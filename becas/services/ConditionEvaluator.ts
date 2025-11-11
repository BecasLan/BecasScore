import { ExecutionContext } from '../core/BehaviorEngine';
import logger from '../utils/logger';

/**
 * ConditionEvaluator
 *
 * Safely evaluates conditions for BDL actions.
 * Supports operators: ===, !==, >, <, >=, <=, &&, ||, !
 *
 * Example: "analysis.isSpammer === true && analysis.confidence > 0.8"
 */

export class ConditionEvaluator {
  /**
   * Evaluate a condition string
   */
  evaluate(
    condition: string,
    context: ExecutionContext,
    analysisResult?: any,
    trackingData?: any
  ): boolean {
    try {
      // Build evaluation context
      const evalContext = this.buildContext(context, analysisResult, trackingData);

      // Parse and evaluate condition safely
      const result = this.safeEvaluate(condition, evalContext);

      logger.debug(`Condition "${condition}" evaluated to: ${result}`);

      return result;

    } catch (error) {
      logger.error(`Error evaluating condition "${condition}":`, error);
      return false; // Safe default: don't execute action on error
    }
  }

  /**
   * Build evaluation context with all available variables
   */
  private buildContext(
    context: ExecutionContext,
    analysisResult?: any,
    trackingData?: any
  ): Record<string, any> {
    const evalContext: Record<string, any> = {
      // Trigger context
      triggeredUserId: context.triggeredBy,
      triggeredChannelId: context.triggeredChannelId,
      triggeredMessageId: context.triggeredMessageId,
      triggeredAt: context.triggeredAt,

      // Event data
      event: context.event,
      serverId: context.serverId,

      // Analysis result
      analysis: analysisResult || {},

      // Tracking data
      tracking: trackingData || {},
      messageCount: trackingData?.messageCount || 0,
      linkCount: trackingData?.linkCount || 0,
      reactionCount: trackingData?.reactionCount || 0,

      // User data (if available)
      user: {
        id: context.triggeredBy,
        // Will be populated from database if needed
      }
    };

    return evalContext;
  }

  /**
   * Safely evaluate condition without arbitrary code execution
   */
  private safeEvaluate(condition: string, context: Record<string, any>): boolean {
    // Tokenize the condition
    const tokens = this.tokenize(condition);

    // Parse into expression tree
    const expression = this.parse(tokens);

    // Evaluate the expression
    return this.evaluateExpression(expression, context);
  }

  /**
   * Tokenize condition string
   */
  private tokenize(condition: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let inString = false;
    let stringChar = '';

    for (let i = 0; i < condition.length; i++) {
      const char = condition[i];

      // Handle strings
      if ((char === '"' || char === "'") && !inString) {
        inString = true;
        stringChar = char;
        current += char;
        continue;
      }

      if (char === stringChar && inString) {
        inString = false;
        current += char;
        tokens.push(current);
        current = '';
        continue;
      }

      if (inString) {
        current += char;
        continue;
      }

      // Handle operators and delimiters
      if (char === ' ') {
        if (current) {
          tokens.push(current);
          current = '';
        }
        continue;
      }

      // Multi-character operators
      if (char === '=' || char === '!' || char === '>' || char === '<' || char === '&' || char === '|') {
        if (current) {
          tokens.push(current);
          current = '';
        }

        const nextChar = condition[i + 1];
        if ((char === '=' && nextChar === '=') ||
            (char === '!' && nextChar === '=') ||
            (char === '>' && nextChar === '=') ||
            (char === '<' && nextChar === '=') ||
            (char === '&' && nextChar === '&') ||
            (char === '|' && nextChar === '|')) {
          tokens.push(char + nextChar);
          i++; // Skip next character
        } else {
          tokens.push(char);
        }
        continue;
      }

      // Regular characters
      current += char;
    }

    if (current) {
      tokens.push(current);
    }

    return tokens;
  }

  /**
   * Parse tokens into expression tree
   */
  private parse(tokens: string[]): any {
    // Simple recursive descent parser
    // For now, handle basic expressions
    return { type: 'tokens', tokens };
  }

