/**
 * ADD ROLE TOOL
 *
 * Adds a role to a user.
 * Role can be specified or selected from available roles in the server.
 */

import { BecasTool, BecasContext, BecasToolResult, BecasMissingParam } from '../../types/BecasFlow.types';
import { PermissionFlagsBits } from 'discord.js';
import { createLogger } from '../../../services/Logger';

const logger = createLogger('AddRoleTool');

export const addRoleTool: BecasTool = {
  name: 'add_role',
  description: 'Add a role to a user',
  category: 'moderation',

  parameters: {
    userId: {
      type: 'userId',
      description: 'The ID of the user to add the role to',
      required: true,
    },
    roleId: {
      type: 'roleId',
      description: 'The ID of the role to add',
      required: true,
    },
    reason: {
      type: 'string',
      description: 'Reason for adding the role',
      required: false,
      default: 'No reason provided',
    },
  },

  detectMissing: (params: any, context: BecasContext): BecasMissingParam | null => {
    // Check userId
    if (!params.userId) {
      if (context.lastUsers && context.lastUsers.length === 1) {
        params.userId = context.lastUsers[0];
      } else if (context.lastUsers && context.lastUsers.length > 1) {
        return {
          param: 'userId',
          prompt: 'Which user would you like to add a role to?',
          type: 'select',
          options: context.lastUsers.map((id) => ({
            label: id,
            value: id,
          })),
        };
      } else {
        return {
          param: 'userId',
          prompt: 'Enter the user ID or @mention the user to add a role to',
          type: 'text',
        };
      }
    }

    // Check roleId
    if (!params.roleId) {
      try {
        const roles = context.guild.roles.cache
          .filter((role) => role.id !== context.guild.id) // Exclude @everyone role
          .sort((a, b) => b.position - a.position);

        if (roles.size === 0) {
          return {
            param: 'roleId',
            prompt: 'No roles available to add',
            type: 'text',
          };
        }

        return {
          param: 'roleId',
          prompt: 'Select a role to add',
          type: 'select',
          options: roles.map((role) => ({
            label: `${role.name} (Position: ${role.position})`,
            value: role.id,
          })),
        };
      } catch (error) {
        return {
          param: 'roleId',
          prompt: 'Enter the role ID',
          type: 'text',
        };
      }
    }

    return null;
  },

  async execute(params: any, context: BecasContext): Promise<BecasToolResult> {
    const startTime = Date.now();

    try {
      const { userId, roleId, reason } = params;

      logger.info(`Attempting to add role ${roleId} to user ${userId}`);

      // Permission check
      if (!context.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
        return {
          success: false,
          error: 'You do not have permission to manage roles',
        };
      }

      // Get member
      let member;
      try {
        member = await context.guild.members.fetch(userId);
      } catch (error) {
        return {
          success: false,
          error: 'User not found in this server',
        };
      }

      // Get role
      let role;
      try {
        role = await context.guild.roles.fetch(roleId);
      } catch (error) {
        return {
          success: false,
          error: 'Role not found in this server',
        };
      }

      if (!role) {
        return {
          success: false,
          error: 'Role not found in this server',
        };
      }

      // Check role hierarchy - user's highest role must be higher than the role being added
      if (context.member.roles.highest.position <= role.position) {
        return {
          success: false,
          error: 'Cannot add this role (role hierarchy)',
        };
      }

      // Check if member already has the role
      if (member.roles.cache.has(roleId)) {
        return {
          success: false,
          error: 'User already has this role',
        };
      }

      // Add the role
      await member.roles.add(role, `${reason} | By: ${context.member.user.tag}`);

      logger.info(`Successfully added role ${roleId} to user ${userId}`);

      // Record to V3
      if (context.services.v3Integration) {
        try {
          await context.services.v3Integration.recordAction({
            type: 'add_role',
            targetUserId: userId,
            targetUsername: member.user.tag,
            targetRoleId: roleId,
            targetRoleName: role.name,
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
          userId,
          username: member.user.tag,
          roleId,
          roleName: role.name,
          reason,
          executedBy: context.member.user.tag,
          executedAt: new Date().toISOString(),
        },
        metadata: {
          executionTime,
          affectedUsers: [userId],
          nextSuggestedTool: 'check_trust',
        },
      };
    } catch (error) {
      logger.error('Error executing add_role:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  canChainTo: ['check_trust', 'timeout', 'warn'],
  requiresConfirmation: true,
  confirmationMessage: (params) =>
    `Add role <@&${params.roleId}> to user <@${params.userId}>?\nReason: ${params.reason || 'No reason'}`,

  preconditions: [
    {
      type: 'custom',
      field: 'member',
      customFn: (context) => context.member.permissions.has(PermissionFlagsBits.ManageRoles),
      message: 'User must have MANAGE_ROLES permission',
    },
  ],
};
