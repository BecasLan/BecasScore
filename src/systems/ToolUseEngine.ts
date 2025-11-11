// ToolUseEngine.ts - AI Function Calling for Discord Actions
// Allows AI to directly call Discord API functions as tools

import { Message, GuildMember } from 'discord.js';
import { ActionRegistry, Action } from './ActionRegistry';
import { ActionExecutor, ActionPlan } from './ActionExecutor';
import { OllamaService } from '../services/OllamaService';
import { createLogger } from '../services/Logger';

const logger = createLogger('ToolUseEngine');

// ============================================
// TOOL DEFINITIONS (OpenAI Function Calling Format)
// ============================================

export interface ToolParameter {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  enum?: string[];
  required?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, ToolParameter>;
    required: string[];
  };
}

export interface ToolCall {
  tool_name: string;
  parameters: Record<string, any>;
  reason: string;
}

export interface ToolUseDecision {
  should_use_tools: boolean;
  reasoning: string;
  tool_calls: ToolCall[];
  response_to_user?: string;
}

// ============================================
// TOOL USE ENGINE
// ============================================

export class ToolUseEngine {
  private registry: ActionRegistry;
  private executor: ActionExecutor;
  private ollama: OllamaService;

  constructor(registry: ActionRegistry, executor: ActionExecutor, ollama: OllamaService) {
    this.registry = registry;
    this.executor = executor;
    this.ollama = ollama;
    logger.info('ToolUseEngine initialized - AI can now call Discord functions directly');
  }

  /**
   * Generate tool definitions from ActionRegistry
   * Converts Discord actions into OpenAI-style function definitions
   */
  generateToolDefinitions(member: GuildMember): ToolDefinition[] {
    const actions = this.registry.getAll();
    const tools: ToolDefinition[] = [];

    for (const action of actions) {
      // Check if member has permissions
      const hasPermissions = action.requiredPermissions.every(perm =>
        member.permissions.has(perm)
      );

      if (!hasPermissions) continue;

      // Convert action to tool definition
      const properties: Record<string, ToolParameter> = {};
      const required: string[] = [];

      for (const param of action.parameters) {
        properties[param.name] = {
          type: this.mapParameterType(param.type),
          description: param.description,
          enum: param.validation?.enum,
        };

        if (param.required) {
          required.push(param.name);
        }
      }

      tools.push({
        name: action.id,
        description: `${action.description}. Examples: ${action.examples.join(' | ')}`,
        parameters: {
          type: 'object',
          properties,
          required,
        },
      });
    }

    logger.info(`Generated ${tools.length} tool definitions for AI`);
    return tools;
  }

  /**
   * Map ActionRegistry parameter types to JSON schema types
   */
  private mapParameterType(type: string): 'string' | 'number' | 'boolean' | 'object' | 'array' {
    switch (type) {
      case 'number':
      case 'duration':
        return 'number';
      case 'boolean':
        return 'boolean';
      case 'user':
      case 'channel':
      case 'role':
      case 'message':
      case 'string':
      default:
        return 'string';
    }
  }

