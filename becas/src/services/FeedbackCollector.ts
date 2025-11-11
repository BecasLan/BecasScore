/**
 * FEEDBACK COLLECTOR - Learn from Moderator Overrides
 *
 * Captures and stores every instance where a moderator:
 * - Overrides BECAS decision (BECAS said ban, mod said timeout)
 * - Reverses BECAS action (BECAS banned, mod unbanned)
 * - Provides explicit feedback (thumbs up/down, comments)
 *
 * This is the PRIMARY learning source for BECAS.
 *
 * Feedback Types:
 * 1. Override: Mod took different action than BECAS suggested
 * 2. Correction: Mod reversed BECAS action
 * 3. Confirmation: Mod agreed with BECAS
 * 4. Explicit: Mod provided thumbs up/down or comment
 */

import { Message, User as DiscordUser, Guild } from 'discord.js';
import { Pool } from 'pg';
import { AggregatedThreatResult } from '../ai/ThreatAggregator';
import { createLogger } from './Logger';

const logger = createLogger('FeedbackCollector');

export interface FeedbackEntry {
  id: string;
  serverId: string;
  moderatorId: string;
  targetUserId: string;

  // BECAS Decision
  becasSuggestion: {
    action: string; // ban, timeout, warn, delete, none
    reason: string;
    confidence: number;
    threatScore: number;
  };

  // Moderator Decision
  moderatorAction: {
    action: string; // What mod actually did
    reason?: string; // Mod's reason (optional)
    timestamp: Date;
  };

  // Feedback Classification
  feedbackType: 'override' | 'correction' | 'confirmation' | 'explicit';
  wasBecasCorrect: boolean | null; // null = unclear
  severityDifference: number; // How different was the action (-5 to +5)

  // Context
  messageContent?: string; // Anonymized
  messageContext: {
    toxicity?: number;
    manipulation?: number;
    userTrustScore?: number;
    wasProvoked?: boolean;
  };

  // Learning Insights
  feedbackCategory: string; // 'too_harsh', 'too_lenient', 'good_call', 'false_positive', 'missed_threat'
  learningTags: string[]; // ['needs_context', 'provocation_missed', 'trust_override', etc.]

  // Optional Mod Comment
  moderatorComment?: string;

  createdAt: Date;
}

export class FeedbackCollector {
  constructor(private pool: Pool) {
    logger.info('FeedbackCollector initialized');
    this.createTables();
  }

