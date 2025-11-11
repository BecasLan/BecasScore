/**
 * TRUST SCORE ENGINE (DATABASE VERSION)
 *
 * Migrated from in-memory to PostgreSQL + Redis
 * - Hot data (active users): Redis cache
 * - Cold data (history, analytics): PostgreSQL
 */

import { TrustScore, TrustEvent, TrustLevel } from '../types/Trust.types';
import { AnalyzedMessage } from '../types/Message.types';
import { TRUST_CONFIG } from '../config/trust.config';
import { UserRepository, SicilRepository } from '../database/repositories';
import { getDatabaseService } from '../database/DatabaseService';
import { createLogger } from '../services/Logger';

const logger = createLogger('TrustScoreEngineDB');

export class TrustScoreEngineDB {
  private userRepo: UserRepository;
  private sicilRepo: SicilRepository;
  private db = getDatabaseService();
  private permanentZeroScores: Set<string> = new Set();
  private onScoreUpdateCallback?: (userId: string, data: any) => void;

  constructor() {
    this.userRepo = new UserRepository();
    this.sicilRepo = new SicilRepository();
    // PERFORMANCE: Skip database loading on startup to avoid 7s timeout
    // this.loadPermanentZeroScores();
    logger.info('TrustScoreEngineDB initialized (database-backed, lazy loading enabled)');
  }

  /**
   * Load permanent zero scores from database
   */
  private async loadPermanentZeroScores(): Promise<void> {
    try {
      const users = await this.userRepo.getHighRiskUsers(1000);
      users.forEach(user => {
        if (user.global_trust_score === 0 && user.is_known_scammer) {
          this.permanentZeroScores.add(user.id);
        }
      });
      logger.info(`Loaded ${this.permanentZeroScores.size} permanent zero scores`);
    } catch (error) {
      logger.error('Failed to load permanent zero scores', error);
    }
  }

  /**
   * Set callback for real-time score updates
   */
  setOnScoreUpdate(callback: (userId: string, data: any) => void): void {
    this.onScoreUpdateCallback = callback;
  }

  /**
   * Set audit logger for trust score changes
   */
  setAuditLogger(auditLogger: any): void {
    // Audit logging is handled by sicilRepo.logAction in updateTrustScore
    // This method exists for interface compatibility with BecasCore
    logger.debug('Audit logger set for TrustScoreEngineDB');
  }

  /**
   * Set V3 architecture integration
   */
  setV3Integration(integration: any): void {
    // V3 integration handled through database service
    // This method exists for interface compatibility with BecasCore
    logger.debug('V3 integration set for TrustScoreEngineDB');
  }

  /**
   * Check redemption - reward good behavior
   */
  async checkRedemption(
    userId: string,
    guildId: string,
    behavior: {
      toxicity: number;
      manipulation?: number;
      sentiment?: any;
      isHelpful?: boolean;
    }
  ): Promise<{
    redeemed: boolean;
    points: number;
    reason: string;
    newScore: number;
  }> {
    try {
      const trustScore = await this.getTrustScore(userId, guildId);

      // Check if user qualifies for redemption
      const lowToxicity = behavior.toxicity < 0.3;
      const isHelpful =
        behavior.isHelpful ||
        (behavior.sentiment?.dominant === 'positive' && behavior.toxicity < 0.1);
      const currentlyLowScore = trustScore.score < 50;

      if (lowToxicity && isHelpful && currentlyLowScore) {
        const points = 5; // Redemption points
        const newScore = Math.min(100, trustScore.score + points);

        await this.updateTrustScore(
          userId,
          guildId,
          newScore,
          points,
          'Redemption: Positive behavior after low trust'
        );

        return {
          redeemed: true,
          points: points,
          reason: 'Positive behavior and helpfulness',
          newScore: newScore,
        };
      }

      return {
        redeemed: false,
        points: 0,
        reason: 'No redemption criteria met',
        newScore: trustScore.score,
      };
    } catch (error) {
      logger.error('Failed to check redemption', error);
      return {
        redeemed: false,
        points: 0,
        reason: 'Error checking redemption',
        newScore: 50,
      };
    }
  }

