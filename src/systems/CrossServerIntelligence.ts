/**
 * CROSS-SERVER INTELLIGENCE - Global Threat Sharing Network
 *
 * Shares threat intelligence across all servers using BECAS:
 * - Known scammers
 * - Phishing campaigns
 * - Raid patterns
 * - Emerging threats
 *
 * Privacy-First Design:
 * - Only shares threat indicators (user IDs, patterns), not message content
 * - Servers can opt in/out
 * - Configurable sharing levels
 *
 * Benefits:
 * - Scammer banned in Server A → Auto-flagged in Server B
 * - New phishing link detected → All servers protected instantly
 * - Raid patterns identified → Other servers get early warning
 */

import { Client } from 'discord.js';
import { UserRepository } from '../database/repositories/UserRepository';
import { MessageRepository } from '../database/repositories/MessageRepository';
import { SicilRepository } from '../database/repositories/SicilRepository';
import { ContentResult } from '../ai/layers/ContentLayer';
import { createLogger } from '../services/Logger';

const logger = createLogger('CrossServerIntelligence');

export interface ThreatAlert {
  id: string; // UUID
  type: 'scammer' | 'phishing' | 'raid' | 'toxic_user' | 'malicious_link';
  severity: 'low' | 'medium' | 'high' | 'critical';

  // Threat Details
  userId?: string; // For user-based threats
  pattern?: string; // For pattern-based threats (regex, keywords)
  link?: string; // For link-based threats

  // Evidence
  confidence: number; // 0-1
  detectedAt: Date;
  detectedInServers: string[]; // Server IDs where detected
  detectionCount: number; // How many times detected

  // Context (anonymized)
  threatDescription: string;
  indicators: string[]; // What made it suspicious

  // Metadata
  createdAt: Date;
  expiresAt?: Date; // Auto-expire old alerts
  reportedBy: string; // Server ID that first reported
  verified: boolean; // Manually verified by admins
}

export interface ServerIntelligenceConfig {
  enabled: boolean;
  shareOutgoing: boolean; // Share threats detected in this server
  receiveIncoming: boolean; // Receive threat alerts from other servers
  autoAction: boolean; // Automatically act on high-confidence alerts
  minConfidence: number; // Minimum confidence to receive alerts (0-1)
  shareLevel: 'critical_only' | 'high_and_critical' | 'all'; // What to share
}

export class CrossServerIntelligence {
  private alerts: Map<string, ThreatAlert> = new Map(); // alertId → alert
  private serverConfigs: Map<string, ServerIntelligenceConfig> = new Map();
  private userReputations: Map<string, number> = new Map(); // userId → reputation (0-100)

  constructor(
    private client: Client,
    private userRepo: UserRepository,
    private messageRepo: MessageRepository,
    private sicilRepo: SicilRepository
  ) {
    logger.info('CrossServerIntelligence initialized');
    this.startCleanupTask();
  }

  /**
   * Report a threat to the network
   */
  async reportThreat(
    serverId: string,
    type: ThreatAlert['type'],
    severity: ThreatAlert['severity'],
    details: {
      userId?: string;
      pattern?: string;
      link?: string;
      confidence: number;
      description: string;
      indicators: string[];
    }
  ): Promise<ThreatAlert> {
    // Check if server has sharing enabled
    const config = this.getServerConfig(serverId);
    if (!config.enabled || !config.shareOutgoing) {
      logger.debug(`Server ${serverId} has sharing disabled`);
      return null as any; // Don't create alert
    }

    // Check severity threshold
    if (config.shareLevel === 'critical_only' && severity !== 'critical') {
      return null as any;
    }
    if (config.shareLevel === 'high_and_critical' && !['high', 'critical'].includes(severity)) {
      return null as any;
    }

    // Create alert
    const alert: ThreatAlert = {
      id: this.generateAlertId(),
      type,
      severity,
      userId: details.userId,
      pattern: details.pattern,
      link: details.link,
      confidence: details.confidence,
      detectedAt: new Date(),
      detectedInServers: [serverId],
      detectionCount: 1,
      threatDescription: details.description,
      indicators: details.indicators,
      createdAt: new Date(),
      expiresAt: this.calculateExpiration(severity),
      reportedBy: serverId,
      verified: false,
    };

    // Check if similar alert exists
    const existingAlert = this.findSimilarAlert(alert);
    if (existingAlert) {
      // Update existing alert
      existingAlert.detectedInServers.push(serverId);
      existingAlert.detectionCount++;
      existingAlert.confidence = Math.min(1.0, existingAlert.confidence + 0.1);

      logger.info(`Updated existing alert ${existingAlert.id} (now detected in ${existingAlert.detectionCount} instances)`);
      return existingAlert;
    }

    // Store new alert
    this.alerts.set(alert.id, alert);

    logger.info(`New threat alert created: ${alert.type} (severity: ${severity}, confidence: ${details.confidence})`);

    // Propagate to other servers
    await this.propagateAlert(alert, serverId);

    // Update user reputation if user-based
    if (alert.userId) {
      await this.updateUserReputation(alert.userId, -20); // Reduce reputation
    }

    return alert;
  }

