import { Client, GuildMember, TextChannel, EmbedBuilder, User } from 'discord.js';
import { Pool } from 'pg';
import { BDLAction } from './BehaviorParser';
import { ExecutionContext } from '../core/BehaviorEngine';
import logger from '../utils/logger';

/**
 * ActionExecutor
 *
 * Executes all action types defined in BDL.
 * Handles Discord API calls, permissions, error handling.
 */

export class ActionExecutor {
  private discordClient: Client;
  private db: Pool;

  constructor(discordClient: Client, db: Pool) {
    this.discordClient = discordClient;
    this.db = db;
  }

  /**
   * Execute an action
   */
  async execute(action: BDLAction, context: ExecutionContext, analysisResult?: any): Promise<void> {
    try {
      logger.info(`Executing action: ${action.type}`);

      switch (action.type) {
        case 'sendDM':
          await this.executeSendDM(action, context, analysisResult);
          break;

        case 'addRole':
          await this.executeAddRole(action, context);
          break;

        case 'removeRole':
          await this.executeRemoveRole(action, context);
          break;

        case 'timeout':
          await this.executeTimeout(action, context);
          break;

        case 'kick':
          await this.executeKick(action, context);
          break;

        case 'ban':
          await this.executeBan(action, context);
          break;

        case 'sendMessage':
          await this.executeSendMessage(action, context, analysisResult);
          break;

        case 'askQuestion':
          await this.executeAskQuestion(action, context);
          break;

        case 'log':
          await this.executeLog(action, context, analysisResult);
          break;

        case 'createTicket':
          await this.executeCreateTicket(action, context, analysisResult);
          break;

        case 'runBehavior':
          await this.executeRunBehavior(action, context);
          break;

        case 'stopTracking':
          await this.executeStopTracking(action, context);
          break;

        default:
          logger.warn(`Unknown action type: ${action.type}`);
      }

      logger.info(`Action ${action.type} executed successfully`);

    } catch (error) {
      logger.error(`Failed to execute action ${action.type}:`, error);
      throw error;
    }
  }

  /**
   * Send DM to user
   */
  private async executeSendDM(action: BDLAction, context: ExecutionContext, analysisResult?: any): Promise<void> {
    const userId = this.resolveVariable(action.target!, context);
    const message = this.resolveVariable(action.message!, context, analysisResult);

    const user = await this.discordClient.users.fetch(userId);
    await user.send(message);

    logger.info(`Sent DM to user ${userId}`);
  }

  /**
   * Add role to user
   */
  private async executeAddRole(action: BDLAction, context: ExecutionContext): Promise<void> {
    const userId = this.resolveVariable(action.target!, context);
    const roleId = action.roleId!;

    const guild = await this.discordClient.guilds.fetch(context.serverId);
    const member = await guild.members.fetch(userId);

    await member.roles.add(roleId);

    logger.info(`Added role ${roleId} to user ${userId}`);
  }

  /**
   * Remove role from user
   */
  private async executeRemoveRole(action: BDLAction, context: ExecutionContext): Promise<void> {
    const userId = this.resolveVariable(action.target!, context);
    const roleId = action.roleId!;

    const guild = await this.discordClient.guilds.fetch(context.serverId);
    const member = await guild.members.fetch(userId);

    await member.roles.remove(roleId);

    logger.info(`Removed role ${roleId} from user ${userId}`);
  }

  /**
   * Timeout user
   */
  private async executeTimeout(action: BDLAction, context: ExecutionContext): Promise<void> {
    const userId = this.resolveVariable(action.target!, context);
    const durationMs = this.parseDuration(action.duration!);
    const reason = action.reason || 'Automated action';

    const guild = await this.discordClient.guilds.fetch(context.serverId);
    const member = await guild.members.fetch(userId);

    await member.timeout(durationMs, reason);

    logger.info(`Timed out user ${userId} for ${action.duration}`);
  }

  /**
   * Kick user
   */
  private async executeKick(action: BDLAction, context: ExecutionContext): Promise<void> {
    const userId = this.resolveVariable(action.target!, context);
    const reason = action.reason || 'Automated action';

    const guild = await this.discordClient.guilds.fetch(context.serverId);
    const member = await guild.members.fetch(userId);

    await member.kick(reason);

    logger.info(`Kicked user ${userId}`);
  }

  /**
   * Ban user
   */
  private async executeBan(action: BDLAction, context: ExecutionContext): Promise<void> {
    const userId = this.resolveVariable(action.target!, context);
    const reason = action.reason || 'Automated action';

    const guild = await this.discordClient.guilds.fetch(context.serverId);

    await guild.members.ban(userId, { reason });

    logger.info(`Banned user ${userId}`);
  }

  /**
   * Send message to channel
   */
  private async executeSendMessage(action: BDLAction, context: ExecutionContext, analysisResult?: any): Promise<void> {
    const channelId = this.resolveVariable(action.channelId!, context);
    const message = this.resolveVariable(action.message || '', context, analysisResult);

    const channel = await this.discordClient.channels.fetch(channelId) as TextChannel;

    if (action.embed) {
      const embed = this.buildEmbed(action.embed, context, analysisResult);
      await channel.send({ content: message || undefined, embeds: [embed] });
    } else {
      await channel.send(message);
    }

    logger.info(`Sent message to channel ${channelId}`);
  }

