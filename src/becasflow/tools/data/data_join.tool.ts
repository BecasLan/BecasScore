/**
 * DATA JOIN TOOL
 *
 * Joins two datasets based on a common field (like SQL JOIN).
 * Part of the data manipulation toolset for multi-step BecasFlow pipelines.
 */

import { BecasTool, BecasContext, BecasToolResult } from '../../types/BecasFlow.types';
import { createLogger } from '../../../services/Logger';

const logger = createLogger('DataJoinTool');

export const dataJoinTool: BecasTool = {
  name: 'data_join',
  description: 'Join two datasets based on a common field (inner join, left join, right join)',
  category: 'data',

  parameters: {
    left: {
      type: 'array',
      description: 'Left dataset to join (can reference previous step output)',
      required: true,
    },
    right: {
      type: 'array',
      description: 'Right dataset to join (can reference previous step output)',
      required: true,
    },
    on: {
      type: 'string',
      description: 'Field name to join on (must exist in both datasets)',
      required: true,
    },
    type: {
      type: 'string',
      description: 'Join type',
      required: false,
      default: 'inner',
      enum: ['inner', 'left', 'right', 'full'],
    },
  },

  detectMissing: (params: any, context: BecasContext) => {
    if (!params.left) {
      return {
        param: 'left',
        prompt: 'What is the left dataset?',
        type: 'text',
      };
    }
    if (!params.right) {
      return {
        param: 'right',
        prompt: 'What is the right dataset?',
        type: 'text',
      };
    }
    if (!params.on) {
      return {
        param: 'on',
        prompt: 'Which field should I join on?',
        type: 'text',
      };
    }
    return null;
  },

  async execute(params: any, context: BecasContext): Promise<BecasToolResult> {
    const startTime = Date.now();

    try {
      let { left, right, on, type } = params;
      type = type || 'inner';

      logger.info(`Joining datasets: type=${type}, on=${on}`);

      // Validate inputs are arrays
      if (!Array.isArray(left)) {
        return {
          success: false,
          error: 'Left dataset must be an array',
        };
      }

      if (!Array.isArray(right)) {
        return {
          success: false,
          error: 'Right dataset must be an array',
        };
      }

      // Perform join based on type
      let result: any[];

      switch (type) {
        case 'inner':
          result = this.innerJoin(left, right, on);
          break;

        case 'left':
          result = this.leftJoin(left, right, on);
          break;

        case 'right':
          result = this.rightJoin(left, right, on);
          break;

        case 'full':
          result = this.fullJoin(left, right, on);
          break;

        default:
          return {
            success: false,
            error: `Unknown join type: ${type}`,
          };
      }

      logger.info(`Joined ${left.length} + ${right.length} items → ${result.length} items`);

      return {
        success: true,
        data: result,
        metadata: {
          joinType: type,
          joinField: on,
          leftCount: left.length,
          rightCount: right.length,
          resultCount: result.length,
        },
      };

    } catch (error: any) {
      logger.error('Data join error:', error);
      return {
        success: false,
        error: `Failed to join data: ${error.message}`,
      };
    }
  },

  /**
   * Inner join - only matching records
   */
  innerJoin(left: any[], right: any[], on: string): any[] {
    const result: any[] = [];
    const rightMap = this.createLookupMap(right, on);

    for (const leftItem of left) {
      const key = String(this.getNestedValue(leftItem, on));
      const rightItem = rightMap.get(key);

      if (rightItem) {
        result.push({ ...leftItem, ...rightItem });
      }
    }

    return result;
  },

  /**
   * Left join - all from left, matching from right
   */
  leftJoin(left: any[], right: any[], on: string): any[] {
    const result: any[] = [];
    const rightMap = this.createLookupMap(right, on);

    for (const leftItem of left) {
      const key = String(this.getNestedValue(leftItem, on));
      const rightItem = rightMap.get(key);

      result.push(rightItem ? { ...leftItem, ...rightItem } : leftItem);
    }

    return result;
  },

  /**
   * Right join - matching from left, all from right
   */
  rightJoin(left: any[], right: any[], on: string): any[] {
    const result: any[] = [];
    const leftMap = this.createLookupMap(left, on);

    for (const rightItem of right) {
      const key = String(this.getNestedValue(rightItem, on));
      const leftItem = leftMap.get(key);

      result.push(leftItem ? { ...leftItem, ...rightItem } : rightItem);
    }

    return result;
  },

  /**
   * Full outer join - all from both
   */
  fullJoin(left: any[], right: any[], on: string): any[] {
    const result: any[] = [];
    const rightMap = this.createLookupMap(right, on);
    const seenKeys = new Set<string>();

    // Add all from left + matching right
    for (const leftItem of left) {
      const key = String(this.getNestedValue(leftItem, on));
      const rightItem = rightMap.get(key);
      seenKeys.add(key);

      result.push(rightItem ? { ...leftItem, ...rightItem } : leftItem);
    }

    // Add remaining from right (not in left)
    for (const rightItem of right) {
      const key = String(this.getNestedValue(rightItem, on));
      if (!seenKeys.has(key)) {
        result.push(rightItem);
      }
    }

    return result;
  },

  /**
   * Create lookup map for faster joins
   */
  createLookupMap(data: any[], field: string): Map<string, any> {
    const map = new Map<string, any>();

    for (const item of data) {
      const key = String(this.getNestedValue(item, field));
      map.set(key, item);
    }

    return map;
  },

  /**
   * Get nested value from object using dot notation
   */
  getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, part) => current?.[part], obj);
  },

  /**
   * Get period cutoff time (keeping interface consistent)
   */
  getPeriodCutoff(period: string): number {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;

    switch (period) {
      case 'day': return now - day;
      case 'week': return now - (7 * day);
      case 'month': return now - (30 * day);
      case 'all': return 0;
      default: return now - (30 * day);
    }
  },
};
