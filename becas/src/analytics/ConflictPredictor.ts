import { Pool } from 'pg';
import { Client, GuildMember, TextChannel } from 'discord.js';
import logger from '../utils/logger';

/**
 * ConflictPredictor
 *
 * Predicts potential conflicts between users before they escalate.
 * Uses relationship history, past conflicts, and behavioral patterns
 * to calculate conflict probability and enable proactive moderation.
 *
 * Prediction Factors:
 * 1. Past Conflicts - History of arguments/fights
 * 2. Relationship Score - Overall sentiment of interactions
 * 3. Recent Negative Interactions - Tense exchanges in last 24h
 * 4. Co-presence - Both users active in same channels
 * 5. Provocation Patterns - One user consistently provoking the other
 */

export interface ConflictPrediction {
  userA: string;
  userB: string;
  conflictProbability: number; // 0-1
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  factors: {
    pastConflictsCount: number;
    lastConflictDate?: Date;
    negativeInteractionsCount: number;
    relationshipScore: number; // -1 to 1
    recentInteractionCount: number;
  };
  bothActiveInChannels: string[];
  recommendedAction: string;
  predictedAt: Date;
}

export interface ConflictAlert {
  prediction: ConflictPrediction;
  message: string;
  urgency: 'low' | 'medium' | 'high' | 'critical';
  suggestedInterventions: string[];
}

export class ConflictPredictor {
  constructor(
    private db: Pool,
    private discordClient: Client
  ) {}

  /**
   * Predict conflicts for all active user pairs in a server
   */
  async predictServerConflicts(serverId: string): Promise<ConflictPrediction[]> {
    try {
      // Get all user pairs with relationship history
      const pairsQuery = `
        SELECT DISTINCT
          LEAST(user_a, user_b) as user_a,
          GREATEST(user_a, user_b) as user_b
        FROM user_relationships
        WHERE server_id = $1
        AND (conflict_count > 0 OR interaction_count >= 5)
      `;

      const pairsResult = await this.db.query(pairsQuery, [serverId]);
      const predictions: ConflictPrediction[] = [];

      for (const pair of pairsResult.rows) {
        const prediction = await this.predictConflict(
          pair.user_a,
          pair.user_b,
          serverId
        );

        if (prediction && prediction.riskLevel !== 'low') {
          predictions.push(prediction);
          // Store prediction in database
          await this.storePrediction(serverId, prediction);
        }
      }

      logger.info(`Predicted ${predictions.length} potential conflicts for server ${serverId}`);
      return predictions.sort((a, b) => b.conflictProbability - a.conflictProbability);

    } catch (error) {
      logger.error('Error predicting server conflicts:', error);
      return [];
    }
  }

  /**
   * Predict conflict between two specific users
   */
  async predictConflict(
    userA: string,
    userB: string,
    serverId: string
  ): Promise<ConflictPrediction | null> {
    try {
      // Ensure consistent ordering
      const [user1, user2] = userA < userB ? [userA, userB] : [userB, userA];

      // Get relationship data
      const relationshipQuery = `
        SELECT
          conflict_count,
          last_conflict_timestamp,
          interaction_count,
          sentiment_avg
        FROM user_relationships
        WHERE server_id = $1
        AND user_a = $2
        AND user_b = $3
      `;

      const relationshipResult = await this.db.query(relationshipQuery, [serverId, user1, user2]);

      if (relationshipResult.rows.length === 0) {
        return null; // No relationship data
      }

      const relationship = relationshipResult.rows[0];

      // Get recent negative interactions (last 24h)
      const recentQuery = `
        SELECT COUNT(*) as negative_count
        FROM messages m1
        JOIN messages m2 ON (
          m1.server_id = m2.server_id
          AND m1.channel_id = m2.channel_id
          AND ABS(EXTRACT(EPOCH FROM (m2.created_at - m1.created_at))) < 300
        )
        WHERE m1.server_id = $1
        AND m1.author_id = $2
        AND m2.author_id = $3
        AND m1.created_at >= NOW() - INTERVAL '24 hours'
        AND (m1.content ~* 'toxic|hate|stupid|idiot' OR m2.content ~* 'toxic|hate|stupid|idiot')
      `;

      const recentResult = await this.db.query(recentQuery, [serverId, user1, user2]);
      const negativeInteractionsCount = parseInt(recentResult.rows[0]?.negative_count || '0');

      // Check if both users are currently active in same channels
      const bothActiveInChannels = await this.getSharedActiveChannels(user1, user2, serverId);

      // Calculate conflict probability
      const factors = {
        pastConflictsCount: parseInt(relationship.conflict_count) || 0,
        lastConflictDate: relationship.last_conflict_timestamp
          ? new Date(relationship.last_conflict_timestamp)
          : undefined,
        negativeInteractionsCount,
        relationshipScore: parseFloat(relationship.sentiment_avg) || 0,
        recentInteractionCount: parseInt(relationship.interaction_count) || 0
      };

      const conflictProbability = this.calculateConflictProbability(factors, bothActiveInChannels.length);

      // Determine risk level
      const riskLevel =
        conflictProbability >= 0.8 ? 'critical' :
        conflictProbability >= 0.6 ? 'high' :
        conflictProbability >= 0.4 ? 'medium' : 'low';

      // Generate recommendation
      const recommendedAction = this.generateRecommendation(
        conflictProbability,
        factors,
        bothActiveInChannels.length > 0
      );

      return {
        userA: user1,
        userB: user2,
        conflictProbability,
        riskLevel,
        factors,
        bothActiveInChannels,
        recommendedAction,
        predictedAt: new Date()
      };

    } catch (error) {
      logger.error('Error predicting conflict:', error);
      return null;
    }
  }

