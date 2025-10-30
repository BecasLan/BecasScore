import { Pool } from 'pg';
import { Client } from 'discord.js';
import * as cron from 'node-cron';
import logger from '../utils/logger';

/**
 * ServerHealthMonitor
 *
 * Collects hourly snapshots of server health metrics for trend analysis.
 * Monitors activity, sentiment, toxicity, moderation, and engagement.
 *
 * Metrics Collected:
 * - Activity: messages/hour, active users, engagement
 * - Sentiment: average sentiment, trend
 * - Toxicity: toxicity rate, toxic message count
 * - Moderation: warnings, timeouts, kicks, bans
 * - Engagement: message length, links, reactions
 * - Health Score: 0-100 overall health score
 */

export interface HealthSnapshot {
  serverId: string;
  snapshotTime: Date;

  // Activity metrics
  activeUsersCount: number;
  messagesCount: number;
  messagesPerHour: number;

  // Sentiment metrics
  avgSentiment: number; // -1 to 1
  sentimentTrend: 'improving' | 'stable' | 'declining';

  // Toxicity metrics
  toxicityRate: number; // 0 to 1
  toxicMessagesCount: number;

  // Moderation metrics
  moderationActionsCount: number;
  warningsCount: number;
  timeoutsCount: number;
  kicksCount: number;
  bansCount: number;

  // Engagement metrics
  avgMessageLength: number;
  linksSharedCount: number;
  reactionsCount: number;

  // Trends (vs previous hour)
  messagesChangePercent: number;
  toxicityChangePercent: number;
  sentimentChangePercent: number;

  // Health score
  healthScore: number; // 0-100
  healthStatus: 'healthy' | 'warning' | 'critical';
}

export class ServerHealthMonitor {
  private cronJob?: cron.ScheduledTask;
  private running = false;

  constructor(
    private db: Pool,
    private discordClient: Client
  ) {}

  /**
   * Start hourly health monitoring
   */
  start(): void {
    if (this.running) {
      logger.warn('ServerHealthMonitor already running');
      return;
    }

    // Run every hour at minute 0
    this.cronJob = cron.schedule('0 * * * *', async () => {
      await this.collectAllServersHealth();
    });

    this.running = true;
    logger.info('✓ ServerHealthMonitor started (hourly snapshots)');

    // Collect initial snapshot
    this.collectAllServersHealth();
  }

  /**
   * Stop health monitoring
   */
  stop(): void {
    if (this.cronJob) {
      this.cronJob.stop();
      this.running = false;
      logger.info('ServerHealthMonitor stopped');
    }
  }

  /**
   * Collect health snapshot for all servers
   */
  async collectAllServersHealth(): Promise<void> {
    try {
      // Get all servers the bot is in
      const serverIds = this.discordClient.guilds.cache.map(guild => guild.id);

      logger.info(`Collecting health snapshots for ${serverIds.length} servers...`);

      for (const serverId of serverIds) {
        try {
          await this.collectServerHealth(serverId);
        } catch (error) {
          logger.error(`Error collecting health for server ${serverId}:`, error);
        }
      }

      logger.info('✓ Health snapshots collected');

    } catch (error) {
      logger.error('Error collecting all servers health:', error);
    }
  }

