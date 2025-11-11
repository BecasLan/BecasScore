// actions/userActions.ts - User-related Discord actions

import { PermissionFlagsBits, GuildMember } from 'discord.js';
import { Action, ActionContext, ActionResult } from '../ActionRegistry';
import { createLogger } from '../../services/Logger';

const logger = createLogger('UserActions');

// ============================================
// USER MODERATION ACTIONS
// ============================================

export const timeoutUser: Action = {
  id: 'timeout',
  category: 'user',
  name: 'Timeout User',
  description: 'Timeout (mute) a user for a specified duration',
  examples: ['timeout @user for 10 minutes', 'mute @user 1 hour', 'timeout @user'],
  requiredPermissions: [PermissionFlagsBits.ModerateMembers],
  canUndo: true,
  undoAction: 'untimeout',
  bulkCapable: true,
  parameters: [
    {
      name: 'user',
      type: 'user',
      required: true,
      description: 'The user to timeout'
    },
    {
      name: 'duration_minutes',
      type: 'number',
      required: false,
      description: 'Duration in minutes (default: 10, max: 40320 = 28 days)',
      default: 10,
      validation: { min: 1, max: 40320 }
    },
    {
      name: 'reason',
      type: 'string',
      required: false,
      description: 'Reason for timeout'
    }
  ],
  execute: async (context: ActionContext): Promise<ActionResult> => {
    try {
      const userId = context.parameters.user;
      const durationMinutes = context.parameters.duration_minutes || 10;
      const reason = context.parameters.reason || 'Moderator timeout';

      const member = await context.message.guild!.members.fetch(userId);
      const durationMs = durationMinutes * 60000;

      if (!member.moderatable) {
        return {
          success: false,
          error: 'Cannot timeout this user (insufficient permissions or higher role)'
        };
      }

      await member.timeout(durationMs, reason);

      // Update trust score
      const analyzed = {
        id: context.message.id,
        content: 'timeout_action',
        authorId: userId,
        authorName: member.user.username,
        guildId: context.message.guild!.id,
        channelId: context.message.channelId,
        timestamp: new Date(),
        mentions: [],
        attachments: [],
        sentiment: { positive: 0, negative: 1, neutral: 0, dominant: 'negative' as const, emotions: [] },
        intent: { type: 'statement' as const, primary: 'statement', confidence: 1, entities: [] },
        hierarchy: 'peer' as const,
        toxicity: 0,
        manipulation: 0
      };
      await context.trustEngine.updateFromMessage(analyzed as any);

      // Audit log
      await context.auditLogger.log({
        type: 'command_executed',
        guildId: context.message.guild!.id,
        guildName: context.message.guild!.name,
        actorId: context.executor.id,
        actorName: context.executor.user.username,
        actorType: 'moderator',
        targetId: userId,
        targetName: member.user.tag,
        action: 'timeout',
        details: { duration: durationMinutes, durationMs, reason },
        success: true,
        channelId: context.message.channelId,
        messageId: context.message.id
      });

      return {
        success: true,
        message: `Timed out ${member.user.tag} for ${durationMinutes} minutes`,
        affectedUsers: [userId],
        canUndo: true,
        undoData: { user: userId }
      };
    } catch (error: any) {
      logger.error('Failed to timeout user:', error);
      return {
        success: false,
        error: `Failed to timeout user: ${error.message}`
      };
    }
  }
};

