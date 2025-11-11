/**
 * PARAMETER INFERENCE ENGINE
 *
 * Intelligently infers missing parameters from context.
 * If uncertain, creates interactive Discord button prompts for user input.
 */

import { OllamaService } from '../../services/OllamaService';
import { createLogger } from '../../services/Logger';
import { BecasContext, BecasTool, BecasMissingParam } from '../types/BecasFlow.types';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Message } from 'discord.js';

const logger = createLogger('ParameterInferenceEngine');

export interface InferenceResult {
  success: boolean;
  value?: any;
  confidence?: number; // 0-1
  needsUserInput?: boolean;
  prompt?: BecasMissingParam; // For interactive prompts
}

export class ParameterInferenceEngine {
  private ollama: OllamaService;
  private pendingPrompts: Map<string, {
    resolve: (value: any) => void;
    reject: (reason: any) => void;
    timeout: NodeJS.Timeout;
  }>;

  constructor() {
    this.ollama = new OllamaService('parameterInference');
    this.pendingPrompts = new Map();
    logger.info('ParameterInferenceEngine initialized');
  }

  /**
   * Infer missing parameter value from context
   */
  async inferParameter(
    param: string,
    tool: BecasTool,
    query: string,
    context: BecasContext
  ): Promise<InferenceResult> {
    try {
      logger.info(`Inferring parameter: ${param} for tool: ${tool.name}`);

      // First, try AI inference
      const aiInference = await this.tryAIInference(param, tool, query, context);

      // If high confidence (>0.7), use it
      if (aiInference.confidence && aiInference.confidence > 0.7) {
        logger.info(`AI inferred ${param} with high confidence (${aiInference.confidence})`);
        return {
          success: true,
          value: aiInference.value,
          confidence: aiInference.confidence,
        };
      }

      // Otherwise, ask user interactively
      logger.info(`Low confidence (${aiInference.confidence || 0}), asking user`);
      return {
        success: false,
        needsUserInput: true,
        prompt: await this.createInteractivePrompt(param, tool, aiInference.value),
      };

    } catch (error: any) {
      logger.error(`Parameter inference error for ${param}:`, error);
      return {
        success: false,
        needsUserInput: true,
        prompt: await this.createInteractivePrompt(param, tool),
      };
    }
  }

