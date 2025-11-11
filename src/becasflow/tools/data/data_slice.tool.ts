/**
 * DATA SLICE TOOL
 *
 * Extracts a portion of data array (first N, last N, or range).
 * Part of the data manipulation toolset for multi-step BecasFlow pipelines.
 */

import { BecasTool, BecasContext, BecasToolResult } from '../../types/BecasFlow.types';
import { createLogger } from '../../../services/Logger';

const logger = createLogger('DataSliceTool');

export const dataSliceTool: BecasTool = {
  name: 'data_slice',
  description: 'Extract a portion of data array - first N, last N, or specific range',
  category: 'data',

  parameters: {
    data: {
      type: 'array',
      description: 'Array of data to slice (can reference previous step output)',
      required: true,
    },
    mode: {
      type: 'string',
      description: 'Slice mode',
      required: false,
      default: 'first',
      enum: ['first', 'last', 'range'],
    },
    count: {
      type: 'number',
      description: 'Number of items to take (for first/last mode)',
      required: false,
      default: 1,
    },
    start: {
      type: 'number',
      description: 'Start index (for range mode)',
      required: false,
    },
    end: {
      type: 'number',
      description: 'End index (for range mode)',
      required: false,
    },
  },

  detectMissing: (params: any, context: BecasContext) => {
    if (!params.data) {
      return {
        param: 'data',
        prompt: 'What data should I slice?',
        type: 'text' as const,
      };
    }
    return null;
  },

  async execute(params: any, context: BecasContext): Promise<BecasToolResult> {
    const startTime = Date.now();

    try {
      let { data, mode, count, start, end } = params;

      logger.info(`Slicing data: mode=${mode}, count=${count}, start=${start}, end=${end}`);

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
          message: 'No data to slice',
          executionTime: Date.now() - startTime,
        };
      }

      let sliced: any[];
      let description: string;

      switch (mode) {
        case 'first':
          sliced = data.slice(0, count || 1);
          description = `First ${sliced.length} item(s)`;
          break;

        case 'last':
          sliced = data.slice(-(count || 1));
          description = `Last ${sliced.length} item(s)`;
          break;

        case 'range':
          const startIdx = start || 0;
          const endIdx = end !== undefined ? end : data.length;
          sliced = data.slice(startIdx, endIdx);
          description = `Items from index ${startIdx} to ${endIdx}`;
          break;

        default:
          sliced = data.slice(0, count || 1);
          description = `First ${sliced.length} item(s)`;
      }

      logger.info(`Sliced ${data.length} items → ${sliced.length} items (${mode})`);

      return {
        success: true,
        data: sliced,
        message: `${description} from ${data.length} total items`,
        metadata: {
          originalCount: data.length,
          slicedCount: sliced.length,
          mode,
          count,
          start,
          end,
        },
        executionTime: Date.now() - startTime,
      };

    } catch (error: any) {
      logger.error('Data slice error:', error);
      return {
        success: false,
        error: `Failed to slice data: ${error.message}`,
        executionTime: Date.now() - startTime,
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
