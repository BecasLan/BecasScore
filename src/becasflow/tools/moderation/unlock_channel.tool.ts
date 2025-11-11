/**
 * UNLOCK CHANNEL TOOL
 *
 * Unlocks a channel by removing SEND_MESSAGES permission override for @everyone role.
 * This allows regular users to send messages again.
 */

import { BecasTool, BecasContext, BecasToolResult, BecasMissingParam } from '../../types/BecasFlow.types';
import { PermissionFlagsBits, TextChannel } from 'discord.js';
import { createLogger } from '../../../services/Logger';

const logger = createLogger('UnlockChannelTool');

export const unlockChannelTool: BecasTool = {
  name: 'unlock_channel',
  description: 'Unlock a channel to allow users to send messages',
  category: 'moderation',

  parameters: {
    channelId: {
      type: 'channelId',
      description: 'The ID of the channel to unlock',
      required: true,
    },
    reason: {
      type: 'string',
      description: 'Reason for unlocking the channel',
      required: false,
      default: 'No reason provided',
    },
  },

  detectMissing: (params: any, context: BecasContext): BecasMissingParam | null => {
    // Check channelId
    if (!params.channelId) {
      if (context.lastChannels && context.lastChannels.length === 1) {
        params.channelId = context.lastChannels[0];
      } else if (context.lastChannels && context.lastChannels.length > 1) {
        return {
          param: 'channelId',
          prompt: 'Which channel would you like to unlock?',
          type: 'select',
          options: context.lastChannels.map((id) => ({
            label: id,
            value: id,
          })),
        };
      } else {
        // Default to current channel
        params.channelId = context.channel.id;
      }
    }

    return null;
  },

  async execute(params: any, context: BecasContext): Promise<BecasToolResult> {
    const startTime = Date.now();

    try {
      const { channelId, reason } = params;

      logger.info(`Attempting to unlock channel ${channelId}`);

      // Permission check
      if (!context.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return {
          success: false,
          error: 'You do not have permission to manage channels',
        };
      }

      // Get channel
      let channel;
      try {
        channel = await context.guild.channels.fetch(channelId);
      } catch (error) {
        return {
          success: false,
          error: 'Channel not found in this server',
        };
      }

      // Check if channel is a text channel
      if (!channel?.isTextBased() || !(channel instanceof TextChannel)) {
        return {
          success: false,
          error: 'This command only works on text channels',
        };
      }

      // Unlock the channel by allowing SEND_MESSAGES for @everyone (or null to remove override)
      const everyoneRole = context.guild.roles.everyone;
      await channel.permissionOverwrites.edit(everyoneRole, {
        SendMessages: null,  // Remove the override, reverting to role defaults
      }, {
        reason: `${reason} | By: ${context.member.user.tag}`,
      });

      logger.info(`Successfully unlocked channel ${channelId}`);

      // Record to V3
      if (context.services.v3Integration) {
        try {
          await context.services.v3Integration.recordAction({
            type: 'unlock_channel',
            targetChannelId: channelId,
            targetChannelName: channel.name,
            executedBy: context.member.id,
            executedByName: context.member.user.tag,
            reason,
            guildId: context.guild.id,
            channelId: context.channel.id,
            messageId: context.message.id,
          });
        } catch (error) {
          logger.warn('Failed to record action to V3:', error);
        }
      }

      const executionTime = Date.now() - startTime;

      return {
        success: true,
        data: {
          channelId,
          channelName: channel.name,
          reason,
          executedBy: context.member.user.tag,
          executedAt: new Date().toISOString(),
        },
        metadata: {
          executionTime,
          nextSuggestedTool: 'set_slowmode',
        },
      };
    } catch (error) {
      logger.error('Error executing unlock_channel:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  canChainTo: ['set_slowmode', 'lock_channel'],
  requiresConfirmation: false,  // Unlocking is less destructive, no confirmation needed

  preconditions: [
    {
      type: 'custom',
      field: 'member',
      customFn: (context) => context.member.permissions.has(PermissionFlagsBits.ManageChannels),
      message: 'User must have MANAGE_CHANNELS permission',
    },
  ],
};
