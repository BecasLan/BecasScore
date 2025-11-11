/**
 * BECASFLOW AI SERVICES - ALL-IN-ONE
 *
 * Consolidated AI services for BecasFlow pipeline enhancements.
 * Includes: LoopDetector, ChainSuggester, ContextSelector, ConflictResolver,
 * IntentEnhancer, and ReasoningEngine.
 */

import { OllamaService } from '../../services/OllamaService';
import { createLogger } from '../../services/Logger';
import { BecasStep, BecasContext, BecasTool } from '../types/BecasFlow.types';
import { BecasToolRegistry } from '../registry/BecasToolRegistry';

const logger = createLogger('BecasFlowAI');

// ============================================================================
// LOOP DETECTOR - Adaptive re-execution
// ============================================================================

export class LoopDetector {
  private ollama: OllamaService;

  constructor() {
    this.ollama = new OllamaService('loopDetection');
    logger.info('LoopDetector initialized');
  }

  async shouldLoop(step: BecasStep, result: any, condition?: any): Promise<boolean> {
    try {
      const systemPrompt = `Should this step re-execute?

RESPONSE FORMAT (JSON only):
{
  "loop": true/false,
  "reason": "<why>"
}`;

      const userPrompt = `Step: ${step.toolName}
Result: ${JSON.stringify(result, null, 2)}
Condition: ${condition ? JSON.stringify(condition) : 'none'}

Should it loop?`;

      const response = await this.ollama.generate(systemPrompt, userPrompt);
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return false;

      const parsed = JSON.parse(jsonMatch[0]);
      return parsed.loop === true;

    } catch (error) {
      return false;
    }
  }
}

// ============================================================================
// CHAIN SUGGESTER - Suggest next tools
// ============================================================================

export class ChainSuggester {
  private ollama: OllamaService;
  private registry: BecasToolRegistry;

  constructor(registry?: BecasToolRegistry) {
    this.ollama = new OllamaService('chainSuggestion');
    this.registry = registry || BecasToolRegistry.getInstance();
    logger.info('ChainSuggester initialized');
  }

  async suggestNext(completedStep: BecasStep, result: any): Promise<string[]> {
    try {
      const tool = this.registry.get(completedStep.toolName);
      if (!tool) return [];

      const availableTools = this.registry.getAll().map(t => `${t.name}: ${t.description}`).join('\n');

      const systemPrompt = `Suggest 3 next tools to run.

Available tools:
${availableTools}

RESPONSE FORMAT (JSON only):
{
  "suggestions": ["tool1", "tool2", "tool3"],
  "reasoning": "<why these>"
}`;

      const userPrompt = `Just ran: ${completedStep.toolName}
Result: ${JSON.stringify(result, null, 2)}

What should we do next?`;

      const response = await this.ollama.generate(systemPrompt, userPrompt);
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return [];

      const parsed = JSON.parse(jsonMatch[0]);
      return parsed.suggestions || [];

    } catch (error) {
      return [];
    }
  }
}

// ============================================================================
// CONTEXT SELECTOR - Context-aware tool selection
// ============================================================================

export class ContextSelector {
  private ollama: OllamaService;
  private registry: BecasToolRegistry;

  constructor(registry?: BecasToolRegistry) {
    this.ollama = new OllamaService('contextSelection');
    this.registry = registry || BecasToolRegistry.getInstance();
    logger.info('ContextSelector initialized');
  }

  async selectTools(query: string, context: BecasContext): Promise<string[]> {
    try {
      const availableTools = this.registry.getAll().map(t => `${t.name}: ${t.description}`).join('\n');

      const systemPrompt = `Select best tools for this query, considering server context.

Available tools:
${availableTools}

RESPONSE FORMAT (JSON only):
{
  "tools": ["tool1", "tool2"],
  "reasoning": "<why>"
}`;

      const userPrompt = `Query: "${query}"
Server: ${context.guild.name}
Members: ${context.guild.memberCount}
Recent activity: ${context.conversationHistory?.length || 0} recent queries

Which tools?`;

      const response = await this.ollama.generate(systemPrompt, userPrompt);
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return [];

      const parsed = JSON.parse(jsonMatch[0]);
      return parsed.tools || [];

    } catch (error) {
      return [];
    }
  }
}