  /**
   * Create feedback tables
   */
  private async createTables(): Promise<void> {
    try {
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS moderator_feedback (
          id VARCHAR(255) PRIMARY KEY,
          server_id VARCHAR(255) NOT NULL,
          moderator_id VARCHAR(255) NOT NULL,
          target_user_id VARCHAR(255) NOT NULL,

          -- BECAS Decision
          becas_action VARCHAR(50),
          becas_reason TEXT,
          becas_confidence DECIMAL(3, 2),
          becas_threat_score DECIMAL(5, 2),

          -- Moderator Decision
          moderator_action VARCHAR(50),
          moderator_reason TEXT,
          moderator_timestamp TIMESTAMP,

          -- Feedback
          feedback_type VARCHAR(20),
          was_becas_correct BOOLEAN,
          severity_difference INTEGER,

          -- Context
          message_content TEXT,
          message_toxicity DECIMAL(3, 2),
          message_manipulation DECIMAL(3, 2),
          user_trust_score INTEGER,
          was_provoked BOOLEAN,

          -- Learning
          feedback_category VARCHAR(50),
          learning_tags JSONB,
          moderator_comment TEXT,

          created_at TIMESTAMP DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_feedback_server ON moderator_feedback(server_id);
        CREATE INDEX IF NOT EXISTS idx_feedback_moderator ON moderator_feedback(moderator_id);
        CREATE INDEX IF NOT EXISTS idx_feedback_type ON moderator_feedback(feedback_type);
        CREATE INDEX IF NOT EXISTS idx_feedback_category ON moderator_feedback(feedback_category);
        CREATE INDEX IF NOT EXISTS idx_feedback_created ON moderator_feedback(created_at);
      `);

      logger.info('Feedback tables created/verified');
    } catch (error) {
      logger.error('Failed to create feedback tables', error);
    }
  }

  /**
   * Record moderator override (different action than BECAS suggested)
   */
  async recordOverride(
    serverId: string,
    moderatorId: string,
    targetUserId: string,
    becasResult: AggregatedThreatResult,
    moderatorAction: { action: string; reason?: string },
    messageContext?: any
  ): Promise<FeedbackEntry> {
    const severityDiff = this.calculateSeverityDifference(
      becasResult.recommendedAction,
      moderatorAction.action
    );

    // Classify feedback
    const feedbackCategory = this.classifyFeedback(severityDiff, becasResult);
    const learningTags = this.generateLearningTags(severityDiff, becasResult, messageContext);

    // Determine if BECAS was correct (heuristic)
    const wasBecasCorrect = this.assessCorrectness(severityDiff, becasResult.confidence);

    const feedback: FeedbackEntry = {
      id: this.generateId(),
      serverId,
      moderatorId,
      targetUserId,
      becasSuggestion: {
        action: becasResult.recommendedAction,
        reason: becasResult.actionReason,
        confidence: becasResult.confidence,
        threatScore: becasResult.threatScore,
      },
      moderatorAction: {
        action: moderatorAction.action,
        reason: moderatorAction.reason,
        timestamp: new Date(),
      },
      feedbackType: 'override',
      wasBecasCorrect,
      severityDifference: severityDiff,
      messageContext: messageContext || {},
      feedbackCategory,
      learningTags,
      createdAt: new Date(),
    };

    await this.storeFeedback(feedback);

    logger.info(`Override recorded: BECAS=${becasResult.recommendedAction}, Mod=${moderatorAction.action}, Diff=${severityDiff}`);

    return feedback;
  }

  /**
   * Record moderator correction (reversed BECAS action)
   */
  async recordCorrection(
    serverId: string,
    moderatorId: string,
    targetUserId: string,
    originalAction: string,
    reason?: string
  ): Promise<FeedbackEntry> {
    const feedback: FeedbackEntry = {
      id: this.generateId(),
      serverId,
      moderatorId,
      targetUserId,
      becasSuggestion: {
        action: originalAction,
        reason: 'Auto-action',
        confidence: 0.8,
        threatScore: 70,
      },
      moderatorAction: {
        action: 'reversed',
        reason,
        timestamp: new Date(),
      },
      feedbackType: 'correction',
      wasBecasCorrect: false, // Correction means BECAS was wrong
      severityDifference: -5, // Max negative (action reversed)
      messageContext: {},
      feedbackCategory: 'false_positive',
      learningTags: ['action_reversed', 'false_positive'],
      moderatorComment: reason,
      createdAt: new Date(),
    };

    await this.storeFeedback(feedback);

    logger.warn(`Correction recorded: BECAS action reversed - ${originalAction}`);

    return feedback;
  }

  /**
   * Record moderator confirmation (agreed with BECAS)
   */
  async recordConfirmation(
    serverId: string,
    moderatorId: string,
    targetUserId: string,
    becasResult: AggregatedThreatResult
  ): Promise<FeedbackEntry> {
    const feedback: FeedbackEntry = {
      id: this.generateId(),
      serverId,
      moderatorId,
      targetUserId,
      becasSuggestion: {
        action: becasResult.recommendedAction,
        reason: becasResult.actionReason,
        confidence: becasResult.confidence,
        threatScore: becasResult.threatScore,
      },
      moderatorAction: {
        action: becasResult.recommendedAction, // Same action
        timestamp: new Date(),
      },
      feedbackType: 'confirmation',
      wasBecasCorrect: true,
      severityDifference: 0,
      messageContext: {},
      feedbackCategory: 'good_call',
      learningTags: ['confirmed'],
      createdAt: new Date(),
    };

    await this.storeFeedback(feedback);

    logger.debug(`Confirmation recorded: BECAS decision confirmed`);

    return feedback;
  }

  /**
   * Record explicit feedback (thumbs up/down, comment)
   */
  async recordExplicitFeedback(
    serverId: string,
    moderatorId: string,
    targetUserId: string,
    rating: 'positive' | 'negative',
    comment?: string
  ): Promise<FeedbackEntry> {
    const feedback: FeedbackEntry = {
      id: this.generateId(),
      serverId,
      moderatorId,
      targetUserId,
      becasSuggestion: {
        action: 'unknown',
        reason: '',
        confidence: 0,
        threatScore: 0,
      },
      moderatorAction: {
        action: 'feedback',
        timestamp: new Date(),
      },
      feedbackType: 'explicit',
      wasBecasCorrect: rating === 'positive',
      severityDifference: 0,
      messageContext: {},
      feedbackCategory: rating === 'positive' ? 'good_call' : 'poor_call',
      learningTags: [rating === 'positive' ? 'thumbs_up' : 'thumbs_down'],
      moderatorComment: comment,
      createdAt: new Date(),
    };

    await this.storeFeedback(feedback);

    logger.info(`Explicit feedback: ${rating} - ${comment || 'no comment'}`);

    return feedback;
  }

  /**
   * Get recent feedback for analysis
   */
  async getRecentFeedback(
    serverId: string,
    days: number = 7,
    limit: number = 100
  ): Promise<FeedbackEntry[]> {
    try {
      const result = await this.pool.query(`
        SELECT * FROM moderator_feedback
        WHERE server_id = $1
        AND created_at > NOW() - INTERVAL '${days} days'
        ORDER BY created_at DESC
        LIMIT $2
      `, [serverId, limit]);

      return result.rows.map(row => this.rowToEntry(row));
    } catch (error) {
      logger.error('Failed to get recent feedback', error);
      return [];
    }
  }

  /**
   * Get feedback statistics
   */
  async getFeedbackStats(serverId: string, days: number = 30): Promise<{
    totalFeedback: number;
    overrideRate: number; // % of BECAS decisions overridden
    correctionRate: number; // % of BECAS actions reversed
    confirmationRate: number; // % of BECAS decisions confirmed
    accuracy: number; // % of correct decisions
    byCategory: Record<string, number>;
    bySeverityDiff: Record<string, number>;
  }> {
    try {
      const result = await this.pool.query(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN feedback_type = 'override' THEN 1 ELSE 0 END) as overrides,
          SUM(CASE WHEN feedback_type = 'correction' THEN 1 ELSE 0 END) as corrections,
          SUM(CASE WHEN feedback_type = 'confirmation' THEN 1 ELSE 0 END) as confirmations,
          SUM(CASE WHEN was_becas_correct = TRUE THEN 1 ELSE 0 END) as correct,
          jsonb_object_agg(COALESCE(feedback_category, 'unknown'), category_count) as by_category
        FROM (
          SELECT
            feedback_type,
            feedback_category,
            was_becas_correct,
            COUNT(*) OVER (PARTITION BY feedback_category) as category_count
          FROM moderator_feedback
          WHERE server_id = $1
          AND created_at > NOW() - INTERVAL '${days} days'
        ) subquery
        GROUP BY feedback_type, feedback_category, was_becas_correct
        LIMIT 1
      `, [serverId]);

      const row = result.rows[0] || {};
      const total = parseInt(row.total) || 0;

      return {
        totalFeedback: total,
        overrideRate: total > 0 ? (parseInt(row.overrides) || 0) / total * 100 : 0,
        correctionRate: total > 0 ? (parseInt(row.corrections) || 0) / total * 100 : 0,
        confirmationRate: total > 0 ? (parseInt(row.confirmations) || 0) / total * 100 : 0,
        accuracy: total > 0 ? (parseInt(row.correct) || 0) / total * 100 : 0,
        byCategory: row.by_category || {},
        bySeverityDiff: {}, // Simplified
      };
    } catch (error) {
      logger.error('Failed to get feedback stats', error);
      return {
        totalFeedback: 0,
        overrideRate: 0,
        correctionRate: 0,
        confirmationRate: 0,
        accuracy: 0,
        byCategory: {},
        bySeverityDiff: {},
      };
    }
  }

