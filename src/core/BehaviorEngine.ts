import { Pool } from 'pg';
import { Client, Message, GuildMember, VoiceState, MessageReaction, User } from 'discord.js';
import { BDLBehavior, BDLTrigger } from '../services/BehaviorParser';
import logger from '../utils/logger';

/**
 * BehaviorEngine
 *
 * Core execution engine for dynamic behaviors.
 * Listens to Discord events, matches them to behavior triggers, and executes actions.
 *
 * This is the META-AI PLATFORM - makes BECAS programmable!
 */

export interface ExecutionContext {
  serverId: string;
  triggeredBy?: string;  // User ID
  triggeredChannelId?: string;
  triggeredMessageId?: string;
  triggeredAt: Date;
  event: string;
  eventData: any;
}

export interface BehaviorExecution {
  id: number;
  behaviorId: string;
  serverId: string;
  triggeredBy?: string;
  triggerEvent: string;
  triggerData: any;
  startedAt: Date;
  completedAt?: Date;
  status: 'running' | 'completed' | 'failed' | 'skipped';
  actionsExecuted: number;
  analysisResult?: any;
  error?: string;
  executionTimeMs?: number;
}

export class BehaviorEngine {
  private db: Pool;
  private discordClient: Client;
  private behaviors: Map<string, BDLBehavior> = new Map();

  // Event listeners registry
  private eventListeners: Map<string, Function[]> = new Map();

  constructor(db: Pool, discordClient: Client) {
    this.db = db;
    this.discordClient = discordClient;
  }

  /**
   * Initialize behavior engine and load all behaviors
   */
  async initialize(): Promise<void> {
    await this.loadBehaviors();
    this.setupEventListeners();
    this.startMaintenanceJobs();
    logger.info('BehaviorEngine initialized');
  }

  /**
   * Load all enabled behaviors from database
   */
  async loadBehaviors(): Promise<void> {
    const query = 'SELECT * FROM dynamic_behaviors WHERE enabled = true';
    const result = await this.db.query(query);

    this.behaviors.clear();

    for (const row of result.rows) {
      const behavior: BDLBehavior = {
        id: row.id,
        name: row.name,
        description: row.description,
        enabled: row.enabled,
        trigger: row.trigger,
        tracking: row.tracking,
        analysis: row.analysis,
        actions: row.actions,
        safety: row.safety
      };

      this.behaviors.set(behavior.id!, behavior);
    }

    logger.info(`Loaded ${this.behaviors.size} active behaviors`);
  }

  /**
   * Setup Discord event listeners
   */
  private setupEventListeners(): void {
    // Message events
    this.discordClient.on('messageCreate', async (message: Message) => {
      await this.handleEvent('messageCreate', {
        serverId: message.guildId!,
        triggeredBy: message.author.id,
        triggeredChannelId: message.channelId,
        triggeredMessageId: message.id,
        message
      });
    });

    this.discordClient.on('messageUpdate', async (oldMessage, newMessage) => {
      if (!newMessage.guildId) return;
      await this.handleEvent('messageUpdate', {
        serverId: newMessage.guildId,
        triggeredBy: newMessage.author?.id,
        triggeredChannelId: newMessage.channelId,
        oldMessage,
        newMessage
      });
    });

    this.discordClient.on('messageDelete', async (message) => {
      if (!message.guildId) return;
      await this.handleEvent('messageDelete', {
        serverId: message.guildId,
        triggeredBy: message.author?.id,
        triggeredChannelId: message.channelId,
        message
      });
    });

    // Reaction events
    this.discordClient.on('messageReactionAdd', async (reaction: MessageReaction, user: User) => {
      const message = reaction.message;
      if (!message.guildId) return;
      await this.handleEvent('messageReactionAdd', {
        serverId: message.guildId,
        triggeredBy: user.id,
        triggeredChannelId: message.channelId,
        triggeredMessageId: message.id,
        reaction,
        user
      });
    });

    // Member events
    this.discordClient.on('guildMemberAdd', async (member: GuildMember) => {
      await this.handleEvent('guildMemberAdd', {
        serverId: member.guild.id,
        triggeredBy: member.id,
        member
      });
    });

    this.discordClient.on('guildMemberRemove', async (member: GuildMember) => {
      await this.handleEvent('guildMemberRemove', {
        serverId: member.guild.id,
        triggeredBy: member.id,
        member
      });
    });

    this.discordClient.on('guildMemberUpdate', async (oldMember, newMember) => {
      await this.handleEvent('guildMemberUpdate', {
        serverId: newMember.guild.id,
        triggeredBy: newMember.id,
        oldMember,
        newMember
      });
    });

    // Voice events
    this.discordClient.on('voiceStateUpdate', async (oldState: VoiceState, newState: VoiceState) => {
      await this.handleEvent('voiceStateUpdate', {
        serverId: newState.guild.id,
        triggeredBy: newState.member?.id,
        oldState,
        newState
      });
    });

    logger.info('Discord event listeners setup complete');
  }

