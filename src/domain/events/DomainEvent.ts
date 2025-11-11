/**
 * DOMAIN EVENTS SYSTEM
 *
 * Event-driven architecture for loose coupling and extensibility.
 * Based on Domain-Driven Design (DDD) principles.
 *
 * Why Events?
 * - Decouple components (Message processing → Violation detection → Action execution)
 * - Enable audit trail (every action is logged as event)
 * - Support for event sourcing (future: reconstruct state from events)
 * - Plugin system (new features subscribe to events without modifying core)
 */

export interface DomainEventMetadata {
  eventId: string;
  timestamp: Date;
  correlationId?: string; // For tracing across services
  causationId?: string; // What event caused this event (event chain)
  userId?: string;
  guildId?: string;
}

/**
 * Base class for all domain events
 */
export abstract class DomainEvent<T = any> {
  readonly eventName: string;
  readonly metadata: DomainEventMetadata;
  readonly payload: T;

  constructor(eventName: string, payload: T, metadata?: Partial<DomainEventMetadata>) {
    this.eventName = eventName;
    this.payload = payload;
    this.metadata = {
      eventId: metadata?.eventId || this.generateEventId(),
      timestamp: metadata?.timestamp || new Date(),
      correlationId: metadata?.correlationId,
      causationId: metadata?.causationId,
      userId: metadata?.userId,
      guildId: metadata?.guildId,
    };
  }

  private generateEventId(): string {
    return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Create child event (preserves correlation chain)
   */
  createChildEvent<P>(eventName: string, payload: P): DomainEvent<P> {
    return new GenericDomainEvent(eventName, payload, {
      correlationId: this.metadata.correlationId || this.metadata.eventId,
      causationId: this.metadata.eventId,
      userId: this.metadata.userId,
      guildId: this.metadata.guildId,
    });
  }

  toJSON(): object {
    return {
      eventName: this.eventName,
      metadata: this.metadata,
      payload: this.payload,
    };
  }
}

/**
 * Generic domain event (for dynamic event creation)
 */
export class GenericDomainEvent<T> extends DomainEvent<T> {
  constructor(eventName: string, payload: T, metadata?: Partial<DomainEventMetadata>) {
    super(eventName, payload, metadata);
  }
}

// ===================================
// CONCRETE DOMAIN EVENTS
// ===================================

/**
 * MessageReceived - Triggered when new message arrives
 */
export class MessageReceivedEvent extends DomainEvent<{
  messageId: string;
  content: string;
  authorId: string;
  authorUsername?: string;
  isBot?: boolean;
  authorityLevel?: 'owner' | 'admin' | 'moderator' | 'regular';
  channelId: string;
  guildId: string;
  hasUrls?: boolean;
  hasMentions?: boolean;
  hasAttachments?: boolean;
  hasEmojis?: boolean;
  timestamp?: Date;
}> {
  constructor(payload: MessageReceivedEvent['payload']) {
    super('message.received', payload, {
      userId: payload.authorId,
      guildId: payload.guildId,
    });
  }
}

/**
 * ViolationDetected - Triggered when content violation found
 */
export class ViolationDetectedEvent extends DomainEvent<{
  messageId: string;
  violationType: string;
  severity: string;
  confidence: number;
  evidence: string;
  reasoning: string;
}> {
  constructor(payload: ViolationDetectedEvent['payload'], causationId?: string) {
    super('violation.detected', payload, { causationId });
  }
}

/**
 * ModerationActionExecuted - Triggered when moderation action taken
 */
export class ModerationActionExecutedEvent extends DomainEvent<{
  actionType: 'timeout' | 'ban' | 'kick' | 'warning';
  targetUserId: string;
  executorId: string; // Bot or moderator ID
  reason: string;
  duration?: number; // For timeout
  guildId: string;
}> {
  constructor(payload: ModerationActionExecutedEvent['payload'], causationId?: string) {
    super('moderation.action_executed', payload, {
      userId: payload.targetUserId,
      guildId: payload.guildId,
      causationId,
    });
  }
}

/**
 * TrustScoreChanged - Triggered when user trust score updates
 */
export class TrustScoreChangedEvent extends DomainEvent<{
  userId: string;
  guildId: string;
  oldScore: number;
  newScore: number;
  delta: number;
  reason: string;
}> {
  constructor(payload: TrustScoreChangedEvent['payload']) {
    super('trust_score.changed', payload, {
      userId: payload.userId,
      guildId: payload.guildId,
    });
  }
}

/**
 * BotCommandExecuted - Triggered when bot command processed
 */
export class BotCommandExecutedEvent extends DomainEvent<{
  command: string;
  executorId: string;
  guildId: string;
  success: boolean;
  executionTimeMs: number;
  result?: any;
  error?: string;
}> {
  constructor(payload: BotCommandExecutedEvent['payload']) {
    super('bot.command_executed', payload, {
      userId: payload.executorId,
      guildId: payload.guildId,
    });
  }
}

// ===================================
// EVENT BUS (Pub/Sub System)
// ===================================

type EventHandler<T = any> = (event: DomainEvent<T>) => Promise<void> | void;

/**
 * Event Bus - Central event dispatcher
 *
 * Design Pattern: Observer + Mediator
 */
export class EventBus {
  private handlers: Map<string, Set<EventHandler>> = new Map();
  private wildcardHandlers: Set<EventHandler> = new Set();

  /**
   * Subscribe to specific event
   */
  on<T>(eventName: string, handler: EventHandler<T>): void {
    if (!this.handlers.has(eventName)) {
      this.handlers.set(eventName, new Set());
    }
    this.handlers.get(eventName)!.add(handler as EventHandler);
  }

  /**
   * Subscribe to all events (for logging, audit trail)
   */
  onAny(handler: EventHandler): void {
    this.wildcardHandlers.add(handler);
  }

  /**
   * Unsubscribe from event
   */
  off(eventName: string, handler: EventHandler): void {
    const handlers = this.handlers.get(eventName);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  /**
   * Publish event (async, non-blocking)
   */
  async publish<T>(event: DomainEvent<T>): Promise<void> {
    // Get specific handlers
    const specificHandlers = this.handlers.get(event.eventName) || new Set();

    // Combine specific + wildcard handlers
    const allHandlers = [...specificHandlers, ...this.wildcardHandlers];

    // Execute all handlers in parallel (non-blocking)
    const promises = allHandlers.map(handler =>
      Promise.resolve(handler(event)).catch(error => {
        console.error(`Event handler error for ${event.eventName}:`, error);
      })
    );

    await Promise.all(promises);
  }

  /**
   * Get statistics (for monitoring)
   */
  getStats(): {
    totalEventTypes: number;
    totalHandlers: number;
    wildcardHandlers: number;
  } {
    let totalHandlers = 0;
    this.handlers.forEach(handlers => {
      totalHandlers += handlers.size;
    });

    return {
      totalEventTypes: this.handlers.size,
      totalHandlers,
      wildcardHandlers: this.wildcardHandlers.size,
    };
  }

  /**
   * Clear all handlers (for testing)
   */
  clear(): void {
    this.handlers.clear();
    this.wildcardHandlers.clear();
  }
}

// Singleton instance
export const eventBus = new EventBus();
