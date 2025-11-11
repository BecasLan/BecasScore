/**
 * DATA AGGREGATE TOOL
 *
 * Performs aggregation operations (count, sum, average, min, max) on arrays.
 * Part of the data manipulation toolset for multi-step BecasFlow pipelines.
 */

import { BecasTool, BecasContext, BecasToolResult } from '../../types/BecasFlow.types';
import { createLogger } from '../../../services/Logger';

const logger = createLogger('DataAggregateTool');

export const dataAggregateTool: BecasTool = {
  name: 'data_aggregate',
  description: 'Perform aggregation operations on data - count, sum, average, min, max. Can group by field.',
  category: 'data',

  parameters: {
    data: {
      type: 'array',
      description: 'Array of data to aggregate (can reference previous step output)',
      required: true,
    },
    operation: {
      type: 'string',
      description: 'Aggregation operation',
      required: true,
      enum: ['count', 'sum', 'average', 'min', 'max'],
    },
    field: {
      type: 'string',
      description: 'Field to aggregate (required for sum, average, min, max)',
      required: false,
    },
    groupBy: {
      type: 'string',
      description: 'Field to group by before aggregating (optional)',
      required: false,
    },
  },

  detectMissing: (params: any, context: BecasContext) => {
    if (!params.data) {
      return {
        param: 'data',
        prompt: 'What data should I aggregate?',
        type: 'text',
      };
    }
    if (!params.operation) {
      return {
        param: 'operation',
        prompt: 'Which operation? (count, sum, average, min, max)',
        type: 'text' as const,
        options: [
          { label: 'count', value: 'count' },
          { label: 'sum', value: 'sum' },
          { label: 'average', value: 'average' },
          { label: 'min', value: 'min' },
          { label: 'max', value: 'max' }
        ],
      };
    }
    return null;
  },

  async execute(params: any, context: BecasContext): Promise<BecasToolResult> {
    const startTime = Date.now();

    try {
      let { data, operation, field, groupBy } = params;

      logger.info(`Aggregating data: operation=${operation}, field=${field}, groupBy=${groupBy}`);

      // Validate data is an array
      if (!Array.isArray(data)) {
        return {
          success: false,
          error: 'Data must be an array',
        };
      }

      if (data.length === 0) {
        return {
          success: true,
          data: groupBy ? {} : 0,
        };
      }

      let result: any;

      if (groupBy) {
        // Group-by aggregation
        result = this.aggregateGrouped(data, operation, field, groupBy);
      } else {
        // Simple aggregation
        result = this.aggregateSimple(data, operation, field);
      }

      logger.info(`Aggregation complete: ${JSON.stringify(result)}`);

      return {
        success: true,
        data: result,
        metadata: {
          operation,
          field,
          groupBy,
          totalItems: data.length,
        },
      };

    } catch (error: any) {
      logger.error('Data aggregate error:', error);
      return {
        success: false,
        error: `Failed to aggregate data: ${error.message}`,
      };
    }
  },

  /**
   * Simple aggregation (no grouping)
   */
  aggregateSimple(data: any[], operation: string, field?: string): any {
    switch (operation) {
      case 'count':
        return data.length;

      case 'sum': {
        if (!field) throw new Error('Field required for sum operation');
        return data.reduce((sum, item) => {
          const value = this.getNestedValue(item, field);
          return sum + (Number(value) || 0);
        }, 0);
      }

      case 'average': {
        if (!field) throw new Error('Field required for average operation');
        const sum = data.reduce((sum, item) => {
          const value = this.getNestedValue(item, field);
          return sum + (Number(value) || 0);
        }, 0);
        return sum / data.length;
      }

      case 'min': {
        if (!field) throw new Error('Field required for min operation');
        const values = data.map(item => Number(this.getNestedValue(item, field)) || 0);
        return Math.min(...values);
      }

      case 'max': {
        if (!field) throw new Error('Field required for max operation');
        const values = data.map(item => Number(this.getNestedValue(item, field)) || 0);
        return Math.max(...values);
      }

      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
  },

  /**
   * Grouped aggregation
   */
  aggregateGrouped(data: any[], operation: string, field: string | undefined, groupBy: string): Record<string, any> {
    // First group the data
    const grouped: Record<string, any[]> = {};

    for (const item of data) {
      const key = String(this.getNestedValue(item, groupBy));
      if (!grouped[key]) {
        grouped[key] = [];
      }
      grouped[key].push(item);
    }

    // Then aggregate each group
    const result: Record<string, any> = {};

    for (const [key, items] of Object.entries(grouped)) {
      result[key] = this.aggregateSimple(items, operation, field);
    }

    return result;
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