  /**
   * Calculate conflict probability based on factors
   */
  private calculateConflictProbability(
    factors: ConflictPrediction['factors'],
    sharedChannelsCount: number
  ): number {
    let probability = 0.0;

    // Factor 1: Past conflicts (0-40 points)
    if (factors.pastConflictsCount > 0) {
      probability += Math.min(factors.pastConflictsCount * 0.15, 0.4);
    }

    // Factor 2: Recent conflicts (0-25 points)
    if (factors.lastConflictDate) {
      const daysSinceConflict = (Date.now() - factors.lastConflictDate.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceConflict < 7) {
        probability += 0.25 * (1 - daysSinceConflict / 7); // Decays over 7 days
      }
    }

    // Factor 3: Negative relationship (0-20 points)
    if (factors.relationshipScore < -0.2) {
      probability += Math.abs(factors.relationshipScore) * 0.2;
    }

    // Factor 4: Recent negative interactions (0-25 points)
    if (factors.negativeInteractionsCount > 0) {
      probability += Math.min(factors.negativeInteractionsCount * 0.1, 0.25);
    }

    // Factor 5: Co-presence in channels (0-15 points)
    if (sharedChannelsCount > 0) {
      probability += Math.min(sharedChannelsCount * 0.05, 0.15);
    }

    return Math.min(probability, 1.0);
  }

  /**
   * Get channels where both users are currently active
   */
  private async getSharedActiveChannels(
    userA: string,
    userB: string,
    serverId: string
  ): Promise<string[]> {
    try {
      const query = `
        SELECT DISTINCT m1.channel_id
        FROM messages m1
        JOIN messages m2 ON m1.channel_id = m2.channel_id
        WHERE m1.server_id = $1
        AND m1.author_id = $2
        AND m2.author_id = $3
        AND m1.created_at >= NOW() - INTERVAL '1 hour'
        AND m2.created_at >= NOW() - INTERVAL '1 hour'
      `;

      const result = await this.db.query(query, [serverId, userA, userB]);
      return result.rows.map(row => row.channel_id);

    } catch (error) {
      logger.error('Error getting shared active channels:', error);
      return [];
    }
  }

  /**
   * Generate recommendation based on conflict probability
   */
  private generateRecommendation(
    probability: number,
    factors: ConflictPrediction['factors'],
    bothActive: boolean
  ): string {
    if (probability >= 0.8) {
      if (bothActive) {
        return 'URGENT: Both users active in same channel. Consider immediate intervention or temporary channel separation.';
      } else {
        return 'HIGH RISK: Monitor closely. Consider preemptive warning DMs to both users.';
      }
    } else if (probability >= 0.6) {
      return 'ELEVATED RISK: Watch for escalation signs. Have moderator ready to intervene if needed.';
    } else if (probability >= 0.4) {
      return 'MODERATE RISK: Keep on radar. Monitor their interactions in coming hours.';
    } else {
      return 'LOW RISK: Normal monitoring sufficient.';
    }
  }

