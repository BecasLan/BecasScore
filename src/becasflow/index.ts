/**
 * BECASFLOW FRAMEWORK - MAIN EXPORTS
 *
 * Complete Discord-native AI workflow automation framework.
 *
 * Usage:
 * ```typescript
 * import { BecasFlow, registerAllTools } from './becasflow';
 *
 * // Initialize
 * const becasFlow = new BecasFlow(ollamaService);
 * registerAllTools();
 *
 * // Use
 * const result = await becasFlow.execute("ban user @spammer", context);
 * ```
 */

// Core types
export * from './types/BecasFlow.types';

// Core systems
export { BecasConditions } from './core/BecasConditions';
export { BecasContext } from './core/BecasContext';
export { BecasPlanner } from './core/BecasPlanner';
export { BecasExecutor } from './core/BecasExecutor';
export { BecasInteractive } from './core/BecasInteractive';

// Registry
export { BecasToolRegistry, toolRegistry } from './registry/BecasToolRegistry';

// Tools
export * from './tools';

// Main BecasFlow class
import { OllamaService } from '../services/OllamaService';
import { BecasPlanner } from './core/BecasPlanner';
import { BecasExecutor } from './core/BecasExecutor';
import { BecasToolRegistry } from './registry/BecasToolRegistry';
import { BecasContext } from './core/BecasContext';
import { BecasExecutionResult, BecasPlanningOptions, BecasExecutionOptions } from './types/BecasFlow.types';
import { Message } from 'discord.js';
import { createLogger } from '../services/Logger';

const logger = createLogger('BecasFlow');

export class BecasFlow {
  private planner: BecasPlanner;
  private executor: BecasExecutor;
  private registry: BecasToolRegistry;

  constructor(ollama?: OllamaService, registry?: BecasToolRegistry) {
    this.registry = registry || BecasToolRegistry.getInstance();
    this.planner = new BecasPlanner(ollama, this.registry);
    this.executor = new BecasExecutor(this.registry);

    logger.info('BecasFlow framework initialized');
  }

  /**
   * Execute natural language query
   */
  async execute(
    query: string,
    message: Message,
    services: any = {},
    options: {
      planning?: BecasPlanningOptions;
      execution?: BecasExecutionOptions;
    } = {}
  ): Promise<BecasExecutionResult> {
    try {
      logger.info(`Executing query: "${query}"`);

      // Create context
      const context = new BecasContext(message, services);

      // Create plan
      const planningResult = await this.planner.createPlan(
        query,
        context,
        options.planning
      );

      if (!planningResult.success || !planningResult.plan) {
        return {
          success: false,
          results: [],
          errors: [
            {
              stepId: 'planner',
              error: planningResult.error || 'Failed to create plan',
            },
          ],
          finalOutput: `Failed to plan: ${planningResult.error || 'Unknown error'}`,
        };
      }

      // Check for missing information
      if (planningResult.missingInfo && planningResult.missingInfo.length > 0) {
        return {
          success: false,
          results: [],
          errors: [
            {
              stepId: 'planner',
              error: 'Missing required information',
            },
          ],
          finalOutput: `Missing information:\n${planningResult.missingInfo
            .map((m) => `- ${m.prompt}`)
            .join('\n')}`,
        };
      }

      // Execute plan
      const executionResult = await this.executor.execute(
        planningResult.plan,
        context,
        options.execution
      );

      return executionResult;
    } catch (error) {
      logger.error('BecasFlow execution error:', error);
      return {
        success: false,
        results: [],
        errors: [
          {
            stepId: 'becasflow',
            error: error instanceof Error ? error.message : String(error),
          },
        ],
        finalOutput: `Execution failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Get planner instance
   */
  getPlanner(): BecasPlanner {
    return this.planner;
  }

  /**
   * Get executor instance
   */
  getExecutor(): BecasExecutor {
    return this.executor;
  }

  /**
   * Get registry instance
   */
  getRegistry(): BecasToolRegistry {
    return this.registry;
  }

  /**
   * Set progress callback for real-time updates
   */
  setProgressCallback(callback: (progress: any) => void): void {
    this.executor.setProgressCallback(callback);
  }
}

// Default export
export default BecasFlow;
