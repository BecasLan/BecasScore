/**
 * BECAS CONDITIONS - CONDITIONAL LOGIC ENGINE
 *
 * Handles if/then/else logic, switch statements, and complex conditions.
 * Supports nested conditions, custom functions, and field path resolution.
 *
 * Examples:
 * - if (trustScore < 30) then ban else warn
 * - if (messageCount > 10 AND toxicity > 0.7) then timeout
 * - switch (role) { case "admin": skip, case "user": check }
 */

import { BecasCondition, BecasContext, BecasConditionType } from '../types/BecasFlow.types';
import { createLogger } from '../../services/Logger';

const logger = createLogger('BecasConditions');

export class BecasConditions {
  /**
   * Evaluate a single condition
   */
  static evaluate(condition: BecasCondition, context: BecasContext): boolean {
    try {
      // Custom function
      if (condition.type === 'custom' && condition.customFn) {
        return condition.customFn(context);
      }

      // Get field value from context
      const fieldValue = this.resolveField(condition.field, context);

      // Evaluate based on type
      switch (condition.type) {
        case 'equals':
          return fieldValue === condition.value;

        case 'notEquals':
          return fieldValue !== condition.value;

        case 'greaterThan':
          return Number(fieldValue) > Number(condition.value);

        case 'lessThan':
          return Number(fieldValue) < Number(condition.value);

        case 'greaterThanOrEqual':
          return Number(fieldValue) >= Number(condition.value);

        case 'lessThanOrEqual':
          return Number(fieldValue) <= Number(condition.value);

        case 'contains':
          if (typeof fieldValue === 'string') {
            return fieldValue.includes(String(condition.value));
          }
          if (Array.isArray(fieldValue)) {
            return fieldValue.includes(condition.value);
          }
          return false;

        case 'notContains':
          if (typeof fieldValue === 'string') {
            return !fieldValue.includes(String(condition.value));
          }
          if (Array.isArray(fieldValue)) {
            return !fieldValue.includes(condition.value);
          }
          return true;

        case 'matches':
          if (typeof fieldValue === 'string' && typeof condition.value === 'string') {
            const regex = new RegExp(condition.value);
            return regex.test(fieldValue);
          }
          return false;

        case 'exists':
          return fieldValue !== undefined && fieldValue !== null;

        case 'notExists':
          return fieldValue === undefined || fieldValue === null;

        default:
          logger.warn(`Unknown condition type: ${condition.type}`);
          return false;
      }
    } catch (error) {
      logger.error(`Error evaluating condition:`, error);
      return false;
    }
  }

  /**
   * Evaluate multiple conditions (AND logic)
   */
  static evaluateAll(conditions: BecasCondition[], context: BecasContext): boolean {
    return conditions.every(condition => this.evaluate(condition, context));
  }

  /**
   * Evaluate multiple conditions (OR logic)
   */
  static evaluateAny(conditions: BecasCondition[], context: BecasContext): boolean {
    return conditions.some(condition => this.evaluate(condition, context));
  }

  /**
   * Resolve field path from context
   * Supports dot notation: "stepResults.check_trust.trustScore"
   */
  private static resolveField(field: string, context: BecasContext): any {
    const parts = field.split('.');
    let current: any = context;

    for (const part of parts) {
      if (current === undefined || current === null) {
        return undefined;
      }

      // Handle Map access
      if (current instanceof Map) {
        current = current.get(part);
      } else {
        current = current[part];
      }
    }

    return current;
  }

  /**
   * Build condition from string expression
   * Example: "trustScore < 30" => { type: 'lessThan', field: 'trustScore', value: 30 }
   */
  static fromString(expression: string): BecasCondition | null {
    try {
      // Simple operator mapping
      const operators: Record<string, BecasConditionType> = {
        '===': 'equals',
        '==': 'equals',
        '!==': 'notEquals',
        '!=': 'notEquals',
        '>': 'greaterThan',
        '<': 'lessThan',
        '>=': 'greaterThanOrEqual',
        '<=': 'lessThanOrEqual',
        'contains': 'contains',
        'includes': 'contains',
        'matches': 'matches',
        'exists': 'exists',
      };

      // Find operator in expression
      for (const [opStr, opType] of Object.entries(operators)) {
        if (expression.includes(opStr)) {
          const [field, valueStr] = expression.split(opStr).map(s => s.trim());

          let value: any = valueStr;

          // Parse value
          if (valueStr === 'true') value = true;
          else if (valueStr === 'false') value = false;
          else if (!isNaN(Number(valueStr))) value = Number(valueStr);
          else if (valueStr.startsWith('"') && valueStr.endsWith('"')) {
            value = valueStr.slice(1, -1);
          } else if (valueStr.startsWith("'") && valueStr.endsWith("'")) {
            value = valueStr.slice(1, -1);
          }

          return {
            type: opType,
            field,
            value,
          };
        }
      }

      // Check for exists/notExists
      if (expression.includes(' exists')) {
        const field = expression.replace(' exists', '').trim();
        return { type: 'exists', field };
      }

      if (expression.includes(' not exists')) {
        const field = expression.replace(' not exists', '').trim();
        return { type: 'notExists', field };
      }

      logger.warn(`Could not parse condition: ${expression}`);
      return null;
    } catch (error) {
      logger.error(`Error parsing condition string:`, error);
      return null;
    }
  }

