import { Pool } from 'pg';
import logger from '../utils/logger';

/**
 * AnomalyDetector
 *
 * Detects unusual patterns in user/server behavior to enable proactive moderation.
 * Uses statistical analysis and historical baselines to identify anomalies.
 *
 * Detection Types:
 * 1. Activity Spike - Sudden increase in message volume
 * 2. Time Anomaly - Activity at unusual hours
 * 3. Behavior Change - Sudden shift in communication style
 * 4. Link Spam Spike - Sudden increase in link posting
 * 5. Account Compromise - Drastic behavior change suggesting hack
 * 6. Coordinated Attack - Multiple users with suspicious synchronized activity
 */

export interface AnomalyResult {
  type: AnomalyType;
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidence: number; // 0-1
  description: string;
  affectedUsers?: string[];
  affectedChannels?: string[];
  metrics: {
    baseline: number;
    current: number;
    deviation: number; // Standard deviations from baseline
  };
  timestamp: Date;
  recommendedAction?: string;
}

export type AnomalyType =
  | 'activity_spike'
  | 'time_anomaly'
  | 'behavior_change'
  | 'link_spam_spike'
  | 'account_compromise'
  | 'coordinated_attack';

interface UserActivityBaseline {
  userId: string;
  avgMessagesPerHour: number;
  avgMessageLength: number;
  avgLinksPerMessage: number;
  commonActiveHours: number[]; // Hours of day (0-23)
  stdDevMessagesPerHour: number;
}

interface ServerActivityBaseline {
  serverId: string;
  avgMessagesPerHour: number;
  avgActiveUsers: number;
  avgToxicityRate: number;
  stdDevMessagesPerHour: number;
}

export class AnomalyDetector {
  constructor(private db: Pool) {}

  /**
   * Detect all anomalies for a server
   */
  async detectServerAnomalies(serverId: string): Promise<AnomalyResult[]> {
    const anomalies: AnomalyResult[] = [];

    try {
      // 1. Activity Spike Detection
      const activityAnomalies = await this.detectActivitySpikes(serverId);
      anomalies.push(...activityAnomalies);

      // 2. Coordinated Attack Detection
      const coordinatedAnomalies = await this.detectCoordinatedAttacks(serverId);
      anomalies.push(...coordinatedAnomalies);

      // Store anomalies in database
      for (const anomaly of anomalies) {
        await this.storeAnomaly(serverId, anomaly);
      }

      logger.info(`Detected ${anomalies.length} anomalies for server ${serverId}`);
      return anomalies;

    } catch (error) {
      logger.error('Error detecting server anomalies:', error);
      return [];
    }
  }

  /**
   * Detect anomalies for a specific user
   */
  async detectUserAnomalies(
    userId: string,
    serverId: string
  ): Promise<AnomalyResult[]> {
    const anomalies: AnomalyResult[] = [];

    try {
      // 1. Time Anomaly Detection
      const timeAnomalies = await this.detectTimeAnomalies(userId, serverId);
      anomalies.push(...timeAnomalies);

      // 2. Behavior Change Detection
      const behaviorAnomalies = await this.detectBehaviorChanges(userId, serverId);
      anomalies.push(...behaviorAnomalies);

      // 3. Link Spam Spike
      const linkAnomalies = await this.detectLinkSpamSpikes(userId, serverId);
      anomalies.push(...linkAnomalies);

      // 4. Account Compromise Detection
      const compromiseAnomalies = await this.detectAccountCompromise(userId, serverId);
      anomalies.push(...compromiseAnomalies);

      // Store anomalies
      for (const anomaly of anomalies) {
        await this.storeAnomaly(serverId, anomaly);
      }

      if (anomalies.length > 0) {
        logger.info(`Detected ${anomalies.length} anomalies for user ${userId}`);
      }

      return anomalies;

    } catch (error) {
      logger.error('Error detecting user anomalies:', error);
      return [];
    }
  }

