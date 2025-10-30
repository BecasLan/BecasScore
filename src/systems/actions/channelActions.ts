// actions/channelActions.ts - Channel management actions

import { PermissionFlagsBits, TextChannel, PermissionOverwriteOptions } from 'discord.js';
import { Action, ActionContext, ActionResult } from '../ActionRegistry';
import { createLogger } from '../../services/Logger';

const logger = createLogger('ChannelActions');

// ============================================
// CHANNEL MANAGEMENT ACTIONS
// ============================================

export const lockChannel: Action = {
  id: 'lock_channel',
  category: 'channel',
  name: 'Lock Channel',
  description: 'Prevent @everyone from sending messages in a channel',
  examples: ['lock this channel', 'lock #general', 'lock the channel'],
  requiredPermissions: [PermissionFlagsBits.ManageChannels],
  canUndo: true,
  undoAction: 'unlock_channel',
  bulkCapable: false,
  parameters: [
    {
      name: 'channel',
      type: 'channel',
      required: false,
      description: 'Channel to lock (defaults to current channel)'
    },
    {
      name: 'reason',
      type: 'string',
      required: false,
      description: 'Reason for locking'
    }
  ],
  execute: async (context: ActionContext): Promise<ActionResult> => {
    try {
      const channel = (context.parameters.channel || context.message.channel) as TextChannel;
      const reason = context.parameters.reason || 'Channel locked by moderator';

      const everyoneRole = context.message.guild!.roles.everyone;

      await channel.permissionOverwrites.edit(everyoneRole, {
        SendMessages: false
      }, { reason });

      await context.auditLogger.log({
        type: 'moderation_action',
        guildId: context.message.guild!.id,
        guildName: context.message.guild!.name,
        actorId: context.executor.id,
        actorName: context.executor.user.username,
        actorType: 'moderator',
        action: 'lock_channel',
        details: { channelName: channel.name, channelId: channel.id, reason },
        success: true,
        channelId: context.message.channelId,
        messageId: context.message.id
      });

      return {
        success: true,
        message: `Locked ${channel.name}`,
        affectedChannels: [channel.id],
        canUndo: true,
        undoData: { channel: channel.id }
      };
    } catch (error: any) {
      logger.error('Failed to lock channel:', error);
      return {
        success: false,
        error: `Failed to lock channel: ${error.message}`
      };
    }
  }
};

export const unlockChannel: Action = {
  id: 'unlock_channel',
  category: 'channel',
  name: 'Unlock Channel',
  description: 'Allow @everyone to send messages in a channel',
  examples: ['unlock this channel', 'unlock #general', 'open the channel'],
  requiredPermissions: [PermissionFlagsBits.ManageChannels],
  canUndo: true,
  undoAction: 'lock_channel',
  bulkCapable: false,
  parameters: [
    {
      name: 'channel',
      type: 'channel',
      required: false,
      description: 'Channel to unlock (defaults to current channel)'
    },
    {
      name: 'reason',
      type: 'string',
      required: false,
      description: 'Reason for unlocking'
    }
  ],
  execute: async (context: ActionContext): Promise<ActionResult> => {
    try {
      const channel = (context.parameters.channel || context.message.channel) as TextChannel;
      const reason = context.parameters.reason || 'Channel unlocked by moderator';

      const everyoneRole = context.message.guild!.roles.everyone;

      await channel.permissionOverwrites.edit(everyoneRole, {
        SendMessages: null  // Reset to default
      }, { reason });

      await context.auditLogger.log({
        type: 'moderation_action',
        guildId: context.message.guild!.id,
        guildName: context.message.guild!.name,
        actorId: context.executor.id,
        actorName: context.executor.user.username,
        actorType: 'moderator',
        action: 'unlock_channel',
        details: { channelName: channel.name, channelId: channel.id, reason },
        success: true,
        channelId: context.message.channelId,
        messageId: context.message.id
      });

      return {
        success: true,
        message: `Unlocked ${channel.name}`,
        affectedChannels: [channel.id],
        canUndo: true,
        undoData: { channel: channel.id }
      };
    } catch (error: any) {
      logger.error('Failed to unlock channel:', error);
      return {
        success: false,
        error: `Failed to unlock channel: ${error.message}`
      };
    }
  }
};

export const setSlowmode: Action = {
  id: 'set_slowmode',
  category: 'channel',
  name: 'Set Slowmode',
  description: 'Set message cooldown in seconds (0 to disable, max 21600 = 6 hours)',
  examples: ['set slowmode to 10 seconds', 'slowmode 30', 'disable slowmode'],
  requiredPermissions: [PermissionFlagsBits.ManageChannels],
  canUndo: true,
  undoAction: 'set_slowmode',
  bulkCapable: false,
  parameters: [
    {
      name: 'seconds',
      type: 'number',
      required: true,
      description: 'Slowmode duration in seconds (0-21600, 0 to disable)',
      validation: { min: 0, max: 21600 }
    },
    {
      name: 'channel',
      type: 'channel',
      required: false,
      description: 'Channel to set slowmode (defaults to current channel)'
    }
  ],
  execute: async (context: ActionContext): Promise<ActionResult> => {
    try {
      const seconds = context.parameters.seconds;
      const channel = (context.parameters.channel || context.message.channel) as TextChannel;

      const oldSlowmode = channel.rateLimitPerUser;

      await channel.setRateLimitPerUser(seconds);

      await context.auditLogger.log({
        type: 'moderation_action',
        guildId: context.message.guild!.id,
        guildName: context.message.guild!.name,
        actorId: context.executor.id,
        actorName: context.executor.user.username,
        actorType: 'moderator',
        action: 'set_slowmode',
        details: {
          channelName: channel.name,
          channelId: channel.id,
          oldSlowmode,
          newSlowmode: seconds
        },
        success: true,
        channelId: context.message.channelId,
        messageId: context.message.id
      });

      return {
        success: true,
        message: seconds === 0
          ? `Disabled slowmode in ${channel.name}`
          : `Set slowmode to ${seconds} seconds in ${channel.name}`,
        affectedChannels: [channel.id],
        canUndo: true,
        undoData: { channel: channel.id, seconds: oldSlowmode }
      };
    } catch (error: any) {
      logger.error('Failed to set slowmode:', error);
      return {
        success: false,
        error: `Failed to set slowmode: ${error.message}`
      };
    }
  }
};

// Export all channel actions
export const channelActions = [
  lockChannel,
  unlockChannel,
  setSlowmode
];
