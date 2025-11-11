/**
 * SELF-HEALING ENGINE
 *
 * Automatically fixes failed pipeline steps by:
 * 1. Analyzing the error
 * 2. Suggesting alternative tools
 * 3. Correcting parameters
 * 4. Deciding whether to skip or retry
 */

import { OllamaService } from '../../services/OllamaService';
import { createLogger } from '../../services/Logger';
import { BecasStep, BecasContext } from '../types/BecasFlow.types';
import { BecasToolRegistry } from '../registry/BecasToolRegistry';

const logger = createLogger('SelfHealingEngine');

export interface HealingResult {
  action: 'retry' | 'alternative' | 'skip' | 'fail';
  alternativeStep?: BecasStep;
  correctedParams?: Record<string, any>;
  reasoning?: string;
}

export class SelfHealingEngine {
  private ollama: OllamaService;
  private registry: BecasToolRegistry;

  constructor(registry?: BecasToolRegistry) {
    this.ollama = new OllamaService('selfHealing');
    this.registry = registry || BecasToolRegistry.getInstance();
    logger.info('SelfHealingEngine initialized');
  }

  /**
   * Attempt to heal a failed step
   */
  async heal(
    failedStep: BecasStep,
    error: string,
    context: BecasContext
  ): Promise<HealingResult> {
    try {
      logger.info(`Attempting to heal failed step: ${failedStep.toolName}`);

      const tool = this.registry.get(failedStep.toolName);
      if (!tool) {
        return { action: 'fail', reasoning: 'Tool not found' };
      }

      // Build healing prompt
      const systemPrompt = `You are a self-healing AI for a tool execution pipeline.

A tool failed. Analyze the error and suggest a fix.

RESPONSE FORMAT (JSON only):
{
  "action": "retry" | "alternative" | "skip" | "fail",
  "reasoning": "<why this action>",
  "alternativeTool": "<tool name>" (if alternative),
  "correctedParams": {<params>} (if retry)
}

Actions:
- retry: Fix parameters and try again
- alternative: Use a different tool that can achieve same goal
- skip: Skip this step, continue pipeline
- fail: Cannot recover, fail pipeline`;

      const userPrompt = `Failed Tool: ${failedStep.toolName}
Description: ${tool.description}
Parameters: ${JSON.stringify(failedStep.params, null, 2)}
Error: ${error}

Available alternative tools:
${this.getAlternativeTools(tool.category).map(t => `- ${t.name}: ${t.description}`).join('\n')}

What should we do?`;

      const response = await this.ollama.generate(systemPrompt, userPrompt);

      // Parse response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        logger.warn('AI did not return valid JSON, failing');
        return { action: 'fail', reasoning: 'Invalid AI response' };
      }

      const result = JSON.parse(jsonMatch[0]);
      logger.info(`Healing decision: ${result.action}`);

      return {
        action: result.action,
        reasoning: result.reasoning,
        alternativeStep: result.alternativeTool ? {
          ...failedStep,
          toolName: result.alternativeTool,
        } : undefined,
        correctedParams: result.correctedParams,
      };

    } catch (error: any) {
      logger.error('Self-healing error:', error);
      return { action: 'fail', reasoning: error.message };
    }
  }

  /**
   * Get alternative tools in same category
   */
  private getAlternativeTools(category: string): any[] {
    return this.registry.getAll().filter(t => t.category === category).slice(0, 5);
  }
}