export const untimeoutUser: Action = {
  id: 'untimeout',
  category: 'user',
  name: 'Remove Timeout',
  description: 'Remove timeout from a user',
  examples: ['untimeout @user', 'remove timeout from @user', 'unmute @user'],
  requiredPermissions: [PermissionFlagsBits.ModerateMembers],
  canUndo: false,
  bulkCapable: true,
  parameters: [
    {
      name: 'user',
      type: 'user',
      required: true,
      description: 'The user to untimeout'
    },
    {
      name: 'reason',
      type: 'string',
      required: false,
      description: 'Reason for removing timeout'
    }
  ],
  execute: async (context: ActionContext): Promise<ActionResult> => {
    try {
      const userId = context.parameters.user;
      const reason = context.parameters.reason || 'Timeout removed by moderator';

      const member = await context.message.guild!.members.fetch(userId);

      if (!member.moderatable) {
        return {
          success: false,
          error: 'Cannot untimeout this user (insufficient permissions)'
        };
      }

      await member.timeout(null, reason);

      await context.auditLogger.log({
        type: 'command_executed',
        guildId: context.message.guild!.id,
        guildName: context.message.guild!.name,
        actorId: context.executor.id,
        actorName: context.executor.user.username,
        actorType: 'moderator',
        targetId: userId,
        targetName: member.user.tag,
        action: 'untimeout',
        details: { reason },
        success: true,
        channelId: context.message.channelId,
        messageId: context.message.id
      });

      return {
        success: true,
        message: `Removed timeout from ${member.user.tag}`,
        affectedUsers: [userId]
      };
    } catch (error: any) {
      logger.error('Failed to untimeout user:', error);
      return {
        success: false,
        error: `Failed to untimeout user: ${error.message}`
      };
    }
  }
};

export const banUser: Action = {
  id: 'ban',
  category: 'user',
  name: 'Ban User',
  description: 'Ban a user from the server',
  examples: ['ban @user', 'ban @user for spamming', 'permanently ban @user'],
  requiredPermissions: [PermissionFlagsBits.BanMembers],
  canUndo: true,
  undoAction: 'unban',
  bulkCapable: true,
  parameters: [
    {
      name: 'user',
      type: 'user',
      required: true,
      description: 'The user to ban'
    },
    {
      name: 'reason',
      type: 'string',
      required: false,
      description: 'Reason for ban'
    },
    {
      name: 'delete_messages_days',
      type: 'number',
      required: false,
      description: 'Delete messages from last N days (0-7)',
      default: 0,
      validation: { min: 0, max: 7 }
    }
  ],
  execute: async (context: ActionContext): Promise<ActionResult> => {
    try {
      const userId = context.parameters.user;
      const reason = context.parameters.reason || 'Banned by moderator';
      const deleteMessageDays = context.parameters.delete_messages_days || 0;

      const member = await context.message.guild!.members.fetch(userId);

      if (!member.bannable) {
        return {
          success: false,
          error: 'Cannot ban this user (insufficient permissions or higher role)'
        };
      }

      await member.ban({
        reason,
        deleteMessageSeconds: deleteMessageDays * 86400
      });

      await context.auditLogger.log({
        type: 'command_executed',
        guildId: context.message.guild!.id,
        guildName: context.message.guild!.name,
        actorId: context.executor.id,
        actorName: context.executor.user.username,
        actorType: 'moderator',
        targetId: userId,
        targetName: member.user.tag,
        action: 'ban',
        details: { reason, deleteMessageDays },
        success: true,
        channelId: context.message.channelId,
        messageId: context.message.id
      });

      return {
        success: true,
        message: `Banned ${member.user.tag}`,
        affectedUsers: [userId],
        canUndo: true,
        undoData: { user: userId }
      };
    } catch (error: any) {
      logger.error('Failed to ban user:', error);
      return {
        success: false,
        error: `Failed to ban user: ${error.message}`
      };
    }
  }
};

export const unbanUser: Action = {
  id: 'unban',
  category: 'user',
  name: 'Unban User',
  description: 'Remove a ban from a user',
  examples: ['unban @user', 'unban 123456789', 'remove ban from @user'],
  requiredPermissions: [PermissionFlagsBits.BanMembers],
  canUndo: false,
  bulkCapable: false,
  parameters: [
    {
      name: 'user',
      type: 'user',
      required: true,
      description: 'The user ID to unban'
    },
    {
      name: 'reason',
      type: 'string',
      required: false,
      description: 'Reason for unbanning'
    }
  ],
  execute: async (context: ActionContext): Promise<ActionResult> => {
    try {
      const userId = context.parameters.user;
      const reason = context.parameters.reason || 'Unbanned by moderator';

      await context.message.guild!.members.unban(userId, reason);

      await context.auditLogger.log({
        type: 'command_executed',
        guildId: context.message.guild!.id,
        guildName: context.message.guild!.name,
        actorId: context.executor.id,
        actorName: context.executor.user.username,
        actorType: 'moderator',
        targetId: userId,
        targetName: userId,
        action: 'unban',
        details: { reason },
        success: true,
        channelId: context.message.channelId,
        messageId: context.message.id
      });

      return {
        success: true,
        message: `Unbanned user ${userId}`,
        affectedUsers: [userId]
      };
    } catch (error: any) {
      logger.error('Failed to unban user:', error);
      return {
        success: false,
        error: `Failed to unban user: ${error.message}`
      };
    }
  }
};

