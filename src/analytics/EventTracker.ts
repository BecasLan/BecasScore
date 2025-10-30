import { StorageService } from '../services/StorageService';
import { createLogger } from '../services/Logger';

const logger = createLogger('EventTracker');

/**
 * EVENT TRACKER - Tüm sunucu olaylarını takip eder
 *
 * Tracks:
 * - Moderation actions (ban, kick, timeout, warn, delete)
 * - User interactions (message, reply, mention, reaction)
 * - Sentiment changes (happy → angry, friendly → hostile)
 * - Scam attempts
 * - Server health metrics
 */

export type EventType =
  // Moderation actions
  | 'ban' | 'kick' | 'timeout' | 'warn' | 'delete'
  // User interactions
  | 'message' | 'reaction' | 'mention' | 'reply' | 'voice_join' | 'voice_leave'
  // Security & scams
  | 'scam_attempt' | 'scam_blocked' | 'spam_detected' | 'raid_attempt'
  // Sentiment & relationships
  | 'sentiment_change' | 'relationship_change' | 'conflict' | 'friendship'
  // User roles & contributions (labeling system)
  | 'fudder' | 'helper' | 'builder' | 'supporter' | 'troll'
  | 'educator' | 'leader' | 'contributor' | 'toxic_user' | 'positive_user'
  // Community events
  | 'helpful_action' | 'toxic_action' | 'constructive_feedback' | 'destructive_criticism';

export interface TrackedEvent {
  id: string;
  guildId: string;
  type: EventType;
  timestamp: number;

  // Who did what to whom
  actorId?: string;      // User who performed action
  targetId?: string;     // User who received action

  // Event details
  reason?: string;
  severity?: number;     // 0-1 scale
  sentiment?: 'positive' | 'negative' | 'neutral';

  // Metadata
  channelId?: string;
  messageId?: string;
  metadata?: Record<string, any>;
}

export interface ServerMetrics {
  guildId: string;
  timestamp: number;

  // Activity metrics
  messagesPerHour: number;
  activeUsers: number;

  // Happiness metrics
  happinessScore: number;      // 0-1 scale
  positiveInteractions: number;
  negativeInteractions: number;

  // Moderation metrics
  bansToday: number;
  kicksToday: number;
  warningsToday: number;
  deletionsToday: number;

  // Security metrics
  scamAttempts: number;
  scamBlocked: number;

  // User feedback
  averageFeedback: number;     // 1-5 scale
  feedbackCount: number;
}

export class EventTracker {
  private storage: StorageService;
  private events: Map<string, TrackedEvent[]> = new Map();

  constructor(storage: StorageService) {
    this.storage = storage;
    logger.info('📊 EventTracker initialized');
  }

  /**
   * Track a new event
   */
  async trackEvent(event: Omit<TrackedEvent, 'id' | 'timestamp'>): Promise<void> {
    const fullEvent: TrackedEvent = {
      ...event,
      id: this.generateEventId(),
      timestamp: Date.now(),
    };

    // Store in memory
    if (!this.events.has(event.guildId)) {
      this.events.set(event.guildId, []);
    }
    this.events.get(event.guildId)!.push(fullEvent);

    // Store in database
    await this.storage.saveEvent(fullEvent);

    logger.debug(`Event tracked: ${event.type} in guild ${event.guildId}`);
  }

  /**
   * Get events for a guild
   */
  async getEvents(guildId: string, options?: {
    type?: EventType;
    startTime?: number;
    endTime?: number;
    limit?: number;
  }): Promise<TrackedEvent[]> {
    let events = await this.storage.getEvents(guildId);

    // Apply filters
    if (options?.type) {
      events = events.filter(e => e.type === options.type);
    }
    if (options?.startTime) {
      events = events.filter(e => e.timestamp >= options.startTime!);
    }
    if (options?.endTime) {
      events = events.filter(e => e.timestamp <= options.endTime!);
    }

    // Sort by timestamp (newest first)
    events.sort((a, b) => b.timestamp - a.timestamp);

    // Limit results
    if (options?.limit) {
      events = events.slice(0, options.limit);
    }

    return events;
  }

