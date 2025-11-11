/**
 * ENFORCEMENT PLUGIN
 *
 * Executes moderation actions when violations are detected.
 * Subscribes to ViolationDetectedEvent and takes appropriate action.
 *
 * Architecture:
 * ViolationDetectedEvent → EnforcementPlugin → Discord Action → ModerationActionExecutedEvent
 */

import { Plugin, BecasKernel } from '../kernel/BecasKernel';
import {
  ViolationDetectedEvent,
  ModerationActionExecutedEvent,
} from '../domain/events/DomainEvent';
import { Violation, ModerationAction } from '../domain/models/Violation';
import { createLogger } from '../services/Logger';
import { Client, GuildMember, TextChannel } from 'discord.js';

const logger = createLogger('EnforcementPlugin');

export class EnforcementPlugin implements Plugin {
  name = 'enforcement';
  version = '2.0.0';
  description = 'Moderation action enforcement based on violations';
  dependencies = ['moderation']; // Requires ModerationPlugin to publish violations

  private kernel!: BecasKernel;
  private client!: Client;

  /**
   * Initialize plugin - subscribe to violation events
   */
  async initialize(kernel: BecasKernel): Promise<void> {
    this.kernel = kernel;

    logger.info('⚖️ Initializing Enforcement Plugin...');

    // Get Discord client from kernel's service registry
    try {
      this.client = kernel.getService<Client>('discord_client');
    } catch (error) {
      logger.error('Discord client not found in service registry!');
      throw new Error('EnforcementPlugin requires Discord client service');
    }

    // Subscribe to violation events
    const eventBus = kernel.getEventBus();

    eventBus.on<ViolationDetectedEvent['payload']>(
      'violation.detected',
      this.handleViolation.bind(this)
    );

    logger.info('✅ Enforcement Plugin initialized');
    logger.info('   → Subscribed to: violation.detected');
  }

  /**
   * Handle violation event - execute moderation action
   */
  private async handleViolation(event: ViolationDetectedEvent): Promise<void> {
    const startTime = Date.now();

    try {
      const { messageId, violationType, severity, confidence, reasoning } = event.payload;

      logger.info(`⚖️ Processing violation: ${violationType} (${severity}, ${confidence})`);

      // Reconstruct Violation domain model to get recommended action
      // Note: In real implementation, you'd store the full Violation object in the event
      // For now, we'll map severity to action based on domain logic
      const action = this.getActionFromSeverity(severity);
      const timeoutDuration = this.getTimeoutDuration(severity);

      logger.info(`   → Recommended action: ${action}`);

      if (action === ModerationAction.NONE || action === ModerationAction.WARNING) {
        logger.info(`   → Skipping enforcement (action=${action})`);
        return;
      }

      // Get guild and member from message
      const { guildId, userId } = await this.getMessageContext(messageId);

      if (!guildId || !userId) {
        logger.warn('   → Cannot enforce: missing guild or user context');
        return;
      }

      // Execute moderation action
      const executed = await this.executeAction(
        action,
        guildId,
        userId,
        reasoning,
        timeoutDuration
      );

      if (!executed) {
        logger.warn(`   → Failed to execute action: ${action}`);
        return;
      }

      // Publish ModerationActionExecutedEvent
      await this.kernel.publishEvent(
        new ModerationActionExecutedEvent(
          {
            actionType: this.mapToEventActionType(action),
            targetUserId: userId,
            executorId: this.client.user!.id, // Bot is executor
            reason: `${violationType} violation: ${reasoning}`,
            duration: timeoutDuration,
            guildId,
          },
          event.metadata.eventId // Causation chain
        )
      );

      const duration = Date.now() - startTime;
      logger.info(`✅ Enforcement complete (${duration}ms) - Action: ${action}`);
    } catch (error: any) {
      logger.error('Enforcement error:', error);
    }
  }

