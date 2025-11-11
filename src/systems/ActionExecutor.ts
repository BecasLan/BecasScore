// ActionExecutor.ts - Executes actions from the action registry
// Handles validation, permission checks, execution, undo tracking

import { Message, GuildMember } from 'discord.js';
import { ActionRegistry, Action, ActionContext, ActionResult } from './ActionRegistry';
import { AuditLogger } from './AuditLogger';
import { TrustScoreEngineDB } from './TrustScoreEngineDB';
import { createLogger } from '../services/Logger';

const logger = createLogger('ActionExecutor');

// ============================================
// ACTION PLAN
// ============================================

export interface ActionStep {
  action_id: string;
  parameters: Record<string, any>;
  reason?: string;
}

export interface ActionPlan {
  understood_intent: string;
  actions: ActionStep[];
  requires_confirmation: boolean;
  response_to_moderator: string;
}

export interface ExecutionContext {
  message: Message;
  executor: GuildMember;
  plan: ActionPlan;
}

export interface ExecutionResult {
  success: boolean;
  results: ActionResult[];
  error?: string;
  totalAffectedUsers?: number;
  totalAffectedChannels?: number;
}

// ============================================
// UNDO TRACKING
// ============================================

interface TrackedAction {
  action: Action;
  context: ActionContext;
  result: ActionResult;
  timestamp: Date;
  channelId: string;
  executorId: string;
}

// ============================================
// ACTION EXECUTOR
// ============================================

export class ActionExecutor {
  private registry: ActionRegistry;
  private auditLogger: AuditLogger;
  private trustEngine: TrustScoreEngineDB;

  // Track recent actions for undo capability
  private actionHistory: Map<string, TrackedAction[]> = new Map();
  private readonly MAX_HISTORY_PER_CHANNEL = 10;

  constructor(registry: ActionRegistry, auditLogger: AuditLogger, trustEngine: TrustScoreEngineDB) {
    this.registry = registry;
    this.auditLogger = auditLogger;
    this.trustEngine = trustEngine;
    logger.info('ActionExecutor initialized');
  }

  /**
   * Execute an action plan (single or multiple actions)
   */
  async execute(execContext: ExecutionContext): Promise<ExecutionResult> {
    const results: ActionResult[] = [];
    const affectedUsers = new Set<string>();
    const affectedChannels = new Set<string>();

    logger.info(`Executing action plan: ${execContext.plan.understood_intent}`);
    logger.info(`Actions to execute: ${execContext.plan.actions.length}`);

    for (const actionStep of execContext.plan.actions) {
      try {
        // Get action from registry
        const action = this.registry.get(actionStep.action_id);

        if (!action) {
          logger.error(`Action not found: ${actionStep.action_id}`);
          results.push({
            success: false,
            error: `Unknown action: ${actionStep.action_id}`
          });
          continue;
        }

        logger.info(`Executing action: ${action.name} (${action.id})`);

        // Validate permissions
        const hasPermissions = this.validatePermissions(execContext.executor, action);
        if (!hasPermissions.valid) {
          logger.warn(`Permission denied for ${action.id}: ${hasPermissions.error}`);
          results.push({
            success: false,
            error: hasPermissions.error
          });
          continue;
        }

        // Validate parameters
        const paramValidation = this.registry.validateParameters(action, actionStep.parameters);
        if (!paramValidation.valid) {
          logger.error(`Parameter validation failed for ${action.id}: ${paramValidation.errors.join(', ')}`);
          results.push({
            success: false,
            error: `Invalid parameters: ${paramValidation.errors.join(', ')}`
          });
          continue;
        }

        // Create action context
        const actionContext: ActionContext = {
          message: execContext.message,
          executor: execContext.executor,
          parameters: actionStep.parameters,
          auditLogger: this.auditLogger,
          trustEngine: this.trustEngine
        };

        // Execute action
        const result = await action.execute(actionContext);

        logger.info(`Action ${action.id} result: ${result.success ? 'SUCCESS' : 'FAILED'}`);
        if (!result.success) {
          logger.error(`Action ${action.id} error: ${result.error}`);
        }

        // Track for undo if successful and undoable
        if (result.success && action.canUndo && result.canUndo) {
          this.trackAction(action, actionContext, result);
        }

        // Collect affected entities
        if (result.affectedUsers) {
          result.affectedUsers.forEach(u => affectedUsers.add(u));
        }
        if (result.affectedChannels) {
          result.affectedChannels.forEach(c => affectedChannels.add(c));
        }

        results.push(result);

      } catch (error: any) {
        logger.error(`Action execution error:`, error);
        results.push({
          success: false,
          error: `Execution failed: ${error.message}`
        });
      }
    }

    // Determine overall success
    const allSuccess = results.every(r => r.success);
    const anySuccess = results.some(r => r.success);

    return {
      success: allSuccess,
      results,
      totalAffectedUsers: affectedUsers.size,
      totalAffectedChannels: affectedChannels.size,
      error: !anySuccess ? 'All actions failed' : undefined
    };
  }

