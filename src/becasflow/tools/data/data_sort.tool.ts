/**
 * DATA SORT TOOL
 *
 * Sorts data arrays by specified field and order.
 * Part of the data manipulation toolset for multi-step BecasFlow pipelines.
 */

import { BecasTool, BecasContext, BecasToolResult } from '../../types/BecasFlow.types';
import { createLogger } from '../../../services/Logger';

const logger = createLogger('DataSortTool');

export const dataSortTool: BecasTool = {
  name: 'data_sort',
  description: 'Sort an array of data by a specified field in ascending or descending order',
  category: 'data',

  parameters: {
    data: {
      type: 'array',
      description: 'Array of data to sort (can reference previous step output)',
      required: true,
    },
    by: {
      type: 'string',
      description: 'Field name to sort by (e.g., "timestamp", "severity", "score")',
      required: true,
    },
    order: {
      type: 'string',
      description: 'Sort order',
      required: false,
      default: 'asc',
      enum: ['asc', 'desc', 'ascending', 'descending'],
    },
  },

  detectMissing: (params: any, context: BecasContext) => {
    if (!params.data) {
      return {
        param: 'data',
        prompt: 'What data should I sort?',
        type: 'text' as const,
      };
    }
    if (!params.by) {
      return {
        param: 'by',
        prompt: 'Which field should I sort by? (e.g., date, score, severity)',
        type: 'text' as const,
      };
    }
    return null;
  },

  async execute(params: any, context: BecasContext): Promise<BecasToolResult> {
    const startTime = Date.now();

    try {
      let { data, by, order } = params;

      // Normalize order
      const isDescending = order === 'desc' || order === 'descending';
      const normalizedOrder = isDescending ? 'desc' : 'asc';

      logger.info(`Sorting data by "${by}" in ${normalizedOrder} order`);

      // Validate data is an array
      if (!Array.isArray(data)) {
        return {
          success: false,
          error: 'Data must be an array',
          executionTime: Date.now() - startTime,
        };
      }

      if (data.length === 0) {
        return {
          success: true,
          data: [],
          message: 'No data to sort',
          executionTime: Date.now() - startTime,
        };
      }

      // Create a copy to avoid mutating original
      const sorted = [...data].sort((a, b) => {
        const valueA = this.getNestedValue(a, by);
        const valueB = this.getNestedValue(b, by);

        // Handle different types
        let comparison = 0;

        if (typeof valueA === 'number' && typeof valueB === 'number') {
          comparison = valueA - valueB;
        } else if (typeof valueA === 'string' && typeof valueB === 'string') {
          comparison = valueA.localeCompare(valueB);
        } else if (valueA instanceof Date && valueB instanceof Date) {
          comparison = valueA.getTime() - valueB.getTime();
        } else {
          // Fallback: convert to string and compare
          comparison = String(valueA).localeCompare(String(valueB));
        }

        return isDescending ? -comparison : comparison;
      });

      logger.info(`Sorted ${sorted.length} items by ${by} (${normalizedOrder})`);

      return {
        success: true,
        data: sorted,
        message: `Sorted ${sorted.length} items by ${by} in ${normalizedOrder} order`,
        metadata: {
          count: sorted.length,
          sortBy: by,
          order: normalizedOrder,
        },
        executionTime: Date.now() - startTime,
      };

    } catch (error: any) {
      logger.error('Data sort error:', error);
      return {
        success: false,
        error: `Failed to sort data: ${error.message}`,
        executionTime: Date.now() - startTime,
      };
    }
  },

  /**
   * Get nested value from object using dot notation
   * e.g., "user.name" → obj.user.name
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