  /**
   * Collect health snapshot for a specific server
   */
  async collectServerHealth(serverId: string): Promise<HealthSnapshot> {
    try {
      const snapshotTime = new Date();
      snapshotTime.setMinutes(0, 0, 0); // Round to hour

      // 1. Activity Metrics
      const activityMetrics = await this.collectActivityMetrics(serverId, snapshotTime);

      // 2. Sentiment Metrics
      const sentimentMetrics = await this.collectSentimentMetrics(serverId, snapshotTime);

      // 3. Toxicity Metrics
      const toxicityMetrics = await this.collectToxicityMetrics(serverId, snapshotTime);

      // 4. Moderation Metrics
      const moderationMetrics = await this.collectModerationMetrics(serverId, snapshotTime);

      // 5. Engagement Metrics
      const engagementMetrics = await this.collectEngagementMetrics(serverId, snapshotTime);

      // 6. Calculate Trends (vs previous hour)
      const trends = await this.calculateTrends(serverId, snapshotTime);

      // Build complete snapshot
      const snapshot: HealthSnapshot = {
        serverId,
        snapshotTime,
        ...activityMetrics,
        ...sentimentMetrics,
        ...toxicityMetrics,
        ...moderationMetrics,
        ...engagementMetrics,
        ...trends,
        healthScore: 100, // Will be calculated by database trigger
        healthStatus: 'healthy'
      };

      // Store in database
      await this.storeSnapshot(snapshot);

      logger.info(`Health snapshot collected for server ${serverId}: ${snapshot.healthScore} (${snapshot.healthStatus})`);

      return snapshot;

    } catch (error) {
      logger.error(`Error collecting server health for ${serverId}:`, error);
      throw error;
    }
  }

  /**
   * Collect activity metrics
   */
  private async collectActivityMetrics(serverId: string, snapshotTime: Date): Promise<{
    activeUsersCount: number;
    messagesCount: number;
    messagesPerHour: number;
  }> {
    const hourStart = new Date(snapshotTime);
    hourStart.setHours(hourStart.getHours() - 1);

    const query = `
      SELECT
        COUNT(DISTINCT author_id) as active_users_count,
        COUNT(*) as messages_count
      FROM messages
      WHERE server_id = $1
      AND created_at >= $2
      AND created_at < $3
    `;

    const result = await this.db.query(query, [serverId, hourStart, snapshotTime]);
    const data = result.rows[0];

    return {
      activeUsersCount: parseInt(data.active_users_count) || 0,
      messagesCount: parseInt(data.messages_count) || 0,
      messagesPerHour: parseInt(data.messages_count) || 0
    };
  }

  /**
   * Collect sentiment metrics
   */
  private async collectSentimentMetrics(serverId: string, snapshotTime: Date): Promise<{
    avgSentiment: number;
    sentimentTrend: 'improving' | 'stable' | 'declining';
  }> {
    const hourStart = new Date(snapshotTime);
    hourStart.setHours(hourStart.getHours() - 1);

    // Note: Sentiment would come from message analysis
    // For now, use placeholder logic
    const query = `
      SELECT
        AVG(CASE
          WHEN content ~* '(good|great|awesome|love|thanks|happy)' THEN 0.5
          WHEN content ~* '(bad|hate|angry|stupid|terrible)' THEN -0.5
          ELSE 0
        END) as avg_sentiment
      FROM messages
      WHERE server_id = $1
      AND created_at >= $2
      AND created_at < $3
    `;

    const result = await this.db.query(query, [serverId, hourStart, snapshotTime]);
    const avgSentiment = parseFloat(result.rows[0]?.avg_sentiment || '0');

    // Get previous hour's sentiment for trend
    const prevHourStart = new Date(hourStart);
    prevHourStart.setHours(prevHourStart.getHours() - 1);

    const prevQuery = `
      SELECT avg_sentiment
      FROM server_health_snapshots
      WHERE server_id = $1
      AND snapshot_time = $2
    `;

    const prevResult = await this.db.query(prevQuery, [serverId, prevHourStart]);
    const prevSentiment = prevResult.rows[0]
      ? parseFloat(prevResult.rows[0].avg_sentiment)
      : 0;

    let sentimentTrend: 'improving' | 'stable' | 'declining' = 'stable';
    if (avgSentiment > prevSentiment + 0.1) {
      sentimentTrend = 'improving';
    } else if (avgSentiment < prevSentiment - 0.1) {
      sentimentTrend = 'declining';
    }

    return {
      avgSentiment,
      sentimentTrend
    };
  }