  /**
   * Check if user is flagged in cross-server network
   */
  async checkUser(userId: string, currentServerId: string): Promise<{
    isFlagged: boolean;
    alerts: ThreatAlert[];
    reputation: number; // 0-100
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
  }> {
    // Get user's reputation
    const reputation = this.userReputations.get(userId) || 50; // Default neutral

    // Find all alerts for this user
    const userAlerts = Array.from(this.alerts.values()).filter(
      alert => alert.userId === userId
    );

    // Determine risk level
    let riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';
    if (userAlerts.some(a => a.severity === 'critical' && a.confidence >= 0.8)) {
      riskLevel = 'critical';
    } else if (userAlerts.some(a => a.severity === 'high' && a.confidence >= 0.7)) {
      riskLevel = 'high';
    } else if (userAlerts.length >= 2) {
      riskLevel = 'medium';
    }

    return {
      isFlagged: userAlerts.length > 0,
      alerts: userAlerts,
      reputation,
      riskLevel,
    };
  }

  /**
   * Check if link is flagged
   */
  async checkLink(link: string): Promise<{
    isFlagged: boolean;
    alert?: ThreatAlert;
    riskLevel: 'safe' | 'suspicious' | 'malicious';
  }> {
    const linkAlerts = Array.from(this.alerts.values()).filter(
      alert => alert.link === link || alert.pattern && new RegExp(alert.pattern).test(link)
    );

    if (linkAlerts.length === 0) {
      return { isFlagged: false, riskLevel: 'safe' };
    }

    // Find highest severity alert
    const highestSeverity = linkAlerts.reduce((max, alert) =>
      this.severityToNumber(alert.severity) > this.severityToNumber(max.severity) ? alert : max
    );

    const riskLevel = highestSeverity.severity === 'critical' ? 'malicious' : 'suspicious';

    return {
      isFlagged: true,
      alert: highestSeverity,
      riskLevel,
    };
  }

  /**
   * Get recent alerts for a server
   */
  async getRecentAlerts(serverId: string, limit = 20): Promise<ThreatAlert[]> {
    const config = this.getServerConfig(serverId);
    if (!config.enabled || !config.receiveIncoming) {
      return [];
    }

    // Get alerts that meet server's confidence threshold
    return Array.from(this.alerts.values())
      .filter(alert => alert.confidence >= config.minConfidence)
      .sort((a, b) => b.detectedAt.getTime() - a.detectedAt.getTime())
      .slice(0, limit);
  }

  /**
   * Get global threat statistics
   */
  getGlobalStats(): {
    totalAlerts: number;
    activeAlerts: number;
    byType: Record<ThreatAlert['type'], number>;
    bySeverity: Record<ThreatAlert['severity'], number>;
    topThreats: ThreatAlert[];
  } {
    const alerts = Array.from(this.alerts.values());

    // Count by type
    const byType: Record<string, number> = {};
    alerts.forEach(alert => {
      byType[alert.type] = (byType[alert.type] || 0) + 1;
    });

    // Count by severity
    const bySeverity: Record<string, number> = {};
    alerts.forEach(alert => {
      bySeverity[alert.severity] = (bySeverity[alert.severity] || 0) + 1;
    });

    // Top threats (most detected)
    const topThreats = alerts
      .sort((a, b) => b.detectionCount - a.detectionCount)
      .slice(0, 10);

    return {
      totalAlerts: alerts.length,
      activeAlerts: alerts.filter(a => !a.expiresAt || a.expiresAt > new Date()).length,
      byType: byType as any,
      bySeverity: bySeverity as any,
      topThreats,
    };
  }

