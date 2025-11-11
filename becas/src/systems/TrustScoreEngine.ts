import { TrustScore, TrustEvent, TrustLevel } from '../types/Trust.types';
import { AnalyzedMessage } from '../types/Message.types';
import { StorageService } from '../services/StorageService';
import { TRUST_CONFIG } from '../config/trust.config';
import { AuditLogger } from './AuditLogger';
import { V3Integration } from '../integration/V3Integration';
import { blockchainService } from '../services/BlockchainService';
import { supabaseService } from '../database/DatabaseService';

export class TrustScoreEngine {
  private storage: StorageService;
  private trustScores: Map<string, TrustScore> = new Map();
  private permanentZeroScores: Set<string> = new Set(); // Users with permanent 0 score
  private auditLogger?: AuditLogger; // Optional audit logger
  private v3Integration?: V3Integration; // Optional V3 integration
  private onScoreUpdateCallback?: (userId: string, data: any) => void; // Real-time update callback

  constructor(storage: StorageService, auditLogger?: AuditLogger) {
    this.storage = storage;
    this.auditLogger = auditLogger;
    this.loadTrustScores();
  }

  /**
   * Set callback for real-time score updates
   */
  setOnScoreUpdate(callback: (userId: string, data: any) => void): void {
    this.onScoreUpdateCallback = callback;
  }

  /**
   * Set audit logger (can be called after construction)
   */
  setAuditLogger(auditLogger: AuditLogger): void {
    this.auditLogger = auditLogger;
  }

  /**
   * Set V3 integration (can be called after construction)
   */
  setV3Integration(v3Integration: V3Integration): void {
    this.v3Integration = v3Integration;
  }

  /**
   * Load trust scores from storage
   */
  private async loadTrustScores(): Promise<void> {
    const data = await this.storage.read<{ scores: Record<string, TrustScore> }>(
      'trust',
      'trust_scores.json'
    );

    if (data?.scores) {
      Object.entries(data.scores).forEach(([key, score]) => {
        // 🔥 FIX: Deserialize Date objects from JSON strings
        const deserializedScore: TrustScore = {
          ...score,
          lastUpdated: new Date(score.lastUpdated),
          joinedAt: new Date(score.joinedAt),
          history: score.history.map(event => ({
            ...event,
            timestamp: new Date(event.timestamp)
          }))
        };
        this.trustScores.set(key, deserializedScore);
      });
    }
  }

  /**
   * Get trust score for a user
   */
  getTrustScore(userId: string, guildId: string): TrustScore {
    // Trust score is GLOBAL - not per-guild (like a passport)
    const key = userId;

    if (!this.trustScores.has(key)) {
      const newScore: TrustScore = {
        userId,
        userName: '',
        guildId: 'global', // Always use 'global' - not tied to specific guild
        score: TRUST_CONFIG.DEFAULT_SCORE,
        level: this.calculateLevel(TRUST_CONFIG.DEFAULT_SCORE),
        history: [],
        lastUpdated: new Date(),
        joinedAt: new Date(),
      };
      this.trustScores.set(key, newScore);
    }

    return this.trustScores.get(key)!;
  }

  /**
   * Update trust score based on message analysis
   */
  async updateFromMessage(message: AnalyzedMessage): Promise<TrustScore> {
    const trustScore = this.getTrustScore(message.authorId, message.guildId);
    let delta = 0;
    const reasons: string[] = [];

    // Analyze toxicity
    if (message.toxicity > 0.7) {
      delta += TRUST_CONFIG.MODIFIERS.SEVERE_INSULT;
      reasons.push('severe toxic language');
    } else if (message.toxicity > 0.4) {
      delta += TRUST_CONFIG.MODIFIERS.MILD_INSULT;
      reasons.push('mild toxic language');
    }

    // Analyze manipulation
    if (message.manipulation > 0.6) {
      delta += TRUST_CONFIG.MODIFIERS.MANIPULATION;
      reasons.push('manipulative behavior detected');
    }

    // Positive sentiment
    if (message.sentiment.dominant === 'positive' && message.toxicity < 0.2) {
      delta += TRUST_CONFIG.MODIFIERS.HELPFUL_MESSAGE;
      reasons.push('positive contribution');
    }

    // Check for spam patterns (handled externally, but can add delta here)

    // Build detailed context with channel and mentions
    const contextDetails = {
      message: message.content,
      channelId: message.channelId,
      mentions: message.mentions,
      timestamp: message.timestamp.toISOString(),
      toxicity: (message.toxicity * 100).toFixed(1) + '%',
      manipulation: (message.manipulation * 100).toFixed(1) + '%'
    };

    return this.modifyTrust(
      message.authorId,
      message.guildId,
      delta,
      reasons.join(', ') || 'message analyzed',
      JSON.stringify(contextDetails)
    );
  }

