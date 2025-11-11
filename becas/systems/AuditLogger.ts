// AuditLogger.ts - Comprehensive audit logging system
// Logs EVERYTHING: commands, moderation, trust changes, permissions, AI decisions

import { StorageService } from '../services/StorageService';
import { createLogger } from '../services/Logger';

const logger = createLogger('AuditLogger');

export type AuditEventType =
  | 'command_executed'
  | 'command_denied'
  | 'moderation_action'
  | 'trust_change'
  | 'permission_check'
  | 'permission_denied'
  | 'scam_detected'
  | 'ai_decision'
  | 'ai_correction'
  | 'bulk_action'
  | 'global_ban'
  | 'rate_limit_hit'
  | 'error'
  | 'warning';

export interface AuditEvent {
  id: string;
  timestamp: Date;
  type: AuditEventType;
  guildId: string;
  guildName?: string;

  // Actor (who did it)
  actorId?: string;
  actorName?: string;
  actorType: 'user' | 'moderator' | 'admin' | 'bot' | 'system';

  // Target (who it affected)
  targetId?: string;
  targetName?: string;

  // Action details
  action: string;
  details: any;
  success: boolean;

  // AI context
  aiConfidence?: number;
  aiReasoning?: string;

  // Metadata
  channelId?: string;
  messageId?: string;
  duration?: number; // execution time
  error?: string;
}

export class AuditLogger {
  private storage: StorageService;
  private events: AuditEvent[] = [];
  private maxEvents = 10000; // Keep last 10k events in memory

  // Rate limiting tracking
  private commandCounts: Map<string, { count: number; resetAt: number }> = new Map();
  private rateLimits = {
    perUser: 10, // 10 commands per minute
    perGuild: 50, // 50 commands per minute per guild
  };

  constructor(storage: StorageService) {
    this.storage = storage;
    this.loadEvents();

    // Auto-save every 5 minutes
    setInterval(() => this.saveEvents(), 5 * 60 * 1000);
  }

  /**
   * Log an audit event
   */
  async log(event: Omit<AuditEvent, 'id' | 'timestamp'>): Promise<void> {
    const auditEvent: AuditEvent = {
      ...event,
      id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
    };

    this.events.push(auditEvent);

    // Keep only last N events in memory
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }

    // Log to console for immediate visibility
    const emoji = this.getEmojiForType(event.type);
    logger.info(`${emoji} [${event.type}] ${event.action} by ${event.actorName || event.actorId} → ${event.success ? '✓' : '✗'}`);

