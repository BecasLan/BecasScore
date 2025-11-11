/**
 * RESULT SYNTHESIZER SERVICE
 *
 * Smart formatting of BecasFlow pipeline results.
 * Handles empty data gracefully and formats full results in Discord-friendly format.
 */

import { OllamaService } from '../../services/OllamaService';
import { OLLAMA_CONFIGS } from '../../config/ollama.config';
import { createLogger } from '../../services/Logger';
import { BecasExecutionResult } from '../types/BecasFlow.types';

const logger = createLogger('ResultSynthesizer');

export class ResultSynthesizer {
  private ollama: OllamaService;

  constructor() {
    this.ollama = new OllamaService('resultSynthesis');
    logger.info('ResultSynthesizer initialized');
  }

  /**
   * Synthesize pipeline results into user-friendly Discord message
   */
  async synthesize(
    query: string,
    result: BecasExecutionResult,
    context?: {
      serverName?: string;
      period?: string;
      actionType?: string;
    }
  ): Promise<string> {
    try {
      // Get final data from last successful step
      const finalData = this.extractFinalData(result);

      // Check if data is empty
      const isEmpty = this.isDataEmpty(finalData);

      logger.info(`Synthesizing result - isEmpty: ${isEmpty}, dataType: ${typeof finalData}`);

      // Build system prompt
      const systemPrompt = this.buildSystemPrompt(isEmpty, context);

      // Build user prompt
      const userPrompt = this.buildUserPrompt(query, finalData, result);

      // Call AI to synthesize response
      const response = await this.ollama.generate(systemPrompt, userPrompt);

      return response || this.buildFallbackMessage(isEmpty, context);

    } catch (error: any) {
      logger.error('Result synthesis error:', error);
      return this.buildFallbackMessage(false, context);
    }
  }

  /**
   * Extract final data from execution result
   */
  private extractFinalData(result: BecasExecutionResult): any {
    if (!result.success || result.results.length === 0) {
      return null;
    }

    // Get last successful step's data
    const lastResult = result.results[result.results.length - 1];
    return lastResult.result.data;
  }

  /**
   * Check if data is empty/null
   */
  private isDataEmpty(data: any): boolean {
    if (data === null || data === undefined) return true;
    if (Array.isArray(data) && data.length === 0) return true;
    if (typeof data === 'object' && Object.keys(data).length === 0) return true;
    return false;
  }

  /**
   * Build system prompt for AI
   */
  private buildSystemPrompt(isEmpty: boolean, context?: any): string {
    return `You are a data analysis assistant for a Discord moderation bot.

Your job: Format data results into clear, concise Discord messages.

CRITICAL RULES:
${isEmpty ? `
1. The data is EMPTY/NULL → Say "No data found for [this period/query]"
2. DO NOT say "system error" or "failed" - empty data is normal
3. Suggest checking a different time period or adding data
4. Be helpful and positive
` : `
1. The data has results → Summarize them clearly
2. Use Discord markdown: **bold**, \`code\`, bullet points
3. Keep it concise (max 5-10 items if list)
4. Add emojis for readability: 📊 📈 ⚠️ ✅ ❌
5. If >10 items, show top 5-10 and say "X more..."
`}

Context: ${context?.serverName || 'Discord Server'}
Period: ${context?.period || 'recent'}
Action Type: ${context?.actionType || 'all'}

Be conversational, helpful, and clear. Write in English.`;
  }

  /**
   * Build user prompt with query and data
   */
  private buildUserPrompt(query: string, data: any, result: BecasExecutionResult): string {
    let prompt = `User Query: "${query}"\n\n`;

    // Add execution summary
    prompt += `Execution Summary:\n`;
    prompt += `- Steps executed: ${result.results.length}\n`;
    prompt += `- Success: ${result.success}\n`;
    prompt += `- Total time: ${result.metadata?.totalTime || 0}ms\n\n`;

    // Add data
    prompt += `Final Data:\n`;
    if (data === null || data === undefined) {
      prompt += `null (no data)\n`;
    } else if (Array.isArray(data)) {
      prompt += `Array with ${data.length} items:\n`;
      prompt += JSON.stringify(data.slice(0, 20), null, 2); // Max 20 items
    } else if (typeof data === 'object') {
      prompt += `Object:\n`;
      prompt += JSON.stringify(data, null, 2);
    } else {
      prompt += String(data);
    }

    prompt += `\n\nFormat this into a clear Discord message for the user.`;

    return prompt;
  }

  /**
   * Build fallback message if AI fails
   */
  private buildFallbackMessage(isEmpty: boolean, context?: any): string {
    if (isEmpty) {
      return `📭 **No Data Found**\n\nI couldn't find any ${context?.actionType || 'actions'} ${context?.period ? `in the ${context.period}` : 'for this query'}.\n\nTry checking a different time period or adding some data first.`;
    }

    return `✅ **Query Completed**\n\nThe query executed successfully, but I couldn't format the results. Please check the raw data.`;
  }
}