  /**
   * Evaluate expression tree
   */
  private evaluateExpression(expression: any, context: Record<string, any>): boolean {
    const tokens = expression.tokens;

    // Handle simple comparisons
    if (tokens.length === 3) {
      const left = this.getValue(tokens[0], context);
      const operator = tokens[1];
      const right = this.getValue(tokens[2], context);

      return this.compare(left, operator, right);
    }

    // Handle logical operators (&&, ||)
    let result = false;
    let currentOperator = null;

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];

      if (token === '&&' || token === '||') {
        currentOperator = token;
        continue;
      }

      // Evaluate sub-expression
      if (i + 2 < tokens.length && this.isOperator(tokens[i + 1])) {
        const left = this.getValue(tokens[i], context);
        const operator = tokens[i + 1];
        const right = this.getValue(tokens[i + 2], context);

        const subResult = this.compare(left, operator, right);

        if (currentOperator === null) {
          result = subResult;
        } else if (currentOperator === '&&') {
          result = result && subResult;
        } else if (currentOperator === '||') {
          result = result || subResult;
        }

        i += 2; // Skip operator and right operand
      }
    }

    return result;
  }

  /**
   * Get value from context or literal
   */
  private getValue(token: string, context: Record<string, any>): any {
    // String literal
    if (token.startsWith('"') || token.startsWith("'")) {
      return token.slice(1, -1);
    }

    // Number literal
    if (!isNaN(Number(token))) {
      return Number(token);
    }

    // Boolean literal
    if (token === 'true') return true;
    if (token === 'false') return false;

    // Null/undefined
    if (token === 'null') return null;
    if (token === 'undefined') return undefined;

    // Variable access (e.g., analysis.isSpammer)
    const parts = token.split('.');
    let value: any = context;

    for (const part of parts) {
      if (value && typeof value === 'object' && part in value) {
        value = value[part];
      } else {
        return undefined;
      }
    }

    return value;
  }

  /**
   * Check if token is an operator
   */
  private isOperator(token: string): boolean {
    return ['===', '!==', '>', '<', '>=', '<=', '==', '!='].includes(token);
  }

  /**
   * Compare two values with operator
   */
  private compare(left: any, operator: string, right: any): boolean {
    switch (operator) {
      case '===':
      case '==':
        return left === right;

      case '!==':
      case '!=':
        return left !== right;

      case '>':
        return left > right;

      case '<':
        return left < right;

      case '>=':
        return left >= right;

      case '<=':
        return left <= right;

      default:
        logger.warn(`Unknown operator: ${operator}`);
        return false;
    }
  }

  /**
   * Test condition evaluator with examples
   */
  static runTests(): void {
    const evaluator = new ConditionEvaluator();

    const testCases = [
      {
        condition: 'messageCount > 5',
        context: { messageCount: 10 },
        expected: true
      },
      {
        condition: 'analysis.isSpammer === true',
        context: { analysis: { isSpammer: true } },
        expected: true
      },
      {
        condition: 'linkCount >= 3 && messageCount <= 10',
        context: { linkCount: 5, messageCount: 8 },
        expected: true
      },
      {
        condition: 'analysis.confidence > 0.8',
        context: { analysis: { confidence: 0.9 } },
        expected: true
      },
      {
        condition: 'userTotalMessages >= 50',
        context: { userTotalMessages: 100 },
        expected: true
      }
    ];

    logger.info('Running ConditionEvaluator tests...');

    for (const test of testCases) {
      const mockContext: ExecutionContext = {
        serverId: 'test',
        triggeredAt: new Date(),
        event: 'test',
        eventData: {}
      };

      const result = evaluator.evaluate(test.condition, mockContext, test.context);

      const status = result === test.expected ? '✅ PASS' : '❌ FAIL';
      logger.info(`${status}: "${test.condition}" = ${result} (expected ${test.expected})`);
    }
  }
}

/**
 * Example usage:
 *
 * const evaluator = new ConditionEvaluator();
 *
 * const shouldExecute = evaluator.evaluate(
 *   'analysis.isSpammer === true && analysis.confidence > 0.8',
 *   context,
 *   { isSpammer: true, confidence: 0.92 }
 * );
 *
 * if (shouldExecute) {
 *   // Execute action
 * }
 */