  /**
   * Validate condition
   */
  static validate(condition: BecasCondition): { valid: boolean; error?: string } {
    if (!condition.type) {
      return { valid: false, error: 'Condition type is required' };
    }

    if (!condition.field && condition.type !== 'custom') {
      return { valid: false, error: 'Condition field is required' };
    }

    if (condition.type === 'custom' && !condition.customFn) {
      return { valid: false, error: 'Custom condition requires customFn' };
    }

    const requiresValue: BecasConditionType[] = [
      'equals', 'notEquals', 'greaterThan', 'lessThan',
      'greaterThanOrEqual', 'lessThanOrEqual', 'contains',
      'notContains', 'matches'
    ];

    if (requiresValue.includes(condition.type) && condition.value === undefined) {
      return { valid: false, error: `Condition type "${condition.type}" requires a value` };
    }

    return { valid: true };
  }

  /**
   * Get human-readable description of condition
   */
  static describe(condition: BecasCondition): string {
    if (condition.type === 'custom') {
      return condition.message || 'Custom condition';
    }

    const operatorText: Record<BecasConditionType, string> = {
      equals: 'equals',
      notEquals: 'does not equal',
      greaterThan: 'is greater than',
      lessThan: 'is less than',
      greaterThanOrEqual: 'is greater than or equal to',
      lessThanOrEqual: 'is less than or equal to',
      contains: 'contains',
      notContains: 'does not contain',
      matches: 'matches pattern',
      exists: 'exists',
      notExists: 'does not exist',
      custom: 'meets custom condition',
    };

    const op = operatorText[condition.type] || condition.type;

    if (condition.type === 'exists' || condition.type === 'notExists') {
      return `${condition.field} ${op}`;
    }

    return `${condition.field} ${op} ${JSON.stringify(condition.value)}`;
  }

  /**
   * Create common conditions (helpers)
   */
  static helpers = {
    /**
     * Check if trust score is below threshold
     */
    lowTrustScore(threshold: number = 30): BecasCondition {
      return {
        type: 'lessThan',
        field: 'services.trustEngine.trustScore',
        value: threshold,
        message: `Trust score below ${threshold}`,
      };
    },

    /**
     * Check if user is admin
     */
    isAdmin(): BecasCondition {
      return {
        type: 'custom',
        field: 'member',
        customFn: (context) => {
          return context.member.permissions.has('Administrator');
        },
        message: 'User is administrator',
      };
    },

    /**
     * Check if user is moderator
     */
    isModerator(): BecasCondition {
      return {
        type: 'custom',
        field: 'member',
        customFn: (context) => {
          return (
            context.member.permissions.has('ModerateMembers') ||
            context.member.permissions.has('KickMembers') ||
            context.member.permissions.has('BanMembers') ||
            context.member.permissions.has('Administrator')
          );
        },
        message: 'User is moderator',
      };
    },

    /**
     * Check if message count exceeds threshold
     */
    messageCountAbove(count: number): BecasCondition {
      return {
        type: 'greaterThan',
        field: 'stepResults.fetch_messages.messageCount',
        value: count,
        message: `Message count above ${count}`,
      };
    },

    /**
     * Check if toxicity is high
     */
    highToxicity(threshold: number = 0.7): BecasCondition {
      return {
        type: 'greaterThan',
        field: 'stepResults.analyze.toxicity',
        value: threshold,
        message: `Toxicity above ${threshold}`,
      };
    },

    /**
     * Check if field exists in context
     */
    fieldExists(field: string): BecasCondition {
      return {
        type: 'exists',
        field,
        message: `${field} exists`,
      };
    },

    /**
     * Combine conditions with AND
     */
    and(...conditions: BecasCondition[]): BecasCondition {
      return {
        type: 'custom',
        field: '',
        customFn: (context) => {
          return BecasConditions.evaluateAll(conditions, context);
        },
        message: `All conditions met: ${conditions.map(c => BecasConditions.describe(c)).join(' AND ')}`,
      };
    },

    /**
     * Combine conditions with OR
     */
    or(...conditions: BecasCondition[]): BecasCondition {
      return {
        type: 'custom',
        field: '',
        customFn: (context) => {
          return BecasConditions.evaluateAny(conditions, context);
        },
        message: `Any condition met: ${conditions.map(c => BecasConditions.describe(c)).join(' OR ')}`,
      };
    },

    /**
     * Negate condition
     */
    not(condition: BecasCondition): BecasCondition {
      return {
        type: 'custom',
        field: '',
        customFn: (context) => {
          return !BecasConditions.evaluate(condition, context);
        },
        message: `NOT (${BecasConditions.describe(condition)})`,
      };
    },
  };
}