  /**
   * Store prediction in database
   */
  private async storePrediction(
    serverId: string,
    prediction: ConflictPrediction
  ): Promise<void> {
    try {
      const query = `
        INSERT INTO conflict_predictions
        (server_id, user_a, user_b, conflict_probability, risk_level,
         past_conflicts_count, last_conflict_date, negative_interactions_count,
         relationship_score, both_active_in_channels, recent_interaction_count,
         predicted_at, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (server_id, user_a, user_b)
        DO UPDATE SET
          conflict_probability = EXCLUDED.conflict_probability,
          risk_level = EXCLUDED.risk_level,
          predicted_at = EXCLUDED.predicted_at,
          expires_at = EXCLUDED.expires_at
      `;

      await this.db.query(query, [
        serverId,
        prediction.userA,
        prediction.userB,
        prediction.conflictProbability,
        prediction.riskLevel,
        prediction.factors.pastConflictsCount,
        prediction.factors.lastConflictDate,
        prediction.factors.negativeInteractionsCount,
        prediction.factors.relationshipScore,
        prediction.bothActiveInChannels,
        prediction.factors.recentInteractionCount,
        prediction.predictedAt,
        new Date(Date.now() + 24 * 60 * 60 * 1000) // Expires in 24h
      ]);

    } catch (error) {
      logger.error('Error storing conflict prediction:', error);
    }
  }

  /**
   * Get active conflict predictions for a server
   */
  async getActivePredictions(
    serverId: string,
    minRiskLevel: 'low' | 'medium' | 'high' | 'critical' = 'medium'
  ): Promise<ConflictPrediction[]> {
    try {
      const riskOrder = { low: 0, medium: 1, high: 2, critical: 3 };
      const minLevel = riskOrder[minRiskLevel];

      const query = `
        SELECT *
        FROM conflict_predictions
        WHERE server_id = $1
        AND occurred IS NULL
        AND expires_at > NOW()
        AND (
          (risk_level = 'low' AND ${minLevel} <= 0) OR
          (risk_level = 'medium' AND ${minLevel} <= 1) OR
          (risk_level = 'high' AND ${minLevel} <= 2) OR
          (risk_level = 'critical' AND ${minLevel} <= 3)
        )
        ORDER BY conflict_probability DESC
        LIMIT 50
      `;

      const result = await this.db.query(query, [serverId]);

      return result.rows.map(row => ({
        userA: row.user_a,
        userB: row.user_b,
        conflictProbability: parseFloat(row.conflict_probability),
        riskLevel: row.risk_level,
        factors: {
          pastConflictsCount: row.past_conflicts_count,
          lastConflictDate: row.last_conflict_date ? new Date(row.last_conflict_date) : undefined,
          negativeInteractionsCount: row.negative_interactions_count,
          relationshipScore: parseFloat(row.relationship_score),
          recentInteractionCount: row.recent_interaction_count
        },
        bothActiveInChannels: row.both_active_in_channels || [],
        recommendedAction: '', // Would be regenerated if needed
        predictedAt: new Date(row.predicted_at)
      }));

    } catch (error) {
      logger.error('Error getting active predictions:', error);
      return [];
    }
  }

  /**
   * Create conflict alert for moderators
   */
  createAlert(prediction: ConflictPrediction): ConflictAlert {
    const urgency = prediction.riskLevel;
    const message = this.generateAlertMessage(prediction);
    const suggestedInterventions = this.getSuggestedInterventions(prediction);

    return {
      prediction,
      message,
      urgency,
      suggestedInterventions
    };
  }

  /**
   * Generate alert message
   */
  private generateAlertMessage(prediction: ConflictPrediction): string {
    const { userA, userB, conflictProbability, factors } = prediction;

    let message = `⚠️ **Conflict Risk Detected**\n\n`;
    message += `**Users:** <@${userA}> and <@${userB}>\n`;
    message += `**Risk Level:** ${prediction.riskLevel.toUpperCase()} (${(conflictProbability * 100).toFixed(0)}% probability)\n\n`;

    message += `**Contributing Factors:**\n`;
    if (factors.pastConflictsCount > 0) {
      message += `• ${factors.pastConflictsCount} past conflict(s)`;
      if (factors.lastConflictDate) {
        const daysAgo = Math.floor((Date.now() - factors.lastConflictDate.getTime()) / (1000 * 60 * 60 * 24));
        message += ` (last ${daysAgo} day(s) ago)`;
      }
      message += `\n`;
    }
    if (factors.relationshipScore < -0.2) {
      message += `• Negative relationship (score: ${factors.relationshipScore.toFixed(2)})\n`;
    }
    if (factors.negativeInteractionsCount > 0) {
      message += `• ${factors.negativeInteractionsCount} negative interaction(s) in last 24h\n`;
    }
    if (prediction.bothActiveInChannels.length > 0) {
      message += `• Both active in ${prediction.bothActiveInChannels.length} channel(s)\n`;
    }

    message += `\n**Recommended Action:** ${prediction.recommendedAction}`;

    return message;
  }

