import { Client } from 'discord.js';
import { StorageService } from '../services/StorageService';
import { createLogger } from '../services/Logger';
import { EventTracker, TrackedEvent, ServerMetrics } from './EventTracker';
import { RelationshipGraph } from './RelationshipGraph';
import { ChannelConfig } from './ChannelConfig';

const logger = createLogger('AnalyticsManager');

/**
 * ANALYTICS MANAGER - Tüm analytics sistemlerini yönetir
 *
 * Bu sistem:
 * - Eventleri otomatik track eder
 * - İlişkileri günceller
 * - Metrikleri hesaplar
 * - Dashboard için veri sağlar
 */

export class AnalyticsManager {
  private eventTracker: EventTracker;
  private relationshipGraph: RelationshipGraph;
  private channelConfig: ChannelConfig;

  constructor(
    private client: Client,
    private storage: StorageService
  ) {
    this.eventTracker = new EventTracker(storage);
    this.relationshipGraph = new RelationshipGraph();
    this.channelConfig = new ChannelConfig();

    logger.info('📊 AnalyticsManager initialized');
  }

  /**
   * Track bir event (tüm sistemleri günceller)
   */
  async trackEvent(event: Omit<TrackedEvent, 'id' | 'timestamp'>): Promise<void> {
    // Event'i kaydet
    await this.eventTracker.trackEvent(event);

    // İlişki grafiğini güncelle
    if (event.actorId && event.targetId) {
      const fullEvent: TrackedEvent = {
        ...event,
        id: `temp_${Date.now()}`,
        timestamp: Date.now(),
      };
      this.relationshipGraph.processEvent(event.guildId, fullEvent);
    }

    // Konfigüre edilmiş kanala bildirim gönder
    const channelId = this.channelConfig.getChannelForEvent(event.guildId, event.type);
    if (channelId) {
      await this.sendEventNotification(event.guildId, channelId, event);
    }
  }

  /**
   * Kanalda event bildirimi gönder
   */
  private async sendEventNotification(
    guildId: string,
    channelId: string,
    event: Omit<TrackedEvent, 'id' | 'timestamp'>
  ): Promise<void> {
    try {
      const guild = this.client.guilds.cache.get(guildId);
      if (!guild) return;

      const channel = guild.channels.cache.get(channelId);
      if (!channel || !channel.isTextBased()) return;

      // Event tipine göre mesaj oluştur
      let message = this.formatEventMessage(event);

      await channel.send(message);
    } catch (error) {
      logger.error('Failed to send event notification:', error);
    }
  }

  /**
   * Event mesajını formatla
   */
  private formatEventMessage(event: Omit<TrackedEvent, 'id' | 'timestamp'>): string {
    const icons: Record<string, string> = {
      // Moderation
      ban: '🔨',
      kick: '👢',
      timeout: '⏰',
      warn: '⚠️',
      delete: '🗑️',
      // Security
      scam_attempt: '🎣',
      scam_blocked: '🛡️',
      spam_detected: '📢',
      raid_attempt: '🚨',
      // Relationships
      conflict: '⚔️',
      friendship: '🤝',
      // User roles/labels
      fudder: '📉',
      helper: '🙋',
      builder: '🔨',
      supporter: '💪',
      troll: '👹',
      educator: '📚',
      leader: '👑',
      contributor: '⭐',
      toxic_user: '☠️',
      positive_user: '✨',
      // Actions
      helpful_action: '🌟',
      toxic_action: '💀',
      constructive_feedback: '💡',
      destructive_criticism: '💣',
    };

    const icon = icons[event.type] || '📊';
    const actor = event.actorId ? `<@${event.actorId}>` : 'System';
    const target = event.targetId ? `<@${event.targetId}>` : '';

    let msg = `${icon} **${event.type.toUpperCase()}**\n`;
    msg += `Actor: ${actor}\n`;
    if (target) msg += `Target: ${target}\n`;
    if (event.reason) msg += `Reason: ${event.reason}\n`;
    if (event.severity) msg += `Severity: ${(event.severity * 100).toFixed(0)}%\n`;

    return msg;
  }

  /**
   * Dashboard verileri al
   */
  async getDashboardData(guildId: string): Promise<{
    metrics: ServerMetrics;
    relationships: {
      total: number;
      friendships: number;
      conflicts: number;
      newRelationships: number;
      recentChanges: number;
    };
    timeline: any[];
    recentEvents: TrackedEvent[];
  }> {
    const metrics = await this.eventTracker.calculateMetrics(guildId);
    const stats = this.relationshipGraph.getStats(guildId);
    const timeline = await this.eventTracker.getTimeline(guildId, 24);
    const recentEvents = await this.eventTracker.getEvents(guildId, { limit: 50 });

    return {
      metrics,
      relationships: {
        total: stats.totalRelationships,
        friendships: stats.friendships,
        conflicts: stats.conflicts,
        newRelationships: stats.newRelationships,
        recentChanges: stats.recentChanges,
      },
      timeline,
      recentEvents,
    };
  }

  /**
   * İlişki grafiği verilerini al (visualization için)
   */
  getRelationshipGraphData(guildId: string) {
    return this.relationshipGraph.getGraphData(guildId);
  }

  /**
   * Kanal yapılandırma yap
   */
  configureChannel(
    guildId: string,
    command: string,
    channelId: string
  ): { success: boolean; message: string } {
    const parsed = this.channelConfig.parseCommand(command);

    if (!parsed.reportType) {
      return {
        success: false,
        message: 'Rapor tipi algılanamadı. Örnek: "bundan sonra banları #mod-logs kanalında yap"',
      };
    }

    this.channelConfig.setChannel(guildId, parsed.reportType, channelId);

    return {
      success: true,
      message: `✅ ${parsed.reportType} raporları artık <#${channelId}> kanalında paylaşılacak.`,
    };
  }

  /**
   * Public API for easy analytics access
   */
  getAnalyticsManager() {
    return this;
  }

  /**
   * Getter metodları
   */
  get events() {
    return this.eventTracker;
  }

  get relationships() {
    return this.relationshipGraph;
  }

  get channels() {
    return this.channelConfig;
  }
}