  /**
   * Update server intelligence configuration
   */
  updateServerConfig(serverId: string, config: Partial<ServerIntelligenceConfig>): void {
    const currentConfig = this.getServerConfig(serverId);
    this.serverConfigs.set(serverId, { ...currentConfig, ...config });
    logger.info(`Updated intelligence config for server ${serverId}`);
  }

  /**
   * Get server configuration (with defaults)
   */
  private getServerConfig(serverId: string): ServerIntelligenceConfig {
    return this.serverConfigs.get(serverId) || {
      enabled: true,
      shareOutgoing: true,
      receiveIncoming: true,
      autoAction: false, // Disabled by default (safety)
      minConfidence: 0.7,
      shareLevel: 'high_and_critical',
    };
  }

  /**
   * Propagate alert to other servers
   */
  private async propagateAlert(alert: ThreatAlert, sourceServerId: string): Promise<void> {
    // Get all servers with BECAS
    const allGuilds = this.client.guilds.cache;

    for (const [guildId, guild] of allGuilds) {
      if (guildId === sourceServerId) continue; // Don't send to source

      const config = this.getServerConfig(guildId);

      // Check if server wants to receive this
      if (!config.enabled || !config.receiveIncoming) continue;
      if (alert.confidence < config.minConfidence) continue;

      // TODO: Send notification to server admins
      // Could use a dedicated channel, DM to admins, or dashboard notification
      logger.debug(`Alert ${alert.id} propagated to server ${guildId}`);
    }
  }

  /**
   * Find similar existing alert
   */
  private findSimilarAlert(newAlert: ThreatAlert): ThreatAlert | null {
    for (const alert of this.alerts.values()) {
      // Same type and target
      if (alert.type === newAlert.type) {
        if (alert.userId && alert.userId === newAlert.userId) return alert;
        if (alert.link && alert.link === newAlert.link) return alert;
        if (alert.pattern && alert.pattern === newAlert.pattern) return alert;
      }
    }
    return null;
  }

  /**
   * Update user reputation across network
   */
  private async updateUserReputation(userId: string, delta: number): Promise<void> {
    const current = this.userReputations.get(userId) || 50;
    const newRep = Math.max(0, Math.min(100, current + delta));
    this.userReputations.set(userId, newRep);

    logger.debug(`User ${userId} reputation: ${current} → ${newRep} (${delta >= 0 ? '+' : ''}${delta})`);
  }

  /**
   * Generate unique alert ID
   */
  private generateAlertId(): string {
    return `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Calculate expiration date based on severity
   */
  private calculateExpiration(severity: ThreatAlert['severity']): Date {
    const now = new Date();
    switch (severity) {
      case 'critical':
        return new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000); // 90 days
      case 'high':
        return new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000); // 60 days
      case 'medium':
        return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days
      case 'low':
        return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days
    }
  }

  /**
   * Convert severity to number for comparison
   */
  private severityToNumber(severity: ThreatAlert['severity']): number {
    switch (severity) {
      case 'critical': return 4;
      case 'high': return 3;
      case 'medium': return 2;
      case 'low': return 1;
      default: return 0;
    }
  }

  /**
   * Start background cleanup task (remove expired alerts)
   */
  private startCleanupTask(): void {
    setInterval(() => {
      const now = new Date();
      let removed = 0;

      for (const [id, alert] of this.alerts) {
        if (alert.expiresAt && alert.expiresAt < now) {
          this.alerts.delete(id);
          removed++;
        }
      }

      if (removed > 0) {
        logger.info(`Cleaned up ${removed} expired alerts`);
      }
    }, 60 * 60 * 1000); // Run every hour
  }

  /**
   * Verify an alert (manually by admin)
   */
  async verifyAlert(alertId: string, verified: boolean): Promise<void> {
    const alert = this.alerts.get(alertId);
    if (!alert) {
      throw new Error(`Alert ${alertId} not found`);
    }

    alert.verified = verified;
    if (verified) {
      alert.confidence = Math.min(1.0, alert.confidence + 0.2); // Boost confidence
    }

    logger.info(`Alert ${alertId} verification set to ${verified}`);
  }

  /**
   * Get all alerts (for admin dashboard)
   */
  getAllAlerts(): ThreatAlert[] {
    return Array.from(this.alerts.values());
  }
}
