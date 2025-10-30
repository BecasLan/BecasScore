import { ethers } from 'ethers';
import { createLogger } from './Logger';

const logger = createLogger('BlockchainService');

/**
 * BlockchainService - Handles interaction with BecasTrustScore contract on Base
 */
export class BlockchainService {
  private provider: ethers.JsonRpcProvider | null = null;
  private wallet: ethers.Wallet | null = null;
  private contract: ethers.Contract | null = null;
  private contractAddress: string;
  private enabled: boolean;

  // Contract ABI (only functions we need)
  private readonly CONTRACT_ABI = [
    "function updateTrustScore(bytes32 userId, uint256 score, uint256 riskScore, uint256 violations) external",
    "function linkWallet(bytes32 userId, address wallet) external",
    "function linkBasename(string basename, bytes32 userId) external",
    "function getTrustScore(bytes32 userId) external view returns (uint256 score, uint256 riskScore, uint256 violations, uint256 lastUpdated)",
    "function getTrustScoreByWallet(address wallet) external view returns (uint256 score, uint256 riskScore, uint256 violations, uint256 lastUpdated)",
    "function getTrustScoreByBasename(string basename) external view returns (uint256 score, uint256 riskScore, uint256 violations, uint256 lastUpdated)",
    "function getTotalUsers() external view returns (uint256)",
    "function getLeaderboard(uint256 limit) external view returns (bytes32[] userIds, uint256[] scores)"
  ];

  constructor() {
    this.contractAddress = process.env.CONTRACT_ADDRESS || '';
    this.enabled = !!(process.env.CONTRACT_ADDRESS && process.env.PRIVATE_KEY);

    if (this.enabled) {
      this.initialize();
    } else {
      logger.warn('⚠️  Blockchain service disabled (missing CONTRACT_ADDRESS or PRIVATE_KEY)');
    }
  }

  private initialize() {
    try {
      // Connect to Base Sepolia
      const rpcUrl = process.env.BASE_SEPOLIA_RPC || 'https://sepolia.base.org';
      this.provider = new ethers.JsonRpcProvider(rpcUrl);

      // Create wallet
      if (process.env.PRIVATE_KEY) {
        this.wallet = new ethers.Wallet(process.env.PRIVATE_KEY, this.provider);

        // Connect to contract
        this.contract = new ethers.Contract(
          this.contractAddress,
          this.CONTRACT_ABI,
          this.wallet
        );

        logger.info('✅ Blockchain service initialized');
        logger.info(`📍 Contract: ${this.contractAddress}`);
        logger.info(`🔗 Network: Base Sepolia`);
      }
    } catch (error) {
      logger.error('Failed to initialize blockchain service:', error);
      this.enabled = false;
    }
  }

  /**
   * Convert Discord user ID to bytes32 hash
   */
  private hashUserId(discordId: string): string {
    return ethers.id(discordId);
  }

  /**
   * Update trust score on blockchain
   */
  async updateTrustScore(
    discordId: string,
    score: number,
    riskScore: number,
    violations: number
  ): Promise<string | null> {
    if (!this.enabled || !this.contract) {
      logger.debug('Blockchain disabled, skipping trust score update');
      return null;
    }

    try {
      const userId = this.hashUserId(discordId);
      logger.info(`📝 Updating trust score on blockchain for user ${discordId}`);

      const tx = await this.contract.updateTrustScore(
        userId,
        BigInt(score),
        BigInt(riskScore),
        BigInt(violations)
      );

      logger.info(`⏳ Transaction sent: ${tx.hash}`);
      await tx.wait();
      logger.info(`✅ Trust score updated on blockchain!`);

      return tx.hash;
    } catch (error) {
      logger.error('Failed to update trust score on blockchain:', error);
      return null;
    }
  }