  /**
   * Detect sudden activity spikes in the server
   */
  private async detectActivitySpikes(serverId: string): Promise<AnomalyResult[]> {
    try {
      // Get baseline activity (past 7 days, excluding last hour)
      const baselineQuery = `
        SELECT
          COUNT(*)::float / (7 * 24) as avg_messages_per_hour,
          STDDEV(hourly_count) as std_dev
        FROM (
          SELECT DATE_TRUNC('hour', created_at) as hour, COUNT(*) as hourly_count
          FROM messages
          WHERE server_id = $1
          AND created_at >= NOW() - INTERVAL '7 days'
          AND created_at < NOW() - INTERVAL '1 hour'
          GROUP BY DATE_TRUNC('hour', created_at)
        ) hourly_stats
      `;

      const baselineResult = await this.db.query(baselineQuery, [serverId]);
      const baseline = baselineResult.rows[0];

      if (!baseline || !baseline.avg_messages_per_hour) {
        return []; // Not enough data
      }

      // Get current hour activity
      const currentQuery = `
        SELECT COUNT(*) as current_count
        FROM messages
        WHERE server_id = $1
        AND created_at >= DATE_TRUNC('hour', NOW())
      `;

      const currentResult = await this.db.query(currentQuery, [serverId]);
      const currentCount = parseInt(currentResult.rows[0].current_count);

      // Calculate deviation
      const avgMessages = parseFloat(baseline.avg_messages_per_hour);
      const stdDev = parseFloat(baseline.std_dev) || avgMessages * 0.3; // Fallback: 30%
      const deviation = (currentCount - avgMessages) / stdDev;

      // Anomaly if > 3 standard deviations
      if (deviation > 3) {
        const severity =
          deviation > 10 ? 'critical' :
          deviation > 6 ? 'high' :
          deviation > 4 ? 'medium' : 'low';

        return [{
          type: 'activity_spike',
          severity,
          confidence: Math.min(deviation / 10, 1),
          description: `Unusual activity spike detected: ${currentCount} messages this hour vs ${avgMessages.toFixed(1)} average (${deviation.toFixed(1)}σ)`,
          metrics: {
            baseline: avgMessages,
            current: currentCount,
            deviation
          },
          timestamp: new Date(),
          recommendedAction: severity === 'critical' || severity === 'high'
            ? 'Investigate possible raid or spam attack'
            : 'Monitor activity for next hour'
        }];
      }

      return [];

    } catch (error) {
      logger.error('Error detecting activity spikes:', error);
      return [];
    }
  }

  /**
   * Detect time anomalies (activity at unusual hours for a user)
   */
  private async detectTimeAnomalies(
    userId: string,
    serverId: string
  ): Promise<AnomalyResult[]> {
    try {
      // Get user's typical active hours (past 30 days)
      const baselineQuery = `
        SELECT
          EXTRACT(HOUR FROM created_at) as hour,
          COUNT(*) as message_count
        FROM messages
        WHERE author_id = $1
        AND server_id = $2
        AND created_at >= NOW() - INTERVAL '30 days'
        GROUP BY EXTRACT(HOUR FROM created_at)
        ORDER BY message_count DESC
      `;

      const baselineResult = await this.db.query(baselineQuery, [userId, serverId]);

      if (baselineResult.rows.length < 5) {
        return []; // Not enough data
      }

      // User's typical active hours (top 50% of hours by activity)
      const totalMessages = baselineResult.rows.reduce((sum, row) => sum + parseInt(row.message_count), 0);
      const threshold = totalMessages * 0.1; // Hours with >10% of total messages
      const typicalHours = baselineResult.rows
        .filter(row => parseInt(row.message_count) >= threshold)
        .map(row => parseInt(row.hour));

      // Check recent activity (last hour)
      const currentHour = new Date().getHours();
      const recentQuery = `
        SELECT COUNT(*) as recent_count
        FROM messages
        WHERE author_id = $1
        AND server_id = $2
        AND created_at >= NOW() - INTERVAL '1 hour'
      `;

      const recentResult = await this.db.query(recentQuery, [userId, serverId]);
      const recentCount = parseInt(recentResult.rows[0].recent_count);

      // Anomaly if active during unusual hours with significant activity
      if (!typicalHours.includes(currentHour) && recentCount > 5) {
        return [{
          type: 'time_anomaly',
          severity: 'medium',
          confidence: 0.7,
          description: `User active at unusual hour (${currentHour}:00). Typical hours: ${typicalHours.join(', ')}`,
          affectedUsers: [userId],
          metrics: {
            baseline: typicalHours.length,
            current: currentHour,
            deviation: 0
          },
          timestamp: new Date(),
          recommendedAction: 'Monitor for account compromise if combined with behavior changes'
        }];
      }

      return [];

    } catch (error) {
      logger.error('Error detecting time anomalies:', error);
      return [];
    }
  }