  /**
   * Get suggested interventions
   */
  private getSuggestedInterventions(prediction: ConflictPrediction): string[] {
    const interventions: string[] = [];

    if (prediction.riskLevel === 'critical') {
      interventions.push('Send immediate DM warning to both users');
      interventions.push('Assign moderator to monitor their interactions');
      if (prediction.bothActiveInChannels.length > 0) {
        interventions.push('Consider temporary channel separation (slowmode or mute one)');
      }
      interventions.push('Prepare timeout action if conflict starts');
    } else if (prediction.riskLevel === 'high') {
      interventions.push('Send calming DM to both users');
      interventions.push('Monitor their messages closely');
      interventions.push('Have moderator ready in active channels');
    } else if (prediction.riskLevel === 'medium') {
      interventions.push('Watch for escalation signs');
      interventions.push('Consider friendly reminder about server rules');
    }

    return interventions;
  }

  /**
   * Record conflict outcome (for learning)
   */
  async recordOutcome(
    serverId: string,
    userA: string,
    userB: string,
    conflictOccurred: boolean,
    interventionTaken: boolean,
    interventionType?: string,
    notes?: string
  ): Promise<void> {
    try {
      const query = `
        UPDATE conflict_predictions
        SET
          occurred = $4,
          occurred_at = CURRENT_TIMESTAMP,
          intervention_taken = $5,
          intervention_type = $6,
          moderator_notes = $7,
          prediction_accurate = (occurred = $4)
        WHERE server_id = $1
        AND user_a = $2
        AND user_b = $3
        AND occurred IS NULL
      `;

      await this.db.query(query, [
        serverId,
        userA < userB ? userA : userB,
        userA < userB ? userB : userA,
        conflictOccurred,
        interventionTaken,
        interventionType,
        notes
      ]);

      logger.info(`Recorded conflict outcome for ${userA} and ${userB}: ${conflictOccurred ? 'occurred' : 'avoided'}`);

    } catch (error) {
      logger.error('Error recording conflict outcome:', error);
    }
  }

  /**
   * Get prediction accuracy stats
   */
  async getPredictionAccuracy(serverId: string, days: number = 7): Promise<{
    totalPredictions: number;
    accurateCount: number;
    accuracy: number;
    falsePositives: number;
    falseNegatives: number;
  }> {
    try {
      const query = `
        SELECT
          COUNT(*) as total_predictions,
          SUM(CASE WHEN prediction_accurate = true THEN 1 ELSE 0 END) as accurate_count,
          SUM(CASE WHEN occurred = false THEN 1 ELSE 0 END) as false_positives,
          SUM(CASE WHEN occurred = true AND intervention_taken = false THEN 1 ELSE 0 END) as false_negatives
        FROM conflict_predictions
        WHERE server_id = $1
        AND occurred IS NOT NULL
        AND predicted_at >= NOW() - INTERVAL '1 day' * $2
      `;

      const result = await this.db.query(query, [serverId, days]);
      const stats = result.rows[0];

      const totalPredictions = parseInt(stats.total_predictions) || 0;
      const accurateCount = parseInt(stats.accurate_count) || 0;

      return {
        totalPredictions,
        accurateCount,
        accuracy: totalPredictions > 0 ? accurateCount / totalPredictions : 0,
        falsePositives: parseInt(stats.false_positives) || 0,
        falseNegatives: parseInt(stats.false_negatives) || 0
      };

    } catch (error) {
      logger.error('Error getting prediction accuracy:', error);
      return {
        totalPredictions: 0,
        accurateCount: 0,
        accuracy: 0,
        falsePositives: 0,
        falseNegatives: 0
      };
    }
  }
}

/**
 * Example usage:
 *
 * const predictor = new ConflictPredictor(db, discordClient);
 *
 * // Run predictions hourly via cron
 * const predictions = await predictor.predictServerConflicts(serverId);
 *
 * // Alert moderators of high-risk conflicts
 * for (const prediction of predictions) {
 *   if (prediction.riskLevel === 'critical' || prediction.riskLevel === 'high') {
 *     const alert = predictor.createAlert(prediction);
 *     await sendModeratorAlert(alert);
 *   }
 * }
 *
 * // After a conflict occurs (or is avoided)
 * await predictor.recordOutcome(serverId, userA, userB, true, true, 'dm_warning', 'Sent calming messages');
 *
 * // Check prediction accuracy
 * const accuracy = await predictor.getPredictionAccuracy(serverId, 30);
 * console.log(`Prediction accuracy: ${(accuracy.accuracy * 100).toFixed(1)}%`);
 */
