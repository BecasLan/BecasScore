// ActionCorrection.ts - Correct, modify, and undo actions dynamically
// Enables: "make it longer", "change to 1 hour", "undo that", "try ban instead"

import { Guild, GuildMember } from 'discord.js';
import { ModerationHandler } from './ModerationHandler';
import { OllamaService } from '../services/OllamaService';
import { createLogger } from '../services/Logger';

const logger = createLogger('ActionCorrection');

// ============================================
// TYPES
// ============================================

export interface ExecutedAction {
  actionId: string;
  actionType: string; // 'timeout', 'ban', 'kick', 'warn'
  targetUserId: string;
  targetUserTag: string;
  moderatorId: string;
  guildId: string;
  parameters: Record<string, any>;
  executedAt: number;
  undoable: boolean;
  undone: boolean;
}

export interface CorrectionRequest {
  originalActionId: string;
  newParameters?: Record<string, any>;
  newActionType?: string;
  reason?: string;
}

export interface CorrectionResult {
  success: boolean;
  message: string;
  newActionId?: string;
}

// ============================================
// ACTION CORRECTION ENGINE
// ============================================

export class ActionCorrection {
  private moderation: ModerationHandler;
  private ollama: OllamaService;
  private actionHistory: Map<string, ExecutedAction> = new Map(); // actionId -> action
  private readonly HISTORY_TTL = 15 * 60 * 1000; // 15 minutes

  constructor(moderation: ModerationHandler, ollama: OllamaService) {
    this.moderation = moderation;
    this.ollama = ollama;
    logger.info('ActionCorrection initialized');

    // Cleanup old actions every minute
    setInterval(() => this.cleanupOldActions(), 60000);
  }

  /**
   * Record an executed action for potential correction later
   */
  async recordAction(
    actionType: string,
    targetUserId: string,
    targetUserTag: string,
    moderatorId: string,
    guildId: string,
    parameters: Record<string, any>
  ): Promise<string> {
    const actionId = `${actionType}_${targetUserId}_${Date.now()}`;

    const action: ExecutedAction = {
      actionId,
      actionType,
      targetUserId,
      targetUserTag,
      moderatorId,
      guildId,
      parameters,
      executedAt: Date.now(),
      undoable: ['timeout', 'ban', 'kick'].includes(actionType), // Warns cannot be undone
      undone: false,
    };

    this.actionHistory.set(actionId, action);
    logger.info(`Recorded action: ${actionId} (${actionType} on ${targetUserTag})`);

    return actionId;
  }

  /**
   * Undo the most recent action by a moderator
   */
  async undoLastAction(moderatorId: string, guildId: string, guild: Guild): Promise<CorrectionResult> {
    // Find most recent undoable action by this moderator
    const recentActions = Array.from(this.actionHistory.values())
      .filter(a => a.moderatorId === moderatorId && a.guildId === guildId && a.undoable && !a.undone)
      .sort((a, b) => b.executedAt - a.executedAt);

    if (recentActions.length === 0) {
      return {
        success: false,
        message: 'No recent undoable actions found.',
      };
    }

    const action = recentActions[0];
    return await this.undoAction(action.actionId, guild);
  }

  /**
   * Undo a specific action by ID
   */
  async undoAction(actionId: string, guild: Guild): Promise<CorrectionResult> {
    const action = this.actionHistory.get(actionId);

    if (!action) {
      return {
        success: false,
        message: 'Action not found or too old.',
      };
    }

    if (action.undone) {
      return {
        success: false,
        message: 'Action already undone.',
      };
    }

    if (!action.undoable) {
      return {
        success: false,
        message: `${action.actionType} actions cannot be undone.`,
      };
    }

    try {
      const member = await guild.members.fetch(action.targetUserId);

      switch (action.actionType) {
        case 'timeout':
          await member.timeout(null, 'Action undone by moderator');
          break;

        case 'ban':
          await guild.bans.remove(action.targetUserId, 'Action undone by moderator');
          break;

        case 'kick':
          // Cannot undo kick - user already left
          return {
            success: false,
            message: 'Cannot undo kick - user has already been removed.',
          };

        default:
          return {
            success: false,
            message: `Cannot undo ${action.actionType}.`,
          };
      }

      action.undone = true;
      this.actionHistory.set(actionId, action);

      logger.info(`Undid action: ${actionId} (${action.actionType} on ${action.targetUserTag})`);

      return {
        success: true,
        message: `Undid ${action.actionType} on ${action.targetUserTag}.`,
      };

    } catch (error: any) {
      logger.error(`Failed to undo action ${actionId}:`, error);
      return {
        success: false,
        message: `Failed to undo action: ${error.message}`,
      };
    }
  }

