import { Pool } from 'pg';
import { Client, EmbedBuilder, TextChannel, ButtonBuilder, ActionRowBuilder, ButtonStyle } from 'discord.js';
import logger from '../utils/logger';
import { AnomalyResult } from './AnomalyDetector';
import { ConflictPrediction } from './ConflictPredictor';
import { HealthSnapshot } from './ServerHealthMonitor';

/**
 * AlertSystem
 *
 * Manages real-time alerts to moderators for critical events.
 * Sends notifications via Discord with actionable buttons.
 *
 * Alert Types:
 * 1. Anomaly Alerts - Unusual activity detected
 * 2. Conflict Alerts - High-risk conflict predicted
 * 3. Health Alerts - Server health degradation
 * 4. Behavior Alerts - Dynamic behavior triggered
 * 5. Trend Alerts - Significant trend changes
 */

export type AlertType = 'anomaly' | 'conflict' | 'health' | 'behavior' | 'trend';
export type AlertSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface Alert {
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  message: string;
  serverId: string;
  relatedUsers?: string[];
  relatedChannels?: string[];
  actionable: boolean;
  suggestedActions?: string[];
  data?: any;
}

export interface AlertPreferences {
  serverId: string;
  alertChannel?: string;
  alertRoles?: string[];
  minSeverity: AlertSeverity;
  enabledTypes: AlertType[];
  quietHours?: { start: number; end: number }; // Hours 0-23
}

export class AlertSystem {
  private alertPreferences: Map<string, AlertPreferences> = new Map();

  constructor(
    private db: Pool,
    private discordClient: Client
  ) {}

  /**
   * Initialize alert system
   */
  async initialize(): Promise<void> {
    logger.info('Initializing AlertSystem...');

    // Load alert preferences from database or config
    // For now, use defaults
    for (const guild of this.discordClient.guilds.cache.values()) {
      this.alertPreferences.set(guild.id, {
        serverId: guild.id,
        minSeverity: 'medium',
        enabledTypes: ['anomaly', 'conflict', 'health', 'behavior', 'trend'],
        quietHours: { start: 0, end: 6 } // No alerts 12 AM - 6 AM
      });
    }

    logger.info('✓ AlertSystem initialized');
  }

  /**
   * Send anomaly alert
   */
  async sendAnomalyAlert(serverId: string, anomaly: AnomalyResult): Promise<void> {
    const alert: Alert = {
      type: 'anomaly',
      severity: anomaly.severity,
      title: `⚠️ Anomaly Detected: ${this.formatAnomalyType(anomaly.type)}`,
      message: anomaly.description,
      serverId,
      relatedUsers: anomaly.affectedUsers,
      relatedChannels: anomaly.affectedChannels,
      actionable: true,
      suggestedActions: anomaly.recommendedAction ? [anomaly.recommendedAction] : [],
      data: anomaly
    };

    await this.sendAlert(alert);
  }

  /**
   * Send conflict alert
   */
  async sendConflictAlert(serverId: string, prediction: ConflictPrediction): Promise<void> {
    const alert: Alert = {
      type: 'conflict',
      severity: prediction.riskLevel,
      title: `🤝 Conflict Risk: ${(prediction.conflictProbability * 100).toFixed(0)}%`,
      message: `High conflict probability between <@${prediction.userA}> and <@${prediction.userB}>`,
      serverId,
      relatedUsers: [prediction.userA, prediction.userB],
      relatedChannels: prediction.bothActiveInChannels,
      actionable: true,
      suggestedActions: [prediction.recommendedAction],
      data: prediction
    };

    await this.sendAlert(alert);
  }

  /**
   * Send health alert
   */
  async sendHealthAlert(serverId: string, health: HealthSnapshot): Promise<void> {
    if (health.healthStatus === 'healthy') return; // Only alert on issues

    const alert: Alert = {
      type: 'health',
      severity: health.healthStatus === 'critical' ? 'critical' : 'medium',
      title: `🏥 Server Health ${health.healthStatus === 'critical' ? 'Critical' : 'Warning'}`,
      message: `Health score: ${health.healthScore}/100\nToxicity: ${(health.toxicityRate * 100).toFixed(1)}%\nSentiment: ${health.avgSentiment.toFixed(2)}`,
      serverId,
      actionable: false,
      data: health
    };

    await this.sendAlert(alert);
  }