  /**
   * Collect toxicity metrics
   */
  private async collectToxicityMetrics(serverId: string, snapshotTime: Date): Promise<{
    toxicityRate: number;
    toxicMessagesCount: number;
  }> {
    const hourStart = new Date(snapshotTime);
    hourStart.setHours(hourStart.getHours() - 1);

    // Note: Toxicity would come from message analysis
    // For now, use simple keyword matching
    const query = `
      SELECT
        COUNT(*) as total_messages,
        SUM(CASE
          WHEN content ~* '(fuck|shit|damn|hate|idiot|stupid|kill|die)' THEN 1
          ELSE 0
        END) as toxic_messages
      FROM messages
      WHERE server_id = $1
      AND created_at >= $2
      AND created_at < $3
    `;

    const result = await this.db.query(query, [serverId, hourStart, snapshotTime]);
    const data = result.rows[0];

    const totalMessages = parseInt(data.total_messages) || 1;
    const toxicMessages = parseInt(data.toxic_messages) || 0;

    return {
      toxicityRate: toxicMessages / totalMessages,
      toxicMessagesCount: toxicMessages
    };
  }

  /**
   * Collect moderation metrics
   */
  private async collectModerationMetrics(serverId: string, snapshotTime: Date): Promise<{
    moderationActionsCount: number;
    warningsCount: number;
    timeoutsCount: number;
    kicksCount: number;
    bansCount: number;
  }> {
    const hourStart = new Date(snapshotTime);
    hourStart.setHours(hourStart.getHours() - 1);

    const query = `
      SELECT
        COUNT(*) as total_actions,
        SUM(CASE WHEN type = 'warning' THEN 1 ELSE 0 END) as warnings,
        SUM(CASE WHEN type = 'timeout' THEN 1 ELSE 0 END) as timeouts,
        SUM(CASE WHEN type = 'kick' THEN 1 ELSE 0 END) as kicks,
        SUM(CASE WHEN type = 'ban' THEN 1 ELSE 0 END) as bans
      FROM sicil
      WHERE server_id = $1
      AND created_at >= $2
      AND created_at < $3
    `;

    const result = await this.db.query(query, [serverId, hourStart, snapshotTime]);
    const data = result.rows[0] || {};

    return {
      moderationActionsCount: parseInt(data.total_actions) || 0,
      warningsCount: parseInt(data.warnings) || 0,
      timeoutsCount: parseInt(data.timeouts) || 0,
      kicksCount: parseInt(data.kicks) || 0,
      bansCount: parseInt(data.bans) || 0
    };
  }

  /**
   * Collect engagement metrics
   */
  private async collectEngagementMetrics(serverId: string, snapshotTime: Date): Promise<{
    avgMessageLength: number;
    linksSharedCount: number;
    reactionsCount: number;
  }> {
    const hourStart = new Date(snapshotTime);
    hourStart.setHours(hourStart.getHours() - 1);

    const query = `
      SELECT
        AVG(LENGTH(content)) as avg_length,
        SUM(ARRAY_LENGTH(REGEXP_MATCHES(content, 'https?://[^\\s]+', 'g'), 1)) as links_count
      FROM messages
      WHERE server_id = $1
      AND created_at >= $2
      AND created_at < $3
    `;

    const result = await this.db.query(query, [serverId, hourStart, snapshotTime]);
    const data = result.rows[0];

    return {
      avgMessageLength: parseFloat(data.avg_length) || 0,
      linksSharedCount: parseInt(data.links_count) || 0,
      reactionsCount: 0 // Would need reactions table
    };
  }

