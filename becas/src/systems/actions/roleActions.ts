// actions/roleActions.ts - Role management actions

import { PermissionFlagsBits } from 'discord.js';
import { Action, ActionContext, ActionResult } from '../ActionRegistry';
import { createLogger } from '../../services/Logger';

const logger = createLogger('RoleActions');

// ============================================
// ROLE MANAGEMENT ACTIONS
// ============================================

export const addRole: Action = {
  id: 'add_role',
  category: 'role',
  name: 'Add Role',
  description: 'Add a role to a user',
  examples: ['add Muted role to @user', 'give @user the VIP role', 'assign Verified to @user'],
  requiredPermissions: [PermissionFlagsBits.ManageRoles],
  canUndo: true,
  undoAction: 'remove_role',
  bulkCapable: true,
  parameters: [
    {
      name: 'user',
      type: 'user',
      required: true,
      description: 'The user to add role to'
    },
    {
      name: 'role_name',
      type: 'string',
      required: true,
      description: 'Name or ID of the role to add'
    }
  ],
  execute: async (context: ActionContext): Promise<ActionResult> => {
    try {
      const userId = context.parameters.user;
      const roleName = context.parameters.role_name;

      const member = await context.message.guild!.members.fetch(userId);

      // Find role by name or ID
      const role = context.message.guild!.roles.cache.find(r =>
        r.name.toLowerCase() === roleName.toLowerCase() || r.id === roleName
      );

      if (!role) {
        return {
          success: false,
          error: `Role "${roleName}" not found`
        };
      }

      await member.roles.add(role);

      await context.auditLogger.log({
        type: 'moderation_action',
        guildId: context.message.guild!.id,
        guildName: context.message.guild!.name,
        actorId: context.executor.id,
        actorName: context.executor.user.username,
        actorType: 'moderator',
        targetId: userId,
        targetName: member.user.tag,
        action: 'add_role',
        details: { roleName: role.name, roleId: role.id },
        success: true,
        channelId: context.message.channelId,
        messageId: context.message.id
      });

      return {
        success: true,
        message: `Added role ${role.name} to ${member.user.tag}`,
        affectedUsers: [userId],
        canUndo: true,
        undoData: { user: userId, role_name: roleName }
      };
    } catch (error: any) {
      logger.error('Failed to add role:', error);
      return {
        success: false,
        error: `Failed to add role: ${error.message}`
      };
    }
  }
};

export const removeRole: Action = {
  id: 'remove_role',
  category: 'role',
  name: 'Remove Role',
  description: 'Remove a role from a user',
  examples: ['remove Muted role from @user', 'take away VIP from @user', 'remove Verified from @user'],
  requiredPermissions: [PermissionFlagsBits.ManageRoles],
  canUndo: true,
  undoAction: 'add_role',
  bulkCapable: true,
  parameters: [
    {
      name: 'user',
      type: 'user',
      required: true,
      description: 'The user to remove role from'
    },
    {
      name: 'role_name',
      type: 'string',
      required: true,
      description: 'Name or ID of the role to remove'
    }
  ],
  execute: async (context: ActionContext): Promise<ActionResult> => {
    try {
      const userId = context.parameters.user;
      const roleName = context.parameters.role_name;

      const member = await context.message.guild!.members.fetch(userId);

      // Find role by name or ID
      const role = context.message.guild!.roles.cache.find(r =>
        r.name.toLowerCase() === roleName.toLowerCase() || r.id === roleName
      );

      if (!role) {
        return {
          success: false,
          error: `Role "${roleName}" not found`
        };
      }

      await member.roles.remove(role);

      await context.auditLogger.log({
        type: 'moderation_action',
        guildId: context.message.guild!.id,
        guildName: context.message.guild!.name,
        actorId: context.executor.id,
        actorName: context.executor.user.username,
        actorType: 'moderator',
        targetId: userId,
        targetName: member.user.tag,
        action: 'remove_role',
        details: { roleName: role.name, roleId: role.id },
        success: true,
        channelId: context.message.channelId,
        messageId: context.message.id
      });

      return {
        success: true,
        message: `Removed role ${role.name} from ${member.user.tag}`,
        affectedUsers: [userId],
        canUndo: true,
        undoData: { user: userId, role_name: roleName }
      };
    } catch (error: any) {
      logger.error('Failed to remove role:', error);
      return {
        success: false,
        error: `Failed to remove role: ${error.message}`
      };
    }
  }
};

// Export all role actions
export const roleActions = [
  addRole,
  removeRole
];
