/**
 * DATA FILTER TOOL
 *
 * Filters data arrays based on conditions.
 * Part of the data manipulation toolset for multi-step BecasFlow pipelines.
 */

import { BecasTool, BecasContext, BecasToolResult } from '../../types/BecasFlow.types';
import { createLogger } from '../../../services/Logger';

const logger = createLogger('DataFilterTool');

export const dataFilterTool: BecasTool = {
  name: 'data_filter',
  description: 'Filter an array of data based on conditions (equals, contains, greater than, etc.)',
  category: 'data',

  parameters: {
    data: {
      type: 'array',
      description: 'Array of data to filter (can reference previous step output)',
      required: true,
    },
    field: {
      type: 'string',
      description: 'Field name to filter by (e.g., "action_type", "severity")',
      required: false,
    },
    condition: {
      type: 'string',
      description: 'Filter condition type',
      required: false,
      default: 'equals',
      enum: ['equals', 'contains', 'greater_than', 'less_than', 'not_equals', 'in_array'],
    },
    value: {
      type: 'string',
      description: 'Value to compare against',
      required: false,
    },
  },

  detectMissing: (params: any, context: BecasContext) => {
    if (!params.data) {
      return {
        param: 'data',
        prompt: 'What data should I filter? (Provide data array or reference previous step)',
        type: 'text' as const,
      };
    }
    return null;
  },

  async execute(params: any, context: BecasContext): Promise<BecasToolResult> {
    const startTime = Date.now();

    try {
      let { data, field, condition, value } = params;

      logger.info(`Filtering data: field=${field}, condition=${condition}, value=${value}`);

      // Validate data is an array
      if (!Array.isArray(data)) {
        return {
          success: false,
          error: 'Data must be an array',
          executionTime: Date.now() - startTime,
        };
      }

      // If no field specified, return original data
      if (!field && !condition) {
        logger.warn('No filter conditions specified, returning original data');
        return {
          success: true,
          data: data,
          message: `No filters applied. Returned ${data.length} items.`,
          executionTime: Date.now() - startTime,
        };
      }

      // Apply filter
      const filtered = data.filter((item: any) => {
        // If no field, can't filter
        if (!field) return true;

        const fieldValue = this.getNestedValue(item, field);

        switch (condition) {
          case 'equals':
            return fieldValue === value;

          case 'not_equals':
            return fieldValue !== value;

          case 'contains':
            return typeof fieldValue === 'string' && fieldValue.toLowerCase().includes(String(value).toLowerCase());

          case 'greater_than':
            return Number(fieldValue) > Number(value);

          case 'less_than':
            return Number(fieldValue) < Number(value);

          case 'in_array':
            return Array.isArray(value) && value.includes(fieldValue);

          default:
            return true;
        }
      });

      logger.info(`Filtered ${data.length} items → ${filtered.length} items`);

      return {
        success: true,
        data: filtered,
        message: `Filtered from ${data.length} to ${filtered.length} items using ${condition} on ${field}`,
        metadata: {
          originalCount: data.length,
          filteredCount: filtered.length,
          field,
          condition,
          value,
        },
        executionTime: Date.now() - startTime,
      };

    } catch (error: any) {
      logger.error('Data filter error:', error);
      return {
        success: false,
        error: `Failed to filter data: ${error.message}`,
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
   * Get period cutoff time (not needed for this tool, but keeping interface consistent)
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