  /**
   * Calculate severity difference (-5 to +5)
   */
  private calculateSeverityDifference(becasAction: string, modAction: string): number {
    const actionSeverity: Record<string, number> = {
      'none': 0,
      'delete': 1,
      'warn': 2,
      'timeout': 3,
      'kick': 4,
      'ban': 5,
    };

    const becasSeverity = actionSeverity[becasAction] || 0;
    const modSeverity = actionSeverity[modAction] || 0;

    return modSeverity - becasSeverity;
  }

  /**
   * Classify feedback into categories
   */
  private classifyFeedback(severityDiff: number, becasResult: AggregatedThreatResult): string {
    if (severityDiff < -2) return 'too_harsh'; // BECAS too strict
    if (severityDiff > 2) return 'too_lenient'; // BECAS too lenient
    if (severityDiff === 0) return 'good_call'; // Perfect match
    if (Math.abs(severityDiff) === 1) return 'minor_adjustment'; // Close call
    if (becasResult.confidence < 0.5) return 'low_confidence'; // BECAS unsure

    return 'unclear';
  }

  /**
   * Generate learning tags for pattern detection
   */
  private generateLearningTags(severityDiff: number, becasResult: AggregatedThreatResult, context?: any): string[] {
    const tags: string[] = [];

    // Severity tags
    if (severityDiff < 0) tags.push('too_harsh');
    if (severityDiff > 0) tags.push('too_lenient');

    // Confidence tags
    if (becasResult.confidence < 0.6) tags.push('low_confidence');
    if (becasResult.confidence > 0.9) tags.push('high_confidence');

    // Context tags
    if (context?.wasProvoked) tags.push('provocation_context');
    if (context?.userTrustScore && context.userTrustScore > 70) tags.push('trusted_user');
    if (context?.userTrustScore && context.userTrustScore < 30) tags.push('low_trust_user');

    // Threat tags
    if (becasResult.threats.some(t => t.type.includes('scam'))) tags.push('scam_related');
    if (becasResult.threats.some(t => t.type === 'toxic')) tags.push('toxicity_related');

    return tags;
  }