  /**
   * Handle Discord event and match to behaviors
   * Public to allow integration with other systems (e.g., MessageAnalysisPipeline)
   */
  async handleEvent(eventName: string, eventData: any): Promise<void> {
    try {
      const { serverId } = eventData;

      // Find behaviors triggered by this event
      const matchedBehaviors = this.findMatchingBehaviors(eventName, eventData);

      logger.debug(`Event ${eventName} matched ${matchedBehaviors.length} behaviors`);

      // Execute each matched behavior
      for (const behavior of matchedBehaviors) {
        await this.executeBehavior(behavior, {
          serverId,
          triggeredBy: eventData.triggeredBy,
          triggeredChannelId: eventData.triggeredChannelId,
          triggeredMessageId: eventData.triggeredMessageId,
          triggeredAt: new Date(),
          event: eventName,
          eventData
        });
      }

    } catch (error) {
      logger.error(`Error handling event ${eventName}:`, error);
    }
  }

  /**
   * Find behaviors that match this event
   */
  private findMatchingBehaviors(eventName: string, eventData: any): BDLBehavior[] {
    const matched: BDLBehavior[] = [];

    for (const behavior of this.behaviors.values()) {
      if (this.doesTriggerMatch(behavior.trigger, eventName, eventData)) {
        matched.push(behavior);
      }
    }

    return matched;
  }

  /**
   * Check if trigger matches event
   */
  private doesTriggerMatch(trigger: BDLTrigger, eventName: string, eventData: any): boolean {
    // Event trigger
    if (trigger.type === 'event' && trigger.event === eventName) {
      // Check filters
      if (trigger.filters) {
        return this.checkFilters(trigger.filters, eventData);
      }
      return true;
    }

    // Schedule trigger (handled separately by cron jobs)
    if (trigger.type === 'schedule') {
      return false;
    }

    // Condition trigger (checked periodically)
    if (trigger.type === 'condition') {
      return false;
    }

    // Pattern trigger (requires analysis)
    if (trigger.type === 'pattern') {
      return false;
    }

    return false;
  }

  /**
   * Check trigger filters
   */
  private checkFilters(filters: Record<string, any>, eventData: any): boolean {
    // Channel filter
    if (filters.channelId && filters.channelId !== eventData.triggeredChannelId) {
      return false;
    }

    // User filter
    if (filters.userId && filters.userId !== eventData.triggeredBy) {
      return false;
    }

    // Role filter (requires member object)
    if (filters.roleId && eventData.member) {
      const member = eventData.member as GuildMember;
      if (!member.roles.cache.has(filters.roleId)) {
        return false;
      }
    }

    // Content match filter
    if (filters.contentMatches && eventData.message) {
      const message = eventData.message as Message;
      const regex = new RegExp(filters.contentMatches, 'i');
      if (!regex.test(message.content)) {
        return false;
      }
    }

    // Has links filter
    if (filters.hasLinks !== undefined && eventData.message) {
      const message = eventData.message as Message;
      const hasLinks = /https?:\/\//.test(message.content);
      if (hasLinks !== filters.hasLinks) {
        return false;
      }
    }

    // Has attachments filter
    if (filters.hasAttachments !== undefined && eventData.message) {
      const message = eventData.message as Message;
      const hasAttachments = message.attachments.size > 0;
      if (hasAttachments !== filters.hasAttachments) {
        return false;
      }
    }

    return true;
  }

