// ActionPlanner.ts - AI-powered action planning
// Allows AI to intelligently select and chain actions based on natural language

import { Message, GuildMember } from 'discord.js';
import { ActionRegistry } from '../systems/ActionRegistry';
import { ActionPlan } from '../systems/ActionExecutor';
import { OllamaService } from '../services/OllamaService';
import { createLogger } from '../services/Logger';

const logger = createLogger('ActionPlanner');

export interface PlannerContext {
  message: Message;
  executor: GuildMember;
  commandText: string;
  recentContext?: string;
  lastActionSummary?: string;
}

export class ActionPlanner {
  private registry: ActionRegistry;
  private ollama: OllamaService;

  constructor(registry: ActionRegistry, ollama: OllamaService) {
    this.registry = registry;
    this.ollama = ollama;
    logger.info('ActionPlanner initialized');
  }

  /**
   * Create an action plan from natural language command
   */
  async createPlan(context: PlannerContext): Promise<ActionPlan> {
    logger.info(`Creating action plan for: "${context.commandText}"`);

    // Generate AI prompt with all available actions
    const actionsPrompt = this.registry.generateAIPrompt(context.executor);

    const prompt = `You are Becas, an advanced AI Discord moderator. Analyze this command and create an execution plan.

${actionsPrompt}

MODERATOR COMMAND: "${context.commandText}"

RECENT CONTEXT:
${context.recentContext || 'No recent context'}

LAST ACTION:
${context.lastActionSummary || 'No recent actions'}

YOUR TASK:
1. Understand what the moderator wants to accomplish
2. Select the BEST action(s) from the available tools above
3. Extract required parameters from the command
4. Determine if confirmation is needed (for destructive actions)
5. Create a natural response to the moderator

PARAMETER EXTRACTION RULES:
- Extract @mentions as user IDs
- Extract #channels as channel IDs
- Extract numbers for durations, counts, etc.
- Infer missing parameters from context when possible
- Use defaults when appropriate

MULTI-ACTION CHAINING:
- If the command requires multiple steps, create multiple actions
- Order actions logically (e.g., lock channel BEFORE deleting messages)
- Example: "lock channel and delete last 10 messages" = 2 actions

UNDO DETECTION:
- If command says "undo", "take it back", "I changed my mind", etc.
- AND there was a recent action
- Return special action: action_id="UNDO_LAST" with no parameters

Return ONLY valid JSON:
{
  "understood_intent": "brief description of what moderator wants",
  "actions": [
    {
      "action_id": "action_id_here",
      "parameters": {
        "param_name": "value"
      },
      "reason": "why this action is needed"
    }
  ],
  "requires_confirmation": true/false,
  "response_to_moderator": "natural language response explaining what you'll do"
}

IMPORTANT:
- Be precise with parameter types (user IDs, channel IDs, numbers)
- Double-check parameter names match the action definition
- For bulk actions, use appropriate filters (trustScoreMin/Max, etc.)
- Always provide helpful response_to_moderator text`;

    const systemPrompt = `You are an expert at understanding natural language commands and selecting the right tools. You analyze moderator intent and create precise execution plans.`;

    try {
      const response = await this.ollama.generate(prompt, systemPrompt);

      // Clean and parse JSON
      let cleaned = response.trim();
      cleaned = cleaned.replace(/```json\s*/g, '');
      cleaned = cleaned.replace(/```\s*/g, '');
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) cleaned = jsonMatch[0];
      cleaned = cleaned.replace(/,(\s*[}\]])/g, '$1');

      const plan: ActionPlan = JSON.parse(cleaned);

      logger.info(`Plan created: ${plan.understood_intent}`);
      logger.info(`Actions: ${plan.actions.map(a => a.action_id).join(', ')}`);

      return plan;

    } catch (error: any) {
      logger.error('Failed to create action plan:', error);

      // Fallback: return error plan
      return {
        understood_intent: 'Failed to understand command',
        actions: [],
        requires_confirmation: false,
        response_to_moderator: `Sorry, I couldn't understand that command. Error: ${error.message}`
      };
    }
  }

  /**
   * Create undo plan for last action
   */
  async createUndoPlan(context: PlannerContext): Promise<ActionPlan> {
    return {
      understood_intent: 'Undo last action',
      actions: [
        {
          action_id: 'UNDO_LAST',
          parameters: {}
        }
      ],
      requires_confirmation: false,
      response_to_moderator: 'Undoing the last action...'
    };
  }

  /**
   * Validate a plan before execution
   */
  validatePlan(plan: ActionPlan): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!plan.actions || plan.actions.length === 0) {
      errors.push('No actions in plan');
    }

    for (const actionStep of plan.actions) {
      // Check if action exists
      const action = this.registry.get(actionStep.action_id);
      if (!action && actionStep.action_id !== 'UNDO_LAST') {
        errors.push(`Unknown action: ${actionStep.action_id}`);
        continue;
      }

      if (action) {
        // Validate parameters
        const paramValidation = this.registry.validateParameters(action, actionStep.parameters);
        if (!paramValidation.valid) {
          errors.push(`${action.id}: ${paramValidation.errors.join(', ')}`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}
