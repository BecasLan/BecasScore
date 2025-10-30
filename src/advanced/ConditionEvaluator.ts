// ConditionEvaluator.ts

import { TaskCondition } from '../types/Task.types';
import { AnalyzedMessage } from '../types/Message.types';
import { TrustScore } from '../types/Trust.types';

export interface EvaluationContext {
  message?: AnalyzedMessage;
  trustScore?: TrustScore;
  timestamp?: Date;
  userMessages?: string[];
  customData?: Record<string, any>;
}

export class ConditionEvaluator {
  /**
   * Evaluate if a condition is met
   */
  evaluate(condition: TaskCondition, context: EvaluationContext): boolean {
    console.log(`🔍 Evaluating condition: ${condition.type}`);

    switch (condition.type) {
      case 'message_pattern':
        return this.evaluateMessagePattern(condition, context);

      case 'trust_threshold':
        return this.evaluateTrustThreshold(condition, context);

      case 'user_action':
        return this.evaluateUserAction(condition, context);

      case 'time':
        return this.evaluateTime(condition, context);

      default:
        console.warn(`Unknown condition type: ${condition.type}`);
        return false;
    }
  }

  /**
   * Evaluate message pattern condition
   */
  private evaluateMessagePattern(condition: TaskCondition, context: EvaluationContext): boolean {
    if (!context.message) return false;

    const pattern = String(condition.value).toLowerCase();
    const message = context.message.content.toLowerCase();

    let result = false;

    switch (condition.operator) {
      case 'contains':
        result = message.includes(pattern);
        break;

      case 'matches':
        try {
          const regex = new RegExp(pattern, 'i');
          result = regex.test(message);
        } catch (e) {
          console.error('Invalid regex pattern:', pattern);
          result = message.includes(pattern);
        }
        break;

      case '=':
        result = message === pattern;
        break;

      default:
        result = message.includes(pattern);
    }

    if (result) {
      console.log(`✓ Message pattern matched: "${pattern}" in "${message}"`);
    }

    return result;
  }

  /**
   * Evaluate trust threshold condition
   */
  private evaluateTrustThreshold(condition: TaskCondition, context: EvaluationContext): boolean {
    if (!context.trustScore) return false;

    const threshold = Number(condition.value);
    const current = context.trustScore.score;

    let result = false;

    switch (condition.operator) {
      case '>':
        result = current > threshold;
        break;

      case '<':
        result = current < threshold;
        break;

      case '>=':
        result = current >= threshold;
        break;

      case '<=':
        result = current <= threshold;
        break;

      case '=':
        result = current === threshold;
        break;

      default:
        result = current >= threshold;
    }

    if (result) {
      console.log(`✓ Trust threshold met: ${current} ${condition.operator} ${threshold}`);
    }

    return result;
  }

  /**
   * Evaluate user action condition
   */
  private evaluateUserAction(condition: TaskCondition, context: EvaluationContext): boolean {
    // Check if user performed specific action
    const requiredAction = String(condition.value).toLowerCase();
    
    if (context.message) {
      const content = context.message.content.toLowerCase();
      
      // Check for apology
      if (requiredAction.includes('apolog')) {
        return content.includes('sorry') || 
               content.includes('apologize') || 
               content.includes('apology') ||
               content.includes('my bad');
      }

      // Check for greeting
      if (requiredAction.includes('greet')) {
        return content.includes('hello') || 
               content.includes('hi') || 
               content.includes('hey');
      }

      // Check for thanks
      if (requiredAction.includes('thank')) {
        return content.includes('thank') || 
               content.includes('thanks') || 
               content.includes('thx');
      }

      // Generic check
      return content.includes(requiredAction);
    }

    return false;
  }

  /**
   * Evaluate time-based condition
   */
  private evaluateTime(condition: TaskCondition, context: EvaluationContext): boolean {
    const targetTime = new Date(condition.value);
    const currentTime = context.timestamp || new Date();

    let result = false;

    switch (condition.operator) {
      case '>':
        result = currentTime > targetTime;
        break;

      case '<':
        result = currentTime < targetTime;
        break;

      case '>=':
        result = currentTime >= targetTime;
        break;

      case '<=':
        result = currentTime <= targetTime;
        break;

      default:
        result = currentTime >= targetTime;
    }

    return result;
  }

  /**
   * Evaluate multiple conditions with AND logic
   */
  evaluateAll(conditions: TaskCondition[], context: EvaluationContext): boolean {
    if (conditions.length === 0) return true;

    return conditions.every(condition => this.evaluate(condition, context));
  }

  /**
   * Evaluate multiple conditions with OR logic
   */
  evaluateAny(conditions: TaskCondition[], context: EvaluationContext): boolean {
    if (conditions.length === 0) return false;

    return conditions.some(condition => this.evaluate(condition, context));
  }

  /**
   * Create a condition from natural language
   */
  createCondition(text: string): TaskCondition | null {
    const lower = text.toLowerCase();

    // Trust-based conditions
    if (lower.includes('trust') && lower.includes('above')) {
      const match = lower.match(/trust.*above\s+(\d+)/);
      if (match) {
        return {
          type: 'trust_threshold',
          value: parseInt(match[1]),
          operator: '>',
        };
      }
    }

    if (lower.includes('trust') && lower.includes('below')) {
      const match = lower.match(/trust.*below\s+(\d+)/);
      if (match) {
        return {
          type: 'trust_threshold',
          value: parseInt(match[1]),
          operator: '<',
        };
      }
    }

    // Message pattern conditions
    if (lower.includes('says') || lower.includes('posts')) {
      const match = lower.match(/(?:says|posts)\s+['"]?([^'"]+)['"]?/);
      if (match) {
        return {
          type: 'message_pattern',
          value: match[1].trim(),
          operator: 'contains',
        };
      }
    }

    // Action conditions
    if (lower.includes('apologi')) {
      return {
        type: 'user_action',
        value: 'apologize',
        operator: 'contains',
      };
    }

    return null;
  }
}