  /**
   * Calculate trends vs previous hour
   */
  private async calculateTrends(serverId: string, snapshotTime: Date): Promise<{
    messagesChangePercent: number;
    toxicityChangePercent: number;
    sentimentChangePercent: number;
  }> {
    const prevHourTime = new Date(snapshotTime);
    prevHourTime.setHours(prevHourTime.getHours() - 1);

    const query = `
      SELECT
        messages_count,
        toxicity_rate,
        avg_sentiment
      FROM server_health_snapshots
      WHERE server_id = $1
      AND snapshot_time = $2
    `;

    const result = await this.db.query(query, [serverId, prevHourTime]);

    if (result.rows.length === 0) {
      return {
        messagesChangePercent: 0,
        toxicityChangePercent: 0,
        sentimentChangePercent: 0
      };
    }

    const prev = result.rows[0];
    const prevMessages = parseInt(prev.messages_count) || 1;
    const prevToxicity = parseFloat(prev.toxicity_rate) || 0;
    const prevSentiment = parseFloat(prev.avg_sentiment) || 0;

    // Get current hour data
    const currentMetrics = await this.collectActivityMetrics(serverId, snapshotTime);
    const currentToxicity = await this.collectToxicityMetrics(serverId, snapshotTime);
    const currentSentiment = await this.collectSentimentMetrics(serverId, snapshotTime);

    return {
      messagesChangePercent: ((currentMetrics.messagesCount - prevMessages) / prevMessages) * 100,
      toxicityChangePercent: ((currentToxicity.toxicityRate - prevToxicity) / (prevToxicity || 0.01)) * 100,
      sentimentChangePercent: ((currentSentiment.avgSentiment - prevSentiment) / (Math.abs(prevSentiment) || 0.01)) * 100
    };
  }

  /**
   * Store snapshot in database
   */
  private async storeSnapshot(snapshot: HealthSnapshot): Promise<void> {
    const query = `
      INSERT INTO server_health_snapshots
      (server_id, snapshot_time, active_users_count, messages_count, messages_per_hour,
       avg_sentiment, sentiment_trend, toxicity_rate, toxic_messages_count,
       moderation_actions_count, warnings_count, timeouts_count, kicks_count, bans_count,
       avg_message_length, links_shared_count, reactions_count,
       messages_change_percent, toxicity_change_percent, sentiment_change_percent)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
      ON CONFLICT (server_id, snapshot_time)
      DO UPDATE SET
        active_users_count = EXCLUDED.active_users_count,
        messages_count = EXCLUDED.messages_count,
        messages_per_hour = EXCLUDED.messages_per_hour,
        avg_sentiment = EXCLUDED.avg_sentiment,
        sentiment_trend = EXCLUDED.sentiment_trend,
        toxicity_rate = EXCLUDED.toxicity_rate,
        toxic_messages_count = EXCLUDED.toxic_messages_count,
        moderation_actions_count = EXCLUDED.moderation_actions_count,
        warnings_count = EXCLUDED.warnings_count,
        timeouts_count = EXCLUDED.timeouts_count,
        kicks_count = EXCLUDED.kicks_count,
        bans_count = EXCLUDED.bans_count,
        avg_message_length = EXCLUDED.avg_message_length,
        links_shared_count = EXCLUDED.links_shared_count,
        reactions_count = EXCLUDED.reactions_count,
        messages_change_percent = EXCLUDED.messages_change_percent,
        toxicity_change_percent = EXCLUDED.toxicity_change_percent,
        sentiment_change_percent = EXCLUDED.sentiment_change_percent
    `;

    await this.db.query(query, [
      snapshot.serverId,
      snapshot.snapshotTime,
      snapshot.activeUsersCount,
      snapshot.messagesCount,
      snapshot.messagesPerHour,
      snapshot.avgSentiment,
      snapshot.sentimentTrend,
      snapshot.toxicityRate,
      snapshot.toxicMessagesCount,
      snapshot.moderationActionsCount,
      snapshot.warningsCount,
      snapshot.timeoutsCount,
      snapshot.kicksCount,
      snapshot.bansCount,
      snapshot.avgMessageLength,
      snapshot.linksSharedCount,
      snapshot.reactionsCount,
      snapshot.messagesChangePercent,
      snapshot.toxicityChangePercent,
      snapshot.sentimentChangePercent
    ]);
  }

