/**
 * DISCORD ADAPTER - Bridge between Discord.js and BecasKernel
 *
 * This adapter converts Discord.js events into domain events,
 * transforming framework-specific data into framework-agnostic domain models.
 *
 * Architecture:
 * Discord.js → DiscordAdapter → Kernel Event Bus → Plugins
 *
 * Design Pattern: Adapter Pattern (Anti-Corruption Layer)
 */

import { Client, Message as DiscordMessage, GuildMember } from 'discord.js';
import { BecasKernel } from './BecasKernel';
import { Message } from '../domain/models/Message';
import { MessageReceivedEvent } from '../domain/events/DomainEvent';
import { createLogger } from '../services/Logger';

const logger = createLogger('DiscordAdapter');

export class DiscordAdapter {
  private client: Client;
  private kernel: BecasKernel;
  private isInitialized = false;

  constructor(client: Client, kernel: BecasKernel) {
    this.client = client;
    this.kernel = kernel;
  }

  /**
   * Initialize adapter - wire up Discord.js events to kernel
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.warn('DiscordAdapter already initialized');
      return;
    }

    logger.info('🔌 Initializing Discord Adapter...');

    // Subscribe to Discord.js messageCreate event
    this.client.on('messageCreate', this.handleMessageCreate.bind(this));

    // Subscribe to Discord.js messageUpdate event
    this.client.on('messageUpdate', this.handleMessageUpdate.bind(this));

    // Subscribe to Discord.js messageDelete event
    this.client.on('messageDelete', this.handleMessageDelete.bind(this));

    this.isInitialized = true;
    logger.info('✅ Discord Adapter initialized');
    logger.info('   → Listening to: messageCreate, messageUpdate, messageDelete');
  }

  /**
   * Handle Discord messageCreate event
   */
  private async handleMessageCreate(discordMessage: DiscordMessage): Promise<void> {
    try {
      // Skip bot messages (prevents infinite loops)
      if (discordMessage.author.bot) {
        return;
      }

      // Skip messages without guild (DMs)
      if (!discordMessage.guild) {
        return;
      }

      // Convert Discord.js message to domain Message model
      const message = this.convertToMessageModel(discordMessage);

      // Publish MessageReceivedEvent to kernel
      await this.kernel.publishEvent(
        new MessageReceivedEvent({
          messageId: message.id,
          content: message.content,
          authorId: message.author.id,
          authorUsername: message.author.username,
          isBot: message.author.isBot,
          authorityLevel: message.author.authorityLevel,
          channelId: message.context.channelId,
          guildId: message.context.guildId,
          hasUrls: message.metadata.hasUrls,
          hasMentions: message.metadata.hasMentions,
          hasAttachments: message.metadata.hasAttachments,
          hasEmojis: message.metadata.hasEmojis,
          timestamp: message.context.timestamp,
        })
      );

      logger.debug(`📨 Published MessageReceivedEvent: ${message.id}`);
    } catch (error: any) {
      logger.error('Error handling messageCreate:', error);
    }
  }

  /**
   * Handle Discord messageUpdate event
   */
  private async handleMessageUpdate(
    oldMessage: DiscordMessage | null,
    newMessage: DiscordMessage
  ): Promise<void> {
    try {
      // Skip bot messages
      if (newMessage.author?.bot) {
        return;
      }

      // Skip messages without guild
      if (!newMessage.guild) {
        return;
      }

      // TODO: Publish MessageEditedEvent
      logger.debug(`✏️ Message edited: ${newMessage.id}`);
    } catch (error: any) {
      logger.error('Error handling messageUpdate:', error);
    }
  }

  /**
   * Handle Discord messageDelete event
   */
  private async handleMessageDelete(discordMessage: DiscordMessage): Promise<void> {
    try {
      // TODO: Publish MessageDeletedEvent
      logger.debug(`🗑️ Message deleted: ${discordMessage.id}`);
    } catch (error: any) {
      logger.error('Error handling messageDelete:', error);
    }
  }

  /**
   * Convert Discord.js Message to domain Message model
   */
  private convertToMessageModel(discordMessage: DiscordMessage): Message {
    // Determine authority level based on permissions
    const member = discordMessage.member as GuildMember;
    let authorityLevel: 'owner' | 'admin' | 'moderator' | 'regular' = 'regular';

    if (member) {
      if (member.guild.ownerId === member.id) {
        authorityLevel = 'owner';
      } else if (member.permissions.has('Administrator')) {
        authorityLevel = 'admin';
      } else if (
        member.permissions.has('ModerateMembers') ||
        member.permissions.has('BanMembers') ||
        member.permissions.has('KickMembers')
      ) {
        authorityLevel = 'moderator';
      }
    }

    // Create domain Message model
    return new Message(
      discordMessage.id,
      discordMessage.content,
      {
        id: discordMessage.author.id,
        username: discordMessage.author.username,
        isBot: discordMessage.author.bot,
        authorityLevel,
      },
      {
        guildId: discordMessage.guild!.id,
        channelId: discordMessage.channel.id,
        timestamp: discordMessage.createdAt,
      },
      {
        hasUrls: /https?:\/\/|www\./i.test(discordMessage.content),
        hasMentions: /@everyone|@here/i.test(discordMessage.content),
        hasAttachments: discordMessage.attachments.size > 0,
        hasEmojis: /<a?:\w+:\d+>/i.test(discordMessage.content),
        isReply: discordMessage.reference !== null,
        channelType: 'text',
        isEdited: discordMessage.editedAt !== null,
        editCount: discordMessage.editedAt ? 1 : 0,
      }
    );
  }

  /**
   * Shutdown adapter - cleanup
   */
  async shutdown(): Promise<void> {
    logger.info('🛑 Shutting down Discord Adapter...');

    // Remove Discord.js event listeners
    this.client.removeAllListeners('messageCreate');
    this.client.removeAllListeners('messageUpdate');
    this.client.removeAllListeners('messageDelete');

    this.isInitialized = false;
    logger.info('✅ Discord Adapter shutdown complete');
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    return this.isInitialized && this.client.isReady();
  }
}