  /**
   * Execute a single action (convenience method)
   */
  async executeSingle(
    message: Message,
    executor: GuildMember,
    actionId: string,
    parameters: Record<string, any>
  ): Promise<ActionResult> {
    const plan: ActionPlan = {
      understood_intent: `Execute ${actionId}`,
      actions: [{ action_id: actionId, parameters }],
      requires_confirmation: false,
      response_to_moderator: ''
    };

    const result = await this.execute({ message, executor, plan });
    return result.results[0];
  }

  /**
   * Undo the last action in a channel
   */
  async undoLastAction(message: Message, executor: GuildMember): Promise<ActionResult> {
    const channelKey = `${message.guild!.id}:${message.channelId}`;
    const history = this.actionHistory.get(channelKey);

    if (!history || history.length === 0) {
      return {
        success: false,
        error: 'No recent action to undo'
      };
    }

    // Get last action
    const lastTracked = history[history.length - 1];
    const lastAction = lastTracked.action;

    if (!lastAction.canUndo || !lastAction.undoAction) {
      return {
        success: false,
        error: `Cannot undo ${lastAction.name} - this action is permanent`
      };
    }

    // Get undo action
    const undoAction = this.registry.get(lastAction.undoAction);
    if (!undoAction) {
      return {
        success: false,
        error: `Undo action not found: ${lastAction.undoAction}`
      };
    }

    logger.info(`Undoing action: ${lastAction.name} → ${undoAction.name}`);

    // Execute undo with original parameters (or undo data if available)
    const undoParameters = lastTracked.result.undoData || lastTracked.context.parameters;

    const result = await this.executeSingle(
      message,
      executor,
      undoAction.id,
      undoParameters
    );

    if (result.success) {
      // Remove from history
      history.pop();
      logger.info(`Successfully undid action: ${lastAction.name}`);
    }

    return result;
  }

  /**
   * Get recent action history for a channel
   */
  getActionHistory(guildId: string, channelId: string): TrackedAction[] {
    const key = `${guildId}:${channelId}`;
    return this.actionHistory.get(key) || [];
  }

  /**
   * Validate if executor has required permissions for action
   */
  private validatePermissions(executor: GuildMember, action: Action): { valid: boolean; error?: string } {
    for (const permission of action.requiredPermissions) {
      if (!executor.permissions.has(permission)) {
        return {
          valid: false,
          error: `Missing permission: ${permission.toString()}`
        };
      }
    }
    return { valid: true };
  }

  /**
   * Track action for undo capability
   */
  private trackAction(action: Action, context: ActionContext, result: ActionResult): void {
    const channelKey = `${context.message.guild!.id}:${context.message.channelId}`;

    if (!this.actionHistory.has(channelKey)) {
      this.actionHistory.set(channelKey, []);
    }

    const history = this.actionHistory.get(channelKey)!;

    // Add to history
    history.push({
      action,
      context,
      result,
      timestamp: new Date(),
      channelId: context.message.channelId,
      executorId: context.executor.id
    });

    // Limit history size
    if (history.length > this.MAX_HISTORY_PER_CHANNEL) {
      history.shift();
    }

    logger.info(`Tracked action ${action.id} for potential undo`);
  }

  /**
   * Clear action history for a channel
   */
  clearHistory(guildId: string, channelId: string): void {
    const key = `${guildId}:${channelId}`;
    this.actionHistory.delete(key);
    logger.info(`Cleared action history for ${key}`);
  }
}
