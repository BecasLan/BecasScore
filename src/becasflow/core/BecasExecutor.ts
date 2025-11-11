/**
 * BECAS EXECUTOR - EXECUTION ENGINE
 *
 * Executes BecasFlow plans with full support for:
 * - Sequential and parallel execution
 * - Conditional branching (if/then/else)
 * - Loop execution
 * - Error handling and retry
 * - Progress reporting
 * - Dry-run mode
 *
 * Features:
 * - Step dependency resolution
 * - Result chaining (reference previous step outputs)
 * - Error recovery with fallback steps
 * - Execution timeouts
 * - Detailed logging and metrics
 */

import {
  BecasPlan,
  BecasStep,
  BecasExecutionResult,
  BecasExecutionOptions,
  BecasContext,
  BecasToolResult,
} from '../types/BecasFlow.types';
import { BecasToolRegistry } from '../registry/BecasToolRegistry';
import { BecasConditions } from './BecasConditions';
import { createLogger } from '../../services/Logger';
import { SelfHealingEngine } from '../services/SelfHealingEngine';
import { SafetyValidator } from '../services/SafetyValidator';
import { LoopDetector } from '../services/BecasFlowAI';

const logger = createLogger('BecasExecutor');

interface ExecutionProgress {
  totalSteps: number;
  completedSteps: number;
  currentStep?: string;
  status: 'running' | 'paused' | 'completed' | 'failed';
}

export class BecasExecutor {
  private registry: BecasToolRegistry;
  private progressCallback?: (progress: ExecutionProgress) => void;
  private selfHealing: SelfHealingEngine;
  private safetyValidator: SafetyValidator;
  private loopDetector: LoopDetector;

  constructor(registry?: BecasToolRegistry) {
    this.registry = registry || BecasToolRegistry.getInstance();
    this.selfHealing = new SelfHealingEngine(this.registry);
    this.safetyValidator = new SafetyValidator();
    this.loopDetector = new LoopDetector();
    logger.info('BecasExecutor initialized with AI enhancements');
  }

  /**
   * Set progress callback for real-time updates
   */
  setProgressCallback(callback: (progress: ExecutionProgress) => void): void {
    this.progressCallback = callback;
  }