  /**
   * Send custom alert
   */
  async sendCustomAlert(alert: Alert): Promise<void> {
    await this.sendAlert(alert);
  }

  /**
   * Core alert sending logic
   */
  private async sendAlert(alert: Alert): Promise<void> {
    try {
      // Check if alerts are enabled for this type/severity
      if (!this.shouldSendAlert(alert)) {
        logger.debug(`Alert suppressed: ${alert.title}`);
        return;
      }

      // Get alert channel
      const channel = await this.getAlertChannel(alert.serverId);
      if (!channel) {
        logger.warn(`No alert channel configured for server ${alert.serverId}`);
        return;
      }

      // Create embed
      const embed = this.createAlertEmbed(alert);

      // Create action buttons if actionable
      const components = alert.actionable ? this.createActionButtons(alert) : [];

      // Send alert
      const message = await channel.send({
        content: this.getMentionString(alert),
        embeds: [embed],
        components
      });

      // Store alert in database
      await this.storeAlert(alert, channel.id);

      logger.info(`Alert sent: ${alert.title} (${alert.severity})`);

    } catch (error) {
      logger.error('Error sending alert:', error);
    }
  }

  /**
   * Check if alert should be sent based on preferences
   */
  private shouldSendAlert(alert: Alert): boolean {
    const prefs = this.alertPreferences.get(alert.serverId);
    if (!prefs) return true; // Send if no preferences set

    // Check severity threshold
    const severityOrder = { low: 0, medium: 1, high: 2, critical: 3 };
    if (severityOrder[alert.severity] < severityOrder[prefs.minSeverity]) {
      return false;
    }

    // Check if type is enabled
    if (!prefs.enabledTypes.includes(alert.type)) {
      return false;
    }

    // Check quiet hours
    if (prefs.quietHours) {
      const currentHour = new Date().getHours();
      const { start, end } = prefs.quietHours;

      if (start < end) {
        // Normal range (e.g., 0-6)
        if (currentHour >= start && currentHour < end) {
          return alert.severity === 'critical'; // Only critical during quiet hours
        }
      } else {
        // Wraps around midnight (e.g., 22-6)
        if (currentHour >= start || currentHour < end) {
          return alert.severity === 'critical';
        }
      }
    }

    return true;
  }

  /**
   * Get alert channel for server
   */
  private async getAlertChannel(serverId: string): Promise<TextChannel | null> {
    const guild = this.discordClient.guilds.cache.get(serverId);
    if (!guild) return null;

    const prefs = this.alertPreferences.get(serverId);

    // Try configured alert channel
    if (prefs?.alertChannel) {
      const channel = guild.channels.cache.get(prefs.alertChannel) as TextChannel;
      if (channel) return channel;
    }

    // Find mod/admin channel
    const modChannel = guild.channels.cache.find(
      ch => ch.isTextBased() &&
           (ch.name.includes('mod') ||
            ch.name.includes('admin') ||
            ch.name.includes('alert'))
    ) as TextChannel | undefined;

    return modChannel || null;
  }

  /**
   * Create alert embed
   */
  private createAlertEmbed(alert: Alert): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setTitle(alert.title)
      .setDescription(alert.message)
      .setColor(this.getSeverityColor(alert.severity))
      .setTimestamp();

    // Add affected users
    if (alert.relatedUsers && alert.relatedUsers.length > 0) {
      embed.addFields({
        name: '👥 Affected Users',
        value: alert.relatedUsers.map(id => `<@${id}>`).join(', '),
        inline: true
      });
    }

    // Add affected channels
    if (alert.relatedChannels && alert.relatedChannels.length > 0) {
      embed.addFields({
        name: '📝 Affected Channels',
        value: alert.relatedChannels.map(id => `<#${id}>`).join(', '),
        inline: true
      });
    }

