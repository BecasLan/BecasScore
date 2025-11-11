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
import { UserRepository, SicilRepository, ServerRepository } from '../database/repositories';
import { getDatabaseService } from '../database/DatabaseService';
import { createLogger } from '../services/Logger';

const logger = createLogger('TrustScoreEngineDB');

export class TrustScoreEngineDB {
  private userRepo: UserRepository;
  private sicilRepo: SicilRepository;
  private serverRepo: ServerRepository;
  private db = getDatabaseService();
  private permanentZeroScores: Set<string> = new Set();
  private onScoreUpdateCallback?: (userId: string, data: any) => void;

  constructor() {
    this.userRepo = new UserRepository();
    this.sicilRepo = new SicilRepository();
    this.serverRepo = new ServerRepository();
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
          const user = await this.userRepo.getUserById(userId);

          if (!user) {
            // Create default score
            return this.createDefaultScore(userId, guildId);
          }

          // Use GLOBAL trust score from users table (default to 50 if null/undefined)
          const globalScore = user.global_trust_score ?? 50;

          // Convert database data to TrustScore format
          return {
            userId: user.id,
            userName: user.username,
            guildId: guildId,
            score: globalScore,
            level: this.calculateLevel(globalScore),
            history: [], // History loaded separately if needed
            lastUpdated: new Date(),
            joinedAt: user.first_seen_at
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
    let triggeredModeration = false;
    let violationCategory: 'toxicity' | 'spam' | 'scam' | 'phishing' | 'harassment' | null = null;

    // Analyze message and calculate delta
    if (message.toxicity && message.toxicity > 0.7) {
      delta -= TRUST_CONFIG.PENALTIES.HIGH_TOXICITY;
      reasons.push('High toxicity detected');
      triggeredModeration = true;
      violationCategory = 'toxicity';
    } else if (message.toxicity && message.toxicity > 0.4) {
      delta -= TRUST_CONFIG.PENALTIES.MEDIUM_TOXICITY;
      reasons.push('Medium toxicity detected');
      triggeredModeration = true;
      violationCategory = 'toxicity';
    }

    // Spam detection
    if (message.intent?.action === 'spam') {
      delta -= TRUST_CONFIG.PENALTIES.SPAM;
      reasons.push('Spam detected');
      triggeredModeration = true;
      violationCategory = 'spam';
    }

    // Positive behavior
    if (message.sentiment?.dominant === 'positive' && !message.toxicity) {
      delta += TRUST_CONFIG.REWARDS.HELPFUL_MESSAGE;
      reasons.push('Positive contribution');
    }

    // 🔥 FIX: Log violation to user_actions table with triggered_moderation = true
    // This makes violations visible on the website
    if (triggeredModeration && violationCategory) {
      try {
        await this.sicilRepo.logAction({
          server_id: message.guildId,
          user_id: message.authorId,
          channel_id: message.channelId,
          action_type: 'message_violation',
          content: message.content,
          intent: message.intent?.action,
          sentiment: message.sentiment?.dominant,
          toxicity_score: message.toxicity || 0,
          scam_score: 0,
          spam_score: message.intent?.action === 'spam' ? 1 : 0,
          triggered_moderation: true,
          moderation_action: 'trust_score_penalty',
          metadata: {
            violation_category: violationCategory,
            penalty: delta,
            reason: reasons.join(', '),
            trust_score_before: trustScore.score,
            trust_score_after: Math.max(0, Math.min(100, trustScore.score + delta))
          }
        });
        logger.info(`🚨 Violation logged: ${violationCategory} for user ${message.authorId} (penalty: ${delta})`);
      } catch (error) {
        logger.error('Failed to log violation to user_actions', error);
      }
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
      // 🔥 FIX: Ensure server, user, and server_member records exist BEFORE updating
      // Otherwise UPDATE will silently succeed with 0 rows affected

      // 1. Ensure server exists (required for foreign key)
      const server = await this.serverRepo.getServerById(guildId);
      if (!server) {
        logger.warn(`Server ${guildId} not found, creating record`);
        await this.serverRepo.upsertServer({
          id: guildId,
          name: 'Discord Server',
          owner_id: '0',  // Will be updated later
          member_count: 0
        });
      }

      // 2. Ensure user exists
      const user = await this.userRepo.getUserById(userId);
      if (!user) {
        logger.warn(`User ${userId} not found in users table, creating record`);
        await this.userRepo.upsertUser({
          id: userId,
          username: 'Unknown'  // Will be updated on next message
        });
      }

      // 3. Ensure server_member exists
      const member = await this.userRepo.getServerMember(guildId, userId);
      if (!member) {
        logger.warn(`User ${userId} not found in server ${guildId}, creating record before trust update`);
        await this.userRepo.upsertServerMember({
          server_id: guildId,
          user_id: userId
        });
      }

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
   * 🛡️ NEW: Decrease trust score for Becas Core Violation (GLOBAL)
   * This is called by BecasCoreViolationEngine when a universal rule is violated
   *
   * CRITICAL: This is the ONLY way trust scores should decrease automatically.
   * Guild policy violations do NOT call this method.
   */
  async decreaseScoreForCoreViolation(
    userId: string,
    guildId: string,
    penalty: number,
    violationType: string,
    reason: string
  ): Promise<void> {
    try {
      const currentScore = await this.getTrustScore(userId, guildId);
      const newScore = Math.max(0, currentScore.score - penalty);

      await this.updateTrustScore(
        userId,
        guildId,
        newScore,
        -penalty,
        `Becas Core Violation: ${violationType} - ${reason}`
      );

      logger.warn(
        `[CoreViolation] Trust score decreased: ${userId} → ${newScore} (-${penalty}) [${violationType}]`
      );
    } catch (error) {
      logger.error('Failed to decrease score for core violation', error);
    }
  }

  /**
   * 🛡️ NEW: Calculate trust score from ONLY Becas core violations
   * This reads from becas_core_violations table (not guild_policy_enforcement)
   *
   * Returns the calculated global score based on violation history
   */
  async calculateScoreFromCoreViolations(userId: string): Promise<number> {
    try {
      const result = await this.db.query(
        `
        SELECT violation_type, severity, SUM(trust_penalty) as total_penalty, COUNT(*) as count
        FROM becas_core_violations
        WHERE user_id = $1
        AND timestamp > NOW() - INTERVAL '90 days'
        GROUP BY violation_type, severity
      `,
        [userId]
      );

      let score = 100; // Start at 100

      for (const row of result.rows) {
        score -= row.total_penalty;
      }

      return Math.max(0, score);
    } catch (error) {
      logger.error('Failed to calculate score from core violations', error);
      return 50; // Default score on error
    }
  }

  /**
   * 🛡️ NEW: Get user's core violation summary
   * Returns breakdown of all Becas core violations (not guild policies)
   */
  async getCoreViolationSummary(userId: string): Promise<{
    totalViolations: number;
    violationsByType: Record<string, number>;
    totalPenalty: number;
    recentViolations: any[];
  }> {
    try {
      const result = await this.db.query(
        `
        SELECT
          violation_type,
          severity,
          confidence,
          trust_penalty,
          action_taken,
          timestamp
        FROM becas_core_violations
        WHERE user_id = $1
        AND timestamp > NOW() - INTERVAL '90 days'
        ORDER BY timestamp DESC
        LIMIT 50
      `,
        [userId]
      );

      const violationsByType: Record<string, number> = {};
      let totalPenalty = 0;

      for (const row of result.rows) {
        violationsByType[row.violation_type] = (violationsByType[row.violation_type] || 0) + 1;
        totalPenalty += row.trust_penalty;
      }

      return {
        totalViolations: result.rows.length,
        violationsByType,
        totalPenalty,
        recentViolations: result.rows.slice(0, 10), // Last 10
      };
    } catch (error) {
      logger.error('Failed to get core violation summary', error);
      return {
        totalViolations: 0,
        violationsByType: {},
        totalPenalty: 0,
        recentViolations: [],
      };
    }
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
   * REDEMPTION SYSTEM: Reward good behavior
   * Users with low trust can recover by being helpful, positive, and non-toxic
   */
  async checkRedemption(userId: string, guildId: string, message: {
    toxicity: number;
    manipulation: number;
    sentiment: { dominant: string };
    isHelpful?: boolean;
  }): Promise<{ redeemed: boolean; points: number; reason: string }> {
    const trustScore = await this.getTrustScore(userId, guildId);

    // Only low-trust users can earn redemption points
    if (trustScore.score >= 60) {
      return { redeemed: false, points: 0, reason: 'Trust score already healthy' };
    }

    // Check if user has permanent zero score (scammers/banned)
    if (this.permanentZeroScores.has(userId)) {
      return { redeemed: false, points: 0, reason: 'Permanent ban - no redemption possible' };
    }

    // 🔥 FIX: Check for scam attempts in user's history
    // Users with scam attempts should NOT be able to earn redemption
    try {
      const sicil = await this.sicilRepo.getSicilSummary(guildId, userId);

      if (sicil && sicil.scam_violations > 0) {
        logger.warn(`🚫 Redemption BLOCKED for ${userId}: ${sicil.scam_violations} scam violations in history`);
        return {
          redeemed: false,
          points: 0,
          reason: `Scam attempt in history - no redemption allowed (${sicil.scam_violations} scam violations)`
        };
      }
    } catch (err) {
      // If query fails, continue - don't block redemption on database errors
      logger.warn('Failed to check scam history for redemption:', err);
    }

    let points = 0;
    const reasons: string[] = [];

    // POSITIVE BEHAVIORS (earn trust back)
    if (message.toxicity < 0.1 && message.sentiment.dominant === 'positive') {
      points += 2;
      reasons.push('positive and non-toxic message');
    }

    if (message.isHelpful) {
      points += 3;
      reasons.push('helpful to community');
    }

    if (message.manipulation < 0.1 && message.toxicity < 0.2) {
      points += 1;
      reasons.push('clean communication');
    }

    // Apply redemption if earned
    if (points > 0) {
      await this.updateTrustScore(
        userId,
        guildId,
        trustScore.score + points,
        points,
        `Redemption: ${reasons.join(', ')}`
      );

      logger.info(`✨ REDEMPTION: User ${userId} earned +${points} trust (${reasons.join(', ')})`);

      return {
        redeemed: true,
        points,
        reason: reasons.join(', '),
      };
    }

    return { redeemed: false, points: 0, reason: 'No redemption earned' };
  }

  /**
   * Save to database (compatibility method - now auto-saves)
   */
  async save(): Promise<void> {
    // No-op: Database saves automatically
    logger.debug('Save called (auto-save enabled, no action needed)');
  }

  /**
   * COMPATIBILITY METHODS - For backward compatibility with old TrustScoreEngine interface
   */

  setAuditLogger(logger: any): void {
    // No-op: DB version doesn't need audit logger injection
  }

  setV3Integration(integration: any): void {
    // No-op: DB version doesn't need V3 integration injection
  }

  async modifyTrust(userId: string, guildId: string, delta: number, reason: string): Promise<void> {
    const current = await this.getTrustScore(userId, guildId);
    const newScore = Math.max(0, Math.min(100, current.score + delta));
    await this.updateTrustScore(userId, guildId, newScore, delta, reason);
  }

  async shouldTakeAction(userId: string, guildId: string, actionType: string): Promise<boolean> {
    const trustScore = await this.getTrustScore(userId, guildId);

    // Low trust users should face actions
    if (trustScore.score < 30) return true;

    // Check recent violations
    const sicil = await this.sicilRepo.getSicilSummary(guildId, userId);
    const totalViolations = (sicil.total_warnings || 0) + (sicil.total_timeouts || 0) +
                           (sicil.total_kicks || 0) + (sicil.total_bans || 0);

    return totalViolations > 3;
  }

  /**
   * Check if action should be taken based on trust AND current message behavior
   * Compatibility method for TrustScoreEngine signature (synchronous-style but returns object)
   * IMPORTANT: Low trust alone is NOT enough - current message must ALSO be problematic
   */
  shouldTakeActionSync(
    trustScore: TrustScore,
    currentToxicity?: number,
    currentManipulation?: number
  ): {
    action: 'warn' | 'timeout' | 'ban' | null;
    reason: string;
  } {
    // CRITICAL FIX: Don't auto-action on neutral/positive messages
    // Only take action if CURRENT message is ALSO toxic/manipulative
    const currentMessageIsBad = (currentToxicity && currentToxicity > 0.4) ||
                                 (currentManipulation && currentManipulation > 0.5);

    // If current message is clean, NO ACTION regardless of trust score
    if (!currentMessageIsBad) {
      return { action: null, reason: '' };
    }

    // Now check trust-based escalation (only if current message is already bad)
    if (trustScore.score <= 10) {  // AUTO_BAN threshold
      return {
        action: 'ban',
        reason: `Trust score critically low (${trustScore.score}) + toxic behavior. Pattern of harmful behavior.`,
      };
    }

    if (trustScore.score <= 25) {  // AUTO_TIMEOUT threshold
      return {
        action: 'timeout',
        reason: `Trust score low (${trustScore.score}) + toxic behavior. Escalated to timeout.`,
      };
    }

    if (trustScore.score <= 40) {  // AUTO_WARN threshold
      return {
        action: 'warn',
        reason: `Trust score declining (${trustScore.score}) + toxic behavior.`,
      };
    }

    // Trust score is OK, no automatic action
    return { action: null, reason: '' };
  }
}
