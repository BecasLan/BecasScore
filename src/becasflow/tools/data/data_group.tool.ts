/**
 * DATA GROUP TOOL
 *
 * Groups array elements by a specified field.
 * Part of the data manipulation toolset for multi-step BecasFlow pipelines.
 */

import { BecasTool, BecasContext, BecasToolResult } from '../../types/BecasFlow.types';
import { createLogger } from '../../../services/Logger';

const logger = createLogger('DataGroupTool');

export const dataGroupTool: BecasTool = {
  name: 'data_group',
  description: 'Group an array of data by a specified field, creating an object with field values as keys',
  category: 'data',

  parameters: {
    data: {
      type: 'array',
      description: 'Array of data to group (can reference previous step output)',
      required: true,
    },
    by: {
      type: 'string',
      description: 'Field name to group by (e.g., "action_type", "userId", "severity")',
      required: true,
    },
  },

  detectMissing: (params: any, context: BecasContext) => {
    if (!params.data) {
      return {
        param: 'data',
        prompt: 'What data should I group?',
        type: 'text',
      };
    }
    if (!params.by) {
      return {
        param: 'by',
        prompt: 'Which field should I group by?',
        type: 'text',
      };
    }
    return null;
  },

  async execute(params: any, context: BecasContext): Promise<BecasToolResult> {
    const startTime = Date.now();

    try {
      let { data, by } = params;

      logger.info(`Grouping data by "${by}"`);

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
          data: {},
          metadata: {
            groupCount: 0,
            totalItems: 0,
          },
        };
      }

      // Group data
      const grouped: Record<string, any[]> = {};

      for (const item of data) {
        const key = this.getNestedValue(item, by);
        const keyStr = String(key);

        if (!grouped[keyStr]) {
          grouped[keyStr] = [];
        }
        grouped[keyStr].push(item);
      }

      const groupCount = Object.keys(grouped).length;

      logger.info(`Grouped ${data.length} items into ${groupCount} groups`);

      return {
        success: true,
        data: grouped,
        metadata: {
          groupCount,
          totalItems: data.length,
          groups: Object.keys(grouped).map(key => ({
            key,
            count: grouped[key].length,
          })),
        },
      };

    } catch (error: any) {
      logger.error('Data group error:', error);
      return {
        success: false,
        error: `Failed to group data: ${error.message}`,
      };
    }
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