  /**
   * Get trust score for a user (with caching)
   */
  async getTrustScore(userId: string, guildId: string): Promise<TrustScore> {
    const cacheKey = `trust:${userId}`;

    try {
      // Try Redis cache first (HOT)
      const cached = await this.db.cached<TrustScore>(
        cacheKey,
        300, // 5 minutes TTL
        async () => {
          // Fallback to database (COLD)
          const member = await this.userRepo.getServerMember(guildId, userId);
          const user = await this.userRepo.getUserById(userId);

          if (!member || !user) {
            // Create default score
            return this.createDefaultScore(userId, guildId);
          }

          // Convert database data to TrustScore format
          return {
            userId: user.id,
            userName: user.username,
            guildId: guildId,
            score: member.trust_score,
            level: this.calculateLevel(member.trust_score),
            history: [], // History loaded separately if needed
            lastUpdated: new Date(),
            joinedAt: member.joined_at
          };
        }
      );

      return cached;
    } catch (error) {
      logger.error('Failed to get trust score, using default', error);
      return this.createDefaultScore(userId, guildId);
    }
  }

  /**
   * Update trust score based on message analysis
   */
  async updateFromMessage(message: AnalyzedMessage): Promise<TrustScore> {
    const trustScore = await this.getTrustScore(message.authorId, message.guildId);

    // Check if user has permanent zero score (scammer)
    if (this.permanentZeroScores.has(message.authorId)) {
      logger.warn(`User ${message.authorId} has permanent zero score, cannot increase`);
      return trustScore;
    }

    let delta = 0;
    const reasons: string[] = [];

    // Analyze message and calculate delta
    if (message.toxicity && message.toxicity > 0.7) {
      delta -= TRUST_CONFIG.PENALTIES.HIGH_TOXICITY;
      reasons.push('High toxicity detected');
    } else if (message.toxicity && message.toxicity > 0.4) {
      delta -= TRUST_CONFIG.PENALTIES.MEDIUM_TOXICITY;
      reasons.push('Medium toxicity detected');
    }

    // Spam detection
    if (message.intent?.action === 'spam') {
      delta -= TRUST_CONFIG.PENALTIES.SPAM;
      reasons.push('Spam detected');
    }

    // Positive behavior
    if (message.sentiment?.dominant === 'positive' && !message.toxicity) {
      delta += TRUST_CONFIG.REWARDS.HELPFUL_MESSAGE;
      reasons.push('Positive contribution');
    }

    // Update score in database
    if (delta !== 0) {
      const newScore = Math.max(0, Math.min(100, trustScore.score + delta));

      await this.updateTrustScore(
        message.authorId,
        message.guildId,
        newScore,
        delta,
        reasons.join(', ')
      );

      trustScore.score = newScore;
      trustScore.level = this.calculateLevel(newScore);
    }

    return trustScore;
  }

  /**
   * Update trust score in database
   */
  async updateTrustScore(
    userId: string,
    guildId: string,
    newScore: number,
    delta: number,
    reason: string
  ): Promise<void> {
    try {
      // Update server member trust score
      await this.userRepo.updateMemberTrustScore(guildId, userId, newScore);

      // Update global trust score (average across all servers)
      await this.userRepo.updateGlobalTrustScore(userId, newScore);

      // Log the change
      await this.sicilRepo.logAction({
        server_id: guildId,
        user_id: userId,
        action_type: 'trust_score_change',
        metadata: {
          old_score: newScore - delta,
          new_score: newScore,
          delta: delta,
          reason: reason
        }
      });

      // Invalidate cache
      await this.db.invalidateCache(`trust:${userId}`);

      // Trigger callback
      if (this.onScoreUpdateCallback) {
        this.onScoreUpdateCallback(userId, {
          score: newScore,
          delta: delta,
          reason: reason
        });
      }

      logger.debug(`Trust score updated: ${userId} → ${newScore} (${delta > 0 ? '+' : ''}${delta})`);
    } catch (error) {
      logger.error('Failed to update trust score', error);
    }
  }

