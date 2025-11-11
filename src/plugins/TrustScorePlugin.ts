/**
 * TRUST SCORE PLUGIN
 *
 * Manages user trust scores based on violations and moderation actions.
 * Subscribes to ViolationDetectedEvent and ModerationActionExecutedEvent.
 *
 * Architecture:
 * ViolationDetectedEvent → TrustScorePlugin → Update Score → TrustScoreChangedEvent
 */

import { Plugin, BecasKernel } from '../kernel/BecasKernel';
import {
  ViolationDetectedEvent,
  ModerationActionExecutedEvent,
  TrustScoreChangedEvent,
} from '../domain/events/DomainEvent';
import { Violation, ViolationType, ViolationSeverity } from '../domain/models/Violation';
import { createLogger } from '../services/Logger';

const logger = createLogger('TrustScorePlugin');

interface TrustScore {
  userId: string;
  guildId: string;
  score: number; // 0-100
  lastUpdated: Date;
}

export class TrustScorePlugin implements Plugin {
  name = 'trust_score';
  version = '2.0.0';
  description = 'Trust score management based on user behavior';
  dependencies = []; // No dependencies

  private kernel!: BecasKernel;
  private trustScores: Map<string, TrustScore> = new Map(); // key: userId:guildId

  /**
   * Initialize plugin - subscribe to events
   */
  async initialize(kernel: BecasKernel): Promise<void> {
    this.kernel = kernel;

    logger.info('🎯 Initializing Trust Score Plugin...');

    // Subscribe to violation events
    const eventBus = kernel.getEventBus();

    eventBus.on<ViolationDetectedEvent['payload']>(
      'violation.detected',
      this.handleViolation.bind(this)
    );

    eventBus.on<ModerationActionExecutedEvent['payload']>(
      'moderation.action_executed',
      this.handleModerationAction.bind(this)
    );

    logger.info('✅ Trust Score Plugin initialized');
    logger.info('   → Subscribed to: violation.detected, moderation.action_executed');
  }

  /**
   * Handle violation event - update trust score
   */
  private async handleViolation(event: ViolationDetectedEvent): Promise<void> {
    try {
      const { violationType, severity, confidence } = event.payload;
      const userId = event.metadata.userId;
      const guildId = event.metadata.guildId;

      if (!userId || !guildId) {
        logger.warn('Cannot update trust score: missing userId or guildId');
        return;
      }

      // Calculate trust penalty based on violation
      const penalty = this.calculateTrustPenalty(
        violationType as ViolationType,
        severity as ViolationSeverity,
        confidence
      );

      // Update trust score
      const oldScore = this.getTrustScore(userId, guildId);
      const newScore = Math.max(0, oldScore - penalty);

      this.setTrustScore(userId, guildId, newScore);

      logger.info(
        `📉 Trust score updated: ${userId} in ${guildId} - ${oldScore} → ${newScore} (${violationType} -${penalty})`
      );

      // Publish TrustScoreChangedEvent
      await this.kernel.publishEvent(
        new TrustScoreChangedEvent({
          userId,
          guildId,
          oldScore,
          newScore,
          delta: -penalty,
          reason: `${violationType} violation (${severity})`,
        })
      );
    } catch (error: any) {
      logger.error('Error handling violation for trust score:', error);
    }
  }

  /**
   * Handle moderation action event - additional penalty
   */
  private async handleModerationAction(event: ModerationActionExecutedEvent): Promise<void> {
    try {
      const { actionType, targetUserId, reason, guildId } = event.payload;

      // Additional penalty for moderation actions
      const actionPenalties: Record<string, number> = {
        warning: 5,
        timeout: 10,
        kick: 20,
        ban: 50,
      };

      const penalty = actionPenalties[actionType] || 0;

      if (penalty === 0) {
        return;
      }

      const oldScore = this.getTrustScore(targetUserId, guildId);
      const newScore = Math.max(0, oldScore - penalty);

      this.setTrustScore(targetUserId, guildId, newScore);

      logger.info(
        `📉 Trust score updated (action): ${targetUserId} in ${guildId} - ${oldScore} → ${newScore} (${actionType} -${penalty})`
      );

      // Publish TrustScoreChangedEvent
      await this.kernel.publishEvent(
        new TrustScoreChangedEvent({
          userId: targetUserId,
          guildId,
          oldScore,
          newScore,
          delta: -penalty,
          reason: `Moderation action: ${actionType}`,
        })
      );
    } catch (error: any) {
      logger.error('Error handling moderation action for trust score:', error);
    }
  }