  /**
   * Modify an existing action (e.g., extend timeout duration)
   */
  async modifyAction(
    actionId: string,
    guild: Guild,
    newParameters: Record<string, any>
  ): Promise<CorrectionResult> {
    const action = this.actionHistory.get(actionId);

    if (!action) {
      return {
        success: false,
        message: 'Action not found or too old.',
      };
    }

    if (action.undone) {
      return {
        success: false,
        message: 'Cannot modify an undone action.',
      };
    }

    try {
      const member = await guild.members.fetch(action.targetUserId);

      switch (action.actionType) {
        case 'timeout':
          // Modify timeout duration
          if (newParameters.duration_minutes !== undefined) {
            const newDuration = newParameters.duration_minutes * 60 * 1000;
            await member.timeout(newDuration, newParameters.reason || 'Timeout modified by moderator');

            // Update action record
            action.parameters.duration_minutes = newParameters.duration_minutes;
            if (newParameters.reason) {
              action.parameters.reason = newParameters.reason;
            }
            this.actionHistory.set(actionId, action);

            logger.info(`Modified timeout: ${actionId} to ${newParameters.duration_minutes} minutes`);

            return {
              success: true,
              message: `Modified timeout for ${action.targetUserTag} to ${newParameters.duration_minutes} minutes.`,
              newActionId: actionId,
            };
          }
          break;

        default:
          return {
            success: false,
            message: `Cannot modify ${action.actionType} actions.`,
          };
      }

      return {
        success: false,
        message: 'No valid modifications specified.',
      };

    } catch (error: any) {
      logger.error(`Failed to modify action ${actionId}:`, error);
      return {
        success: false,
        message: `Failed to modify action: ${error.message}`,
      };
    }
  }

  /**
   * Replace an action with a different one (undo + execute new)
   */
  async replaceAction(
    actionId: string,
    guild: Guild,
    newActionType: string,
    newParameters: Record<string, any>
  ): Promise<CorrectionResult> {
    const action = this.actionHistory.get(actionId);

    if (!action) {
      return {
        success: false,
        message: 'Action not found or too old.',
      };
    }

    if (action.undone) {
      return {
        success: false,
        message: 'Cannot replace an undone action.',
      };
    }

    try {
      // Step 1: Undo original action
      const undoResult = await this.undoAction(actionId, guild);
      if (!undoResult.success) {
        return undoResult;
      }

      // Step 2: Execute new action
      const member = await guild.members.fetch(action.targetUserId);
      const reason = newParameters.reason || `Replaced ${action.actionType} with ${newActionType}`;

      switch (newActionType) {
        case 'timeout':
          const duration = (newParameters.duration_minutes || 10) * 60 * 1000;
          await member.timeout(duration, reason);
          break;

        case 'ban':
          await member.ban({ reason });
          break;

        case 'kick':
          await member.kick(reason);
          break;

        case 'warn':
          await member.send(`⚠️ **Warning from Becas**\n\n${reason}`).catch(() => {});
          break;

        default:
          return {
            success: false,
            message: `Unknown action type: ${newActionType}`,
          };
      }

      // Record new action
      const newActionId = await this.recordAction(
        newActionType,
        action.targetUserId,
        action.targetUserTag,
        action.moderatorId,
        action.guildId,
        newParameters
      );

      logger.info(`Replaced action ${actionId} (${action.actionType}) with ${newActionId} (${newActionType})`);

      return {
        success: true,
        message: `Replaced ${action.actionType} with ${newActionType} on ${action.targetUserTag}.`,
        newActionId,
      };

    } catch (error: any) {
      logger.error(`Failed to replace action ${actionId}:`, error);
      return {
        success: false,
        message: `Failed to replace action: ${error.message}`,
      };
    }
  }

  /**
   * Get action history for a moderator
   */
  getModeratorHistory(moderatorId: string, guildId: string): ExecutedAction[] {
    return Array.from(this.actionHistory.values())
      .filter(a => a.moderatorId === moderatorId && a.guildId === guildId)
      .sort((a, b) => b.executedAt - a.executedAt);
  }

  /**
   * Get the most recent action in a channel/guild
   */
  getMostRecentAction(guildId: string): ExecutedAction | undefined {
    const actions = Array.from(this.actionHistory.values())
      .filter(a => a.guildId === guildId && !a.undone)
      .sort((a, b) => b.executedAt - a.executedAt);

    return actions[0];
  }

  /**
   * Cleanup old actions
   */
  private cleanupOldActions(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [actionId, action] of this.actionHistory) {
      if (now - action.executedAt > this.HISTORY_TTL) {
        this.actionHistory.delete(actionId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug(`Cleaned up ${cleaned} old action records`);
    }
  }
}