  /**
   * Detect sudden behavior changes (communication style, toxicity, etc.)
   */
  private async detectBehaviorChanges(
    userId: string,
    serverId: string
  ): Promise<AnomalyResult[]> {
    try {
      // Get baseline behavior (past 30 days, excluding last 24h)
      const baselineQuery = `
        SELECT
          AVG(LENGTH(content)) as avg_length,
          AVG(CASE WHEN content ~* 'https?://' THEN 1 ELSE 0 END) as avg_has_link,
          COUNT(*) as message_count
        FROM messages
        WHERE author_id = $1
        AND server_id = $2
        AND created_at >= NOW() - INTERVAL '30 days'
        AND created_at < NOW() - INTERVAL '24 hours'
      `;

      const baselineResult = await this.db.query(baselineQuery, [userId, serverId]);
      const baseline = baselineResult.rows[0];

      if (parseInt(baseline.message_count) < 20) {
        return []; // Not enough data
      }

      // Get recent behavior (last 24h)
      const recentQuery = `
        SELECT
          AVG(LENGTH(content)) as avg_length,
          AVG(CASE WHEN content ~* 'https?://' THEN 1 ELSE 0 END) as avg_has_link,
          COUNT(*) as message_count
        FROM messages
        WHERE author_id = $1
        AND server_id = $2
        AND created_at >= NOW() - INTERVAL '24 hours'
      `;

      const recentResult = await this.db.query(recentQuery, [userId, serverId]);
      const recent = recentResult.rows[0];

      if (parseInt(recent.message_count) < 5) {
        return []; // Not enough recent activity
      }

      const anomalies: AnomalyResult[] = [];

      // Check message length change
      const avgLength = parseFloat(baseline.avg_length);
      const recentLength = parseFloat(recent.avg_length);
      const lengthChange = Math.abs(recentLength - avgLength) / avgLength;

      if (lengthChange > 1.5) { // 150% change
        anomalies.push({
          type: 'behavior_change',
          severity: lengthChange > 3 ? 'high' : 'medium',
          confidence: Math.min(lengthChange / 3, 1),
          description: `Dramatic message length change: ${recentLength.toFixed(0)} chars vs ${avgLength.toFixed(0)} baseline (${(lengthChange * 100).toFixed(0)}% change)`,
          affectedUsers: [userId],
          metrics: {
            baseline: avgLength,
            current: recentLength,
            deviation: lengthChange
          },
          timestamp: new Date(),
          recommendedAction: 'Check for account compromise if combined with time anomaly'
        });
      }

      // Check link posting behavior change
      const avgLinks = parseFloat(baseline.avg_has_link);
      const recentLinks = parseFloat(recent.avg_has_link);
      const linkChange = Math.abs(recentLinks - avgLinks);

      if (linkChange > 0.3 && recentLinks > avgLinks) { // 30%+ increase in link posting
        anomalies.push({
          type: 'behavior_change',
          severity: linkChange > 0.6 ? 'high' : 'medium',
          confidence: Math.min(linkChange / 0.6, 1),
          description: `Sudden increase in link posting: ${(recentLinks * 100).toFixed(0)}% of messages vs ${(avgLinks * 100).toFixed(0)}% baseline`,
          affectedUsers: [userId],
          metrics: {
            baseline: avgLinks,
            current: recentLinks,
            deviation: linkChange
          },
          timestamp: new Date(),
          recommendedAction: 'Monitor for spam or account compromise'
        });
      }

      return anomalies;

    } catch (error) {
      logger.error('Error detecting behavior changes:', error);
      return [];
    }
  }

