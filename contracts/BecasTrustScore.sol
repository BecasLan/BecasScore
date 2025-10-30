// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title BecasTrustScore
 * @dev Decentralized trust score registry for Becas AI Security Platform
 * @notice This contract stores and manages user trust scores on Base blockchain
 */
contract BecasTrustScore {

    // Contract owner
    address public owner;

    // Struct to store user trust data
    struct TrustData {
        uint256 score;              // Trust score (0-100)
        uint256 riskScore;          // Risk score (0-100)
        uint256 totalViolations;    // Total violations count
        uint256 lastUpdated;        // Timestamp of last update
        bool exists;                // Check if user exists
    }

    // Mapping from user Discord ID (as string hash) to trust data
    mapping(bytes32 => TrustData) public trustScores;

    // Mapping from Basename to Discord ID hash (for Basename integration)
    mapping(string => bytes32) public basenameToUserId;

    // Mapping from wallet address to Discord ID hash (for Base Account integration)
    mapping(address => bytes32) public walletToUserId;

    // Array to track all user IDs
    bytes32[] public allUsers;

    // Events
    event TrustScoreUpdated(bytes32 indexed userId, uint256 score, uint256 riskScore);
    event UserRegistered(bytes32 indexed userId, address indexed wallet);
    event BasenameLinked(string indexed basename, bytes32 indexed userId);

    // Modifiers
    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner can call this");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /**
     * @dev Register or update user trust score
     * @param userId Discord user ID (hashed for privacy)
     * @param score Trust score (0-100)
     * @param riskScore Risk score (0-100)
     * @param violations Total violations count
     */
    function updateTrustScore(
        bytes32 userId,
        uint256 score,
        uint256 riskScore,
        uint256 violations
    ) external onlyOwner {
        require(score <= 100, "Score must be <= 100");
        require(riskScore <= 100, "Risk score must be <= 100");

        if (!trustScores[userId].exists) {
            allUsers.push(userId);
            trustScores[userId].exists = true;
        }

        trustScores[userId].score = score;
        trustScores[userId].riskScore = riskScore;
        trustScores[userId].totalViolations = violations;
        trustScores[userId].lastUpdated = block.timestamp;

        emit TrustScoreUpdated(userId, score, riskScore);
    }

    /**
     * @dev Link wallet address to user ID (Base Account integration)
     * @param userId Discord user ID hash
     * @param wallet User's wallet address
     */
    function linkWallet(bytes32 userId, address wallet) external onlyOwner {
        require(wallet != address(0), "Invalid wallet address");
        walletToUserId[wallet] = userId;
        emit UserRegistered(userId, wallet);
    }

    /**
     * @dev Link Basename to user ID (Basename integration)
     * @param basename User's Basename (e.g., "alice.base.eth")
     * @param userId Discord user ID hash
     */
    function linkBasename(string memory basename, bytes32 userId) external onlyOwner {
        require(bytes(basename).length > 0, "Invalid basename");
        basenameToUserId[basename] = userId;
        emit BasenameLinked(basename, userId);
    }

    /**
     * @dev Get trust score by user ID
     * @param userId Discord user ID hash
     * @return score Trust score
     * @return riskScore Risk score
     * @return violations Total violations
     * @return lastUpdated Last update timestamp
     */
    function getTrustScore(bytes32 userId) external view returns (
        uint256 score,
        uint256 riskScore,
        uint256 violations,
        uint256 lastUpdated
    ) {
        require(trustScores[userId].exists, "User not found");
        TrustData memory data = trustScores[userId];
        return (data.score, data.riskScore, data.totalViolations, data.lastUpdated);
    }

    /**
     * @dev Get trust score by wallet address (Base Account)
     * @param wallet User's wallet address
     */
    function getTrustScoreByWallet(address wallet) external view returns (
        uint256 score,
        uint256 riskScore,
        uint256 violations,
        uint256 lastUpdated
    ) {
        bytes32 userId = walletToUserId[wallet];
        require(trustScores[userId].exists, "User not found");
        TrustData memory data = trustScores[userId];
        return (data.score, data.riskScore, data.totalViolations, data.lastUpdated);
    }

    /**
     * @dev Get trust score by Basename
     * @param basename User's Basename
     */
    function getTrustScoreByBasename(string memory basename) external view returns (
        uint256 score,
        uint256 riskScore,
        uint256 violations,
        uint256 lastUpdated
    ) {
        bytes32 userId = basenameToUserId[basename];
        require(trustScores[userId].exists, "User not found");
        TrustData memory data = trustScores[userId];
        return (data.score, data.riskScore, data.totalViolations, data.lastUpdated);
    }

    /**
     * @dev Get total number of registered users
     */
    function getTotalUsers() external view returns (uint256) {
        return allUsers.length;
    }

    /**
     * @dev Get leaderboard (top trusted users)
     * @param limit Number of users to return
     */
    function getLeaderboard(uint256 limit) external view returns (
        bytes32[] memory userIds,
        uint256[] memory scores
    ) {
        uint256 count = allUsers.length < limit ? allUsers.length : limit;
        userIds = new bytes32[](count);
        scores = new uint256[](count);

        // Simple implementation - in production, this should be optimized
        for (uint256 i = 0; i < count; i++) {
            userIds[i] = allUsers[i];
            scores[i] = trustScores[allUsers[i]].score;
        }

        return (userIds, scores);
    }

    /**
     * @dev Transfer ownership
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid address");
        owner = newOwner;
    }
}
