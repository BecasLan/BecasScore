/**
 * ANALYTICS PLUGIN
 *
 * Tracks all domain events for analytics, monitoring, and dashboards.
 * Subscribes to ALL events using wildcard subscription.
 *
 * Architecture:
 * ANY Event → AnalyticsPlugin → Store Metrics → Dashboard API
 */

import { Plugin, BecasKernel } from '../kernel/BecasKernel';
import { DomainEvent } from '../domain/events/DomainEvent';
import { createLogger } from '../services/Logger';

const logger = createLogger('AnalyticsPlugin');

interface EventMetric {
  eventName: string;
  count: number;
  lastOccurred: Date;
  avgProcessingTime?: number; // milliseconds
}

interface UserActivityMetric {
  userId: string;
  guildId: string;
  messageCount: number;
  violationCount: number;
  moderationActionCount: number;
  lastActivity: Date;
}

interface GuildMetric {
  guildId: string;
  messageCount: number;
  violationCount: number;
  moderationActionCount: number;
  uniqueUsers: Set<string>;
  lastActivity: Date;
}

export class AnalyticsPlugin implements Plugin {
  name = 'analytics';
  version = '2.0.0';
  description = 'Event analytics and monitoring';
  dependencies = []; // No dependencies

  private kernel!: BecasKernel;

  // Analytics storage
  private eventMetrics: Map<string, EventMetric> = new Map();
  private userActivity: Map<string, UserActivityMetric> = new Map(); // key: userId:guildId
  private guildMetrics: Map<string, GuildMetric> = new Map(); // key: guildId

  // Event log (last 1000 events)
  private eventLog: DomainEvent[] = [];
  private readonly MAX_EVENT_LOG_SIZE = 1000;

  /**
   * Initialize plugin - subscribe to all events
   */
  async initialize(kernel: BecasKernel): Promise<void> {
    this.kernel = kernel;

    logger.info('📊 Initializing Analytics Plugin...');

    // Subscribe to ALL events using wildcard
    const eventBus = kernel.getEventBus();
    eventBus.onAny(this.handleAnyEvent.bind(this));

    logger.info('✅ Analytics Plugin initialized');
    logger.info('   → Subscribed to: ALL EVENTS (wildcard)');
  }

  /**
   * Handle any event - update metrics
   */
  private async handleAnyEvent(event: DomainEvent): Promise<void> {
    try {
      // Update event metrics
      this.updateEventMetrics(event);

      // Update user/guild metrics based on event type
      this.updateDomainMetrics(event);

      // Store in event log
      this.addToEventLog(event);

      logger.debug(`📈 Tracked event: ${event.eventName}`);
    } catch (error: any) {
      logger.error('Error tracking event:', error);
    }
  }

  /**
   * Update event occurrence metrics
   */
  private updateEventMetrics(event: DomainEvent): void {
    const existing = this.eventMetrics.get(event.eventName);

    if (existing) {
      existing.count++;
      existing.lastOccurred = new Date();
    } else {
      this.eventMetrics.set(event.eventName, {
        eventName: event.eventName,
        count: 1,
        lastOccurred: new Date(),
      });
    }
  }

  /**
   * Update user/guild metrics based on event type
   */
  private updateDomainMetrics(event: DomainEvent): void {
    const { userId, guildId } = event.metadata;

    if (!userId || !guildId) {
      return; // Skip events without user/guild context
    }

    // Update user activity
    const userKey = `${userId}:${guildId}`;
    let userMetric = this.userActivity.get(userKey);

    if (!userMetric) {
      userMetric = {
        userId,
        guildId,
        messageCount: 0,
        violationCount: 0,
        moderationActionCount: 0,
        lastActivity: new Date(),
      };
      this.userActivity.set(userKey, userMetric);
    }

    // Update guild metrics
    let guildMetric = this.guildMetrics.get(guildId);

    if (!guildMetric) {
      guildMetric = {
        guildId,
        messageCount: 0,
        violationCount: 0,
        moderationActionCount: 0,
        uniqueUsers: new Set(),
        lastActivity: new Date(),
      };
      this.guildMetrics.set(guildId, guildMetric);
    }

    // Update based on event type
    switch (event.eventName) {
      case 'message.received':
        userMetric.messageCount++;
        guildMetric.messageCount++;
        guildMetric.uniqueUsers.add(userId);
        break;

      case 'violation.detected':
        userMetric.violationCount++;
        guildMetric.violationCount++;
        break;

      case 'moderation.action_executed':
        userMetric.moderationActionCount++;
        guildMetric.moderationActionCount++;
        break;
    }

    userMetric.lastActivity = new Date();
    guildMetric.lastActivity = new Date();
  }