  /**
   * Detect link spam spikes
   */
  private async detectLinkSpamSpikes(
    userId: string,
    serverId: string
  ): Promise<AnomalyResult[]> {
    try {
      // Count links in last hour
      const recentQuery = `
        SELECT
          COUNT(*) as message_count,
          SUM(ARRAY_LENGTH(REGEXP_MATCHES(content, 'https?://[^\\s]+', 'g'), 1)) as link_count
        FROM messages
        WHERE author_id = $1
        AND server_id = $2
        AND created_at >= NOW() - INTERVAL '1 hour'
      `;

      const recentResult = await this.db.query(recentQuery, [userId, serverId]);
      const { message_count, link_count } = recentResult.rows[0];

      const msgCount = parseInt(message_count) || 0;
      const lnkCount = parseInt(link_count) || 0;

      // Anomaly if >5 links in last hour from single user
      if (lnkCount >= 5) {
        return [{
          type: 'link_spam_spike',
          severity: lnkCount >= 10 ? 'high' : 'medium',
          confidence: Math.min(lnkCount / 10, 1),
          description: `Link spam spike: ${lnkCount} links in ${msgCount} messages within 1 hour`,
          affectedUsers: [userId],
          metrics: {
            baseline: 1,
            current: lnkCount,
            deviation: lnkCount - 1
          },
          timestamp: new Date(),
          recommendedAction: 'Consider timeout or ban if links are spam/scam'
        }];
      }

      return [];

    } catch (error) {
      logger.error('Error detecting link spam spikes:', error);
      return [];
    }
  }

  /**
   * Detect account compromise (drastic behavior change + time anomaly + content change)
   */
  private async detectAccountCompromise(
    userId: string,
    serverId: string
  ): Promise<AnomalyResult[]> {
    try {
      // Detect multiple anomalies
      const timeAnomalies = await this.detectTimeAnomalies(userId, serverId);
      const behaviorAnomalies = await this.detectBehaviorChanges(userId, serverId);
      const linkAnomalies = await this.detectLinkSpamSpikes(userId, serverId);

      // Account compromise if multiple anomalies detected
      const anomalyCount = timeAnomalies.length + behaviorAnomalies.length + linkAnomalies.length;

      if (anomalyCount >= 2) {
        return [{
          type: 'account_compromise',
          severity: 'critical',
          confidence: Math.min(anomalyCount / 3, 1),
          description: `Possible account compromise detected: ${anomalyCount} simultaneous behavioral anomalies`,
          affectedUsers: [userId],
          metrics: {
            baseline: 0,
            current: anomalyCount,
            deviation: anomalyCount
          },
          timestamp: new Date(),
          recommendedAction: 'URGENT: Contact user via alternative channel, consider temporary suspension'
        }];
      }

      return [];

    } catch (error) {
      logger.error('Error detecting account compromise:', error);
      return [];
    }
  }

  /**
   * Detect coordinated attacks (multiple users with synchronized suspicious activity)
   */
  private async detectCoordinatedAttacks(serverId: string): Promise<AnomalyResult[]> {
    try {
      // Find users who joined recently and are posting links
      const suspiciousUsersQuery = `
        SELECT
          m.author_id,
          COUNT(*) as message_count,
          SUM(ARRAY_LENGTH(REGEXP_MATCHES(m.content, 'https?://[^\\s]+', 'g'), 1)) as link_count,
          MIN(m.created_at) as first_message
        FROM messages m
        WHERE m.server_id = $1
        AND m.created_at >= NOW() - INTERVAL '1 hour'
        GROUP BY m.author_id
        HAVING SUM(ARRAY_LENGTH(REGEXP_MATCHES(m.content, 'https?://[^\\s]+', 'g'), 1)) >= 3
        AND COUNT(*) >= 3
      `;

      const suspiciousResult = await this.db.query(suspiciousUsersQuery, [serverId]);

      if (suspiciousResult.rows.length >= 3) {
        const affectedUsers = suspiciousResult.rows.map(row => row.author_id);

        return [{
          type: 'coordinated_attack',
          severity: 'critical',
          confidence: Math.min(suspiciousResult.rows.length / 5, 1),
          description: `Coordinated attack detected: ${suspiciousResult.rows.length} users posting links simultaneously`,
          affectedUsers,
          metrics: {
            baseline: 0,
            current: suspiciousResult.rows.length,
            deviation: suspiciousResult.rows.length
          },
          timestamp: new Date(),
          recommendedAction: 'URGENT: Mass ban suspected raid participants'
        }];
      }

      return [];

    } catch (error) {
      logger.error('Error detecting coordinated attacks:', error);
      return [];
    }
  }

