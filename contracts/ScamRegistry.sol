// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// OpenZeppelin Ownable gives us a single owner address with onlyOwner modifier.
// We use the treasury wallet as the initial owner so that admin functions
// are controlled by the treasury, not the deployer.
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

// IERC20 is the standard interface for ERC-20 tokens like USDC.
// We use it to call transferFrom (to collect the $5 fee) and transfer
// (to pay out the treasury, developer, and reporter).
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title ArcShield ScamRegistry v8
/// @author Built with Arc Studio — https://studio.arc.io
/// @notice Decentralised scam registry and verification marketplace on Arc.
///
/// ┌─────────────────────────────────────────────────────────┐
/// │  HOW IT WORKS (plain English)                           │
/// │                                                         │
/// │  1. Anyone can register as a Reporter (once per wallet).│
/// │  2. Reporters submit scam reports linking an X handle   │
/// │     to on-chain evidence. Each report is an ALLEGATION. │
/// │  3. If the same handle is reported again, the second    │
/// │     submission is stored as a CORROBORATION — it adds   │
/// │     credibility but earns no reward.                    │
/// │  4. Searchers pay $5 USDC to unlock the full evidence   │
/// │     for ANY found record (regardless of status).        │
/// │  5. The $5 splits: 50% treasury, 30% developer, 20%    │
/// │     original reporter (pull-payment, claim any time).   │
/// │  6. Admins (treasury or developer wallet) can classify  │
/// │     records: Reported → UnderReview → Verified.         │
/// └─────────────────────────────────────────────────────────┘
///
/// Status model:
///   Reported    (0) — allegation submitted, not yet reviewed
///   UnderReview (1) — flagged for investigation by an admin
///   Verified    (2) — confirmed scam
///
/// Fee model:
///   Any found record (any status) triggers the $5 USDC gate.
///   No record found = free.
///
/// Scalability design (built to handle millions of records):
///   - reporterRecordKeys: each reporter has their own key list (O(1) lookup).
///   - getRecordKeysPaginated: admin loads records 50 at a time, not all at once.
///   - getReporterListPaginated: same pattern for the reporter list.
///   - getRecordsByReporter: returns only that reporter's keys directly.
///   - corroborations are stored per primary key, paginated separately.
contract ScamRegistry is Ownable {

    // ── Enums ─────────────────────────────────────────────────────────

    enum RecordStatus { Reported, UnderReview, Verified }

    // ── Structs ───────────────────────────────────────────────────────

    struct ScamRecord {
        string xHandle;
        string walletAddress;
        string profileLink;    // required — direct link to the scam profile
        string evidenceUrl;
        string description;
        address reporter;
        uint256 timestamp;
        bool active;
        RecordStatus status;
        uint256 corroborationCount; // number of additional reporters who confirmed this
    }

    struct Reporter {
        address wallet;
        string handle;
        string profileUrl;     // required — reporter's own X profile URL
        bool registered;
        bool banned;
        uint256 totalSubmissions;
        uint256 totalRewardsEarned;
    }

    struct Corroboration {
        address reporter;
        string reporterHandle;
        string reporterProfileUrl;
        uint256 timestamp;
    }

    // ── State ─────────────────────────────────────────────────────────

    /// @dev The fee searchers pay to unlock a found record (in USDC micro-units, 6 decimals).
    ///      e.g. 5000000 = $5.00 USDC. Only the treasury (owner) can change this.
    uint256 public lookupFee;

    /// @dev Arc's USDC token address. Same on testnet and mainnet.
    ///      Immutable — set once in the constructor and can never change.
    address public immutable usdcToken;

    /// @dev The developer wallet. Receives 30% of every paid lookup.
    ///      Only the current developer can update this (via setDeveloper).
    address public developer;

    /// @dev The treasury wallet. Receives 50% of every paid lookup.
    ///      Also the contract owner — controls fee updates and admin actions.
    ///      Updated via setTreasury which also transfers Ownable ownership atomically.
    address public treasury;

    // Fee split constants (in basis points, out of 10,000).
    // 5000 = 50%, 3000 = 30%, 2000 = 20%. Must add up to 10,000.
    uint256 public constant PLATFORM_BPS  = 5000; // → treasury
    uint256 public constant DEVELOPER_BPS = 3000; // → developer
    uint256 public constant REPORTER_BPS  = 2000; // → original reporter (claimable)

    /// @dev Lifetime counters for the admin dashboard.
    uint256 public totalQueries;  // total number of paid lookups ever
    uint256 public totalRevenue;  // total USDC collected (in micro-units)

    // ── Core mappings ──────────────────────────────────────────────────

    /// @dev All scam records keyed by their unique bytes32 key.
    ///      Key = keccak256(abi.encode(normalizedHandle, normalizedWallet)).
    mapping(bytes32  => ScamRecord)        public scamRecords;

    /// @dev Fast lookup: normalised X handle → primary record key.
    ///      Used by checkExists and lookupAndPay to find a record in O(1).
    mapping(string   => bytes32)           public handleIndex;

    /// @dev Fast lookup: normalised wallet address → primary record key.
    ///      Only set when a wallet address was provided at submission.
    mapping(string   => bytes32)           public walletIndex;

    /// @dev All registered reporters, indexed by their wallet address.
    mapping(address  => Reporter)          public reporters;

    /// @dev Unclaimed USDC rewards for each reporter (pull-payment pattern).
    ///      Reporters call claimRewards() to withdraw their balance.
    ///      Using pull-payment avoids reentrancy risks from push payments.
    mapping(address  => uint256)           public pendingRewards;

    /// @dev Corroborations for each primary record key.
    ///      Private because it's only accessed via getCorroborations().
    mapping(bytes32  => Corroboration[])   private _corroborations;

    // ── Lists for enumeration and pagination ───────────────────────────

    /// @dev All record keys ever created, in submission order.
    ///      Used by getRecordKeysPaginated for the admin panel.
    bytes32[]  public recordKeys;

    /// @dev Per-reporter list of record keys they submitted.
    ///      This is the scalability key: getRecordsByReporter is O(1) here
    ///      instead of scanning the entire recordKeys array.
    mapping(address => bytes32[]) private reporterRecordKeys;

    /// @dev All registered reporter wallet addresses, in registration order.
    ///      Used by getReporterListPaginated for the admin panel.
    address[]  public reporterList;

    // ── Events ────────────────────────────────────────────────────────

    event ScamReported(bytes32 indexed key, string xHandle, string walletAddress, address indexed reporter);
    event ScamCorroborated(bytes32 indexed key, address indexed reporter, uint256 totalCorroborations);
    event ScamDeactivated(bytes32 indexed key, string xHandle, address indexed byAdmin);
    event ScamReactivated(bytes32 indexed key, string xHandle, address indexed byAdmin);
    event RecordStatusUpdated(bytes32 indexed key, RecordStatus status, address indexed updatedBy);
    event LookupPerformed(bytes32 indexed key, address indexed searcher, uint256 fee);
    event ReporterRegistered(address indexed wallet, string handle);
    event ReporterBanned(address indexed wallet, bool banned);
    event LookupFeeUpdated(uint256 oldFee, uint256 newFee);
    event RewardAccrued(address indexed reporter, uint256 amount);
    event RewardClaimed(address indexed reporter, uint256 amount);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event DeveloperUpdated(address indexed oldDeveloper, address indexed newDeveloper);

    // ── Errors ────────────────────────────────────────────────────────

    error NotRegistered();
    error ReporterIsBanned();
    error RecordNotFound();
    error ZeroAddress();
    error InvalidFee();
    error NothingToClaim();
    error AlreadyInactive();
    error AlreadyActive();
    error NotDeveloper();
    error NotAdmin();
    error AlreadyRegistered();

    // ── Modifiers ─────────────────────────────────────────────────────

    modifier onlyAdmin() {
        if (msg.sender != owner() && msg.sender != developer) revert NotAdmin();
        _;
    }

    // ── Constructor ───────────────────────────────────────────────────

    /// @param initialOwner  Treasury wallet — owns the contract.
    /// @param _developer    Developer wallet — receives 30%.
    /// @param _initialFee   Initial lookup fee in USDC micro-units (e.g. 5000000 = $5.00).
    constructor(address initialOwner, address _developer, uint256 _initialFee)
        Ownable(initialOwner)
    {
        if (initialOwner == address(0) || _developer == address(0)) revert ZeroAddress();
        if (_initialFee == 0) revert InvalidFee();

        usdcToken = 0x3600000000000000000000000000000000000000;
        developer = _developer;
        treasury  = initialOwner;
        lookupFee = _initialFee;
    }

    // ── Reporter registration ─────────────────────────────────────────

    /// @notice Register as a reporter. Handle and X profile URL are both required.
    function registerReporter(string calldata handle, string calldata profileUrl) external {
        Reporter storage r = reporters[msg.sender];
        if (r.registered) revert AlreadyRegistered();
        require(bytes(handle).length > 0, "Handle required");
        require(bytes(profileUrl).length > 0, "Profile URL required");

        r.wallet     = msg.sender;
        r.handle     = handle;
        r.profileUrl = profileUrl;
        r.registered = true;
        r.banned     = false;

        reporterList.push(msg.sender);
        emit ReporterRegistered(msg.sender, handle);
    }

    // ── Scam reporting ────────────────────────────────────────────────

    /// @notice Submit a scam report. If the handle already exists, stores as corroboration.
    ///         The original reporter keeps the primary record and earns rewards.
    ///         Corroborators earn nothing but add credibility (visible corroboration count).
    function reportScam(
        string calldata xHandle,
        string calldata walletAddress,
        string calldata profileLink,
        string calldata evidenceUrl,
        string calldata description
    ) external {
        Reporter storage r = reporters[msg.sender];
        if (!r.registered)  revert NotRegistered();
        if (r.banned)       revert ReporterIsBanned();
        require(bytes(profileLink).length > 0, "Profile link required");

        string memory normHandle = _toLower(xHandle);
        string memory normWallet = _toLower(walletAddress);

        // If handle already indexed — store as corroboration, not a new primary record
        bytes32 existingKey = handleIndex[normHandle];
        if (existingKey != bytes32(0) && scamRecords[existingKey].active) {
            _corroborations[existingKey].push(Corroboration({
                reporter:          msg.sender,
                reporterHandle:    r.handle,
                reporterProfileUrl: r.profileUrl,
                timestamp:         block.timestamp
            }));
            scamRecords[existingKey].corroborationCount += 1;
            emit ScamCorroborated(existingKey, msg.sender, scamRecords[existingKey].corroborationCount);
            return;
        }

        bytes32 key = keccak256(abi.encode(normHandle, normWallet));

        bool walletProvided = bytes(normWallet).length > 0;

        scamRecords[key] = ScamRecord({
            xHandle:             normHandle,
            walletAddress:       normWallet,
            profileLink:         profileLink,
            evidenceUrl:         evidenceUrl,
            description:         description,
            reporter:            msg.sender,
            timestamp:           block.timestamp,
            active:              true,
            status:              RecordStatus.Reported,
            corroborationCount:  0
        });

        handleIndex[normHandle] = key;
        if (walletProvided) walletIndex[normWallet] = key;

        recordKeys.push(key);
        reporterRecordKeys[msg.sender].push(key);
        r.totalSubmissions += 1;

        emit ScamReported(key, normHandle, normWallet, msg.sender);
    }

    // ── Paid lookup ───────────────────────────────────────────────────

    /// @notice Paid unlock — charges $5 USDC for ANY found record (any status).
    ///         Returns (false, empty) for free if no record is found.
    function lookupAndPay(string calldata query)
        external
        returns (bool found, ScamRecord memory record)
    {
        string memory normQuery = _toLower(query);

        bytes32 key = handleIndex[normQuery];
        if (key == bytes32(0)) key = walletIndex[normQuery];

        ScamRecord storage scamRecord = scamRecords[key];
        if (key == bytes32(0) || !scamRecord.active) {
            totalQueries += 1;
            return (false, scamRecord);
        }

        uint256 fee          = lookupFee;
        uint256 platformCut  = (fee * PLATFORM_BPS)  / 10_000;
        uint256 developerCut = (fee * DEVELOPER_BPS) / 10_000;
        uint256 reporterCut  = (fee * REPORTER_BPS)  / 10_000;

        // CEI: state changes before external calls
        address reporterAddr = scamRecord.reporter;
        pendingRewards[reporterAddr] += reporterCut;
        reporters[reporterAddr].totalRewardsEarned += reporterCut;
        totalQueries += 1;
        totalRevenue += fee;

        IERC20 usdc = IERC20(usdcToken);
        require(usdc.transferFrom(msg.sender, address(this), fee), "USDC transferFrom failed");
        require(usdc.transfer(treasury,  platformCut),  "Platform transfer failed");
        require(usdc.transfer(developer, developerCut), "Developer transfer failed");

        emit LookupPerformed(key, msg.sender, fee);
        emit RewardAccrued(reporterAddr, reporterCut);

        return (true, scamRecord);
    }

    // ── Reporter reward claim ─────────────────────────────────────────

    function claimRewards() external {
        uint256 amount = pendingRewards[msg.sender];
        if (amount == 0) revert NothingToClaim();
        pendingRewards[msg.sender] = 0;
        require(IERC20(usdcToken).transfer(msg.sender, amount), "Reward transfer failed");
        emit RewardClaimed(msg.sender, amount);
    }

    // ── Admin: status classification ──────────────────────────────────

    function setRecordStatus(bytes32 key, RecordStatus status) external onlyAdmin {
        ScamRecord storage rec = scamRecords[key];
        require(bytes(rec.xHandle).length > 0, "Record does not exist");
        require(rec.active, "Record is deactivated");
        rec.status = status;
        emit RecordStatusUpdated(key, status, msg.sender);
    }

    // ── Admin: record management ──────────────────────────────────────

    function deactivateRecord(bytes32 key) external onlyAdmin {
        ScamRecord storage rec = scamRecords[key];
        if (!rec.active) revert AlreadyInactive();
        rec.active = false;
        delete handleIndex[rec.xHandle];
        if (bytes(rec.walletAddress).length > 0) delete walletIndex[rec.walletAddress];
        emit ScamDeactivated(key, rec.xHandle, msg.sender);
    }

    function reactivateRecord(bytes32 key) external onlyAdmin {
        ScamRecord storage rec = scamRecords[key];
        if (rec.active) revert AlreadyActive();
        require(bytes(rec.xHandle).length > 0, "Record does not exist");
        if (handleIndex[rec.xHandle] != bytes32(0) && handleIndex[rec.xHandle] != key) {
            revert();
        }
        rec.active = true;
        handleIndex[rec.xHandle] = key;
        if (bytes(rec.walletAddress).length > 0) walletIndex[rec.walletAddress] = key;
        emit ScamReactivated(key, rec.xHandle, msg.sender);
    }

    // ── Admin: configuration ──────────────────────────────────────────

    function setLookupFee(uint256 newFee) external onlyOwner {
        if (newFee == 0) revert InvalidFee();
        emit LookupFeeUpdated(lookupFee, newFee);
        lookupFee = newFee;
    }

    function setBanStatus(address wallet, bool banned) external onlyAdmin {
        if (!reporters[wallet].registered) revert NotRegistered();
        reporters[wallet].banned = banned;
        emit ReporterBanned(wallet, banned);
    }

    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        emit TreasuryUpdated(treasury, newTreasury);
        treasury = newTreasury;
        _transferOwnership(newTreasury);
    }

    function setDeveloper(address newDeveloper) external {
        if (msg.sender != developer) revert NotDeveloper();
        if (newDeveloper == address(0)) revert ZeroAddress();
        emit DeveloperUpdated(developer, newDeveloper);
        developer = newDeveloper;
    }

    // ── Views ─────────────────────────────────────────────────────────

    function checkExists(string calldata query)
        external view
        returns (bool found, address reporter, uint256 timestamp, RecordStatus status, uint256 corroborationCount)
    {
        string memory normQuery = _toLower(query);
        bytes32 key = handleIndex[normQuery];
        if (key == bytes32(0)) key = walletIndex[normQuery];
        if (key == bytes32(0) || !scamRecords[key].active)
            return (false, address(0), 0, RecordStatus.Reported, 0);
        ScamRecord storage r = scamRecords[key];
        return (true, r.reporter, r.timestamp, r.status, r.corroborationCount);
    }

    function getReporter(address wallet) external view returns (Reporter memory) {
        return reporters[wallet];
    }

    function getCorroborations(bytes32 key) external view returns (Corroboration[] memory) {
        return _corroborations[key];
    }

    function getCorroborationsPaginated(bytes32 key, uint256 offset, uint256 limit)
        external view returns (Corroboration[] memory page, uint256 total)
    {
        Corroboration[] storage corrs = _corroborations[key];
        total = corrs.length;
        if (offset >= total) return (new Corroboration[](0), total);
        uint256 end = offset + limit;
        if (end > total) end = total;
        uint256 len = end - offset;
        page = new Corroboration[](len);
        for (uint256 i = 0; i < len; i++) {
            page[i] = corrs[offset + i];
        }
    }

    function getAllRecordKeys() external view returns (bytes32[] memory) {
        return recordKeys;
    }

    function getRecordKeysPaginated(uint256 offset, uint256 limit)
        external view returns (bytes32[] memory page, uint256 total)
    {
        total = recordKeys.length;
        if (offset >= total) return (new bytes32[](0), total);
        uint256 end = offset + limit;
        if (end > total) end = total;
        uint256 len = end - offset;
        page = new bytes32[](len);
        for (uint256 i = 0; i < len; i++) {
            page[i] = recordKeys[offset + i];
        }
    }

    function getRecordsByReporter(address reporter)
        external view returns (bytes32[] memory)
    {
        bytes32[] storage keys = reporterRecordKeys[reporter];
        uint256 len = keys.length;
        bytes32[] memory result = new bytes32[](len);
        for (uint256 i = 0; i < len; i++) {
            result[i] = keys[len - 1 - i];
        }
        return result;
    }

    function getReporterList() external view returns (address[] memory) {
        return reporterList;
    }

    function getReporterListPaginated(uint256 offset, uint256 limit)
        external view returns (address[] memory page, uint256 total)
    {
        total = reporterList.length;
        if (offset >= total) return (new address[](0), total);
        uint256 end = offset + limit;
        if (end > total) end = total;
        uint256 len = end - offset;
        page = new address[](len);
        for (uint256 i = 0; i < len; i++) {
            page[i] = reporterList[offset + i];
        }
    }

    function getRecordByKey(bytes32 key) external view returns (ScamRecord memory) {
        return scamRecords[key];
    }

    // ── Internal helpers ──────────────────────────────────────────────

    function _toLower(string memory str) internal pure returns (string memory) {
        bytes memory bStr = bytes(str);
        uint256 start = (bStr.length > 0 && bStr[0] == bytes1('@')) ? 1 : 0;
        uint256 len = bStr.length - start;
        bytes memory result = new bytes(len);
        for (uint256 i = 0; i < len; i++) {
            uint8 c = uint8(bStr[start + i]);
            result[i] = (c >= 65 && c <= 90) ? bytes1(c + 32) : bStr[start + i];
        }
        return string(result);
    }
}