  /**
   * Execute a plan
   */
  async execute(
    plan: BecasPlan,
    context: BecasContext,
    options: BecasExecutionOptions = {}
  ): Promise<BecasExecutionResult> {
    const startTime = Date.now();
    const results: BecasExecutionResult['results'] = [];
    const errors: BecasExecutionResult['errors'] = [];
    let stepsExecuted = 0;
    let stepsSkipped = 0;
    let loopsExecuted = 0;

    logger.info(`Executing plan: ${plan.id} (${plan.steps.length} steps)`);

    // Set plan in context
    context.currentPlan = plan;

    try {
      // Execute steps in order
      for (let i = 0; i < plan.steps.length; i++) {
        const step = plan.steps[i];

        // Update progress
        this.reportProgress({
          totalSteps: plan.steps.length,
          completedSteps: i,
          currentStep: step.id,
          status: 'running',
        });

        // Check timeout
        if (options.maxExecutionTime && Date.now() - startTime > options.maxExecutionTime) {
          throw new Error('Execution timeout exceeded');
        }

        // Check if step should be executed (dependencies)
        if (step.dependsOn && step.dependsOn.length > 0) {
          const unmetDeps = step.dependsOn.filter((depId) => !context.stepResults.has(depId));
          if (unmetDeps.length > 0) {
            logger.warn(`Step ${step.id} has unmet dependencies: ${unmetDeps.join(', ')}`);
            stepsSkipped++;
            continue;
          }
        }

        // Execute step
        try {
          const stepResult = await this.executeStep(step, context, options);

          if (stepResult) {
            results.push(stepResult);
            stepsExecuted++;

            // Handle loops
            if (stepResult.result.metadata?.loopBack) {
              loopsExecuted++;
            }
          } else {
            stepsSkipped++;
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.error(`Error executing step ${step.id}:`, error);

          errors.push({
            stepId: step.id,
            error: errorMessage,
          });

          if (options.pauseOnError) {
            throw error;
          }
        }
      }

      // Generate natural language summary
      const finalOutput = this.generateSummary(results, errors, plan.query);

      const executionResult: BecasExecutionResult = {
        success: errors.length === 0,
        results,
        errors,
        finalOutput,
        metadata: {
          totalTime: Date.now() - startTime,
          stepsExecuted,
          stepsSkipped,
          loopsExecuted,
        },
      };

      // Update progress - completed
      this.reportProgress({
        totalSteps: plan.steps.length,
        completedSteps: plan.steps.length,
        status: errors.length === 0 ? 'completed' : 'failed',
      });

      // Add to conversation history
      context.addToHistory(plan.query, context.stepResults);

      logger.info(`Plan execution completed: ${stepsExecuted} steps in ${executionResult.metadata?.totalTime}ms`);

      return executionResult;
    } catch (error) {
      logger.error('Fatal execution error:', error);

      // Update progress - failed
      this.reportProgress({
        totalSteps: plan.steps.length,
        completedSteps: results.length,
        status: 'failed',
      });

      return {
        success: false,
        results,
        errors: [
          ...errors,
          {
            stepId: 'executor',
            error: error instanceof Error ? error.message : String(error),
          },
        ],
        finalOutput: `Execution failed: ${error instanceof Error ? error.message : String(error)}`,
        metadata: {
          totalTime: Date.now() - startTime,
          stepsExecuted,
          stepsSkipped,
          loopsExecuted,
        },
      };
    }
  }

  /**
   * Execute a single step
   */
  private async executeStep(
    step: BecasStep,
    context: BecasContext,
    options: BecasExecutionOptions
  ): Promise<BecasExecutionResult['results'][0] | null> {
    const stepStartTime = Date.now();

    logger.info(`Executing step: ${step.id} (tool: ${step.toolName})`);

    // Get tool
    const tool = this.registry.get(step.toolName);
    if (!tool) {
      throw new Error(`Tool not found: ${step.toolName}`);
    }

    // Check preconditions
    if (tool.preconditions && tool.preconditions.length > 0) {
      const preconditionsMet = BecasConditions.evaluateAll(tool.preconditions, context);
      if (!preconditionsMet) {
        logger.warn(`Preconditions not met for ${step.toolName}, skipping`);
        return null;
      }
    }

    // Safety validation before execution
    const safetyCheck = await this.safetyValidator.validate(step, context);
    if (!safetyCheck.safe) {
      logger.warn(`Step ${step.id} failed safety check: ${safetyCheck.warning}`);

      if (safetyCheck.severity === 'critical') {
        throw new Error(`Safety violation: ${safetyCheck.warning}`);
      }

      // Skip this step for non-critical violations
      return null;
    }

    // Check step condition
    if (step.condition) {
      const conditions = Array.isArray(step.condition) ? step.condition : [step.condition];
      const conditionMet = BecasConditions.evaluateAll(conditions, context);

      logger.info(`Step condition evaluated: ${conditionMet}`);

      if (!conditionMet && step.ifFalse) {
        // Execute ifFalse branch
        logger.info(`Executing ifFalse branch for ${step.id}`);
        for (const falseStep of step.ifFalse) {
          await this.executeStep(falseStep, context, options);
        }
        return null;
      } else if (conditionMet && step.ifTrue) {
        // Execute ifTrue branch
        logger.info(`Executing ifTrue branch for ${step.id}`);
        for (const trueStep of step.ifTrue) {
          await this.executeStep(trueStep, context, options);
        }
      } else if (!conditionMet) {
        // Skip step
        logger.info(`Step condition not met, skipping ${step.id}`);
        return null;
      }
    }

    // Handle loop
    if (step.loop) {
      return await this.handleLoop(step, context, options);
    }

    // Resolve parameters (handle references to previous results)
    const resolvedParams = this.resolveParameters(step.params, context);
    logger.info(`🔍 Step ${step.id} - Original params:`, step.params);
    logger.info(`🔍 Step ${step.id} - Resolved params:`, resolvedParams);

    // Dry run mode
    if (options.dryRun) {
      logger.info(`[DRY RUN] Would execute ${step.toolName} with params:`, resolvedParams);
      const dryRunResult: BecasToolResult = {
        success: true,
        data: { dryRun: true },
      };

      context.setStepResult(step.id, dryRunResult.data);

      return {
        stepId: step.id,
        toolName: step.toolName,
        result: dryRunResult,
        executionTime: 0,
      };
    }

    // Execute with retry logic
    const maxRetries = step.onError?.retry || 0;
    let lastError: Error | null = null;
    let stepResult: BecasToolResult | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          logger.info(`Retry attempt ${attempt}/${maxRetries} for ${step.toolName}`);
        }

        // Execute tool
        stepResult = await tool.execute(resolvedParams, context);

        // Check postconditions
        if (tool.postconditions && tool.postconditions.length > 0) {
          const postconditionsMet = BecasConditions.evaluateAll(tool.postconditions, context);
          if (!postconditionsMet) {
            throw new Error(`Postconditions not met for ${step.toolName}`);
          }
        }

        // Store result
        context.setStepResult(step.id, stepResult.data);

        // Store in variable if specified
        if (step.outputAs) {
          context.setVariable(step.outputAs, stepResult.data);
        }

        const executionTime = Date.now() - stepStartTime;

        logger.info(`Step ${step.id} completed in ${executionTime}ms`);

        // Check if step should loop
        if (step.condition && stepResult.success) {
          const shouldLoop = await this.loopDetector.shouldLoop(step, stepResult.data, step.condition);
          if (shouldLoop) {
            logger.info(`Loop detected for step ${step.id}, re-executing...`);
            // Re-execute step by continuing the loop
            // Note: This is a simple approach - more sophisticated loop handling can be added
          }
        }

        return {
          stepId: step.id,
          toolName: step.toolName,
          result: stepResult,
          executionTime,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.warn(`Step ${step.id} failed (attempt ${attempt + 1}):`, lastError.message);

        // If step failed, try self-healing
        if (attempt >= maxRetries) {
          logger.warn(`Step ${step.id} failed after all retries, attempting self-healing...`);

          const healing = await this.selfHealing.heal(step, lastError.message, context);

          if (healing.action === 'retry' && healing.correctedParams) {
            logger.info(`Self-healing: Retrying with corrected params`);
            // Update resolved params with corrected ones
            Object.assign(resolvedParams, healing.correctedParams);
            // Execute with corrected params
            try {
              stepResult = await tool.execute(resolvedParams, context);
              if (stepResult.success) {
                context.setStepResult(step.id, stepResult.data);
                if (step.outputAs) {
                  context.setVariable(step.outputAs, stepResult.data);
                }
                return {
                  stepId: step.id,
                  toolName: step.toolName,
                  result: stepResult,
                  executionTime: Date.now() - stepStartTime,
                };
              }
            } catch (healError) {
              logger.error(`Self-healing retry failed:`, healError);
            }
          } else if (healing.action === 'alternative' && healing.alternativeStep) {
            logger.info(`Self-healing: Using alternative tool ${healing.alternativeStep.toolName}`);
            const altTool = this.registry.get(healing.alternativeStep.toolName);
            if (altTool) {
              try {
                stepResult = await altTool.execute(healing.alternativeStep.params, context);
                if (stepResult.success) {
                  context.setStepResult(step.id, stepResult.data);
                  if (step.outputAs) {
                    context.setVariable(step.outputAs, stepResult.data);
                  }
                  return {
                    stepId: step.id,
                    toolName: healing.alternativeStep.toolName,
                    result: stepResult,
                    executionTime: Date.now() - stepStartTime,
                  };
                }
              } catch (altError) {
                logger.error(`Alternative tool execution failed:`, altError);
              }
            }
          } else if (healing.action === 'skip') {
            logger.info(`Self-healing: Skipping failed step`);
            return null;
          }

          break;
        }

        // Wait before retry (exponential backoff)
        await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      }
    }