  /**
   * Ask AI if it wants to use tools for this message
   * Returns tool calls if AI decides to take action
   */
  async decideToolUse(
    message: Message,
    executor: GuildMember,
    context: string
  ): Promise<ToolUseDecision> {
    const tools = this.generateToolDefinitions(executor);

    // Create tool use prompt
    const toolDescriptions = tools
      .map(
        (t) =>
          `- ${t.name}: ${t.description}\n  Params: ${Object.keys(t.parameters.properties).join(', ')}`
      )
      .join('\n');

    const prompt = `
MESSAGE: "${message.content}"
AUTHOR: ${message.author.tag}
CONTEXT: ${context}

AVAILABLE TOOLS (${tools.length}):
${toolDescriptions}

Should you take action? Analyze the message and decide:
1. Is this a moderation issue? (spam, toxicity, rule violation)
2. Is this a command for you? (user asking you to do something)
3. Should you use any tools?

Return JSON decision:
{
  "should_use_tools": true/false,
  "reasoning": "why you decided this",
  "tool_calls": [
    {
      "tool_name": "action_id",
      "parameters": {"param": "value"},
      "reason": "why using this tool"
    }
  ],
  "response_to_user": "optional message to user"
}

If NO action needed, return {"should_use_tools": false, "reasoning": "...", "tool_calls": [], "response_to_user": "..."}.
`;

    const systemPrompt = `You are an AI moderator with direct access to Discord moderation tools.
CRITICAL RULES:
1. ONLY use tools when absolutely necessary (rule violations, spam, clear commands)
2. DO NOT over-moderate casual conversations
3. Warn before timeout/ban (unless severe violation)
4. Be conservative - false positives are worse than false negatives
5. Return ONLY valid JSON, no explanations outside JSON.`;

    try {
      const decision = await this.ollama.generateJSON<ToolUseDecision>(prompt, systemPrompt);

      logger.info(`Tool use decision: ${decision.should_use_tools ? 'YES' : 'NO'} - ${decision.reasoning}`);

      if (decision.should_use_tools && decision.tool_calls.length > 0) {
        logger.info(`AI wants to call ${decision.tool_calls.length} tools: ${decision.tool_calls.map(t => t.tool_name).join(', ')}`);
      }

      return decision;

    } catch (error: any) {
      logger.error('Tool use decision error:', error);
      return {
        should_use_tools: false,
        reasoning: `Error in decision making: ${error.message}`,
        tool_calls: [],
      };
    }
  }

  /**
   * Execute AI's tool calls
   * Converts ToolCall[] into ActionPlan and executes via ActionExecutor
   */
  async executeToolCalls(
    message: Message,
    executor: GuildMember,
    decision: ToolUseDecision
  ): Promise<{ success: boolean; message: string }> {
    if (!decision.should_use_tools || decision.tool_calls.length === 0) {
      return {
        success: true,
        message: decision.response_to_user || 'No action taken',
      };
    }

    // Convert tool calls to action plan
    const actionPlan: ActionPlan = {
      understood_intent: decision.reasoning,
      actions: decision.tool_calls.map((call) => ({
        action_id: call.tool_name,
        parameters: call.parameters,
        reason: call.reason,
      })),
      requires_confirmation: false,
      response_to_moderator: decision.response_to_user || '',
    };

    logger.info(`Executing ${actionPlan.actions.length} tool calls from AI decision`);

    // Execute via ActionExecutor
    const result = await this.executor.execute({
      message,
      executor,
      plan: actionPlan,
    });

    if (result.success) {
      logger.info(`✅ Tool execution SUCCESS - ${result.totalAffectedUsers} users, ${result.totalAffectedChannels} channels`);
      return {
        success: true,
        message:
          decision.response_to_user ||
          `Action completed: ${actionPlan.actions.map((a) => a.action_id).join(', ')}`,
      };
    } else {
      logger.error(`❌ Tool execution FAILED: ${result.error}`);
      return {
        success: false,
        message: `Failed to execute: ${result.error}`,
      };
    }
  }

  /**
   * Full tool use pipeline: decide + execute
   */
  async processMessage(
    message: Message,
    executor: GuildMember,
    context: string
  ): Promise<{ used_tools: boolean; response: string }> {
    // Step 1: AI decides if tools should be used
    const decision = await this.decideToolUse(message, executor, context);

    // Step 2: Execute tools if AI decided to use them
    const result = await this.executeToolCalls(message, executor, decision);

    return {
      used_tools: decision.should_use_tools,
      response: result.message,
    };
  }

  /**
   * Get statistics about tool usage
   */
  getToolStats(): { total_tools: number; most_used: string[] } {
    const actions = this.registry.getAll();
    return {
      total_tools: actions.length,
      most_used: actions.slice(0, 5).map((a) => a.id), // TODO: Track actual usage
    };
  }
}