  /**
   * Calculate trust penalty based on violation
   */
  private calculateTrustPenalty(
    type: ViolationType,
    severity: ViolationSeverity,
    confidence: number
  ): number {
    // Base penalties (same as Violation domain model)
    const basePenalties: Record<ViolationType, Record<ViolationSeverity, number>> = {
      [ViolationType.PROFANITY]: {
        [ViolationSeverity.LOW]: 5,
        [ViolationSeverity.MEDIUM]: 10,
        [ViolationSeverity.HIGH]: 20,
        [ViolationSeverity.CRITICAL]: 30,
      },
      [ViolationType.HATE_SPEECH]: {
        [ViolationSeverity.LOW]: 15,
        [ViolationSeverity.MEDIUM]: 30,
        [ViolationSeverity.HIGH]: 50,
        [ViolationSeverity.CRITICAL]: 80,
      },
      [ViolationType.HARASSMENT]: {
        [ViolationSeverity.LOW]: 10,
        [ViolationSeverity.MEDIUM]: 25,
        [ViolationSeverity.HIGH]: 40,
        [ViolationSeverity.CRITICAL]: 60,
      },
      [ViolationType.SPAM]: {
        [ViolationSeverity.LOW]: 3,
        [ViolationSeverity.MEDIUM]: 7,
        [ViolationSeverity.HIGH]: 15,
        [ViolationSeverity.CRITICAL]: 25,
      },
      [ViolationType.SCAM]: {
        [ViolationSeverity.LOW]: 20,
        [ViolationSeverity.MEDIUM]: 40,
        [ViolationSeverity.HIGH]: 60,
        [ViolationSeverity.CRITICAL]: 90,
      },
      [ViolationType.EXPLICIT_CONTENT]: {
        [ViolationSeverity.LOW]: 15,
        [ViolationSeverity.MEDIUM]: 30,
        [ViolationSeverity.HIGH]: 50,
        [ViolationSeverity.CRITICAL]: 70,
      },
      [ViolationType.DOXXING]: {
        [ViolationSeverity.LOW]: 40,
        [ViolationSeverity.MEDIUM]: 60,
        [ViolationSeverity.HIGH]: 80,
        [ViolationSeverity.CRITICAL]: 100,
      },
      [ViolationType.RAIDING]: {
        [ViolationSeverity.LOW]: 30,
        [ViolationSeverity.MEDIUM]: 50,
        [ViolationSeverity.HIGH]: 70,
        [ViolationSeverity.CRITICAL]: 90,
      },
      [ViolationType.IMPERSONATION]: {
        [ViolationSeverity.LOW]: 10,
        [ViolationSeverity.MEDIUM]: 20,
        [ViolationSeverity.HIGH]: 35,
        [ViolationSeverity.CRITICAL]: 50,
      },
    };

    const basePenalty = basePenalties[type]?.[severity] || 0;

    // Adjust by confidence (0.7-1.0 → 0.7x-1.0x multiplier)
    return Math.round(basePenalty * confidence);
  }

  /**
   * Get trust score for user in guild
   */
  private getTrustScore(userId: string, guildId: string): number {
    const key = `${userId}:${guildId}`;
    const score = this.trustScores.get(key);

    if (!score) {
      // Default trust score for new users
      return 100;
    }

    return score.score;
  }

  /**
   * Set trust score for user in guild
   */
  private setTrustScore(userId: string, guildId: string, score: number): void {
    const key = `${userId}:${guildId}`;

    this.trustScores.set(key, {
      userId,
      guildId,
      score: Math.max(0, Math.min(100, score)), // Clamp to 0-100
      lastUpdated: new Date(),
    });
  }

  /**
   * Public API: Get trust score (for other plugins)
   */
  getUserTrustScore(userId: string, guildId: string): number {
    return this.getTrustScore(userId, guildId);
  }

  /**
   * Public API: Get all trust scores for a guild
   */
  getGuildTrustScores(guildId: string): TrustScore[] {
    const scores: TrustScore[] = [];

    for (const [key, score] of this.trustScores) {
      if (score.guildId === guildId) {
        scores.push(score);
      }
    }

    return scores.sort((a, b) => b.score - a.score);
  }

  /**
   * Public API: Get trust score statistics
   */
  getTrustScoreStats(): {
    totalUsers: number;
    averageScore: number;
    highestScore: number;
    lowestScore: number;
  } {
    const scores = Array.from(this.trustScores.values());

    if (scores.length === 0) {
      return { totalUsers: 0, averageScore: 100, highestScore: 100, lowestScore: 100 };
    }

    const scoreValues = scores.map(s => s.score);

    return {
      totalUsers: scores.length,
      averageScore: Math.round(scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length),
      highestScore: Math.max(...scoreValues),
      lowestScore: Math.min(...scoreValues),
    };
  }

  /**
   * Shutdown plugin - cleanup
   */
  async shutdown(): Promise<void> {
    logger.info('🛑 Shutting down Trust Score Plugin...');

    // TODO: Persist trust scores to database before shutdown
    logger.info(`   → ${this.trustScores.size} trust scores in memory (not persisted)`);
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    return true; // Always healthy (in-memory)
  }
}