  /**
   * Get health history for a server
   */
  async getHealthHistory(
    serverId: string,
    hours: number = 24
  ): Promise<HealthSnapshot[]> {
    try {
      const query = `
        SELECT *
        FROM server_health_snapshots
        WHERE server_id = $1
        AND snapshot_time >= NOW() - INTERVAL '1 hour' * $2
        ORDER BY snapshot_time ASC
      `;

      const result = await this.db.query(query, [serverId, hours]);

      return result.rows.map(row => ({
        serverId: row.server_id,
        snapshotTime: new Date(row.snapshot_time),
        activeUsersCount: row.active_users_count,
        messagesCount: row.messages_count,
        messagesPerHour: parseFloat(row.messages_per_hour),
        avgSentiment: parseFloat(row.avg_sentiment),
        sentimentTrend: row.sentiment_trend,
        toxicityRate: parseFloat(row.toxicity_rate),
        toxicMessagesCount: row.toxic_messages_count,
        moderationActionsCount: row.moderation_actions_count,
        warningsCount: row.warnings_count,
        timeoutsCount: row.timeouts_count,
        kicksCount: row.kicks_count,
        bansCount: row.bans_count,
        avgMessageLength: parseFloat(row.avg_message_length),
        linksSharedCount: row.links_shared_count,
        reactionsCount: row.reactions_count,
        messagesChangePercent: parseFloat(row.messages_change_percent),
        toxicityChangePercent: parseFloat(row.toxicity_change_percent),
        sentimentChangePercent: parseFloat(row.sentiment_change_percent),
        healthScore: row.health_score,
        healthStatus: row.health_status
      }));

    } catch (error) {
      logger.error('Error getting health history:', error);
      return [];
    }
  }

  /**
   * Get current health status
   */
  async getCurrentHealth(serverId: string): Promise<HealthSnapshot | null> {
    try {
      const query = `
        SELECT *
        FROM server_health_snapshots
        WHERE server_id = $1
        ORDER BY snapshot_time DESC
        LIMIT 1
      `;

      const result = await this.db.query(query, [serverId]);

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return {
        serverId: row.server_id,
        snapshotTime: new Date(row.snapshot_time),
        activeUsersCount: row.active_users_count,
        messagesCount: row.messages_count,
        messagesPerHour: parseFloat(row.messages_per_hour),
        avgSentiment: parseFloat(row.avg_sentiment),
        sentimentTrend: row.sentiment_trend,
        toxicityRate: parseFloat(row.toxicity_rate),
        toxicMessagesCount: row.toxic_messages_count,
        moderationActionsCount: row.moderation_actions_count,
        warningsCount: row.warnings_count,
        timeoutsCount: row.timeouts_count,
        kicksCount: row.kicks_count,
        bansCount: row.bans_count,
        avgMessageLength: parseFloat(row.avg_message_length),
        linksSharedCount: row.links_shared_count,
        reactionsCount: row.reactions_count,
        messagesChangePercent: parseFloat(row.messages_change_percent),
        toxicityChangePercent: parseFloat(row.toxicity_change_percent),
        sentimentChangePercent: parseFloat(row.sentiment_change_percent),
        healthScore: row.health_score,
        healthStatus: row.health_status
      };

    } catch (error) {
      logger.error('Error getting current health:', error);
      return null;
    }
  }
}

/**
 * Example usage:
 *
 * const monitor = new ServerHealthMonitor(db, discordClient);
 *
 * // Start hourly monitoring
 * monitor.start();
 *
 * // Get current health
 * const health = await monitor.getCurrentHealth(serverId);
 * console.log(`Health Score: ${health.healthScore} (${health.healthStatus})`);
 *
 * // Get 24-hour history for charts
 * const history = await monitor.getHealthHistory(serverId, 24);
 *
 * // Manually collect snapshot
 * const snapshot = await monitor.collectServerHealth(serverId);
 *
 * // Stop monitoring
 * monitor.stop();
 */