export const kickUser: Action = {
  id: 'kick',
  category: 'user',
  name: 'Kick User',
  description: 'Kick a user from the server (they can rejoin)',
  examples: ['kick @user', 'kick @user for breaking rules'],
  requiredPermissions: [PermissionFlagsBits.KickMembers],
  canUndo: false,
  bulkCapable: true,
  parameters: [
    {
      name: 'user',
      type: 'user',
      required: true,
      description: 'The user to kick'
    },
    {
      name: 'reason',
      type: 'string',
      required: false,
      description: 'Reason for kick'
    }
  ],
  execute: async (context: ActionContext): Promise<ActionResult> => {
    try {
      const userId = context.parameters.user;
      const reason = context.parameters.reason || 'Kicked by moderator';

      const member = await context.message.guild!.members.fetch(userId);

      if (!member.kickable) {
        return {
          success: false,
          error: 'Cannot kick this user (insufficient permissions or higher role)'
        };
      }

      await member.kick(reason);

      await context.auditLogger.log({
        type: 'command_executed',
        guildId: context.message.guild!.id,
        guildName: context.message.guild!.name,
        actorId: context.executor.id,
        actorName: context.executor.user.username,
        actorType: 'moderator',
        targetId: userId,
        targetName: member.user.tag,
        action: 'kick',
        details: { reason },
        success: true,
        channelId: context.message.channelId,
        messageId: context.message.id
      });

      return {
        success: true,
        message: `Kicked ${member.user.tag}`,
        affectedUsers: [userId]
      };
    } catch (error: any) {
      logger.error('Failed to kick user:', error);
      return {
        success: false,
        error: `Failed to kick user: ${error.message}`
      };
    }
  }
};

export const changeNickname: Action = {
  id: 'change_nickname',
  category: 'user',
  name: 'Change Nickname',
  description: 'Change a user\'s server nickname',
  examples: ['change @user nickname to NewName', 'set @user nick to Test', 'rename @user to NewName'],
  requiredPermissions: [PermissionFlagsBits.ManageNicknames],
  canUndo: true,
  undoAction: 'change_nickname',
  bulkCapable: false,
  parameters: [
    {
      name: 'user',
      type: 'user',
      required: true,
      description: 'The user to change nickname for'
    },
    {
      name: 'nickname',
      type: 'string',
      required: true,
      description: 'New nickname (null to remove)'
    }
  ],
  execute: async (context: ActionContext): Promise<ActionResult> => {
    try {
      const userId = context.parameters.user;
      const nickname = context.parameters.nickname;

      const member = await context.message.guild!.members.fetch(userId);
      const oldNickname = member.nickname;

      await member.setNickname(nickname);

      await context.auditLogger.log({
        type: 'moderation_action',
        guildId: context.message.guild!.id,
        guildName: context.message.guild!.name,
        actorId: context.executor.id,
        actorName: context.executor.user.username,
        actorType: 'moderator',
        targetId: userId,
        targetName: member.user.tag,
        action: 'change_nickname',
        details: { oldNickname, newNickname: nickname },
        success: true,
        channelId: context.message.channelId,
        messageId: context.message.id
      });

      return {
        success: true,
        message: `Changed ${member.user.tag}'s nickname to ${nickname || 'default'}`,
        affectedUsers: [userId],
        canUndo: true,
        undoData: { user: userId, nickname: oldNickname }
      };
    } catch (error: any) {
      logger.error('Failed to change nickname:', error);
      return {
        success: false,
        error: `Failed to change nickname: ${error.message}`
      };
    }
  }
};

// Export all user actions
export const userActions = [
  timeoutUser,
  untimeoutUser,
  banUser,
  unbanUser,
  kickUser,
  changeNickname
];
