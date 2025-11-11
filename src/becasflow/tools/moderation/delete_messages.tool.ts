/**
 * DELETE MESSAGES TOOL
 *
 * Bulk deletes messages from a channel based on various criteria.
 * Can delete by user, content pattern, time range, or count.
 */

import { BecasTool, BecasContext, BecasToolResult, BecasMissingParam } from '../../types/BecasFlow.types';
import { PermissionFlagsBits, Message, Collection, TextChannel } from 'discord.js';
import { createLogger } from '../../../services/Logger';

const logger = createLogger('DeleteMessagesTool');

export const deleteMessagesTool: BecasTool = {
  name: 'delete_messages',
  description: 'Bulk delete messages from a channel based on criteria',
  category: 'moderation',

  parameters: {
    count: {
      type: 'number',
      description: 'Number of messages to delete (1-100)',
      required: false,
      default: 10,
    },
    userId: {
      type: 'userId',
      description: 'Only delete messages from this user',
      required: false,
    },
    pattern: {
      type: 'string',
      description: 'Only delete messages containing this text/pattern',
      required: false,
    },
    olderThan: {
      type: 'number',
      description: 'Only delete messages older than X minutes',
      required: false,
    },
    channelId: {
      type: 'channelId',
      description: 'Channel to delete from (defaults to current)',
      required: false,
    },
    reason: {
      type: 'string',
      description: 'Reason for deletion',
      required: false,
      default: 'Bulk message deletion',
    },
  },

  detectMissing: (params: any, context: BecasContext): BecasMissingParam | null => {
    // Auto-set channelId to current if not specified
    if (!params.channelId) {
      params.channelId = context.channel.id;
    }

    // If no criteria specified, ask for count
    if (!params.count && !params.userId && !params.pattern && !params.olderThan) {
      return {
        param: 'count',
        prompt: 'How many messages should I delete?',
        type: 'select',
        options: [
          { label: '10 messages', value: 10 },
          { label: '25 messages', value: 25 },
          { label: '50 messages', value: 50 },
          { label: '100 messages', value: 100 },
        ],
      };
    }

    return null;
  },

  async execute(params: any, context: BecasContext): Promise<BecasToolResult> {
    const startTime = Date.now();

    try {
      const { count, userId, pattern, olderThan, channelId, reason } = params;

      logger.info(`Deleting messages from channel ${channelId}`);

      // Permission check
      if (!context.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
        return {
          success: false,
          error: 'You do not have permission to manage messages',
        };
      }

      // Get channel
      let channel: TextChannel;
      try {
        const fetchedChannel = await context.guild.channels.fetch(channelId);
        if (!fetchedChannel || !fetchedChannel.isTextBased()) {
          return {
            success: false,
            error: 'Invalid text channel',
          };
        }
        channel = fetchedChannel as TextChannel;
      } catch (error) {
        return {
          success: false,
          error: 'Channel not found',
        };
      }

      // Fetch messages
      const fetchLimit = Math.min(count || 100, 100);
      let messages: Collection<string, Message>;

      try {
        messages = await channel.messages.fetch({ limit: fetchLimit });
      } catch (error) {
        return {
          success: false,
          error: 'Failed to fetch messages',
        };
      }

      // Filter messages based on criteria
      let filteredMessages = Array.from(messages.values());

      // Filter by user
      if (userId) {
        filteredMessages = filteredMessages.filter((m) => m.author.id === userId);
      }

      // Filter by pattern
      if (pattern) {
        const regex = new RegExp(pattern, 'i');
        filteredMessages = filteredMessages.filter((m) => regex.test(m.content));
      }

      // Filter by age
      if (olderThan) {
        const cutoffTime = Date.now() - olderThan * 60 * 1000;
        filteredMessages = filteredMessages.filter((m) => m.createdTimestamp < cutoffTime);
      }

      // Discord has a 14-day limit for bulk delete
      const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
      const bulkDeletable = filteredMessages.filter((m) => m.createdTimestamp > twoWeeksAgo);
      const oldMessages = filteredMessages.filter((m) => m.createdTimestamp <= twoWeeksAgo);

      logger.info(`Found ${bulkDeletable.length} messages to bulk delete, ${oldMessages.length} old messages`);

      // Bulk delete (max 100 at a time)
      const deletedIds: string[] = [];

      if (bulkDeletable.length > 0) {
        try {
          const deleted = await channel.bulkDelete(bulkDeletable, true);
          deletedIds.push(...deleted.keys());
        } catch (error) {
          logger.warn('Bulk delete failed:', error);
          // Fall back to individual deletion
          for (const msg of bulkDeletable) {
            try {
              await msg.delete();
              deletedIds.push(msg.id);
            } catch (e) {
              logger.warn(`Failed to delete message ${msg.id}:`, e);
            }
          }
        }
      }

      // Delete old messages individually (slower)
      for (const msg of oldMessages.slice(0, 10)) { // Limit to 10 old messages
        try {
          await msg.delete();
          deletedIds.push(msg.id);
        } catch (e) {
          logger.warn(`Failed to delete old message ${msg.id}:`, e);
        }
      }

      logger.info(`Successfully deleted ${deletedIds.length} messages`);

      // Record to V3
      if (context.services.v3Integration) {
        try {
          await context.services.v3Integration.recordAction({
            type: 'delete',
            targetUserId: userId || 'bulk',
            targetUsername: userId ? `User ${userId}` : 'Bulk deletion',
            executedBy: context.member.id,
            executedByName: context.member.user.tag,
            reason,
            guildId: context.guild.id,
            channelId: channel.id,
            messageId: context.message.id,
          });
        } catch (error) {
          logger.warn('Failed to record action to V3:', error);
        }
      }

      const executionTime = Date.now() - startTime;

      // Get unique user IDs from deleted messages
      const affectedUserIds = [...new Set(
        filteredMessages
          .filter((m) => deletedIds.includes(m.id))
          .map((m) => m.author.id)
      )];

      return {
        success: true,
        data: {
          deletedCount: deletedIds.length,
          requestedCount: count || filteredMessages.length,
          channelId: channel.id,
          channelName: channel.name,
          criteria: {
            userId,
            pattern,
            olderThan,
          },
          affectedUsers: affectedUserIds,
          deletedMessages: deletedIds,
          oldMessagesSkipped: oldMessages.length - Math.min(oldMessages.length, 10),
        },
        metadata: {
          executionTime,
          affectedMessages: deletedIds,
          affectedUsers: affectedUserIds,
          nextSuggestedTool: userId ? 'check_trust' : undefined,
        },
      };
    } catch (error) {
      logger.error('Error deleting messages:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  canChainTo: ['check_trust', 'warn', 'timeout'],
  requiresConfirmation: true,
  confirmationMessage: (params) => {
    const parts = [`Delete messages from <#${params.channelId || 'current channel'}>`];
    if (params.count) parts.push(`Count: ${params.count}`);
    if (params.userId) parts.push(`User: <@${params.userId}>`);
    if (params.pattern) parts.push(`Pattern: "${params.pattern}"`);
    if (params.olderThan) parts.push(`Older than: ${params.olderThan} minutes`);
    return parts.join('\n');
  },

  preconditions: [
    {
      type: 'custom',
      field: 'member',
      customFn: (context) => context.member.permissions.has(PermissionFlagsBits.ManageMessages),
      message: 'User must have MANAGE_MESSAGES permission',
    },
  ],
};