  /**
   * Execute a behavior
   */
  async executeBehavior(behavior: BDLBehavior, context: ExecutionContext): Promise<void> {
    const startTime = Date.now();
    let executionId: number | null = null;

    try {
      logger.info(`Executing behavior: ${behavior.name} (${behavior.id})`);

      // Create execution record
      executionId = await this.createExecutionRecord(behavior, context);

      // Check rate limits
      const rateLimitOk = await this.checkRateLimits(behavior, context);
      if (!rateLimitOk) {
        logger.warn(`Behavior ${behavior.name} skipped due to rate limit`);
        await this.updateExecutionRecord(executionId, 'skipped', 0, undefined, 'Rate limit exceeded');
        return;
      }

      // Start tracking if configured
      if (behavior.tracking?.enabled) {
        await this.startTracking(behavior, context, executionId);
      }

      // Run analysis if configured
      let analysisResult: any = undefined;
      if (behavior.analysis && behavior.analysis.type !== 'none') {
        analysisResult = await this.runAnalysis(behavior, context);
      }

      // Execute actions
      let actionsExecuted = 0;
      for (const action of behavior.actions) {
        const shouldExecute = await this.shouldExecuteAction(action, context, analysisResult);
        if (shouldExecute) {
          await this.executeAction(action, context, analysisResult);
          actionsExecuted++;
        }
      }

      // Update execution record
      const executionTime = Date.now() - startTime;
      await this.updateExecutionRecord(executionId, 'completed', actionsExecuted, analysisResult, undefined, executionTime);

      // Increment behavior execution count
      await this.db.query('SELECT increment_behavior_execution($1)', [behavior.id]);

      logger.info(`Behavior ${behavior.name} executed successfully (${actionsExecuted} actions in ${executionTime}ms)`);

    } catch (error) {
      const executionTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      logger.error(`Behavior ${behavior.name} execution failed:`, error);

      if (executionId) {
        await this.updateExecutionRecord(executionId, 'failed', 0, undefined, errorMessage, executionTime);
      }

      // Record error
      await this.db.query('SELECT record_behavior_error($1, $2)', [behavior.id, errorMessage]);

      // Reload behaviors if this one was auto-disabled
      await this.loadBehaviors();
    }
  }

  /**
   * Create execution record in database
   */
  private async createExecutionRecord(behavior: BDLBehavior, context: ExecutionContext): Promise<number> {
    const query = `
      INSERT INTO behavior_executions
      (behavior_id, server_id, triggered_by, trigger_event, trigger_data, status)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `;

    const result = await this.db.query(query, [
      behavior.id,
      context.serverId,
      context.triggeredBy,
      context.event,
      JSON.stringify(context.eventData),
      'running'
    ]);

    return result.rows[0].id;
  }

  /**
   * Update execution record
   */
  private async updateExecutionRecord(
    executionId: number,
    status: string,
    actionsExecuted: number,
    analysisResult?: any,
    error?: string,
    executionTimeMs?: number
  ): Promise<void> {
    const query = `
      UPDATE behavior_executions
      SET status = $1,
          actions_executed = $2,
          analysis_result = $3,
          error = $4,
          execution_time_ms = $5,
          completed_at = CURRENT_TIMESTAMP
      WHERE id = $6
    `;

    await this.db.query(query, [
      status,
      actionsExecuted,
      analysisResult ? JSON.stringify(analysisResult) : null,
      error,
      executionTimeMs,
      executionId
    ]);
  }

