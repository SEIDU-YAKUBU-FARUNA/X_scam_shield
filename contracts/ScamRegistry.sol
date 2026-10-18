// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract ScamRegistry is Ownable {
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

    uint256 public lookupFee;
    address public immutable usdcToken;
    // developer is immutable — set once at deploy, never changeable
    address public immutable developer;
    address public treasury;

    uint256 public constant PLATFORM_BPS = 5000;
    uint256 public constant DEVELOPER_BPS = 3000;
    uint256 public constant REPORTER_BPS = 2000;

    uint256 public totalQueries;
    uint256 public totalRevenue;

    mapping(bytes32 => ScamRecord) public scamRecords;
    mapping(string => bytes32) public handleIndex;
    mapping(string => bytes32) public walletIndex;
    mapping(address => Reporter) public reporters;
    mapping(address => uint256) public pendingRewards;

    bytes32[] public recordKeys;
    address[] public reporterList;

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

    error AlreadyReported();
    error NotRegistered();
    error ReporterIsBanned();
    error RecordNotFound();
    error ZeroAddress();
    error InvalidFee();
    error NothingToClaim();
    error AlreadyInactive();
    error AlreadyActive();

    /// @param initialOwner  Treasury wallet — this address owns the contract and controls admin functions.
    /// @param _developer    Developer wallet — immutable, receives 30% of every lookup fee forever.
    /// @param _initialFee   Initial lookup fee in USDC (6 decimals). E.g. 5000000 = $5.00.
    constructor(address initialOwner, address _developer, uint256 _initialFee) Ownable(initialOwner) {
        if (initialOwner == address(0) || _developer == address(0)) {
            revert ZeroAddress();
        }
        if (_initialFee == 0) {
            revert InvalidFee();
        }

        usdcToken = 0x3600000000000000000000000000000000000000;
        developer = _developer;
        // treasury = owner (initialOwner) — the same wallet that controls admin functions receives 50%
        treasury = initialOwner;
        lookupFee = _initialFee;
    }

    function registerReporter(string calldata handle) external {
        Reporter storage reporter = reporters[msg.sender];
        require(!reporter.registered, "Already registered");

        reporter.wallet = msg.sender;
        reporter.handle = handle;
        reporter.registered = true;
        reporter.banned = false;

        reporterList.push(msg.sender);

        emit ReporterRegistered(msg.sender, handle);
    }

    function reportScam(
        string calldata xHandle,
        string calldata walletAddress,
        string calldata evidenceUrl,
        string calldata description
    ) external {
        Reporter storage reporter = reporters[msg.sender];
        if (!reporter.registered) {
            revert NotRegistered();
        }
        if (reporter.banned) {
            revert ReporterIsBanned();
        }

        string memory normalizedHandle = _toLower(xHandle);
        string memory normalizedWallet = _toLower(walletAddress);
        bytes32 key = keccak256(abi.encode(normalizedHandle, normalizedWallet));

        // Check handle duplication always; only check wallet duplication when wallet is non-empty
        bool walletProvided = bytes(normalizedWallet).length > 0;
        if (handleIndex[normalizedHandle] != bytes32(0)) {
            revert AlreadyReported();
        }
        if (walletProvided && walletIndex[normalizedWallet] != bytes32(0)) {
            revert AlreadyReported();
        }

        scamRecords[key] = ScamRecord({
            xHandle: normalizedHandle,
            walletAddress: normalizedWallet,
            evidenceUrl: evidenceUrl,
            description: description,
            reporter: msg.sender,
            timestamp: block.timestamp,
            active: true
        });

        handleIndex[normalizedHandle] = key;
        // Only index wallet when one was provided to avoid empty-string collisions
        if (walletProvided) {
            walletIndex[normalizedWallet] = key;
        }
        recordKeys.push(key);

        reporter.totalSubmissions += 1;

        emit ScamReported(key, normalizedHandle, normalizedWallet, msg.sender);
    }

    function lookupAndPay(string calldata query) external returns (bool found, ScamRecord memory record) {
        string memory normalizedQuery = _toLower(query);

        bytes32 key = handleIndex[normalizedQuery];
        if (key == bytes32(0)) {
            key = walletIndex[normalizedQuery];
        }

        ScamRecord storage scamRecord = scamRecords[key];
        if (key == bytes32(0) || !scamRecord.active) {
            totalQueries += 1;
            return (false, scamRecord);
        }

        uint256 fee = lookupFee;
        uint256 platformCut = (fee * PLATFORM_BPS) / 10_000;
        uint256 developerCut = (fee * DEVELOPER_BPS) / 10_000;
        uint256 reporterCut = (fee * REPORTER_BPS) / 10_000;

        // CEI: accrue reporter reward before external calls
        address reporterAddr = scamRecord.reporter;
        pendingRewards[reporterAddr] += reporterCut;
        reporters[reporterAddr].totalRewardsEarned += reporterCut;
        totalQueries += 1;
        totalRevenue += fee;

        IERC20 usdc = IERC20(usdcToken);
        require(usdc.transferFrom(msg.sender, address(this), fee), "USDC transferFrom failed");
        require(usdc.transfer(treasury, platformCut), "Platform transfer failed");
        require(usdc.transfer(developer, developerCut), "Developer transfer failed");

        emit LookupPerformed(key, msg.sender, fee);
        emit RewardAccrued(reporterAddr, reporterCut);

        return (true, scamRecord);
    }

    /// @notice Admin: deactivate a fake or erroneous report. The handle slot is freed so it can be re-reported.
    function deactivateRecord(bytes32 key) external onlyOwner {
        ScamRecord storage rec = scamRecords[key];
        if (!rec.active) revert AlreadyInactive();
        rec.active = false;
        // Free the handle and wallet index slots so a corrected report can be submitted
        delete handleIndex[rec.xHandle];
        if (bytes(rec.walletAddress).length > 0) {
            delete walletIndex[rec.walletAddress];
        }
        emit ScamDeactivated(key, rec.xHandle, msg.sender);
    }

    /// @notice Admin: reactivate a previously deactivated report. Re-indexes the handle and wallet slots.
    function reactivateRecord(bytes32 key) external onlyOwner {
        ScamRecord storage rec = scamRecords[key];
        if (rec.active) revert AlreadyActive();
        // Guard: ensure the record actually exists (non-empty handle)
        require(bytes(rec.xHandle).length > 0, "Record does not exist");
        // Guard: block reactivation if the handle was already re-claimed by a new report
        if (handleIndex[rec.xHandle] != bytes32(0) && handleIndex[rec.xHandle] != key) {
            revert AlreadyReported();
        }
        rec.active = true;
        handleIndex[rec.xHandle] = key;
        if (bytes(rec.walletAddress).length > 0) {
            walletIndex[rec.walletAddress] = key;
        }
        emit ScamReactivated(key, rec.xHandle, msg.sender);
    }

    function setLookupFee(uint256 newFee) external onlyOwner {
        if (newFee == 0) {
            revert InvalidFee();
        }
        uint256 oldFee = lookupFee;
        lookupFee = newFee;
        emit LookupFeeUpdated(oldFee, newFee);
    }

    function setBanStatus(address wallet, bool banned) external onlyOwner {
        if (!reporters[wallet].registered) {
            revert NotRegistered();
        }
        reporters[wallet].banned = banned;
        emit ReporterBanned(wallet, banned);
    }

    /// @notice Owner can update the treasury address (the 50% cut recipient).
    /// Also transfers Ownable ownership to the new address so owner() and treasury() stay in sync.
    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) {
            revert ZeroAddress();
        }
        emit TreasuryUpdated(treasury, newTreasury);
        treasury = newTreasury;
        _transferOwnership(newTreasury);
    }

    /// @notice Reporter calls this to withdraw their accrued rewards.
    function claimRewards() external {
        uint256 amount = pendingRewards[msg.sender];
        if (amount == 0) revert NothingToClaim();
        pendingRewards[msg.sender] = 0;
        require(IERC20(usdcToken).transfer(msg.sender, amount), "Reward transfer failed");
        emit RewardClaimed(msg.sender, amount);
    }

    /// @notice Free preview: returns whether a query is flagged and the record timestamp/reporter,
    /// but NOT the evidence URL or description (those are unlocked by the paid lookupAndPay call).
    function checkExists(string calldata query)
        external
        view
        returns (bool found, address reporter, uint256 timestamp)
    {
        string memory normalizedQuery = _toLower(query);

        bytes32 key = handleIndex[normalizedQuery];
        if (key == bytes32(0)) {
            key = walletIndex[normalizedQuery];
        }

        if (key == bytes32(0) || !scamRecords[key].active) {
            return (false, address(0), 0);
        }

        ScamRecord storage r = scamRecords[key];
        return (true, r.reporter, r.timestamp);
    }

    function getReporter(address wallet) external view returns (Reporter memory) {
        return reporters[wallet];
    }

    function getAllRecordKeys() external view returns (bytes32[] memory) {
        return recordKeys;
    }

    /// @notice Return a paginated slice of recordKeys. Use offset=0, limit=50 then increment offset.
    function getRecordKeysPaginated(uint256 offset, uint256 limit)
        external view returns (bytes32[] memory page, uint256 total)
    {
        total = recordKeys.length;
        if (offset >= total) {
            return (new bytes32[](0), total);
        }
        uint256 end = offset + limit;
        if (end > total) end = total;
        uint256 len = end - offset;
        page = new bytes32[](len);
        for (uint256 i = 0; i < len; i++) {
            page[i] = recordKeys[offset + i];
        }
    }

    /// @notice Return keys of all records submitted by a specific reporter, newest first.
    /// Scans recordKeys — use getRecordKeysPaginated on a large registry.
    function getRecordsByReporter(address reporter)
        external view returns (bytes32[] memory)
    {
        uint256 count = 0;
        for (uint256 i = 0; i < recordKeys.length; i++) {
            if (scamRecords[recordKeys[i]].reporter == reporter) count++;
        }
        bytes32[] memory result = new bytes32[](count);
        uint256 idx = 0;
        // Iterate newest-first
        for (uint256 i = recordKeys.length; i > 0; i--) {
            if (scamRecords[recordKeys[i - 1]].reporter == reporter) {
                result[idx++] = recordKeys[i - 1];
            }
        }
        return result;
    }

    function getReporterList() external view returns (address[] memory) {
        return reporterList;
    }

    function getRecordByKey(bytes32 key) external view returns (ScamRecord memory) {
        return scamRecords[key];
    }

    /// @dev Normalise a user-supplied identifier: strip a leading at-sign, lowercase everything.
    function _toLower(string memory str) internal pure returns (string memory) {
        bytes memory bStr = bytes(str);
        uint256 start = 0;
        if (bStr.length > 0 && bStr[0] == bytes1('@')) {
            start = 1;
        }
        uint256 len = bStr.length - start;
        bytes memory result = new bytes(len);
        for (uint256 i = 0; i < len; i++) {
            uint8 charCode = uint8(bStr[start + i]);
            if (charCode >= 65 && charCode <= 90) {
                result[i] = bytes1(charCode + 32);
            } else {
                result[i] = bStr[start + i];
            }
        }
        return string(result);
    }
}
