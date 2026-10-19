// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title ArcShield ScamRegistry
/// @notice Decentralised scam registry and verification marketplace on Arc.
///         Reporters register, submit flagged handles/wallets, and earn 20% of every
///         paid lookup. Searchers pay $5 USDC to unlock full evidence. 50% goes to
///         the treasury, 30% to the developer, 20% to the reporter (pull-payment).
///
/// Scalability design:
///   - reporterRecordKeys: per-reporter O(1) key list — no full-scan needed.
///   - getRecordKeysPaginated: admin paginates records in bounded pages.
///   - getReporterListPaginated: admin paginates reporters in bounded pages.
///   - getRecordsByReporter: O(1) via the per-reporter mapping.
contract ScamRegistry is Ownable {
    // ── Structs ───────────────────────────────────────────────────────

    struct ScamRecord {
        string xHandle;
        string walletAddress;
        string evidenceUrl;
        string description;
        address reporter;
        uint256 timestamp;
        bool active;
    }

    struct Reporter {
        address wallet;
        string handle;
        bool registered;
        bool banned;
        uint256 totalSubmissions;
        uint256 totalRewardsEarned;
    }

    // ── State ─────────────────────────────────────────────────────────

    uint256 public lookupFee;
    address public immutable usdcToken;

    /// @notice Developer wallet — receives 30% of every lookup fee.
    ///         Can only be updated by the current developer via setDeveloper().
    address public developer;

    /// @notice Treasury wallet — receives 50% of every lookup fee.
    ///         Also the contract owner (Ownable). setTreasury transfers ownership too.
    address public treasury;

    uint256 public constant PLATFORM_BPS  = 5000; // 50%
    uint256 public constant DEVELOPER_BPS = 3000; // 30%
    uint256 public constant REPORTER_BPS  = 2000; // 20%

    uint256 public totalQueries;
    uint256 public totalRevenue;

    mapping(bytes32  => ScamRecord) public scamRecords;
    mapping(string   => bytes32)    public handleIndex;
    mapping(string   => bytes32)    public walletIndex;
    mapping(address  => Reporter)   public reporters;
    mapping(address  => uint256)    public pendingRewards;

    /// @dev Global ordered list of all record keys (append-only, never removed).
    bytes32[] public recordKeys;

    /// @dev Per-reporter ordered list of their record keys (append-only).
    ///      Enables O(1) getRecordsByReporter without scanning recordKeys.
    mapping(address => bytes32[]) private reporterRecordKeys;

    /// @dev Global ordered list of reporter addresses (append-only).
    address[] public reporterList;

    // ── Events ────────────────────────────────────────────────────────

    event ScamReported(bytes32 indexed key, string xHandle, string walletAddress, address indexed reporter);
    event ScamDeactivated(bytes32 indexed key, string xHandle, address indexed byAdmin);
    event ScamReactivated(bytes32 indexed key, string xHandle, address indexed byAdmin);
    event LookupPerformed(bytes32 indexed key, address indexed searcher, uint256 fee);
    event ReporterRegistered(address indexed wallet, string handle);
    event ReporterBanned(address indexed wallet, bool banned);
    event LookupFeeUpdated(uint256 oldFee, uint256 newFee);
    event RewardAccrued(address indexed reporter, uint256 amount);
    event RewardClaimed(address indexed reporter, uint256 amount);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event DeveloperUpdated(address indexed oldDeveloper, address indexed newDeveloper);

    // ── Errors ────────────────────────────────────────────────────────

    error AlreadyReported();
    error NotRegistered();
    error ReporterIsBanned();
    error RecordNotFound();
    error ZeroAddress();
    error InvalidFee();
    error NothingToClaim();
    error AlreadyInactive();
    error AlreadyActive();
    error NotDeveloper();

    // ── Constructor ───────────────────────────────────────────────────

    /// @param initialOwner  Treasury wallet — owns the contract and controls admin functions.
    /// @param _developer    Developer wallet — receives 30%. Can update itself via setDeveloper().
    /// @param _initialFee   Initial lookup fee in USDC (6 decimals). E.g. 5000000 = $5.00.
    constructor(address initialOwner, address _developer, uint256 _initialFee)
        Ownable(initialOwner)
    {
        if (initialOwner == address(0) || _developer == address(0)) revert ZeroAddress();
        if (_initialFee == 0) revert InvalidFee();

        usdcToken  = 0x3600000000000000000000000000000000000000;
        developer  = _developer;
        treasury   = initialOwner;
        lookupFee  = _initialFee;
    }

    // ── Reporter registration ─────────────────────────────────────────

    function registerReporter(string calldata handle) external {
        Reporter storage r = reporters[msg.sender];
        require(!r.registered, "Already registered");

        r.wallet     = msg.sender;
        r.handle     = handle;
        r.registered = true;
        r.banned     = false;

        reporterList.push(msg.sender);
        emit ReporterRegistered(msg.sender, handle);
    }

    // ── Scam reporting ────────────────────────────────────────────────

    function reportScam(
        string calldata xHandle,
        string calldata walletAddress,
        string calldata evidenceUrl,
        string calldata description
    ) external {
        Reporter storage r = reporters[msg.sender];
        if (!r.registered)  revert NotRegistered();
        if (r.banned)       revert ReporterIsBanned();

        string memory normHandle = _toLower(xHandle);
        string memory normWallet = _toLower(walletAddress);
        bytes32 key = keccak256(abi.encode(normHandle, normWallet));

        // Duplicate prevention: handle always checked; wallet only when non-empty
        if (handleIndex[normHandle] != bytes32(0)) revert AlreadyReported();
        bool walletProvided = bytes(normWallet).length > 0;
        if (walletProvided && walletIndex[normWallet] != bytes32(0)) revert AlreadyReported();

        scamRecords[key] = ScamRecord({
            xHandle:       normHandle,
            walletAddress: normWallet,
            evidenceUrl:   evidenceUrl,
            description:   description,
            reporter:      msg.sender,
            timestamp:     block.timestamp,
            active:        true
        });

        handleIndex[normHandle] = key;
        if (walletProvided) walletIndex[normWallet] = key;

        recordKeys.push(key);
        reporterRecordKeys[msg.sender].push(key); // O(1) per-reporter index

        r.totalSubmissions += 1;
        emit ScamReported(key, normHandle, normWallet, msg.sender);
    }

    // ── Paid lookup ───────────────────────────────────────────────────

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

    // ── Admin: record management ──────────────────────────────────────

    /// @notice Deactivate a fake/erroneous report. Frees the handle slot for re-submission.
    function deactivateRecord(bytes32 key) external onlyOwner {
        ScamRecord storage rec = scamRecords[key];
        if (!rec.active) revert AlreadyInactive();
        rec.active = false;
        delete handleIndex[rec.xHandle];
        if (bytes(rec.walletAddress).length > 0) delete walletIndex[rec.walletAddress];
        emit ScamDeactivated(key, rec.xHandle, msg.sender);
    }

    /// @notice Reactivate a previously deactivated report. Re-indexes the handle/wallet slots.
    function reactivateRecord(bytes32 key) external onlyOwner {
        ScamRecord storage rec = scamRecords[key];
        if (rec.active) revert AlreadyActive();
        require(bytes(rec.xHandle).length > 0, "Record does not exist");
        // Block if the handle was re-claimed by a newer report
        if (handleIndex[rec.xHandle] != bytes32(0) && handleIndex[rec.xHandle] != key) {
            revert AlreadyReported();
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

    function setBanStatus(address wallet, bool banned) external onlyOwner {
        if (!reporters[wallet].registered) revert NotRegistered();
        reporters[wallet].banned = banned;
        emit ReporterBanned(wallet, banned);
    }

    /// @notice Update the treasury wallet. Also transfers Ownable ownership so they stay in sync.
    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        emit TreasuryUpdated(treasury, newTreasury);
        treasury = newTreasury;
        _transferOwnership(newTreasury);
    }

    /// @notice Only the current developer can call this.
    function setDeveloper(address newDeveloper) external {
        if (msg.sender != developer) revert NotDeveloper();
        if (newDeveloper == address(0)) revert ZeroAddress();
        emit DeveloperUpdated(developer, newDeveloper);
        developer = newDeveloper;
    }

    // ── Views ─────────────────────────────────────────────────────────

    /// @notice Free check: returns whether a query is flagged plus reporter/timestamp.
    ///         Does NOT return evidence URL or description — those require the paid lookup.
    function checkExists(string calldata query)
        external view
        returns (bool found, address reporter, uint256 timestamp)
    {
        string memory normQuery = _toLower(query);
        bytes32 key = handleIndex[normQuery];
        if (key == bytes32(0)) key = walletIndex[normQuery];
        if (key == bytes32(0) || !scamRecords[key].active) return (false, address(0), 0);
        ScamRecord storage r = scamRecords[key];
        return (true, r.reporter, r.timestamp);
    }

    function getReporter(address wallet) external view returns (Reporter memory) {
        return reporters[wallet];
    }

    function getAllRecordKeys() external view returns (bytes32[] memory) {
        return recordKeys;
    }

    /// @notice Paginated record keys. offset=0, limit=50 to get first page; increment offset for next.
    ///         Returns (page, total) so caller knows when to stop.
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

    /// @notice O(1) — returns this reporter's record keys directly from their own index.
    ///         Returns newest-first by reversing the append-order array.
    function getRecordsByReporter(address reporter)
        external view returns (bytes32[] memory)
    {
        bytes32[] storage keys = reporterRecordKeys[reporter];
        uint256 len = keys.length;
        bytes32[] memory result = new bytes32[](len);
        // Reverse so newest is first
        for (uint256 i = 0; i < len; i++) {
            result[i] = keys[len - 1 - i];
        }
        return result;
    }

    function getReporterList() external view returns (address[] memory) {
        return reporterList;
    }

    /// @notice Paginated reporter list. offset=0, limit=50 to get first page.
    ///         Returns (page, total) so caller knows when to stop.
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

    /// @dev Normalise: strip a leading @ and lowercase everything.
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