  /**
   * Store anomaly in database
   */
  private async storeAnomaly(serverId: string, anomaly: AnomalyResult): Promise<void> {
    try {
      const query = `
        INSERT INTO anomaly_detections
        (server_id, type, severity, confidence, description, affected_users, affected_channels,
         baseline_value, current_value, deviation, recommended_action, detected_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `;

      await this.db.query(query, [
        serverId,
        anomaly.type,
        anomaly.severity,
        anomaly.confidence,
        anomaly.description,
        anomaly.affectedUsers || [],
        anomaly.affectedChannels || [],
        anomaly.metrics.baseline,
        anomaly.metrics.current,
        anomaly.metrics.deviation,
        anomaly.recommendedAction,
        anomaly.timestamp
      ]);

    } catch (error) {
      logger.error('Error storing anomaly:', error);
    }
  }

  /**
   * Get recent anomalies for a server
   */
  async getRecentAnomalies(
    serverId: string,
    hours: number = 24,
    minSeverity?: 'low' | 'medium' | 'high' | 'critical'
  ): Promise<AnomalyResult[]> {
    try {
      let query = `
        SELECT *
        FROM anomaly_detections
        WHERE server_id = $1
        AND detected_at >= NOW() - INTERVAL '${hours} hours'
      `;

      if (minSeverity) {
        const severityOrder = { low: 0, medium: 1, high: 2, critical: 3 };
        const minLevel = severityOrder[minSeverity];
        query += ` AND (
          (severity = 'low' AND ${minLevel} <= 0) OR
          (severity = 'medium' AND ${minLevel} <= 1) OR
          (severity = 'high' AND ${minLevel} <= 2) OR
          (severity = 'critical' AND ${minLevel} <= 3)
        )`;
      }

      query += ' ORDER BY detected_at DESC LIMIT 50';

      const result = await this.db.query(query, [serverId]);

      return result.rows.map(row => ({
        type: row.type,
        severity: row.severity,
        confidence: parseFloat(row.confidence),
        description: row.description,
        affectedUsers: row.affected_users,
        affectedChannels: row.affected_channels,
        metrics: {
          baseline: parseFloat(row.baseline_value),
          current: parseFloat(row.current_value),
          deviation: parseFloat(row.deviation)
        },
        timestamp: row.detected_at,
        recommendedAction: row.recommended_action
      }));

    } catch (error) {
      logger.error('Error getting recent anomalies:', error);
      return [];
    }
  }
}

/**
 * Example usage:
 *
 * const detector = new AnomalyDetector(db);
 *
 * // Detect server anomalies (run every hour via cron)
 * const serverAnomalies = await detector.detectServerAnomalies(serverId);
 * for (const anomaly of serverAnomalies) {
 *   if (anomaly.severity === 'critical' || anomaly.severity === 'high') {
 *     // Send alert to moderators
 *     await alertModerators(anomaly);
 *   }
 * }
 *
 * // Detect user anomalies (run on every message)
 * const userAnomalies = await detector.detectUserAnomalies(userId, serverId);
 * if (userAnomalies.some(a => a.type === 'account_compromise')) {
 *   // Immediate action
 *   await suspendUser(userId);
 * }
 *
 * // Get recent anomalies for dashboard
 * const recentAnomalies = await detector.getRecentAnomalies(serverId, 24, 'high');
 */
