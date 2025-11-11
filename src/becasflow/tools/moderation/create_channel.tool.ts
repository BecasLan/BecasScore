/**
 * CREATE CHANNEL TOOL
 *
 * Creates a new text or voice channel in the server.
 * Supports category assignment and permission setup.
 */

import { BecasTool, BecasContext, BecasToolResult, BecasMissingParam } from '../../types/BecasFlow.types';
import { PermissionFlagsBits, ChannelType } from 'discord.js';
import { createLogger } from '../../../services/Logger';

const logger = createLogger('CreateChannelTool');

export const createChannelTool: BecasTool = {
  name: 'create_channel',
  description: 'Create a new text or voice channel',
  category: 'moderation',

  parameters: {
    name: {
      type: 'string',
      description: 'The name of the new channel',
      required: true,
    },
    type: {
      type: 'string',
      description: 'Channel type: text or voice',
      required: false,
      default: 'text',
    },
    category: {
      type: 'string',
      description: 'Category ID to place the channel in (optional)',
      required: false,
    },
    reason: {
      type: 'string',
      description: 'Reason for creating the channel',
      required: false,
      default: 'No reason provided',
    },
  },

  detectMissing: (params: any, context: BecasContext): BecasMissingParam | null => {
    // Check name
    if (!params.name) {
      return {
        param: 'name',
        prompt: 'What should the channel be named?',
        type: 'text',
      };
    }

    // Check type (optional but can prompt if needed)
    if (!params.type) {
      params.type = 'text'; // Default to text
    }

    return null;
  },

  async execute(params: any, context: BecasContext): Promise<BecasToolResult> {
    const startTime = Date.now();

    try {
      const { name, type, category, reason } = params;

      logger.info(`Attempting to create ${type} channel: ${name}`);

      // Permission check
      if (!context.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return {
          success: false,
          error: '❌ You do not have permission to manage channels',
        };
      }

      // Validate channel type
      const channelType = type === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText;

      // Create the channel
      const channel = await context.guild.channels.create({
        name: name,
        type: channelType,
        parent: category || null,
        reason: `${reason} | By: ${context.member.user.tag}`,
      });

      logger.info(`Successfully created channel: ${channel.name} (${channel.id})`);

      // Record to V3
      if (context.services.v3Integration) {
        try {
          await context.services.v3Integration.recordAction({
            type: 'create_channel',
            targetChannelId: channel.id,
            targetChannelName: channel.name,
            executedBy: context.member.id,
            executedByName: context.member.user.tag,
            reason,
            channelType: type,
            category: category || 'none',
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
          channelId: channel.id,
          channelName: channel.name,
          channelType: type,
          category: category || 'none',
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
      logger.error('Error executing create_channel:', error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `❌ Failed to create channel: ${errorMsg}`,
      };
    }
  },

  canChainTo: ['lock_channel', 'set_slowmode', 'add_role'],
  requiresConfirmation: false, // Creating channels is usually intentional

  preconditions: [
    {
      type: 'custom',
      field: 'member',
      customFn: (context) => context.member.permissions.has(PermissionFlagsBits.ManageChannels),
      message: 'User must have MANAGE_CHANNELS permission',
    },
  ],
};
