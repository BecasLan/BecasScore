/**
 * DATA TRANSFORM TOOL
 *
 * Transforms data by picking/omitting fields, or mapping values.
 * Part of the data manipulation toolset for multi-step BecasFlow pipelines.
 */

import { BecasTool, BecasContext, BecasToolResult } from '../../types/BecasFlow.types';
import { createLogger } from '../../../services/Logger';

const logger = createLogger('DataTransformTool');

export const dataTransformTool: BecasTool = {
  name: 'data_transform',
  description: 'Transform data by picking specific fields, omitting fields, or renaming fields',
  category: 'data',

  parameters: {
    data: {
      type: 'array',
      description: 'Array of data to transform (can reference previous step output)',
      required: true,
    },
    mode: {
      type: 'string',
      description: 'Transformation mode',
      required: true,
      enum: ['pick', 'omit', 'rename'],
    },
    fields: {
      type: 'array',
      description: 'Fields to pick/omit (array of field names)',
      required: false,
    },
    mapping: {
      type: 'object',
      description: 'Field rename mapping (for rename mode) - {oldName: newName}',
      required: false,
    },
  },

  detectMissing: (params: any, context: BecasContext) => {
    if (!params.data) {
      return {
        param: 'data',
        prompt: 'What data should I transform?',
        type: 'text',
      };
    }
    if (!params.mode) {
      return {
        param: 'mode',
        prompt: 'Which transformation mode? (pick, omit, rename)',
        type: 'text' as const,
        options: [
          { label: 'pick', value: 'pick' },
          { label: 'omit', value: 'omit' },
          { label: 'rename', value: 'rename' }
        ],
      };
    }
    return null;
  },

  async execute(params: any, context: BecasContext): Promise<BecasToolResult> {
    const startTime = Date.now();

    try {
      let { data, mode, fields, mapping } = params;

      logger.info(`Transforming data: mode=${mode}, fields=${fields}, mapping=${mapping}`);

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
          data: [],
        };
      }

      let transformed: any[];

      switch (mode) {
        case 'pick':
          if (!fields || !Array.isArray(fields)) {
            return {
              success: false,
              error: 'Fields array required for pick mode',
            };
          }
          transformed = data.map(item => this.pickFields(item, fields));
          break;

        case 'omit':
          if (!fields || !Array.isArray(fields)) {
            return {
              success: false,
              error: 'Fields array required for omit mode',
            };
          }
          transformed = data.map(item => this.omitFields(item, fields));
          break;

        case 'rename':
          if (!mapping || typeof mapping !== 'object') {
            return {
              success: false,
              error: 'Mapping object required for rename mode',
            };
          }
          transformed = data.map(item => this.renameFields(item, mapping));
          break;

        default:
          return {
            success: false,
            error: `Unknown transformation mode: ${mode}`,
          };
      }

      logger.info(`Transformed ${data.length} items`);

      return {
        success: true,
        data: transformed,
        metadata: {
          mode,
          fields,
          mapping,
          totalItems: transformed.length,
        },
      };

    } catch (error: any) {
      logger.error('Data transform error:', error);
      return {
        success: false,
        error: `Failed to transform data: ${error.message}`,
      };
    }
  },

  /**
   * Pick only specified fields from object
   */
  pickFields(obj: any, fields: string[]): any {
    const result: any = {};
    for (const field of fields) {
      if (field.includes('.')) {
        // Nested field - preserve structure
        const value = this.getNestedValue(obj, field);
        this.setNestedValue(result, field, value);
      } else {
        // Top-level field
        if (obj.hasOwnProperty(field)) {
          result[field] = obj[field];
        }
      }
    }
    return result;
  },

  /**
   * Omit specified fields from object
   */
  omitFields(obj: any, fields: string[]): any {
    const result = { ...obj };
    for (const field of fields) {
      delete result[field];
    }
    return result;
  },

  /**
   * Rename fields in object
   */
  renameFields(obj: any, mapping: Record<string, string>): any {
    const result = { ...obj };
    for (const [oldName, newName] of Object.entries(mapping)) {
      if (result.hasOwnProperty(oldName)) {
        result[newName] = result[oldName];
        delete result[oldName];
      }
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
   * Set nested value in object using dot notation
   */
  setNestedValue(obj: any, path: string, value: any): void {
    const parts = path.split('.');
    const last = parts.pop()!;
    const target = parts.reduce((current, part) => {
      if (!current[part]) current[part] = {};
      return current[part];
    }, obj);
    target[last] = value;
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