  /**
   * Manually modify trust score
   */
  async modifyTrust(
    userId: string,
    guildId: string,
    delta: number,
    reason: string,
    context?: string
  ): Promise<TrustScore> {
    const trustScore = this.getTrustScore(userId, guildId);
    const oldScore = trustScore.score;
    const key = userId; // Global trust score

    // Check if user has permanent zero score (scammer/banned)
    if (this.permanentZeroScores.has(key) && delta > 0) {
      console.log(`⚠️ Attempt to increase score for permanently banned user ${userId} - blocked`);
      return trustScore; // No change allowed
    }

    // Update score with bounds
    trustScore.score = Math.max(
      TRUST_CONFIG.MIN_SCORE,
      Math.min(TRUST_CONFIG.MAX_SCORE, trustScore.score + delta)
    );

    // Update level
    trustScore.level = this.calculateLevel(trustScore.score);
    trustScore.lastUpdated = new Date();

    // Add to history
    const event: TrustEvent = {
      timestamp: new Date(),
      action: reason,
      delta,
      reason,
      context,
    };
    trustScore.history.push(event);

    // Keep only last 100 events
    if (trustScore.history.length > 100) {
      trustScore.history = trustScore.history.slice(-100);
    }

    // Save to storage
    await this.saveTrustScores();

    // 🔥 REAL-TIME UPDATE - Emit WebSocket event if callback is set
    if (this.onScoreUpdateCallback) {
      this.onScoreUpdateCallback(userId, {
        score: trustScore.score,
        level: trustScore.level,
        delta,
        reason,
        timestamp: new Date(),
        oldScore,
        userName: trustScore.userName
      });
    }

    // 🔥 V3 INTEGRATION - Sync user profile to unified memory
    if (this.v3Integration) {
      try {
        await this.v3Integration.updateUserProfile(
          userId,
          trustScore.userName || 'Unknown',
          guildId,
          trustScore.score / 100, // Normalize to 0-1 range
          [] // Roles not available in this context
        );
      } catch (error) {
        console.error('Failed to update V3 user profile:', error);
      }
    }

    console.log(
      `Trust updated: ${trustScore.userName} (${userId}) ${oldScore} → ${trustScore.score} (${delta >= 0 ? '+' : ''}${delta}) - ${reason}`
    );

    // 🔥 AUDIT LOG - Trust change
    if (this.auditLogger && Math.abs(delta) > 0) {
      await this.auditLogger.log({
        type: 'trust_change',
        guildId,
        actorId: userId,
        actorName: trustScore.userName || userId,
        actorType: 'system',
        targetId: userId,
        targetName: trustScore.userName || userId,
        action: delta > 0 ? 'trust_increase' : 'trust_decrease',
        details: {
          oldScore,
          newScore: trustScore.score,
          delta,
          reason,
          context,
          oldLevel: this.calculateLevel(oldScore),
          newLevel: trustScore.level,
        },
        success: true,
      });
    }

    // 🔥 SUPABASE SYNC - Write to database
    if (supabaseService.isInitialized()) {
      try {
        await supabaseService.upsertTrustScore(userId, {
          discord_id: userId,
          score: trustScore.score,
          level: trustScore.level,
          total_messages: trustScore.totalMessages,
          last_updated: trustScore.lastUpdated,
          user_name: trustScore.userName || 'Unknown',
        });
        console.log(`💾 Trust score synced to Supabase for ${userId}`);
      } catch (error) {
        console.error('Failed to sync trust score to Supabase:', error);
        // Don't throw - Supabase sync is optional
      }
    }

    // ⛓️ BLOCKCHAIN SYNC - Write trust score to Base blockchain
    if (blockchainService.isEnabled() && Math.abs(delta) > 0) {
      try {
        // Calculate total violations from history
        const violations = trustScore.history.filter(
          (event) => event.delta < 0
        ).length;

        const txHash = await blockchainService.updateTrustScore(
          userId,
          Math.round(trustScore.score),
          Math.round(100 - trustScore.score), // risk score (inverse of trust)
          violations
        );

        if (txHash) {
          console.log(`⛓️  Trust score synced to blockchain: ${txHash}`);
        }
      } catch (error) {
        console.error('Failed to sync trust score to blockchain:', error);
        // Don't throw - blockchain sync is optional
      }
    }

    return trustScore;
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
   * Check if action should be taken based on trust AND current message behavior
   * IMPORTANT: Low trust alone is NOT enough - current message must ALSO be problematic
   */
  shouldTakeAction(
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
    if (trustScore.score <= TRUST_CONFIG.ACTION_THRESHOLDS.AUTO_BAN) {
      return {
        action: 'ban',
        reason: `Trust score critically low (${trustScore.score}) + toxic behavior. Pattern of harmful behavior.`,
      };
    }

    if (trustScore.score <= TRUST_CONFIG.ACTION_THRESHOLDS.AUTO_TIMEOUT) {
      return {
        action: 'timeout',
        reason: `Trust score low (${trustScore.score}) + toxic behavior. Escalated to timeout.`,
      };
    }

    if (trustScore.score <= TRUST_CONFIG.ACTION_THRESHOLDS.AUTO_WARN) {
      return {
        action: 'warn',
        reason: `Trust score concerning (${trustScore.score}) + problematic behavior. Warning issued.`,
      };
    }

    return { action: null, reason: '' };
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
    const trustScore = this.getTrustScore(userId, guildId);

    // Only low-trust users can earn redemption points
    if (trustScore.score >= 60) {
      return { redeemed: false, points: 0, reason: 'Trust score already healthy' };
    }

    // Check for permanent zero score (scammers/banned)
    const key = userId; // Global trust score
    if (this.permanentZeroScores.has(key)) {
      return { redeemed: false, points: 0, reason: 'Permanent ban - no redemption possible' };
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
      await this.modifyTrust(
        userId,
        guildId,
        points,
        `Redemption: ${reasons.join(', ')}`,
        'Good behavior recovery'
      );

      console.log(`✨ REDEMPTION: ${trustScore.userName} earned +${points} trust (${reasons.join(', ')})`);

      return {
        redeemed: true,
        points,
        reason: reasons.join(', '),
      };
    }

    return { redeemed: false, points: 0, reason: 'No redemption earned' };
  }

  /**
   * Apply time decay to inactive users
   * OLD VIOLATIONS should fade over time
   */
  async applyDecay(): Promise<void> {
    const now = new Date();
    let modified = false;

    for (const [key, trustScore] of this.trustScores.entries()) {
      // Skip permanent zero scores
      if (this.permanentZeroScores.has(key)) continue;

      const daysSinceUpdate = (now.getTime() - trustScore.lastUpdated.getTime()) / (1000 * 60 * 60 * 24);

      // OLD VIOLATIONS FADE: After 7 days of inactivity, slowly recover trust
      if (daysSinceUpdate > 7 && trustScore.score < TRUST_CONFIG.DEFAULT_SCORE) {
        const decay = Math.floor(daysSinceUpdate * TRUST_CONFIG.MODIFIERS.TIME_DECAY);

        if (decay !== 0) {
          trustScore.score = Math.min(
            TRUST_CONFIG.DEFAULT_SCORE, // Max recovery to 50 (neutral)
            Math.max(TRUST_CONFIG.MIN_SCORE, trustScore.score + decay)
          );
          trustScore.level = this.calculateLevel(trustScore.score);
          modified = true;

          console.log(`⏰ Time decay: ${trustScore.userName} recovered +${decay} trust (inactive ${Math.floor(daysSinceUpdate)} days)`);
        }
      }
    }

    if (modified) {
      await this.saveTrustScores();
    }
  }

  /**
   * Get redemption progress for a user
   */
  getRedemptionProgress(userId: string, guildId: string): {
    canRedeem: boolean;
    currentScore: number;
    targetScore: number;
    pointsNeeded: number;
    recentGoodBehaviors: number;
    suggestion: string;
  } {
    const trustScore = this.getTrustScore(userId, guildId);
    const key = userId; // Global trust score

    // Check if banned permanently
    if (this.permanentZeroScores.has(key)) {
      return {
        canRedeem: false,
        currentScore: 0,
        targetScore: 50,
        pointsNeeded: 0,
        recentGoodBehaviors: 0,
        suggestion: 'Permanent ban - no redemption possible',
      };
    }

    // Count recent good behaviors (last 20 events)
    const recentGood = trustScore.history
      .slice(-20)
      .filter(e => e.delta > 0 && e.reason.includes('Redemption'))
      .length;

    const targetScore = 50; // Neutral
    const pointsNeeded = Math.max(0, targetScore - trustScore.score);

    let suggestion = '';
    if (trustScore.score < 30) {
      suggestion = 'Be helpful, positive, and avoid toxicity. Every good message helps!';
    } else if (trustScore.score < 50) {
      suggestion = 'Keep up the good behavior! You\'re making progress.';
    } else {
      suggestion = 'Trust score is healthy. Continue being a positive community member!';
    }

    return {
      canRedeem: trustScore.score < 60 && !this.permanentZeroScores.has(key),
      currentScore: trustScore.score,
      targetScore,
      pointsNeeded,
      recentGoodBehaviors: recentGood,
      suggestion,
    };
  }

  /**
   * Get users by trust level
   */
  getUsersByLevel(guildId: string, level: TrustLevel): TrustScore[] {
    return Array.from(this.trustScores.values())
      .filter(score => score.guildId === guildId && score.level === level);
  }

  /**
   * Get top trusted users
   */
  getTopUsers(guildId: string, limit: number = 10): TrustScore[] {
    return Array.from(this.trustScores.values())
      .filter(score => score.guildId === guildId)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Get trust statistics for guild
   */
  getGuildStats(guildId: string): {
    total: number;
    averageScore: number;
    byLevel: Record<TrustLevel, number>;
  } {
    const guildScores = Array.from(this.trustScores.values())
      .filter(score => score.guildId === guildId);

    const byLevel: Record<TrustLevel, number> = {
      exemplary: 0,
      trusted: 0,
      neutral: 0,
      cautious: 0,
      dangerous: 0,
    };

    let totalScore = 0;

    guildScores.forEach(score => {
      byLevel[score.level]++;
      totalScore += score.score;
    });

    return {
      total: guildScores.length,
      averageScore: guildScores.length > 0 ? totalScore / guildScores.length : 0,
      byLevel,
    };
  }

  /**
   * Save trust scores to storage
   */
  private async saveTrustScores(): Promise<void> {
    const scores: Record<string, TrustScore> = {};
    
    this.trustScores.forEach((score, key) => {
      scores[key] = score;
    });

    await this.storage.write('trust', 'trust_scores.json', { scores });
  }

  /**
   * Export user trust report
   */
  generateUserReport(userId: string, guildId: string): string {
    const trustScore = this.getTrustScore(userId, guildId);
    const recentEvents = trustScore.history.slice(-10);

    let report = `Trust Report for ${trustScore.userName || userId}\n`;
    report += `Score: ${trustScore.score} (${trustScore.level})\n`;
    report += `Member since: ${trustScore.joinedAt.toLocaleDateString()}\n`;
    report += `Last activity: ${trustScore.lastUpdated.toLocaleDateString()}\n\n`;
    report += `Recent History:\n`;

    recentEvents.forEach(event => {
      report += `- ${event.timestamp.toLocaleString()}: ${event.action} (${event.delta >= 0 ? '+' : ''}${event.delta})\n`;
    });

    return report;
  }

  /**
   * Set permanent zero score for scammers/malicious users
   * This score can never be increased
   */
  async setPermanentZeroScore(
    userId: string,
    guildId: string,
    reason: string,
    context?: string
  ): Promise<TrustScore> {
    const key = userId; // Global trust score

    // Add to permanent zero list
    this.permanentZeroScores.add(key);

    // Set score to 0
    const trustScore = this.getTrustScore(userId, guildId);
    trustScore.score = 0;
    trustScore.level = 'dangerous';
    trustScore.lastUpdated = new Date();

    // Add to history
    const event: TrustEvent = {
      timestamp: new Date(),
      action: 'PERMANENT_BAN',
      delta: -trustScore.score,
      reason: `PERMANENT: ${reason}`,
      context,
    };
    trustScore.history.push(event);

    await this.saveTrustScores();

    console.log(`🚫 PERMANENT ZERO SCORE set for ${userId} in guild ${guildId}`);
    console.log(`   Reason: ${reason}`);

    return trustScore;
  }

  /**
   * Check if user has permanent zero score
   */
  isPermanentlyBanned(userId: string, guildId: string): boolean {
    const key = userId; // Global trust score
    return this.permanentZeroScores.has(key);
  }
}