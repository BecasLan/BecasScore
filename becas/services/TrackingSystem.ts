import { Pool } from 'pg';
import { Client, Message, MessageReaction, User } from 'discord.js';
import { BDLTracking } from './BehaviorParser';
import logger from '../utils/logger';

/**
 * TrackingSystem
 *
 * Monitors users/channels/servers for a specified duration and collects data.
 * Used by behaviors to track activity before making decisions.
 *
 * Example: Track new user's first 10 messages to detect spam
 */

export interface TrackingSession {
  id: string;
  behaviorId: string;
  executionId: number;
  serverId: string;
  targetType: 'user' | 'channel' | 'server';
  targetId: string;
  duration: string;
  startedAt: Date;
  expiresAt: Date;
  collectedData: CollectedData;
  stopConditions: string[];
  status: 'active' | 'completed' | 'expired' | 'stopped';
  completedAt?: Date;
}

export interface CollectedData {
  messages: Message[];
  messageCount: number;
  linkCount: number;
  reactionCount: number;
  voiceMinutes: number;
  roleChanges: any[];
  customData: Record<string, any>;
}

export class TrackingSystem {
  private db: Pool;
  private discordClient: Client;
  private activeSessions: Map<string, TrackingSession> = new Map();

  constructor(db: Pool, discordClient: Client) {
    this.db = db;
    this.discordClient = discordClient;
  }

  /**
   * Initialize tracking system
   */
  async initialize(): Promise<void> {
    await this.loadActiveSessions();
    this.setupEventListeners();
    this.startExpirationCheck();
    logger.info('TrackingSystem initialized');
  }

  /**
   * Start a new tracking session
   */
  async startTracking(
    behaviorId: string,
    executionId: number,
    serverId: string,
    tracking: BDLTracking
  ): Promise<TrackingSession> {
    const id = `track-${behaviorId}-${executionId}-${Date.now()}`;

    // Parse duration (24h, 7d, etc.)
    const durationMs = this.parseDuration(tracking.duration);
    const expiresAt = new Date(Date.now() + durationMs);

    // Resolve target ID (replace variables)
    const targetId = this.resolveVariable(tracking.targetId, { executionId });

    const session: TrackingSession = {
      id,
      behaviorId,
      executionId,
      serverId,
      targetType: tracking.targetType,
      targetId,
      duration: tracking.duration,
      startedAt: new Date(),
      expiresAt,
      collectedData: {
        messages: [],
        messageCount: 0,
        linkCount: 0,
        reactionCount: 0,
        voiceMinutes: 0,
        roleChanges: [],
        customData: {}
      },
      stopConditions: tracking.stopConditions || [],
      status: 'active'
    };

    // Save to database
    await this.saveSession(session);

    // Add to active sessions
    this.activeSessions.set(id, session);

    logger.info(`Started tracking session ${id} for ${tracking.targetType} ${targetId}`);

    return session;
  }

  /**
   * Save session to database
   */
  private async saveSession(session: TrackingSession): Promise<void> {
    const query = `
      INSERT INTO behavior_active_tracking
      (id, behavior_id, execution_id, server_id, target_type, target_id, duration, expires_at, collected_data, stop_conditions, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `;

    await this.db.query(query, [
      session.id,
      session.behaviorId,
      session.executionId,
      session.serverId,
      session.targetType,
      session.targetId,
      session.duration,
      session.expiresAt,
      JSON.stringify(session.collectedData),
      JSON.stringify(session.stopConditions),
      session.status
    ]);
  }

  /**
   * Update session in database
   */
  private async updateSession(session: TrackingSession): Promise<void> {
    const query = `
      UPDATE behavior_active_tracking
      SET collected_data = $1,
          status = $2,
          completed_at = $3
      WHERE id = $4
    `;

    await this.db.query(query, [
      JSON.stringify(session.collectedData),
      session.status,
      session.completedAt,
      session.id
    ]);
  }

  /**
   * Load active sessions from database
   */
  private async loadActiveSessions(): Promise<void> {
    const query = `
      SELECT * FROM behavior_active_tracking
      WHERE status = 'active'
      AND expires_at > CURRENT_TIMESTAMP
    `;

    const result = await this.db.query(query);

    for (const row of result.rows) {
      const session: TrackingSession = {
        id: row.id,
        behaviorId: row.behavior_id,
        executionId: row.execution_id,
        serverId: row.server_id,
        targetType: row.target_type,
        targetId: row.target_id,
        duration: row.duration,
        startedAt: new Date(row.started_at),
        expiresAt: new Date(row.expires_at),
        collectedData: JSON.parse(row.collected_data),
        stopConditions: JSON.parse(row.stop_conditions),
        status: row.status
      };

      this.activeSessions.set(session.id, session);
    }

    logger.info(`Loaded ${this.activeSessions.size} active tracking sessions`);
  }