  /**
   * Ask user a question and wait for answer
   */
  private async executeAskQuestion(action: BDLAction, context: ExecutionContext): Promise<void> {
    const userId = this.resolveVariable(action.target!, context);
    const question = this.resolveVariable(action.question!, context);
    const expectedAnswer = action.expectedAnswer!;
    const timeoutMs = this.parseDuration(action.timeout || '60s');

    const user = await this.discordClient.users.fetch(userId);
    await user.send(question);

    // Wait for answer
    try {
      const dmChannel = await user.createDM();
      const collected = await dmChannel.awaitMessages({
        filter: (m: any) => m.author.id === userId,
        max: 1,
        time: timeoutMs,
        errors: ['time']
      });

      const answer = collected.first()?.content.trim().toLowerCase();
      const expected = expectedAnswer.toLowerCase();

      if (answer === expected) {
        // Correct answer
        if (action.onCorrect) {
          await this.execute(action.onCorrect, context);
        }
        logger.info(`User ${userId} answered correctly`);
      } else {
        // Incorrect answer
        if (action.onIncorrect) {
          await this.execute(action.onIncorrect, context);
        }
        logger.info(`User ${userId} answered incorrectly`);
      }

    } catch (error) {
      // Timeout
      if (action.onTimeout) {
        await this.execute(action.onTimeout, context);
      }
      logger.info(`User ${userId} timed out on question`);
    }
  }

  /**
   * Log action
   */
  private async executeLog(action: BDLAction, context: ExecutionContext, analysisResult?: any): Promise<void> {
    const level = action.level || 'info';
    const message = this.resolveVariable(action.message!, context, analysisResult);

    const logData = action.data ? this.resolveVariable(action.data, context, analysisResult) : undefined;

    switch (level) {
      case 'error':
        logger.error(message, logData);
        break;
      case 'warn':
        logger.warn(message, logData);
        break;
      case 'debug':
        logger.debug(message, logData);
        break;
      case 'http':
        logger.http(message, logData);
        break;
      default:
        logger.info(message, logData);
    }
  }

  /**
   * Create moderator ticket
   */
  private async executeCreateTicket(action: BDLAction, context: ExecutionContext, analysisResult?: any): Promise<void> {
    const title = this.resolveVariable(action.title!, context, analysisResult);
    const description = this.resolveVariable(action.description!, context, analysisResult);

    // Store ticket in database
    const query = `
      INSERT INTO mod_tickets (server_id, title, description, created_by, priority, status)
      VALUES ($1, $2, $3, $4, $5, $6)
    `;

    await this.db.query(query, [
      context.serverId,
      title,
      description,
      'BECAS-Behavior',
      action.priority || 'medium',
      'open'
    ]);

    logger.info(`Created ticket: ${title}`);
  }

  /**
   * Run another behavior
   */
  private async executeRunBehavior(action: BDLAction, context: ExecutionContext): Promise<void> {
    // TODO: Integrate with BehaviorEngine to trigger another behavior
    logger.info(`Triggering behavior ${action.behaviorId}`);
  }

  /**
   * Stop tracking session
   */
  private async executeStopTracking(action: BDLAction, context: ExecutionContext): Promise<void> {
    // TODO: Integrate with TrackingSystem
    logger.info(`Stopping tracking for target`);
  }

  /**
   * Build Discord embed
   */
  private buildEmbed(embedConfig: any, context: ExecutionContext, analysisResult?: any): EmbedBuilder {
    const embed = new EmbedBuilder();

    if (embedConfig.title) {
      embed.setTitle(this.resolveVariable(embedConfig.title, context, analysisResult));
    }

    if (embedConfig.description) {
      embed.setDescription(this.resolveVariable(embedConfig.description, context, analysisResult));
    }

    if (embedConfig.color) {
      embed.setColor(embedConfig.color);
    }

    if (embedConfig.fields) {
      for (const field of embedConfig.fields) {
        embed.addFields({
          name: this.resolveVariable(field.name, context, analysisResult),
          value: this.resolveVariable(field.value, context, analysisResult),
          inline: field.inline || false
        });
      }
    }

    if (embedConfig.footer) {
      embed.setFooter({ text: this.resolveVariable(embedConfig.footer, context, analysisResult) });
    }

    embed.setTimestamp();

    return embed;
  }

  /**
   * Parse duration string to milliseconds
   */
  private parseDuration(duration: string): number {
    const match = duration.match(/^(\d+)([smhd])$/);
    if (!match) return 60000; // Default 1 minute

    const value = parseInt(match[1]);
    const unit = match[2];

    switch (unit) {
      case 's': return value * 1000;
      case 'm': return value * 60 * 1000;
      case 'h': return value * 60 * 60 * 1000;
      case 'd': return value * 24 * 60 * 60 * 1000;
      default: return 60000;
    }
  }

  /**
   * Resolve variables in strings
   */
  private resolveVariable(value: string, context: ExecutionContext, analysisResult?: any): string {
    let resolved = value;

    // Replace context variables
    resolved = resolved.replace(/\$\{triggeredUserId\}/g, context.triggeredBy || '');
    resolved = resolved.replace(/\$\{triggeredChannelId\}/g, context.triggeredChannelId || '');
    resolved = resolved.replace(/\$\{triggeredMessageId\}/g, context.triggeredMessageId || '');
    resolved = resolved.replace(/\$\{triggeredAt\}/g, context.triggeredAt.toISOString());

    // Replace user variables
    if (context.eventData?.member) {
      const member = context.eventData.member as GuildMember;
      resolved = resolved.replace(/\$\{user\.username\}/g, member.user.username);
      resolved = resolved.replace(/\$\{user\.id\}/g, member.user.id);
    }

    // Replace analysis variables
    if (analysisResult) {
      for (const [key, val] of Object.entries(analysisResult)) {
        resolved = resolved.replace(new RegExp(`\\$\\{analysis\\.${key}\\}`, 'g'), String(val));
      }
    }

    return resolved;
  }
}