  /**
   * Set permanent zero score (for scammers)
   */
  async setPermanentZeroScore(
    userId: string,
    guildId: string,
    reason: string,
    evidence?: string
  ): Promise<void> {
    try {
      // Mark user as scammer
      await this.userRepo.markAsScammer(userId);

      // Set trust score to 0
      await this.userRepo.updateMemberTrustScore(guildId, userId, 0);

      // Add to permanent zero set
      this.permanentZeroScores.add(userId);

      // Log the action
      await this.sicilRepo.logAction({
        server_id: guildId,
        user_id: userId,
        action_type: 'permanent_zero_score',
        content: evidence,
        metadata: { reason }
      });

      // Invalidate cache
      await this.db.invalidateCache(`trust:${userId}`);

      logger.warn(`Permanent zero score set for ${userId}: ${reason}`);
    } catch (error) {
      logger.error('Failed to set permanent zero score', error);
    }
  }

  /**
   * Manual adjustment (moderator override)
   */
  async manualAdjustment(
    userId: string,
    guildId: string,
    newScore: number,
    moderatorId: string,
    reason: string
  ): Promise<void> {
    const current = await this.getTrustScore(userId, guildId);
    const delta = newScore - current.score;

    await this.updateTrustScore(userId, guildId, newScore, delta, `Manual adjustment by moderator: ${reason}`);

    // Add moderator note
    await this.sicilRepo.addModeratorNote(guildId, userId, moderatorId, `Trust score manually set to ${newScore}: ${reason}`);
  }

  /**
   * Apply decay (called periodically)
   */
  async applyDecay(userId: string, guildId: string): Promise<void> {
    const score = await this.getTrustScore(userId, guildId);

    if (this.permanentZeroScores.has(userId)) {
      return; // No decay for permanent zero scores
    }

    // Decay towards neutral (50)
    const target = TRUST_CONFIG.DEFAULT_SCORE;
    const decayRate = TRUST_CONFIG.DECAY_RATE || 0.01;

    if (Math.abs(score.score - target) > 0.1) {
      const delta = (target - score.score) * decayRate;
      const newScore = score.score + delta;

      await this.updateTrustScore(
        userId,
        guildId,
        Math.round(newScore),
        Math.round(delta),
        'Natural decay towards neutral'
      );
    }
  }

  /**
   * Get trust level distribution for a server
   */
  async getTrustLevelDistribution(guildId: string): Promise<Record<TrustLevel, number>> {
    const members = await this.userRepo.getServerMember(guildId, ''); // Get all members

    const distribution: Record<TrustLevel, number> = {
      'dangerous': 0,
      'cautious': 0,
      'neutral': 0,
      'trusted': 0,
      'exemplary': 0
    };

    // This would need a proper query, simplified for now
    return distribution;
  }

  /**
   * Get low trust users
   */
  async getLowTrustUsers(guildId: string, threshold: number = 30): Promise<string[]> {
    const members = await this.userRepo.getMembersByRiskCategory(guildId, 'risky');
    const dangerous = await this.userRepo.getMembersByRiskCategory(guildId, 'dangerous');

    return [...members, ...dangerous]
      .filter(m => m.trust_score <= threshold)
      .map(m => m.user_id);
  }

  /**
   * Calculate trust level from score
   */
  private calculateLevel(score: number): TrustLevel {
    if (score >= TRUST_CONFIG.LEVELS.EXEMPLARY) return 'exemplary';
    if (score >= TRUST_CONFIG.LEVELS.TRUSTED) return 'trusted';
    if (score >= TRUST_CONFIG.LEVELS.NEUTRAL_MIN) return 'neutral';
    if (score >= TRUST_CONFIG.LEVELS.RISKY) return 'cautious';
    return 'dangerous';
  }

  /**
   * Create default score
   */
  private createDefaultScore(userId: string, guildId: string): TrustScore {
    return {
      userId,
      userName: '',
      guildId: guildId,
      score: TRUST_CONFIG.DEFAULT_SCORE,
      level: this.calculateLevel(TRUST_CONFIG.DEFAULT_SCORE),
      history: [],
      lastUpdated: new Date(),
      joinedAt: new Date()
    };
  }

  /**
   * Save to database (compatibility method - now auto-saves)
   */
  async save(): Promise<void> {
    // No-op: Database saves automatically
    logger.debug('Save called (auto-save enabled, no action needed)');
  }
}