  /**
   * Check rate limits
   */
  private async checkRateLimits(behavior: BDLBehavior, context: ExecutionContext): Promise<boolean> {
    const safety = behavior.safety;
    if (!safety) return true;

    // Per-hour limit
    if (safety.maxExecutionsPerHour) {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const query = `
        SELECT COUNT(*) as count
        FROM behavior_executions
        WHERE behavior_id = $1
        AND started_at >= $2
      `;

      const result = await this.db.query(query, [behavior.id, oneHourAgo]);
      const count = parseInt(result.rows[0].count);

      if (count >= safety.maxExecutionsPerHour) {
        return false;
      }
    }

    // Per-user limit
    if (safety.maxExecutionsPerUser && context.triggeredBy) {
      const query = `
        SELECT COUNT(*) as count
        FROM behavior_executions
        WHERE behavior_id = $1
        AND triggered_by = $2
      `;

      const result = await this.db.query(query, [behavior.id, context.triggeredBy]);
      const count = parseInt(result.rows[0].count);

      if (count >= safety.maxExecutionsPerUser) {
        return false;
      }
    }

    return true;
  }

  /**
   * Start tracking session (placeholder - will be implemented in TrackingSystem)
   */
  private async startTracking(behavior: BDLBehavior, context: ExecutionContext, executionId: number): Promise<void> {
    logger.debug(`Starting tracking for behavior ${behavior.name}`);
    // TODO: Implement in TrackingSystem.ts
  }

  /**
   * Run analysis (placeholder - will integrate with analysis systems)
   */
  private async runAnalysis(behavior: BDLBehavior, context: ExecutionContext): Promise<any> {
    logger.debug(`Running analysis for behavior ${behavior.name}`);
    // TODO: Implement analysis logic
    return {};
  }

  /**
   * Check if action should execute (evaluate condition)
   */
  private async shouldExecuteAction(action: any, context: ExecutionContext, analysisResult: any): Promise<boolean> {
    if (!action.condition) return true;

    // TODO: Implement ConditionEvaluator
    // For now, always execute
    return true;
  }

  /**
   * Execute an action (placeholder - will be implemented in ActionExecutor)
   */
  private async executeAction(action: any, context: ExecutionContext, analysisResult: any): Promise<void> {
    logger.debug(`Executing action: ${action.type}`);
    // TODO: Implement in ActionExecutor.ts
  }

  /**
   * Start maintenance jobs (cleanup, rate limit resets, etc.)
   */
  private startMaintenanceJobs(): void {
    // Clean up expired tracking sessions every 5 minutes
    setInterval(async () => {
      try {
        const result = await this.db.query('SELECT cleanup_expired_tracking()');
        const cleaned = result.rows[0].cleanup_expired_tracking;
        if (cleaned > 0) {
          logger.debug(`Cleaned up ${cleaned} expired tracking sessions`);
        }
      } catch (error) {
        logger.error('Error cleaning up tracking sessions:', error);
      }
    }, 5 * 60 * 1000);

    logger.info('Maintenance jobs started');
  }

  /**
   * Reload behaviors (when changes are made)
   */
  async reload(): Promise<void> {
    logger.info('Reloading behaviors...');
    await this.loadBehaviors();
  }

  /**
   * Get behavior by ID
   */
  getBehavior(behaviorId: string): BDLBehavior | undefined {
    return this.behaviors.get(behaviorId);
  }

  /**
   * Get all behaviors for a server
   */
  getServerBehaviors(serverId: string): BDLBehavior[] {
    return Array.from(this.behaviors.values()).filter(b =>
      b.trigger && (b.trigger as any).serverId === serverId
    );
  }
}

/**
 * Example usage:
 *
 * const engine = new BehaviorEngine(db, discordClient);
 * await engine.initialize();
 *
 * // Behaviors are automatically executed when Discord events occur
 * // No manual intervention needed!
 *
 * // Reload behaviors after creating a new one
 * await engine.reload();
 */
