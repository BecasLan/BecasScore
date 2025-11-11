// actions/messageActions.ts - Message-related Discord actions

import { PermissionFlagsBits, TextChannel } from 'discord.js';
import { Action, ActionContext, ActionResult } from '../ActionRegistry';
import { createLogger } from '../../services/Logger';

const logger = createLogger('MessageActions');

// ============================================
// MESSAGE ACTIONS
// ============================================

export const deleteMessage: Action = {
  id: 'delete_message',
  category: 'message',
  name: 'Delete Message',
  description: 'Delete a specific message by ID or reference',
  examples: ['delete that message', 'remove the message above', 'delete this'],
  requiredPermissions: [PermissionFlagsBits.ManageMessages],
  canUndo: false,
  bulkCapable: false,
  parameters: [
    {
      name: 'message_id',
      type: 'message',
      required: true,
      description: 'The message to delete (ID or reference like "above", "that", "previous")'
    },
    {
      name: 'reason',
      type: 'string',
      required: false,
      description: 'Reason for deletion'
    }
  ],
  execute: async (context: ActionContext): Promise<ActionResult> => {
    try {
      const messageId = context.parameters.message_id;
      const channel = context.message.channel as TextChannel;

      const targetMessage = await channel.messages.fetch(messageId);
      await targetMessage.delete();

      await context.auditLogger.log({
        type: 'moderation_action',
        guildId: context.message.guild!.id,
        guildName: context.message.guild!.name,
        actorId: context.executor.id,
        actorName: context.executor.user.username,
        actorType: 'moderator',
        action: 'delete_message',
        details: {
          messageId,
          reason: context.parameters.reason,
          content: targetMessage.content.substring(0, 100)
        },
        success: true,
        channelId: channel.id,
        messageId: context.message.id
      });

      return {
        success: true,
        message: 'Message deleted',
        affectedChannels: [channel.id]
      };
    } catch (error: any) {
      logger.error('Failed to delete message:', error);
      return {
        success: false,
        error: `Failed to delete message: ${error.message}`
      };
    }
  }
};

export const bulkDeleteMessages: Action = {
  id: 'bulk_delete_messages',
  category: 'message',
  name: 'Bulk Delete Messages',
  description: 'Delete multiple messages at once (2-100 messages, max 14 days old)',
  examples: ['delete last 50 messages', 'purge 20 messages', 'clear 10 messages from @user'],
  requiredPermissions: [PermissionFlagsBits.ManageMessages],
  canUndo: false,
  bulkCapable: true,
  parameters: [
    {
      name: 'count',
      type: 'number',
      required: true,
      description: 'Number of messages to delete (2-100)',
      validation: { min: 2, max: 100 }
    },
    {
      name: 'author_filter',
      type: 'user',
      required: false,
      description: 'Only delete messages from this user'
    },
    {
      name: 'channel',
      type: 'channel',
      required: false,
      description: 'Channel to delete from (defaults to current)'
    }
  ],
  execute: async (context: ActionContext): Promise<ActionResult> => {
    try {
      const count = context.parameters.count;
      const authorFilter = context.parameters.author_filter;
      const channel = (context.parameters.channel || context.message.channel) as TextChannel;

      // Fetch messages
      const messages = await channel.messages.fetch({ limit: count });
      let toDelete = Array.from(messages.values());

      // Filter by author if specified
      if (authorFilter) {
        toDelete = toDelete.filter(m => m.author.id === authorFilter);
      }

      // Bulk delete (Discord API handles 14-day limit)
      const deleted = await channel.bulkDelete(toDelete, true);

      await context.auditLogger.log({
        type: 'moderation_action',
        guildId: context.message.guild!.id,
        guildName: context.message.guild!.name,
        actorId: context.executor.id,
        actorName: context.executor.user.username,
        actorType: 'moderator',
        action: 'bulk_delete_messages',
        details: {
          count: deleted.size,
          authorFilter,
          channel: channel.name
        },
        success: true,
        channelId: channel.id,
        messageId: context.message.id
      });

      return {
        success: true,
        message: `Deleted ${deleted.size} messages`,
        affectedChannels: [channel.id]
      };
    } catch (error: any) {
      logger.error('Failed to bulk delete messages:', error);
      return {
        success: false,
        error: `Failed to delete messages: ${error.message}`
      };
    }
  }
};

export const pinMessage: Action = {
  id: 'pin_message',
  category: 'message',
  name: 'Pin Message',
  description: 'Pin a message to the channel',
  examples: ['pin that message', 'pin this', 'pin the message above'],
  requiredPermissions: [PermissionFlagsBits.ManageMessages],
  canUndo: true,
  undoAction: 'unpin_message',
  bulkCapable: false,
  parameters: [
    {
      name: 'message_id',
      type: 'message',
      required: true,
      description: 'The message to pin'
    }
  ],
  execute: async (context: ActionContext): Promise<ActionResult> => {
    try {
      const messageId = context.parameters.message_id;
      const channel = context.message.channel as TextChannel;

      const targetMessage = await channel.messages.fetch(messageId);
      await targetMessage.pin();

      await context.auditLogger.log({
        type: 'moderation_action',
        guildId: context.message.guild!.id,
        guildName: context.message.guild!.name,
        actorId: context.executor.id,
        actorName: context.executor.user.username,
        actorType: 'moderator',
        action: 'pin_message',
        details: { messageId, content: targetMessage.content.substring(0, 100) },
        success: true,
        channelId: channel.id,
        messageId: context.message.id
      });

      return {
        success: true,
        message: 'Message pinned',
        canUndo: true,
        undoData: { message_id: messageId }
      };
    } catch (error: any) {
      logger.error('Failed to pin message:', error);
      return {
        success: false,
        error: `Failed to pin message: ${error.message}`
      };
    }
  }
};

export const unpinMessage: Action = {
  id: 'unpin_message',
  category: 'message',
  name: 'Unpin Message',
  description: 'Unpin a pinned message',
  examples: ['unpin that message', 'unpin this', 'remove pin'],
  requiredPermissions: [PermissionFlagsBits.ManageMessages],
  canUndo: true,
  undoAction: 'pin_message',
  bulkCapable: false,
  parameters: [
    {
      name: 'message_id',
      type: 'message',
      required: true,
      description: 'The message to unpin'
    }
  ],
  execute: async (context: ActionContext): Promise<ActionResult> => {
    try {
      const messageId = context.parameters.message_id;
      const channel = context.message.channel as TextChannel;

      const targetMessage = await channel.messages.fetch(messageId);
      await targetMessage.unpin();

      await context.auditLogger.log({
        type: 'moderation_action',
        guildId: context.message.guild!.id,
        guildName: context.message.guild!.name,
        actorId: context.executor.id,
        actorName: context.executor.user.username,
        actorType: 'moderator',
        action: 'unpin_message',
        details: { messageId },
        success: true,
        channelId: channel.id,
        messageId: context.message.id
      });

      return {
        success: true,
        message: 'Message unpinned',
        canUndo: true,
        undoData: { message_id: messageId }
      };
    } catch (error: any) {
      logger.error('Failed to unpin message:', error);
      return {
        success: false,
        error: `Failed to unpin message: ${error.message}`
      };
    }
  }
};

// Export all message actions
export const messageActions = [
  deleteMessage,
  bulkDeleteMessages,
  pinMessage,
  unpinMessage
];