// ============================================================================
// CONFLICT RESOLVER - Multi-tool ordering
// ============================================================================

export class ConflictResolver {
  private ollama: OllamaService;

  constructor() {
    this.ollama = new OllamaService('conflictResolution');
    logger.info('ConflictResolver initialized');
  }

  async resolveOrder(tools: BecasStep[]): Promise<BecasStep[]> {
    try {
      const systemPrompt = `Two+ tools want to run. Determine execution order.

RESPONSE FORMAT (JSON only):
{
  "order": [0, 1, 2],  // Indices in execution order
  "parallel": [[0, 1], [2]],  // Which can run parallel
  "reasoning": "<why>"
}`;

      const userPrompt = `Tools:
${tools.map((t, i) => `${i}. ${t.toolName}: ${JSON.stringify(t.params)}`).join('\n')}

What order?`;

      const response = await this.ollama.generate(systemPrompt, userPrompt);
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return tools;

      const parsed = JSON.parse(jsonMatch[0]);
      if (!parsed.order) return tools;

      return parsed.order.map((i: number) => tools[i]);

    } catch (error) {
      return tools;
    }
  }
}

// ============================================================================
// INTENT ENHANCER - Enhanced intent classification
// ============================================================================

export class IntentEnhancer {
  private ollama: OllamaService;

  constructor() {
    this.ollama = new OllamaService('intentEnhancement');
    logger.info('IntentEnhancer initialized');
  }

  async classifyIntent(query: string, context: BecasContext): Promise<{
    intent: string;
    subIntent?: string;
    confidence: number;
  }> {
    try {
      const systemPrompt = `Classify user intent.

Intents:
- moderation (ban, warn, kick, timeout)
- analytics (stats, reports, aggregation)
- trust (check trust, update trust)
- data_query (filter, group, sort)
- chat (conversation, help)

RESPONSE FORMAT (JSON only):
{
  "intent": "...",
  "subIntent": "...",
  "confidence": 0.95
}`;

      const userPrompt = `Query: "${query}"
User: ${context.member.user.tag}

Classify intent.`;

      const response = await this.ollama.generate(systemPrompt, userPrompt);
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return { intent: 'unknown', confidence: 0 };

      return JSON.parse(jsonMatch[0]);

    } catch (error) {
      return { intent: 'unknown', confidence: 0 };
    }
  }
}

// ============================================================================
// REASONING ENGINE - Analyze and decide
// ============================================================================

export class ReasoningEngine {
  private ollama: OllamaService;

  constructor() {
    this.ollama = new OllamaService('reasoning');
    logger.info('ReasoningEngine initialized');
  }

  async reason(query: string, data: any, context: BecasContext): Promise<{
    answer: string;
    needsMoreData: boolean;
    suggestedActions?: string[];
  }> {
    try {
      const systemPrompt = `Analyze results and decide next steps.

Can you answer the query? If not, what's missing?

RESPONSE FORMAT (JSON only):
{
  "answer": "<answer or null>",
  "needsMoreData": true/false,
  "missingData": ["what's missing"],
  "suggestedActions": ["action1", "action2"]
}`;

      const userPrompt = `Query: "${query}"
Data: ${JSON.stringify(data, null, 2)}

Can we answer?`;

      const response = await this.ollama.generate(systemPrompt, userPrompt);
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return { answer: '', needsMoreData: false };

      return JSON.parse(jsonMatch[0]);

    } catch (error) {
      return { answer: '', needsMoreData: false };
    }
  }
}

// ============================================================================
// EXPORT ALL
// ============================================================================

export const BecasFlowAI = {
  LoopDetector,
  ChainSuggester,
  ContextSelector,
  ConflictResolver,
  IntentEnhancer,
  ReasoningEngine,
};