  /**
   * Try to infer parameter using AI
   */
  private async tryAIInference(
    param: string,
    tool: BecasTool,
    query: string,
    context: BecasContext
  ): Promise<{ value?: any; confidence?: number }> {
    try {
      const paramSchema = tool.parameters[param];
      if (!paramSchema) {
        return { confidence: 0 };
      }

      const systemPrompt = `You are a parameter inference AI.

Task: Infer the value of parameter "${param}" from user's query.

Parameter schema:
- Type: ${paramSchema.type}
- Description: ${paramSchema.description}
${paramSchema.enum ? `- Valid values: ${paramSchema.enum.join(', ')}` : ''}
${paramSchema.default ? `- Default: ${paramSchema.default}` : ''}

RESPONSE FORMAT (JSON only):
{
  "value": <inferred value>,
  "confidence": <0-1>,
  "reasoning": "<why you chose this value>"
}

If you can't infer with confidence >0.7, set confidence lower.`;

      const userPrompt = `User Query: "${query}"

Tool: ${tool.name}
Tool Description: ${tool.description}
Parameter to infer: "${param}" (${paramSchema.description})

Recent context:
- Server: ${context.guild.name}
- Channel: ${context.channel.name}
- User: ${context.member.user.tag}

Infer the parameter value.`;

      const response = await this.ollama.generate(systemPrompt, userPrompt);

      // Parse JSON response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        logger.warn('AI did not return valid JSON');
        return { confidence: 0 };
      }

      const result = JSON.parse(jsonMatch[0]);
      logger.info(`AI inference result: ${JSON.stringify(result)}`);

      return {
        value: result.value,
        confidence: result.confidence || 0,
      };

    } catch (error: any) {
      logger.error('AI inference error:', error);
      return { confidence: 0 };
    }
  }

  /**
   * Create interactive Discord button prompt
   */
  private async createInteractivePrompt(
    param: string,
    tool: BecasTool,
    suggestedValue?: any
  ): Promise<BecasMissingParam> {
    const paramSchema = tool.parameters[param];

    // Build options for buttons
    let options: Array<{ label: string; value: any; description?: string }> = [];

    if (paramSchema.enum) {
      // Use enum values as options
      options = paramSchema.enum.map((val: any) => ({
        label: String(val),
        value: val,
        description: `Select ${val}`,
      }));
    } else if (paramSchema.type === 'number') {
      // For numbers, offer common ranges
      if (param.includes('threshold') || param.includes('score')) {
        options = [
          { label: '>50 (Medium)', value: 50, description: 'Medium threshold' },
          { label: '>70 (High)', value: 70, description: 'High threshold' },
          { label: '>90 (Extreme)', value: 90, description: 'Extreme threshold' },
        ];
      }
    } else if (param.includes('period') || param.includes('time')) {
      // For time periods
      options = [
        { label: 'Today', value: 'day', description: 'Last 24 hours' },
        { label: 'This Week', value: 'week', description: 'Last 7 days' },
        { label: 'This Month', value: 'month', description: 'Last 30 days' },
        { label: 'All Time', value: 'all', description: 'All data' },
      ];
    }

    // If we have a suggested value, add it as first option
    if (suggestedValue !== undefined && suggestedValue !== null) {
      options.unshift({
        label: `✨ ${suggestedValue} (AI suggested)`,
        value: suggestedValue,
        description: 'AI recommendation',
      });
    }

    return {
      param,
      prompt: paramSchema.description || `What value for ${param}?`,
      type: options.length > 0 ? 'button' : 'text',
      options,
    };
  }

  /**
   * Send interactive prompt to Discord and wait for user response
   */
  async promptUser(
    prompt: BecasMissingParam,
    context: BecasContext,
    timeoutMs: number = 60000
  ): Promise<any> {
    try {
      // Build Discord message with buttons
      const message = await this.sendPromptMessage(prompt, context);

      // Wait for user response
      return await this.waitForResponse(message, prompt, timeoutMs);

    } catch (error: any) {
      logger.error('User prompt error:', error);
      throw error;
    }
  }

  /**
   * Send prompt message with buttons
   */
  private async sendPromptMessage(
    prompt: BecasMissingParam,
    context: BecasContext
  ): Promise<Message> {
    if (prompt.type === 'button' && prompt.options && prompt.options.length > 0) {
      // Create button rows (max 5 buttons per row, max 5 rows)
      const rows: ActionRowBuilder<ButtonBuilder>[] = [];
      const buttons = prompt.options.slice(0, 20); // Max 20 buttons (4 rows of 5)

      for (let i = 0; i < buttons.length; i += 5) {
        const row = new ActionRowBuilder<ButtonBuilder>();
        const rowButtons = buttons.slice(i, i + 5);

        rowButtons.forEach((option, index) => {
          const button = new ButtonBuilder()
            .setCustomId(`param_${prompt.param}_${i + index}`)
            .setLabel(option.label)
            .setStyle(index === 0 ? ButtonStyle.Primary : ButtonStyle.Secondary);

          row.addComponents(button);
        });

        rows.push(row);
      }

      // Add "Custom Value" button
      const customRow = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`param_${prompt.param}_custom`)
            .setLabel('✏️ Enter Custom Value')
            .setStyle(ButtonStyle.Secondary)
        );

      rows.push(customRow);

      return await context.channel.send({
        content: `❓ **${prompt.prompt}**\n\nPlease select an option:`,
        components: rows,
      });
    } else {
      // Text-only prompt
      return await context.channel.send({
        content: `❓ **${prompt.prompt}**\n\nPlease type your answer.`,
      });
    }
  }

  /**
   * Wait for user response (button click or message)
   */
  private async waitForResponse(
    message: Message,
    prompt: BecasMissingParam,
    timeoutMs: number
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingPrompts.delete(message.id);
        reject(new Error('User response timeout'));
      }, timeoutMs);

      this.pendingPrompts.set(message.id, {
        resolve: (value) => {
          clearTimeout(timeoutId);
          this.pendingPrompts.delete(message.id);
          resolve(value);
        },
        reject: (reason) => {
          clearTimeout(timeoutId);
          this.pendingPrompts.delete(message.id);
          reject(reason);
        },
        timeout: timeoutId,
      });
    });
  }

  /**
   * Handle button interaction response
   */
  async handleButtonResponse(interactionId: string, customId: string, value: string): Promise<void> {
    // Extract param name and option index from customId
    const match = customId.match(/^param_(.+)_(\d+|custom)$/);
    if (!match) return;

    const [, paramName, optionIndex] = match;

    // Find pending prompt
    for (const [messageId, pending] of this.pendingPrompts.entries()) {
      // Resolve with the selected value
      if (optionIndex === 'custom') {
        pending.resolve({ needsCustomInput: true });
      } else {
        pending.resolve(value);
      }
      break;
    }
  }

  /**
   * Handle text message response
   */
  async handleTextResponse(messageId: string, text: string): Promise<void> {
    const pending = this.pendingPrompts.get(messageId);
    if (pending) {
      pending.resolve(text);
    }
  }
}
