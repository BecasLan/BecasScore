/**
 * SET SLOWMODE TOOL
 *
 * Sets slowmode (rate limit) for a channel.
 * Duration can be specified or selected from common options.
 */

import { BecasTool, BecasContext, BecasToolResult, BecasMissingParam } from '../../types/BecasFlow.types';
import { PermissionFlagsBits, TextChannel } from 'discord.js';
import { createLogger } from '../../../services/Logger';

const logger = createLogger('SetSlowmodeTool');

export const setSlowmodeTool: BecasTool = {
  name: 'set_slowmode',
  description: 'Set slowmode (rate limit) for a channel',
  category: 'moderation',

  parameters: {
    channelId: {
      type: 'channelId',
      description: 'The ID of the channel to set slowmode on',
      required: true,
    },
    duration: {
      type: 'number',
      description: 'Duration in seconds (0-21600, 0 = disabled)',
      required: true,
    },
    reason: {
      type: 'string',
      description: 'Reason for setting slowmode',
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
          prompt: 'Which channel would you like to set slowmode on?',
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

    // Check duration
    if (params.duration === undefined || params.duration === null) {
      return {
        param: 'duration',
        prompt: 'Select slowmode duration',
        type: 'select',
        options: [
          { label: 'Disabled (0 seconds)', value: 0 },
          { label: '5 seconds', value: 5 },
          { label: '10 seconds', value: 10 },
          { label: '15 seconds', value: 15 },
          { label: '30 seconds', value: 30 },
          { label: '1 minute', value: 60 },
          { label: '2 minutes', value: 120 },
          { label: '5 minutes', value: 300 },
          { label: '10 minutes', value: 600 },
          { label: '15 minutes', value: 900 },
          { label: '30 minutes', value: 1800 },
          { label: '1 hour', value: 3600 },
          { label: '2 hours', value: 7200 },
          { label: '6 hours', value: 21600 },
        ],
      };
    }

    return null;
  },

  async execute(params: any, context: BecasContext): Promise<BecasToolResult> {
    const startTime = Date.now();

    try {
      const { channelId, duration, reason } = params;

      logger.info(`Attempting to set slowmode on channel ${channelId} to ${duration}s`);

      // Permission check
      if (!context.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return {
          success: false,
          error: 'You do not have permission to manage channels',
        };
      }

      // Validate duration (0-21600 seconds = 0-6 hours)
      if (duration < 0 || duration > 21600) {
        return {
          success: false,
          error: 'Duration must be between 0 and 21600 seconds (0-6 hours)',
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

      // Execute slowmode
      await channel.setRateLimitPerUser(duration, `${reason} | By: ${context.member.user.tag}`);

      logger.info(`Successfully set slowmode on channel ${channelId} to ${duration}s`);

      // Record to V3
      if (context.services.v3Integration) {
        try {
          await context.services.v3Integration.recordAction({
            type: 'set_slowmode',
            targetChannelId: channelId,
            targetChannelName: channel.name,
            executedBy: context.member.id,
            executedByName: context.member.user.tag,
            reason,
            duration,
            guildId: context.guild.id,
            channelId: context.channel.id,
            messageId: context.message.id,
          });
        } catch (error) {
          logger.warn('Failed to record action to V3:', error);
        }
      }

      const executionTime = Date.now() - startTime;

      // Format duration for display
      const durationText = this.formatDuration(duration);

      return {
        success: true,
        data: {
          channelId,
          channelName: channel.name,
          duration,
          durationText,
          reason,
          executedBy: context.member.user.tag,
          executedAt: new Date().toISOString(),
        },
        metadata: {
          executionTime,
          affectedUsers: [], // Affects all users but not tracking individually
          nextSuggestedTool: duration > 0 ? 'unlock_channel' : undefined,
        },
      };
    } catch (error) {
      logger.error('Error executing set_slowmode:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  canChainTo: ['lock_channel', 'unlock_channel'],
  requiresConfirmation: true,
  confirmationMessage: (params) =>
    `Set slowmode on <#${params.channelId}>?\nDuration: ${(setSlowmodeTool as any).formatDuration(params.duration)}\nReason: ${params.reason || 'No reason'}`,

  preconditions: [
    {
      type: 'custom',
      field: 'member',
      customFn: (context) => context.member.permissions.has(PermissionFlagsBits.ManageChannels),
      message: 'User must have MANAGE_CHANNELS permission',
    },
  ],
};

// Helper function to format duration
(setSlowmodeTool as any).formatDuration = (seconds: number): string => {
  if (seconds === 0) return 'Disabled';

  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    if (remainingMinutes > 0) {
      return `${hours} hour${hours !== 1 ? 's' : ''} ${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''}`;
    }
    return `${hours} hour${hours !== 1 ? 's' : ''}`;
  }

  if (minutes > 0) {
    const remainingSeconds = seconds % 60;
    if (remainingSeconds > 0) {
      return `${minutes} minute${minutes !== 1 ? 's' : ''} ${remainingSeconds} second${remainingSeconds !== 1 ? 's' : ''}`;
    }
    return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
  }

  return `${seconds} second${seconds !== 1 ? 's' : ''}`;
};