  /**
   * Setup event listeners to collect data
   */
  private setupEventListeners(): void {
    // Track messages
    this.discordClient.on('messageCreate', async (message: Message) => {
      await this.handleMessageCreate(message);
    });

    // Track reactions
    this.discordClient.on('messageReactionAdd', async (reaction: MessageReaction, user: User) => {
      await this.handleReactionAdd(reaction, user);
    });

    logger.info('Tracking event listeners setup');
  }

  /**
   * Handle message create event
   */
  private async handleMessageCreate(message: Message): Promise<void> {
    if (!message.guildId) return;

    // Find sessions tracking this user
    const sessions = Array.from(this.activeSessions.values()).filter(s =>
      s.serverId === message.guildId &&
      s.targetType === 'user' &&
      s.targetId === message.author.id &&
      s.status === 'active'
    );

    for (const session of sessions) {
      // Add message to collected data
      session.collectedData.messages.push(message);
      session.collectedData.messageCount++;

      // Count links
      if (/https?:\/\//.test(message.content)) {
        session.collectedData.linkCount++;
      }

      // Update database
      await this.updateSession(session);

      // Check stop conditions
      await this.checkStopConditions(session);
    }
  }

  /**
   * Handle reaction add event
   */
  private async handleReactionAdd(reaction: MessageReaction, user: User): Promise<void> {
    const message = reaction.message;
    if (!message.guildId) return;

    // Find sessions tracking this user
    const sessions = Array.from(this.activeSessions.values()).filter(s =>
      s.serverId === message.guildId &&
      s.targetType === 'user' &&
      s.targetId === user.id &&
      s.status === 'active'
    );

    for (const session of sessions) {
      session.collectedData.reactionCount++;
      await this.updateSession(session);
      await this.checkStopConditions(session);
    }
  }

  /**
   * Check if stop conditions are met
   */
  private async checkStopConditions(session: TrackingSession): Promise<void> {
    for (const condition of session.stopConditions) {
      if (this.evaluateCondition(condition, session)) {
        await this.completeSession(session);
        return;
      }
    }
  }

  /**
   * Evaluate a stop condition
   */
  private evaluateCondition(condition: string, session: TrackingSession): boolean {
    const data = session.collectedData;

    // Simple condition evaluation
    if (condition.includes('messageCount')) {
      const match = condition.match(/messageCount\s*>=\s*(\d+)/);
      if (match) {
        const threshold = parseInt(match[1]);
        return data.messageCount >= threshold;
      }
    }

    if (condition.includes('duration')) {
      const elapsed = Date.now() - session.startedAt.getTime();
      const match = condition.match(/duration\s*>=\s*(\d+)([smhd])/);
      if (match) {
        const value = parseInt(match[1]);
        const unit = match[2];
        const thresholdMs = this.parseDuration(`${value}${unit}`);
        return elapsed >= thresholdMs;
      }
    }

    return false;
  }

  /**
   * Complete a tracking session
   */
  private async completeSession(session: TrackingSession): Promise<void> {
    session.status = 'completed';
    session.completedAt = new Date();

    await this.updateSession(session);
    this.activeSessions.delete(session.id);

    logger.info(`Tracking session ${session.id} completed`);

    // TODO: Trigger analysis for this session
  }

  /**
   * Stop tracking session manually
   */
  async stopTracking(sessionId: string, reason: string = 'Manual stop'): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    session.status = 'stopped';
    session.completedAt = new Date();

    await this.updateSession(session);
    this.activeSessions.delete(sessionId);

    logger.info(`Tracking session ${sessionId} stopped: ${reason}`);
  }

  /**
   * Get tracking session by ID
   */
  getSession(sessionId: string): TrackingSession | undefined {
    return this.activeSessions.get(sessionId);
  }

  /**
   * Get collected data for a session
   */
  getCollectedData(sessionId: string): CollectedData | undefined {
    const session = this.activeSessions.get(sessionId);
    return session?.collectedData;
  }

  /**
   * Parse duration string to milliseconds
   */
  private parseDuration(duration: string): number {
    const match = duration.match(/^(\d+)([smhd])$/);
    if (!match) return 24 * 60 * 60 * 1000; // Default 24h

    const value = parseInt(match[1]);
    const unit = match[2];

    switch (unit) {
      case 's': return value * 1000;
      case 'm': return value * 60 * 1000;
      case 'h': return value * 60 * 60 * 1000;
      case 'd': return value * 24 * 60 * 60 * 1000;
      default: return 24 * 60 * 60 * 1000;
    }
  }

  /**
   * Resolve variables in strings
   */
  private resolveVariable(value: string, context: any): string {
    return value.replace(/\$\{(\w+)\}/g, (match, varName) => {
      return context[varName] || match;
    });
  }

  /**
   * Start expiration check job
   */
  private startExpirationCheck(): void {
    setInterval(async () => {
      const now = Date.now();

      for (const [id, session] of this.activeSessions.entries()) {
        if (now >= session.expiresAt.getTime()) {
          session.status = 'expired';
          session.completedAt = new Date();

          await this.updateSession(session);
          this.activeSessions.delete(id);

          logger.info(`Tracking session ${id} expired`);
        }
      }
    }, 60000); // Check every minute
  }
}