  /**
   * Link wallet address to Discord user
   */
  async linkWallet(discordId: string, walletAddress: string): Promise<string | null> {
    if (!this.enabled || !this.contract) return null;

    try {
      const userId = this.hashUserId(discordId);
      logger.info(`🔗 Linking wallet ${walletAddress} to Discord user ${discordId}`);

      const tx = await this.contract.linkWallet(userId, walletAddress);
      await tx.wait();

      logger.info(`✅ Wallet linked on blockchain!`);
      return tx.hash;
    } catch (error) {
      logger.error('Failed to link wallet:', error);
      return null;
    }
  }

  /**
   * Link Basename to Discord user
   */
  async linkBasename(discordId: string, basename: string): Promise<string | null> {
    if (!this.enabled || !this.contract) return null;

    try {
      const userId = this.hashUserId(discordId);
      logger.info(`🏷️  Linking Basename ${basename} to Discord user ${discordId}`);

      const tx = await this.contract.linkBasename(basename, userId);
      await tx.wait();

      logger.info(`✅ Basename linked on blockchain!`);
      return tx.hash;
    } catch (error) {
      logger.error('Failed to link basename:', error);
      return null;
    }
  }

  /**
   * Get trust score from blockchain by Discord ID
   */
  async getTrustScore(discordId: string): Promise<{
    score: number;
    riskScore: number;
    violations: number;
    lastUpdated: number;
  } | null> {
    if (!this.enabled || !this.contract) return null;

    try {
      const userId = this.hashUserId(discordId);
      const result = await this.contract.getTrustScore(userId);

      return {
        score: Number(result[0]),
        riskScore: Number(result[1]),
        violations: Number(result[2]),
        lastUpdated: Number(result[3])
      };
    } catch (error) {
      logger.debug(`User ${discordId} not found on blockchain`);
      return null;
    }
  }

  /**
   * Get trust score by wallet address
   */
  async getTrustScoreByWallet(walletAddress: string): Promise<{
    score: number;
    riskScore: number;
    violations: number;
    lastUpdated: number;
  } | null> {
    if (!this.enabled || !this.contract) return null;

    try {
      const result = await this.contract.getTrustScoreByWallet(walletAddress);

      return {
        score: Number(result[0]),
        riskScore: Number(result[1]),
        violations: Number(result[2]),
        lastUpdated: Number(result[3])
      };
    } catch (error) {
      logger.debug(`Wallet ${walletAddress} not found on blockchain`);
      return null;
    }
  }

  /**
   * Get trust score by Basename
   */
  async getTrustScoreByBasename(basename: string): Promise<{
    score: number;
    riskScore: number;
    violations: number;
    lastUpdated: number;
  } | null> {
    if (!this.enabled || !this.contract) return null;

    try {
      const result = await this.contract.getTrustScoreByBasename(basename);

      return {
        score: Number(result[0]),
        riskScore: Number(result[1]),
        violations: Number(result[2]),
        lastUpdated: Number(result[3])
      };
    } catch (error) {
      logger.debug(`Basename ${basename} not found on blockchain`);
      return null;
    }
  }

  /**
   * Get leaderboard from blockchain
   */
  async getLeaderboard(limit: number = 20): Promise<Array<{
    userId: string;
    score: number;
  }>> {
    if (!this.enabled || !this.contract) return [];

    try {
      const result = await this.contract.getLeaderboard(BigInt(limit));
      const userIds = result[0];
      const scores = result[1];

      return userIds.map((userId: string, index: number) => ({
        userId,
        score: Number(scores[index])
      }));
    } catch (error) {
      logger.error('Failed to get leaderboard from blockchain:', error);
      return [];
    }
  }

  /**
   * Get total users on blockchain
   */
  async getTotalUsers(): Promise<number> {
    if (!this.enabled || !this.contract) return 0;

    try {
      const total = await this.contract.getTotalUsers();
      return Number(total);
    } catch (error) {
      logger.error('Failed to get total users:', error);
      return 0;
    }
  }

  /**
   * Check if blockchain service is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Get contract address
   */
  getContractAddress(): string {
    return this.contractAddress;
  }
}

// Singleton instance
export const blockchainService = new BlockchainService();