    // Add suggested actions
    if (alert.suggestedActions && alert.suggestedActions.length > 0) {
      embed.addFields({
        name: '💡 Suggested Actions',
        value: alert.suggestedActions.map((action, i) => `${i + 1}. ${action}`).join('\n')
      });
    }

    // Add severity indicator
    embed.setFooter({ text: `Severity: ${alert.severity.toUpperCase()}` });

    return embed;
  }

  /**
   * Create action buttons for alert
   */
  private createActionButtons(alert: Alert): ActionRowBuilder<ButtonBuilder>[] {
    const row = new ActionRowBuilder<ButtonBuilder>();

    // Acknowledge button
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`alert_ack_${Date.now()}`)
        .setLabel('✅ Acknowledge')
        .setStyle(ButtonStyle.Success)
    );

    // Type-specific action buttons
    if (alert.type === 'conflict' && alert.relatedUsers && alert.relatedUsers.length === 2) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`alert_dm_users_${Date.now()}`)
          .setLabel('📧 DM Both Users')
          .setStyle(ButtonStyle.Primary)
      );
    }

    if (alert.type === 'anomaly' && alert.severity === 'critical') {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`alert_investigate_${Date.now()}`)
          .setLabel('🔍 Investigate')
          .setStyle(ButtonStyle.Primary)
      );
    }

    // Dismiss button
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`alert_dismiss_${Date.now()}`)
        .setLabel('❌ Dismiss')
        .setStyle(ButtonStyle.Danger)
    );

    return [row];
  }

  /**
   * Get mention string for alert
   */
  private getMentionString(alert: Alert): string {
    const prefs = this.alertPreferences.get(alert.serverId);

    // Critical alerts mention everyone
    if (alert.severity === 'critical') {
      return '@here'; // Use @here instead of @everyone for online users only
    }

    // High severity mentions configured roles
    if (alert.severity === 'high' && prefs?.alertRoles && prefs.alertRoles.length > 0) {
      return prefs.alertRoles.map(roleId => `<@&${roleId}>`).join(' ');
    }

    return ''; // No mentions for medium/low
  }

  /**
   * Get color based on severity
   */
  private getSeverityColor(severity: AlertSeverity): number {
    switch (severity) {
      case 'critical': return 0xFF0000; // Red
      case 'high': return 0xFF9900; // Orange
      case 'medium': return 0xFFFF00; // Yellow
      case 'low': return 0x0099FF; // Blue
      default: return 0x808080; // Gray
    }
  }

  /**
   * Format anomaly type for display
   */
  private formatAnomalyType(type: string): string {
    return type.split('_').map(word =>
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
  }

  /**
   * Store alert in database
   */
  private async storeAlert(alert: Alert, channelId: string): Promise<void> {
    try {
      const query = `
        INSERT INTO alert_history
        (server_id, alert_type, severity, title, message,
         related_users, related_channels, sent_to_channel)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `;

      await this.db.query(query, [
        alert.serverId,
        alert.type,
        alert.severity,
        alert.title,
        alert.message,
        alert.relatedUsers || [],
        alert.relatedChannels || [],
        channelId
      ]);

    } catch (error) {
      logger.error('Error storing alert:', error);
    }
  }

  /**
   * Acknowledge alert
   */
  async acknowledgeAlert(alertId: number, moderatorId: string): Promise<void> {
    try {
      await this.db.query(
        'UPDATE alert_history SET acknowledged = true, acknowledged_by = $1, acknowledged_at = CURRENT_TIMESTAMP WHERE id = $2',
        [moderatorId, alertId]
      );

      logger.info(`Alert ${alertId} acknowledged by ${moderatorId}`);

    } catch (error) {
      logger.error('Error acknowledging alert:', error);
    }
  }

  /**
   * Get recent alerts
   */
  async getRecentAlerts(
    serverId: string,
    hours: number = 24,
    minSeverity?: AlertSeverity
  ): Promise<Alert[]> {
    try {
      let query = `
        SELECT *
        FROM alert_history
        WHERE server_id = $1
        AND sent_at >= NOW() - INTERVAL '${hours} hours'
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

      query += ' ORDER BY sent_at DESC LIMIT 50';

      const result = await this.db.query(query, [serverId]);

      return result.rows.map(row => ({
        type: row.alert_type,
        severity: row.severity,
        title: row.title,
        message: row.message,
        serverId: row.server_id,
        relatedUsers: row.related_users,
        relatedChannels: row.related_channels,
        actionable: false,
        data: null
      }));

    } catch (error) {
      logger.error('Error getting recent alerts:', error);
      return [];
    }
  }

  /**
   * Get alert statistics
   */
  async getAlertStats(serverId: string, days: number = 7): Promise<{
    totalAlerts: number;
    byType: Record<AlertType, number>;
    bySeverity: Record<AlertSeverity, number>;
    acknowledgedPercent: number;
  }> {
    try {
      const query = `
        SELECT
          COUNT(*) as total_alerts,
          alert_type,
          severity,
          SUM(CASE WHEN acknowledged THEN 1 ELSE 0 END) as acknowledged_count
        FROM alert_history
        WHERE server_id = $1
        AND sent_at >= NOW() - INTERVAL '1 day' * $2
        GROUP BY alert_type, severity
      `;

      const result = await this.db.query(query, [serverId, days]);

      const byType: Record<string, number> = {};
      const bySeverity: Record<string, number> = {};
      let totalAlerts = 0;
      let totalAcknowledged = 0;

      for (const row of result.rows) {
        const count = parseInt(row.total_alerts);
        const ackCount = parseInt(row.acknowledged_count);

        totalAlerts += count;
        totalAcknowledged += ackCount;

        byType[row.alert_type] = (byType[row.alert_type] || 0) + count;
        bySeverity[row.severity] = (bySeverity[row.severity] || 0) + count;
      }

      return {
        totalAlerts,
        byType: byType as Record<AlertType, number>,
        bySeverity: bySeverity as Record<AlertSeverity, number>,
        acknowledgedPercent: totalAlerts > 0 ? (totalAcknowledged / totalAlerts) * 100 : 0
      };

    } catch (error) {
      logger.error('Error getting alert stats:', error);
      return {
        totalAlerts: 0,
        byType: {} as Record<AlertType, number>,
        bySeverity: {} as Record<AlertSeverity, number>,
        acknowledgedPercent: 0
      };
    }
  }

  /**
   * Update alert preferences
   */
  async updatePreferences(serverId: string, prefs: Partial<AlertPreferences>): Promise<void> {
    const current = this.alertPreferences.get(serverId) || {
      serverId,
      minSeverity: 'medium',
      enabledTypes: ['anomaly', 'conflict', 'health', 'behavior', 'trend']
    };

    this.alertPreferences.set(serverId, { ...current, ...prefs });
    logger.info(`Updated alert preferences for server ${serverId}`);
  }
}

/**
 * Example usage:
 *
 * const alertSystem = new AlertSystem(db, discordClient);
 * await alertSystem.initialize();
 *
 * // Send anomaly alert
 * const anomaly = await anomalyDetector.detectUserAnomalies(userId, serverId);
 * if (anomaly.severity === 'critical') {
 *   await alertSystem.sendAnomalyAlert(serverId, anomaly);
 * }
 *
 * // Send conflict alert
 * const conflict = await conflictPredictor.predictConflict(userA, userB, serverId);
 * if (conflict.riskLevel === 'high') {
 *   await alertSystem.sendConflictAlert(serverId, conflict);
 * }
 *
 * // Get alert stats
 * const stats = await alertSystem.getAlertStats(serverId, 7);
 * console.log(`${stats.totalAlerts} alerts in last 7 days`);
 *
 * // Update preferences
 * await alertSystem.updatePreferences(serverId, {
 *   alertChannel: 'channel-id',
 *   minSeverity: 'high',
 *   quietHours: { start: 22, end: 8 }
 * });
 */
