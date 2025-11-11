/**
 * REMOVE ROLE TOOL
 *
 * Removes a role from a user.
 * Role can be specified or selected from roles the user currently has.
 */

import { BecasTool, BecasContext, BecasToolResult, BecasMissingParam } from '../../types/BecasFlow.types';
import { PermissionFlagsBits } from 'discord.js';
import { createLogger } from '../../../services/Logger';

const logger = createLogger('RemoveRoleTool');

export const removeRoleTool: BecasTool = {
  name: 'remove_role',
  description: 'Remove a role from a user',
  category: 'moderation',

  parameters: {
    userId: {
      type: 'userId',
      description: 'The ID of the user to remove the role from',
      required: true,
    },
    roleId: {
      type: 'roleId',
      description: 'The ID of the role to remove',
      required: true,
    },
    reason: {
      type: 'string',
      description: 'Reason for removing the role',
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
          prompt: 'Which user would you like to remove a role from?',
          type: 'select',
          options: context.lastUsers.map((id) => ({
            label: id,
            value: id,
          })),
        };
      } else {
        return {
          param: 'userId',
          prompt: 'Enter the user ID or @mention the user to remove a role from',
          type: 'text',
        };
      }
    }

    // Check roleId
    if (!params.roleId) {
      try {
        // Fetch the member to get their roles
        context.guild.members.fetch(params.userId).then((member) => {
          const userRoles = member.roles.cache
            .filter((role) => role.id !== context.guild.id) // Exclude @everyone role
            .sort((a, b) => b.position - a.position);

          if (userRoles.size === 0) {
            return {
              param: 'roleId',
              prompt: 'User has no roles to remove',
              type: 'text',
            };
          }
        }).catch(() => {
          // If member fetch fails, show all server roles
          const roles = context.guild.roles.cache
            .filter((role) => role.id !== context.guild.id)
            .sort((a, b) => b.position - a.position);

          if (roles.size === 0) {
            return {
              param: 'roleId',
              prompt: 'No roles available',
              type: 'text',
            };
          }
        });

        const roles = context.guild.roles.cache
          .filter((role) => role.id !== context.guild.id)
          .sort((a, b) => b.position - a.position);

        if (roles.size === 0) {
          return {
            param: 'roleId',
            prompt: 'No roles available to remove',
            type: 'text',
          };
        }

        return {
          param: 'roleId',
          prompt: 'Select a role to remove',
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

      logger.info(`Attempting to remove role ${roleId} from user ${userId}`);

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

      // Check role hierarchy - user's highest role must be higher than the role being removed
      if (context.member.roles.highest.position <= role.position) {
        return {
          success: false,
          error: 'Cannot remove this role (role hierarchy)',
        };
      }

      // Check if member has the role
      if (!member.roles.cache.has(roleId)) {
        return {
          success: false,
          error: 'User does not have this role',
        };
      }

      // Remove the role
      await member.roles.remove(role, `${reason} | By: ${context.member.user.tag}`);

      logger.info(`Successfully removed role ${roleId} from user ${userId}`);

      // Record to V3
      if (context.services.v3Integration) {
        try {
          await context.services.v3Integration.recordAction({
            type: 'remove_role',
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
      logger.error('Error executing remove_role:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  canChainTo: ['check_trust', 'timeout', 'warn'],
  requiresConfirmation: true,
  confirmationMessage: (params) =>
    `Remove role <@&${params.roleId}> from user <@${params.userId}>?\nReason: ${params.reason || 'No reason'}`,

  preconditions: [
    {
      type: 'custom',
      field: 'member',
      customFn: (context) => context.member.permissions.has(PermissionFlagsBits.ManageRoles),
      message: 'User must have MANAGE_ROLES permission',
    },
  ],
};