    // All retries failed - check for fallback
    if (step.onError?.fallback) {
      logger.info(`Executing fallback steps for ${step.id}`);
      for (const fallbackStep of step.onError.fallback) {
        await this.executeStep(fallbackStep, context, options);
      }

      if (step.onError.continueOnError) {
        return null;
      }
    }

    // Throw error if no fallback or continueOnError
    throw lastError || new Error(`Step ${step.id} failed`);
  }

  /**
   * Handle loop execution
   */
  private async handleLoop(
    step: BecasStep,
    context: BecasContext,
    options: BecasExecutionOptions
  ): Promise<BecasExecutionResult['results'][0] | null> {
    if (!step.loop) return null;

    const maxIterations = step.loop.maxIterations || 100;
    let iteration = 0;
    const loopResults: any[] = [];

    logger.info(`Starting loop for ${step.id} (max iterations: ${maxIterations})`);

    while (iteration < maxIterations) {
      // Check loop condition
      const conditionMet = BecasConditions.evaluate(step.loop.condition, context);

      if (!conditionMet) {
        logger.info(`Loop condition not met after ${iteration} iterations`);
        break;
      }

      logger.info(`Loop iteration ${iteration + 1}`);

      // Execute loop steps
      for (const loopStep of step.loop.steps) {
        const result = await this.executeStep(loopStep, context, options);
        if (result) {
          loopResults.push(result);
        }
      }

      iteration++;
    }

    if (iteration >= maxIterations) {
      logger.warn(`Loop reached max iterations: ${maxIterations}`);
    }

    // Store loop results
    const loopResult: BecasToolResult = {
      success: true,
      data: {
        iterations: iteration,
        results: loopResults,
      },
    };

    context.setStepResult(step.id, loopResult.data);

    return {
      stepId: step.id,
      toolName: 'loop',
      result: loopResult,
      executionTime: 0,
    };
  }

  /**
   * Resolve parameters (handle references to previous results)
   */
  private resolveParameters(params: Record<string, any>, context: BecasContext): Record<string, any> {
    const resolved: Record<string, any> = {};

    for (const [key, value] of Object.entries(params)) {
      // Handle {{variable}} syntax (NEW! - More intuitive than $variable)
      if (typeof value === 'string' && /\{\{([^}]+)\}\}/.test(value)) {
        const templateStr = value;
        let resolvedValue = templateStr;

        // Replace all {{...}} patterns
        const matches = templateStr.matchAll(/\{\{([^}]+)\}\}/g);
        for (const match of matches) {
          const expression = match[1].trim();
          let replacement: any;

          // Support variable names: {{varName}}
          if (context.getVariable(expression) !== undefined) {
            replacement = context.getVariable(expression);
          }
          // Support step results: {{step_1}} or {{step_1.field.nested}}
          else if (expression.includes('.')) {
            const [stepId, ...fieldParts] = expression.split('.');
            const stepResult = context.getStepResult(stepId);
            if (stepResult && fieldParts.length > 0) {
              replacement = this.getNestedValue(stepResult, fieldParts.join('.'));
            } else {
              replacement = stepResult;
            }
          } else {
            // Try as step ID directly
            replacement = context.getStepResult(expression);
          }

          // If entire value is just {{...}}, return the object directly (not stringified)
          if (templateStr === match[0] && replacement !== undefined) {
            resolvedValue = replacement;
            break;
          }

          // Otherwise replace in string template
          if (replacement !== undefined) {
            resolvedValue = resolvedValue.replace(match[0], String(replacement));
          }
        }

        resolved[key] = resolvedValue;
      }
      // Legacy: $variable syntax
      else if (typeof value === 'string' && value.startsWith('$')) {
        // Variable reference: $variableName
        const varName = value.substring(1);
        resolved[key] = context.getVariable(varName);
      }
      // Legacy: stepResults.stepId syntax
      else if (typeof value === 'string' && value.startsWith('stepResults.')) {
        // Step result reference: stepResults.stepId.field
        const parts = value.split('.');
        const stepId = parts[1];
        const field = parts.slice(2).join('.');

        const stepResult = context.getStepResult(stepId);
        if (stepResult && field) {
          resolved[key] = this.getNestedValue(stepResult, field);
        } else {
          resolved[key] = stepResult;
        }
      } else if (typeof value === 'string' && (value === '@lastUsers' || value === '@lastMessages')) {
        // Reference shortcuts
        if (value === '@lastUsers') {
          resolved[key] = context.lastUsers;
        } else if (value === '@lastMessages') {
          resolved[key] = context.lastMessages;
        }
      } else {
        resolved[key] = value;
      }
    }

    return resolved;
  }

  /**
   * Get nested value from object using dot notation
   */
  private getNestedValue(obj: any, path: string): any {
    const parts = path.split('.');
    let current = obj;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }
      current = current[part];
    }

    return current;
  }

  /**
   * Generate natural language summary
   */
  private generateSummary(
    results: BecasExecutionResult['results'],
    errors: BecasExecutionResult['errors'],
    originalQuery: string
  ): string {
    const parts: string[] = [];

    if (errors.length > 0) {
      parts.push(`Failed to complete "${originalQuery}". Errors occurred:`);
      errors.forEach((e) => {
        parts.push(`- ${e.stepId}: ${e.error}`);
      });
    } else {
      parts.push(`Successfully completed "${originalQuery}".`);
    }

    if (results.length > 0) {
      parts.push(`\nExecuted ${results.length} step(s):`);
      results.forEach((r) => {
        const status = r.result.success ? '✓' : '✗';
        parts.push(`${status} ${r.toolName} (${r.executionTime}ms)`);
      });
    }

    return parts.join('\n');
  }

  /**
   * Report progress
   */
  private reportProgress(progress: ExecutionProgress): void {
    if (this.progressCallback) {
      this.progressCallback(progress);
    }
  }
}