  /**
   * Get message context (guild, user)
   */
  private async getMessageContext(
    messageId: string
  ): Promise<{ guildId?: string; userId?: string }> {
    try {
      // Search all guilds for the message
      for (const [guildId, guild] of this.client.guilds.cache) {
        for (const [channelId, channel] of guild.channels.cache) {
          if (channel.isTextBased()) {
            try {
              const message = await (channel as TextChannel).messages.fetch(messageId);
              return { guildId, userId: message.author.id };
            } catch {
              // Message not in this channel, continue
            }
          }
        }
      }

      return {};
    } catch (error: any) {
      logger.error('Error getting message context:', error);
      return {};
    }
  }

  /**
   * Execute moderation action on Discord
   */
  private async executeAction(
    action: ModerationAction,
    guildId: string,
    userId: string,
    reason: string,
    timeoutDuration?: number
  ): Promise<boolean> {
    try {
      const guild = this.client.guilds.cache.get(guildId);
      if (!guild) {
        logger.warn(`Guild not found: ${guildId}`);
        return false;
      }

      const member = await guild.members.fetch(userId);
      if (!member) {
        logger.warn(`Member not found: ${userId} in guild ${guildId}`);
        return false;
      }

      // Check bot permissions
      const botMember = await guild.members.fetch(this.client.user!.id);
      if (!botMember) {
        logger.warn('Bot member not found in guild');
        return false;
      }

      switch (action) {
        case ModerationAction.TIMEOUT:
          if (!botMember.permissions.has('ModerateMembers')) {
            logger.warn('Bot lacks ModerateMembers permission');
            return false;
          }

          if (!timeoutDuration) {
            logger.warn('Timeout duration not specified');
            return false;
          }

          await member.timeout(timeoutDuration * 1000, reason);
          logger.info(`   → Timed out ${member.user.username} for ${timeoutDuration}s`);
          return true;

        case ModerationAction.KICK:
          if (!botMember.permissions.has('KickMembers')) {
            logger.warn('Bot lacks KickMembers permission');
            return false;
          }

          await member.kick(reason);
          logger.info(`   → Kicked ${member.user.username}`);
          return true;

        case ModerationAction.BAN:
        case ModerationAction.CROSS_BAN:
          if (!botMember.permissions.has('BanMembers')) {
            logger.warn('Bot lacks BanMembers permission');
            return false;
          }

          await member.ban({ reason });
          logger.info(`   → Banned ${member.user.username}`);

          // TODO: For CROSS_BAN, ban across all Becas-powered servers
          if (action === ModerationAction.CROSS_BAN) {
            logger.info('   → Cross-ban not yet implemented');
          }

          return true;

        default:
          logger.warn(`Unknown action: ${action}`);
          return false;
      }
    } catch (error: any) {
      logger.error(`Error executing action ${action}:`, error);
      return false;
    }
  }

  /**
   * Map severity to action (domain logic extracted from Violation model)
   */
  private getActionFromSeverity(severity: string): ModerationAction {
    switch (severity) {
      case 'critical':
        return ModerationAction.BAN;
      case 'high':
        return ModerationAction.TIMEOUT;
      case 'medium':
        return ModerationAction.TIMEOUT;
      case 'low':
        return ModerationAction.WARNING;
      default:
        return ModerationAction.NONE;
    }
  }

  /**
   * Get timeout duration based on severity
   */
  private getTimeoutDuration(severity: string): number | undefined {
    switch (severity) {
      case 'high':
        return 3600; // 1 hour
      case 'medium':
        return 600; // 10 minutes
      case 'low':
        return 300; // 5 minutes
      default:
        return undefined;
    }
  }

  /**
   * Map ModerationAction to event action type
   */
  private mapToEventActionType(
    action: ModerationAction
  ): 'timeout' | 'ban' | 'kick' | 'warning' {
    switch (action) {
      case ModerationAction.TIMEOUT:
        return 'timeout';
      case ModerationAction.BAN:
      case ModerationAction.CROSS_BAN:
        return 'ban';
      case ModerationAction.KICK:
        return 'kick';
      case ModerationAction.WARNING:
        return 'warning';
      default:
        return 'warning';
    }
  }

  /**
   * Shutdown plugin - cleanup
   */
  async shutdown(): Promise<void> {
    logger.info('🛑 Shutting down Enforcement Plugin...');
    // No cleanup needed (event bus handles unsubscribe)
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    return this.client?.isReady() || false;
  }
}
