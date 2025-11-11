// ActionRegistry.ts - Universal action system for Discord moderation
// Allows AI to dynamically use any Discord action as a tool

import { Message, GuildMember, TextChannel, PermissionFlagsBits, Role } from 'discord.js';
import { createLogger } from '../services/Logger';
import { AuditLogger } from './AuditLogger';
import { TrustScoreEngine } from './TrustScoreEngine';

const logger = createLogger('ActionRegistry');

// ============================================
// TYPE DEFINITIONS
// ============================================

export type ActionCategory = 'message' | 'user' | 'channel' | 'role' | 'voice' | 'server';

export type ParameterType = 'user' | 'channel' | 'role' | 'number' | 'string' | 'duration' | 'boolean' | 'message';

export interface ActionParameter {
  name: string;
  type: ParameterType;
  required: boolean;
  description: string;
  default?: any;
  validation?: {
    min?: number;
    max?: number;
    pattern?: RegExp;
    enum?: string[];
  };
}

export interface ActionContext {
  message: Message;
  executor: GuildMember;
  parameters: Record<string, any>;
  auditLogger: AuditLogger;
  trustEngine: TrustScoreEngine;
}

export interface ActionResult {
  success: boolean;
  message?: string;
  error?: string;
  data?: any;
  affectedUsers?: string[];
  affectedChannels?: string[];
  canUndo?: boolean;
  undoData?: any;
}

export interface Action {
  id: string;
  category: ActionCategory;
  name: string;
  description: string;
  examples: string[];
  requiredPermissions: bigint[];
  parameters: ActionParameter[];
  canUndo: boolean;
  undoAction?: string;
  bulkCapable: boolean;
  execute: (context: ActionContext) => Promise<ActionResult>;
}

// ============================================
// ACTION REGISTRY
// ============================================

export class ActionRegistry {
  private actions: Map<string, Action> = new Map();
  private categoryIndex: Map<ActionCategory, string[]> = new Map();

  constructor() {
    logger.info('ActionRegistry initialized');
  }

  /**
   * Register a new action
   */
  register(action: Action): void {
    this.actions.set(action.id, action);

    // Add to category index
    if (!this.categoryIndex.has(action.category)) {
      this.categoryIndex.set(action.category, []);
    }
    this.categoryIndex.get(action.category)!.push(action.id);

    logger.info(`Registered action: ${action.id} (${action.category})`);
  }

  /**
   * Get action by ID
   */
  get(actionId: string): Action | undefined {
    return this.actions.get(actionId);
  }

  /**
   * Get all actions
   */
  getAll(): Action[] {
    return Array.from(this.actions.values());
  }

  /**
   * Get actions by category
   */
  getByCategory(category: ActionCategory): Action[] {
    const ids = this.categoryIndex.get(category) || [];
    return ids.map(id => this.actions.get(id)!).filter(Boolean);
  }

  /**
   * Get bulk-capable actions
   */
  getBulkCapable(): Action[] {
    return this.getAll().filter(a => a.bulkCapable);
  }

  /**
   * Get actions that can be undone
   */
  getUndoable(): Action[] {
    return this.getAll().filter(a => a.canUndo);
  }

  /**
   * Generate AI prompt with all available actions
   */
  generateAIPrompt(member: GuildMember): string {
    const availableActions: Action[] = [];

    // Filter actions based on member permissions
    for (const action of this.getAll()) {
      const hasAllPerms = action.requiredPermissions.every(perm =>
        member.permissions.has(perm)
      );
      if (hasAllPerms) {
        availableActions.push(action);
      }
    }

    let prompt = `AVAILABLE ACTIONS (${availableActions.length} tools you can use):\n\n`;

    // Group by category
    const categories: ActionCategory[] = ['message', 'user', 'channel', 'role', 'voice', 'server'];

    for (const category of categories) {
      const categoryActions = availableActions.filter(a => a.category === category);
      if (categoryActions.length === 0) continue;

      prompt += `**${category.toUpperCase()} ACTIONS:**\n`;

      for (const action of categoryActions) {
        prompt += `\n${action.id} - ${action.description}\n`;

        // Required parameters
        const required = action.parameters.filter(p => p.required);
        if (required.length > 0) {
          prompt += `  Required: ${required.map(p => p.name).join(', ')}\n`;
        }

        // Optional parameters
        const optional = action.parameters.filter(p => !p.required);
        if (optional.length > 0) {
          prompt += `  Optional: ${optional.map(p => p.name).join(', ')}\n`;
        }

        // Can undo?
        prompt += `  Can undo: ${action.canUndo ? 'Yes' : 'No'}`;
        if (action.canUndo && action.undoAction) {
          prompt += ` (via ${action.undoAction})`;
        }
        prompt += '\n';

        // Examples
        if (action.examples.length > 0) {
          prompt += `  Examples: ${action.examples.join(' | ')}\n`;
        }
      }
      prompt += '\n';
    }

    return prompt;
  }

  /**
   * Validate action parameters
   */
  validateParameters(action: Action, parameters: Record<string, any>): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check required parameters
    for (const param of action.parameters.filter(p => p.required)) {
      if (parameters[param.name] === undefined || parameters[param.name] === null) {
        errors.push(`Missing required parameter: ${param.name}`);
      }
    }

    // Validate parameter types and constraints
    for (const [key, value] of Object.entries(parameters)) {
      const param = action.parameters.find(p => p.name === key);
      if (!param) {
        errors.push(`Unknown parameter: ${key}`);
        continue;
      }

      // Type validation
      if (param.type === 'number' && typeof value !== 'number') {
        errors.push(`Parameter ${key} must be a number`);
      }
      if (param.type === 'string' && typeof value !== 'string') {
        errors.push(`Parameter ${key} must be a string`);
      }
      if (param.type === 'boolean' && typeof value !== 'boolean') {
        errors.push(`Parameter ${key} must be a boolean`);
      }

      // Validation rules
      if (param.validation) {
        if (param.validation.min !== undefined && value < param.validation.min) {
          errors.push(`Parameter ${key} must be >= ${param.validation.min}`);
        }
        if (param.validation.max !== undefined && value > param.validation.max) {
          errors.push(`Parameter ${key} must be <= ${param.validation.max}`);
        }
        if (param.validation.pattern && !param.validation.pattern.test(value)) {
          errors.push(`Parameter ${key} has invalid format`);
        }
        if (param.validation.enum && !param.validation.enum.includes(value)) {
          errors.push(`Parameter ${key} must be one of: ${param.validation.enum.join(', ')}`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}