  /**
   * Assess if BECAS was correct (heuristic)
   */
  private assessCorrectness(severityDiff: number, confidence: number): boolean | null {
    // If mod chose same or very similar action → BECAS correct
    if (Math.abs(severityDiff) <= 1 && confidence > 0.6) {
      return true;
    }

    // If mod chose much different action and BECAS was confident → BECAS wrong
    if (Math.abs(severityDiff) >= 3 && confidence > 0.7) {
      return false;
    }

    // Unclear
    return null;
  }

  /**
   * Store feedback in database
   */
  private async storeFeedback(feedback: FeedbackEntry): Promise<void> {
    try {
      await this.pool.query(`
        INSERT INTO moderator_feedback (
          id, server_id, moderator_id, target_user_id,
          becas_action, becas_reason, becas_confidence, becas_threat_score,
          moderator_action, moderator_reason, moderator_timestamp,
          feedback_type, was_becas_correct, severity_difference,
          message_toxicity, message_manipulation, user_trust_score, was_provoked,
          feedback_category, learning_tags, moderator_comment
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21
        )
      `, [
        feedback.id,
        feedback.serverId,
        feedback.moderatorId,
        feedback.targetUserId,
        feedback.becasSuggestion.action,
        feedback.becasSuggestion.reason,
        feedback.becasSuggestion.confidence,
        feedback.becasSuggestion.threatScore,
        feedback.moderatorAction.action,
        feedback.moderatorAction.reason,
        feedback.moderatorAction.timestamp,
        feedback.feedbackType,
        feedback.wasBecasCorrect,
        feedback.severityDifference,
        feedback.messageContext.toxicity,
        feedback.messageContext.manipulation,
        feedback.messageContext.userTrustScore,
        feedback.messageContext.wasProvoked,
        feedback.feedbackCategory,
        JSON.stringify(feedback.learningTags),
        feedback.moderatorComment,
      ]);
    } catch (error) {
      logger.error('Failed to store feedback', error);
    }
  }

  /**
   * Convert database row to FeedbackEntry
   */
  private rowToEntry(row: any): FeedbackEntry {
    return {
      id: row.id,
      serverId: row.server_id,
      moderatorId: row.moderator_id,
      targetUserId: row.target_user_id,
      becasSuggestion: {
        action: row.becas_action,
        reason: row.becas_reason,
        confidence: parseFloat(row.becas_confidence),
        threatScore: parseFloat(row.becas_threat_score),
      },
      moderatorAction: {
        action: row.moderator_action,
        reason: row.moderator_reason,
        timestamp: new Date(row.moderator_timestamp),
      },
      feedbackType: row.feedback_type,
      wasBecasCorrect: row.was_becas_correct,
      severityDifference: row.severity_difference,
      messageContext: {
        toxicity: row.message_toxicity ? parseFloat(row.message_toxicity) : undefined,
        manipulation: row.message_manipulation ? parseFloat(row.message_manipulation) : undefined,
        userTrustScore: row.user_trust_score,
        wasProvoked: row.was_provoked,
      },
      feedbackCategory: row.feedback_category,
      learningTags: row.learning_tags || [],
      moderatorComment: row.moderator_comment,
      createdAt: new Date(row.created_at),
    };
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `feedback_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