  /**
   * Add event to log (FIFO queue, max 1000 events)
   */
  private addToEventLog(event: DomainEvent): void {
    this.eventLog.push(event);

    if (this.eventLog.length > this.MAX_EVENT_LOG_SIZE) {
      this.eventLog.shift(); // Remove oldest event
    }
  }

  /**
   * Public API: Get event metrics
   */
  getEventMetrics(): EventMetric[] {
    return Array.from(this.eventMetrics.values()).sort((a, b) => b.count - a.count);
  }

  /**
   * Public API: Get user activity for a guild
   */
  getUserActivity(guildId: string): UserActivityMetric[] {
    const users: UserActivityMetric[] = [];

    for (const [key, metric] of this.userActivity) {
      if (metric.guildId === guildId) {
        users.push(metric);
      }
    }

    return users.sort((a, b) => b.messageCount - a.messageCount);
  }

  /**
   * Public API: Get guild metrics
   */
  getGuildMetrics(guildId: string): GuildMetric | undefined {
    const metric = this.guildMetrics.get(guildId);

    if (!metric) {
      return undefined;
    }

    // Convert Set to size for serialization
    return {
      ...metric,
      uniqueUsers: new Set(metric.uniqueUsers), // Clone to prevent mutation
    };
  }

  /**
   * Public API: Get all guild metrics
   */
  getAllGuildMetrics(): Array<{
    guildId: string;
    messageCount: number;
    violationCount: number;
    moderationActionCount: number;
    uniqueUserCount: number;
    lastActivity: Date;
  }> {
    return Array.from(this.guildMetrics.values()).map(metric => ({
      guildId: metric.guildId,
      messageCount: metric.messageCount,
      violationCount: metric.violationCount,
      moderationActionCount: metric.moderationActionCount,
      uniqueUserCount: metric.uniqueUsers.size,
      lastActivity: metric.lastActivity,
    }));
  }

  /**
   * Public API: Get recent events
   */
  getRecentEvents(count: number = 100): DomainEvent[] {
    return this.eventLog.slice(-count).reverse(); // Most recent first
  }

  /**
   * Public API: Get event log filtered by type
   */
  getEventsByType(eventName: string, count: number = 100): DomainEvent[] {
    return this.eventLog
      .filter(e => e.eventName === eventName)
      .slice(-count)
      .reverse();
  }

  /**
   * Public API: Get analytics summary
   */
  getAnalyticsSummary(): {
    totalEvents: number;
    eventTypes: number;
    totalGuilds: number;
    totalUsers: number;
    topEvents: Array<{ name: string; count: number }>;
  } {
    const eventMetrics = this.getEventMetrics();

    return {
      totalEvents: eventMetrics.reduce((sum, e) => sum + e.count, 0),
      eventTypes: eventMetrics.length,
      totalGuilds: this.guildMetrics.size,
      totalUsers: this.userActivity.size,
      topEvents: eventMetrics.slice(0, 5).map(e => ({ name: e.eventName, count: e.count })),
    };
  }

  /**
   * Public API: Get violation statistics for a guild
   */
  getViolationStats(guildId: string): {
    totalViolations: number;
    violationsByUser: Array<{ userId: string; count: number }>;
    violationRate: number; // violations per message
  } {
    const guildMetric = this.guildMetrics.get(guildId);

    if (!guildMetric) {
      return { totalViolations: 0, violationsByUser: [], violationRate: 0 };
    }

    const users = this.getUserActivity(guildId);
    const violationsByUser = users
      .filter(u => u.violationCount > 0)
      .map(u => ({ userId: u.userId, count: u.violationCount }))
      .sort((a, b) => b.count - a.count);

    const violationRate =
      guildMetric.messageCount > 0
        ? guildMetric.violationCount / guildMetric.messageCount
        : 0;

    return {
      totalViolations: guildMetric.violationCount,
      violationsByUser,
      violationRate: Math.round(violationRate * 1000) / 1000, // 3 decimal places
    };
  }

  /**
   * Shutdown plugin - cleanup
   */
  async shutdown(): Promise<void> {
    logger.info('🛑 Shutting down Analytics Plugin...');

    const summary = this.getAnalyticsSummary();
    logger.info(`   → Tracked ${summary.totalEvents} events across ${summary.totalGuilds} guilds`);

    // TODO: Persist analytics to database before shutdown
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    return true; // Always healthy (in-memory)
  }
}