    if (event.error) {
      logger.error(`   Error: ${event.error}`);
    }
  }

  /**
   * Check rate limit for user/guild
   */
  checkRateLimit(userId: string, guildId: string): { allowed: boolean; reason?: string; resetIn?: number } {
    const now = Date.now();

    // Check per-user rate limit
    const userKey = `user:${userId}`;
    let userLimit = this.commandCounts.get(userKey);

    if (!userLimit || userLimit.resetAt < now) {
      userLimit = { count: 0, resetAt: now + 60000 }; // Reset every minute
      this.commandCounts.set(userKey, userLimit);
    }

    if (userLimit.count >= this.rateLimits.perUser) {
      const resetIn = Math.ceil((userLimit.resetAt - now) / 1000);
      return {
        allowed: false,
        reason: `Rate limit exceeded: ${this.rateLimits.perUser} commands per minute`,
        resetIn,
      };
    }

    // Check per-guild rate limit
    const guildKey = `guild:${guildId}`;
    let guildLimit = this.commandCounts.get(guildKey);

    if (!guildLimit || guildLimit.resetAt < now) {
      guildLimit = { count: 0, resetAt: now + 60000 };
      this.commandCounts.set(guildKey, guildLimit);
    }

    if (guildLimit.count >= this.rateLimits.perGuild) {
      const resetIn = Math.ceil((guildLimit.resetAt - now) / 1000);
      return {
        allowed: false,
        reason: `Server rate limit exceeded: ${this.rateLimits.perGuild} commands per minute`,
        resetIn,
      };
    }

    // Increment counts
    userLimit.count++;
    guildLimit.count++;

    return { allowed: true };
  }

  /**
   * Get recent events
   */
  getRecentEvents(limit: number = 100, filter?: Partial<AuditEvent>): AuditEvent[] {
    let filtered = this.events;

    if (filter) {
      filtered = filtered.filter(event => {
        return Object.entries(filter).every(([key, value]) => {
          return event[key as keyof AuditEvent] === value;
        });
      });
    }

    return filtered.slice(-limit);
  }

  /**
   * Get events by user
   */
  getUserHistory(userId: string, limit: number = 50): AuditEvent[] {
    return this.events
      .filter(e => e.actorId === userId || e.targetId === userId)
      .slice(-limit);
  }

  /**
   * Get events by type
   */
  getEventsByType(type: AuditEventType, limit: number = 100): AuditEvent[] {
    return this.events
      .filter(e => e.type === type)
      .slice(-limit);
  }

  /**
   * Search events
   */
  search(query: {
    type?: AuditEventType;
    actorId?: string;
    targetId?: string;
    guildId?: string;
    action?: string;
    success?: boolean;
    startDate?: Date;
    endDate?: Date;
  }): AuditEvent[] {
    return this.events.filter(event => {
      if (query.type && event.type !== query.type) return false;
      if (query.actorId && event.actorId !== query.actorId) return false;
      if (query.targetId && event.targetId !== query.targetId) return false;
      if (query.guildId && event.guildId !== query.guildId) return false;
      if (query.action && !event.action.includes(query.action)) return false;
      if (query.success !== undefined && event.success !== query.success) return false;
      if (query.startDate && event.timestamp < query.startDate) return false;
      if (query.endDate && event.timestamp > query.endDate) return false;
      return true;
    });
  }

  /**
   * Get statistics
   */
  getStats(guildId?: string): {
    totalEvents: number;
    byType: Record<AuditEventType, number>;
    successRate: number;
    topActors: Array<{ id: string; name: string; count: number }>;
    topTargets: Array<{ id: string; name: string; count: number }>;
    recentErrors: AuditEvent[];
  } {
    const events = guildId
      ? this.events.filter(e => e.guildId === guildId)
      : this.events;

    const byType: any = {};
    const actorCounts: Map<string, { name: string; count: number }> = new Map();
    const targetCounts: Map<string, { name: string; count: number }> = new Map();
    let successCount = 0;

    events.forEach(event => {
      // Count by type
      byType[event.type] = (byType[event.type] || 0) + 1;

      // Count success
      if (event.success) successCount++;

      // Count actors
      if (event.actorId) {
        const existing = actorCounts.get(event.actorId);
        if (existing) {
          existing.count++;
        } else {
          actorCounts.set(event.actorId, { name: event.actorName || event.actorId, count: 1 });
        }
      }

      // Count targets
      if (event.targetId) {
        const existing = targetCounts.get(event.targetId);
        if (existing) {
          existing.count++;
        } else {
          targetCounts.set(event.targetId, { name: event.targetName || event.targetId, count: 1 });
        }
      }
    });

    const topActors = Array.from(actorCounts.entries())
      .map(([id, data]) => ({ id, name: data.name, count: data.count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const topTargets = Array.from(targetCounts.entries())
      .map(([id, data]) => ({ id, name: data.name, count: data.count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const recentErrors = events
      .filter(e => !e.success || e.error)
      .slice(-20);

    return {
      totalEvents: events.length,
      byType,
      successRate: events.length > 0 ? (successCount / events.length) * 100 : 0,
      topActors,
      topTargets,
      recentErrors,
    };
  }

  /**
   * Load events from storage
   */
  private async loadEvents(): Promise<void> {
    try {
      const data = await this.storage.read<{ events: AuditEvent[] }>('audit', 'audit_log.json');
      if (data?.events) {
        this.events = data.events.map(e => ({
          ...e,
          timestamp: new Date(e.timestamp),
        }));
        logger.info(`📋 Loaded ${this.events.length} audit events`);
      }
    } catch (error) {
      logger.warn('No audit log found, starting fresh');
    }
  }

  /**
   * Save events to storage
   */
  private async saveEvents(): Promise<void> {
    try {
      await this.storage.write('audit', 'audit_log.json', {
        events: this.events,
        savedAt: new Date(),
      });
      logger.info(`💾 Saved ${this.events.length} audit events`);
    } catch (error) {
      logger.error('Failed to save audit log:', error);
    }
  }

  /**
   * Get emoji for event type
   */
  private getEmojiForType(type: AuditEventType): string {
    const emojiMap: Record<AuditEventType, string> = {
      command_executed: '⚡',
      command_denied: '🚫',
      moderation_action: '🔨',
      trust_change: '⚖️',
      permission_check: '🔑',
      permission_denied: '🔒',
      scam_detected: '🚨',
      ai_decision: '🤖',
      ai_correction: '📝',
      bulk_action: '📦',
      global_ban: '🌐',
      rate_limit_hit: '⏱️',
      error: '❌',
      warning: '⚠️',
    };
    return emojiMap[type] || '📋';
  }

  /**
   * Clean up old events (older than 30 days)
   */
  async cleanup(daysToKeep: number = 30): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const before = this.events.length;
    this.events = this.events.filter(e => e.timestamp >= cutoffDate);
    const removed = before - this.events.length;

    if (removed > 0) {
      await this.saveEvents();
      logger.info(`🗑️ Cleaned up ${removed} old audit events`);
    }

    return removed;
  }
}
