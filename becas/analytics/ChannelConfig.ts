import { createLogger } from '../services/Logger';
import { EventType } from './EventTracker';

const logger = createLogger('ChannelConfig');

/**
 * CHANNEL CONFIGURATION - Hangi olay hangi kanalda paylaşılsın
 *
 * Kullanıcı komutları:
 * - "becas bundan sonra banları #mod-logs kanalında yap"
 * - "becas scam denemelerini #security'de göster"
 * - "becas toxicity raporlarını #ai-reports'ta paylaş"
 */

export type ReportType =
  | EventType
  | 'ai_reports'
  | 'mod_actions'
  | 'security_alerts'
  | 'relationship_changes'
  | 'server_metrics';

export interface ChannelMapping {
  reportType: ReportType;
  channelId: string;
  enabled: boolean;
  createdAt: number;
}

export class ChannelConfig {
  private configs: Map<string, Map<ReportType, ChannelMapping>> = new Map();

  constructor() {
    logger.info('⚙️  ChannelConfig initialized');
  }

  /**
   * Set channel for a report type
   */
  setChannel(guildId: string, reportType: ReportType, channelId: string): void {
    if (!this.configs.has(guildId)) {
      this.configs.set(guildId, new Map());
    }

    const guildConfig = this.configs.get(guildId)!;

    guildConfig.set(reportType, {
      reportType,
      channelId,
      enabled: true,
      createdAt: Date.now(),
    });

    logger.info(`Channel configured: ${guildId} - ${reportType} → ${channelId}`);
  }

  /**
   * Get channel for a report type
   */
  getChannel(guildId: string, reportType: ReportType): string | null {
    const guildConfig = this.configs.get(guildId);
    if (!guildConfig) return null;

    const mapping = guildConfig.get(reportType);
    if (!mapping || !mapping.enabled) return null;

    return mapping.channelId;
  }

  /**
   * Disable reporting for a type
   */
  disable(guildId: string, reportType: ReportType): void {
    const guildConfig = this.configs.get(guildId);
    if (!guildConfig) return;

    const mapping = guildConfig.get(reportType);
    if (mapping) {
      mapping.enabled = false;
      logger.info(`Channel disabled: ${guildId} - ${reportType}`);
    }
  }

  /**
   * Enable reporting for a type
   */
  enable(guildId: string, reportType: ReportType): void {
    const guildConfig = this.configs.get(guildId);
    if (!guildConfig) return;

    const mapping = guildConfig.get(reportType);
    if (mapping) {
      mapping.enabled = true;
      logger.info(`Channel enabled: ${guildId} - ${reportType}`);
    }
  }

  /**
   * Get all configured channels for a guild
   */
  getAllChannels(guildId: string): ChannelMapping[] {
    const guildConfig = this.configs.get(guildId);
    if (!guildConfig) return [];

    return Array.from(guildConfig.values());
  }

  /**
   * Remove channel configuration
   */
  removeChannel(guildId: string, reportType: ReportType): void {
    const guildConfig = this.configs.get(guildId);
    if (!guildConfig) return;

    guildConfig.delete(reportType);
    logger.info(`Channel removed: ${guildId} - ${reportType}`);
  }

  /**
   * Parse natural language command to set channel
   *
   * Examples:
   * - "bundan sonra banları #mod-logs kanalında yap"
   * - "scam denemelerini #security'de göster"
   * - "toxicity raporlarını #ai-reports'ta paylaş"
   */
  parseCommand(command: string): {
    reportType: ReportType | null;
    channelMention: string | null;
  } {
    // Extract channel mention (#channel-name or <#channelId>)
    const channelMatch = command.match(/<#(\d+)>|#([\w-]+)/);
    const channelMention = channelMatch ? channelMatch[0] : null;

    // Detect report type from keywords
    let reportType: ReportType | null = null;

    // Moderation actions
    if (/ban|banla/i.test(command)) reportType = 'ban';
    else if (/kick|at|çıkar/i.test(command)) reportType = 'kick';
    else if (/timeout|sustur/i.test(command)) reportType = 'timeout';
    else if (/warn|uyar/i.test(command)) reportType = 'warn';
    else if (/delete|sil/i.test(command)) reportType = 'delete';

    // Security
    else if (/scam|dolandırıcı/i.test(command)) reportType = 'security_alerts';

    // AI reports
    else if (/toxic|küfür|profan/i.test(command)) reportType = 'ai_reports';

    // Relationships
    else if (/ilişki|relationship|çatışma|conflict/i.test(command)) reportType = 'relationship_changes';

    // Metrics
    else if (/metric|istatistik|stats/i.test(command)) reportType = 'server_metrics';

    // Mod actions (general)
    else if (/mod|moderasyon/i.test(command)) reportType = 'mod_actions';

    return { reportType, channelMention };
  }

  /**
   * Get configured channel for event type, with fallback
   */
  getChannelForEvent(guildId: string, eventType: EventType): string | null {
    // Try exact match
    let channelId = this.getChannel(guildId, eventType);
    if (channelId) return channelId;

    // Try category matches
    const moderationTypes: EventType[] = ['ban', 'kick', 'timeout', 'warn', 'delete'];
    if (moderationTypes.includes(eventType)) {
      channelId = this.getChannel(guildId, 'mod_actions');
      if (channelId) return channelId;
    }

    const securityTypes: EventType[] = ['scam_attempt', 'scam_blocked'];
    if (securityTypes.includes(eventType)) {
      channelId = this.getChannel(guildId, 'security_alerts');
      if (channelId) return channelId;
    }

    const relationshipTypes: EventType[] = ['conflict', 'friendship', 'relationship_change'];
    if (relationshipTypes.includes(eventType)) {
      channelId = this.getChannel(guildId, 'relationship_changes');
      if (channelId) return channelId;
    }

    return null;
  }
}