  /**
   * Calculate server metrics
   */
  async calculateMetrics(guildId: string): Promise<ServerMetrics> {
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const oneHourAgo = now - 60 * 60 * 1000;

    // Get events from last 24 hours
    const recentEvents = await this.getEvents(guildId, {
      startTime: oneDayAgo,
    });

    // Get events from last hour (for rate calculation)
    const lastHourEvents = recentEvents.filter(e => e.timestamp >= oneHourAgo);

    // Calculate activity metrics
    const messages = lastHourEvents.filter(e => e.type === 'message');
    const messagesPerHour = messages.length;
    const activeUsers = new Set(messages.map(e => e.actorId)).size;

    // Calculate happiness score
    const positiveEvents = recentEvents.filter(e => e.sentiment === 'positive');
    const negativeEvents = recentEvents.filter(e => e.sentiment === 'negative');
    const positiveInteractions = positiveEvents.length;
    const negativeInteractions = negativeEvents.length;

    const totalSentimentEvents = positiveInteractions + negativeInteractions;
    const happinessScore = totalSentimentEvents > 0
      ? positiveInteractions / totalSentimentEvents
      : 0.5; // Neutral default

    // Calculate moderation metrics
    const bansToday = recentEvents.filter(e => e.type === 'ban').length;
    const kicksToday = recentEvents.filter(e => e.type === 'kick').length;
    const warningsToday = recentEvents.filter(e => e.type === 'warn').length;
    const deletionsToday = recentEvents.filter(e => e.type === 'delete').length;

    // Calculate security metrics
    const scamEvents = recentEvents.filter(e =>
      e.type === 'scam_attempt' || e.type === 'scam_blocked'
    );
    const scamAttempts = scamEvents.length;
    const scamBlocked = scamEvents.filter(e => e.type === 'scam_blocked').length;

    // Get feedback (from metadata)
    const feedbackEvents = recentEvents.filter(e => e.metadata?.feedback);
    const feedbackCount = feedbackEvents.length;
    const averageFeedback = feedbackCount > 0
      ? feedbackEvents.reduce((sum, e) => sum + (e.metadata!.feedback || 0), 0) / feedbackCount
      : 0;

    return {
      guildId,
      timestamp: now,
      messagesPerHour,
      activeUsers,
      happinessScore,
      positiveInteractions,
      negativeInteractions,
      bansToday,
      kicksToday,
      warningsToday,
      deletionsToday,
      scamAttempts,
      scamBlocked,
      averageFeedback,
      feedbackCount,
    };
  }

  /**
   * Get timeline of events (for visualization)
   */
  async getTimeline(guildId: string, hoursBack: number = 24): Promise<{
    timestamp: number;
    events: TrackedEvent[];
    metrics: {
      happiness: number;
      activity: number;
      conflicts: number;
    };
  }[]> {
    const now = Date.now();
    const startTime = now - hoursBack * 60 * 60 * 1000;
    const events = await this.getEvents(guildId, { startTime });

    // Group events by hour
    const timeline: Map<number, TrackedEvent[]> = new Map();

    events.forEach(event => {
      const hourTimestamp = Math.floor(event.timestamp / (60 * 60 * 1000)) * (60 * 60 * 1000);
      if (!timeline.has(hourTimestamp)) {
        timeline.set(hourTimestamp, []);
      }
      timeline.get(hourTimestamp)!.push(event);
    });

    // Calculate metrics for each hour
    const result = Array.from(timeline.entries()).map(([timestamp, hourEvents]) => {
      const positive = hourEvents.filter(e => e.sentiment === 'positive').length;
      const negative = hourEvents.filter(e => e.sentiment === 'negative').length;
      const happiness = (positive + negative) > 0 ? positive / (positive + negative) : 0.5;

      const activity = hourEvents.filter(e => e.type === 'message').length;
      const conflicts = hourEvents.filter(e => e.type === 'conflict').length;

      return {
        timestamp,
        events: hourEvents,
        metrics: { happiness, activity, conflicts },
      };
    });

    // Sort by timestamp
    result.sort((a, b) => a.timestamp - b.timestamp);

    return result;
  }

  /**
   * Generate unique event ID
   */
  private generateEventId(): string {
    return `event_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
