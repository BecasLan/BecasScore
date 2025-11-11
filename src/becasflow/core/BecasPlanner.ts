/**
 * BECAS PLANNER - AI PLANNING ENGINE
 *
 * Converts natural language queries into executable plans using AI.
 * Uses Ollama to understand intent and map to available tools.
 *
 * Features:
 * - Natural language to plan conversion
 * - Missing parameter detection
 * - AI-powered next step suggestions
 * - Conditional planning (if/then/else)
 * - Multi-step plan generation
 * - Context-aware planning (references previous results)
 */

import { OllamaService } from '../../services/OllamaService';
import {
  BecasPlan,
  BecasStep,
  BecasPlanningResult,
  BecasPlanningOptions,
  BecasContext,
  BecasMissingParam,
  BecasCondition,
} from '../types/BecasFlow.types';
import { BecasToolRegistry } from '../registry/BecasToolRegistry';
import { createLogger } from '../../services/Logger';
import { ParameterInferenceEngine } from '../services/ParameterInferenceEngine';
import { ContextSelector, IntentEnhancer } from '../services/BecasFlowAI';

const logger = createLogger('BecasPlanner');

export class BecasPlanner {
  private ollama: OllamaService;
  private registry: BecasToolRegistry;
  private parameterInference: ParameterInferenceEngine;
  private contextSelector: ContextSelector;
  private intentEnhancer: IntentEnhancer;

  constructor(ollama?: OllamaService, registry?: BecasToolRegistry) {
    this.ollama = ollama || new OllamaService('planning');
    this.registry = registry || BecasToolRegistry.getInstance();
    this.parameterInference = new ParameterInferenceEngine();
    this.contextSelector = new ContextSelector(this.registry);
    this.intentEnhancer = new IntentEnhancer();
    logger.info('BecasPlanner initialized with AI enhancements');
  }

  /**
   * Create execution plan from natural language query
   */
  async createPlan(
    query: string,
    context: BecasContext,
    options: BecasPlanningOptions = {}
  ): Promise<BecasPlanningResult> {
    try {
      logger.info(`Planning for query: "${query}"`);

      // 🔥 FAST PATH: Common query patterns that don't need AI
      // This bypasses AI planning for frequently used queries to avoid JSON parsing issues
      const fastPlan = this.tryFastPath(query, context);
      if (fastPlan) {
        logger.info(`✅ Fast path matched - skipping AI planning`);
        return fastPlan;
      }

      // Classify intent before planning
      const intent = await this.intentEnhancer.classifyIntent(query, context);
      logger.info(`Intent classified: ${intent.intent} (confidence: ${intent.confidence})`);

      // If low confidence, use context-aware selection
      if (intent.confidence < 0.7) {
        const suggestedTools = await this.contextSelector.selectTools(query, context);
        logger.info(`Context-based tool suggestions: ${suggestedTools.join(', ')}`);
      }

      // Get available tools
      const tools = this.registry.getAll();
      const toolDescriptions = tools
        .map(
          (t) =>
            `- ${t.name}: ${t.description} (category: ${t.category}, params: ${Object.keys(t.parameters).join(', ')})`
        )
        .join('\n');

      // Build planning prompt
      const systemPrompt = this.buildPlanningPrompt(toolDescriptions, options);

      // 🔥 BECAS COGNITIVE: ALWAYS include conversation history for context-aware planning
      const contextInfo = this.buildContextInfo(context);

      // 🔥 Add conversation summary for EVERY query (not just retries!)
      const conversationSummary = context.conversationHistory
        .slice(-5) // Last 5 messages for full context
        .map(h => h.query)
        .join('\n');

      const fullPrompt = `${contextInfo}

${conversationSummary ? `RECENT CONVERSATION:\n${conversationSummary}\n\n` : ''}User Query: "${query}"

CRITICAL INSTRUCTIONS:
1. If query is ONLY casual conversation (like "hello", "thanks", "goodbye"), return EMPTY steps array []
2. If query contains ANY admin/moderation intent (slowmode, ban, kick, delete, timeout, check, warn, lock, unlock, role, channel settings), CREATE proper tool steps
3. Commands like "set slowmode", "lock channel", "ban user" are NOT casual conversation - they MUST have tool steps
4. Even if phrased casually ("can you set slowmode?"), treat it as moderation action

Generate an execution plan as JSON.`;

      // Call AI with BecasFlow-specific schema
      const becasFlowSchema = `{
  "steps": [
    {
      "id": "string",
      "toolName": "string",
      "params": {},
      "condition": {},
      "ifTrue": [],
      "ifFalse": [],
      "outputAs": "string",
      "dependsOn": []
    }
  ],
  "metadata": {
    "estimatedTime": number,
    "requiresUserInput": boolean,
    "affectsUsers": number,
    "affectsMessages": number
  },
  "missingInfo": [
    {
      "param": "string",
      "prompt": "string",
      "type": "string",
      "options": []
    }
  ]
}`;

      // 🔥 BECAS REASONING SYSTEM: Two-step AI with quality check and retry
      let response = await this.ollama.generateJSON<{
        steps: Array<{
          id: string;
          toolName: string;
          params: Record<string, any>;
          condition?: any;
          ifTrue?: any[];
          ifFalse?: any[];
          outputAs?: string;
          dependsOn?: string[];
        }>;
        metadata?: {
          estimatedTime?: number;
          requiresUserInput?: boolean;
          affectsUsers?: number;
          affectsMessages?: number;
        };
        missingInfo?: Array<{
          param: string;
          prompt: string;
          type: string;
          options?: any[];
        }>;
      }>(fullPrompt, systemPrompt, becasFlowSchema);

      // 🔥 QUALITY CHECK: If reasoning produced bad results (undefined, missing data), retry with conversation history
      const hasUndefinedData = response.missingInfo?.some(m => !m.prompt || m.prompt === 'undefined');
      const hasMissingSteps = !response.steps || !Array.isArray(response.steps);
      const needsRetry = hasUndefinedData || hasMissingSteps;

      if (needsRetry) {
        logger.warn('⚠️ BecasReasoning: First attempt produced low-quality results, retrying with conversation history...');

        // Add conversation history to improve reasoning
        const conversationContext = context.conversationHistory
          .slice(-3) // Last 3 messages
          .map(h => h.query)
          .join('\n');

        const enhancedPrompt = `${contextInfo}

CONVERSATION CONTEXT (for better understanding):
${conversationContext}

User Query: "${query}"

Generate an execution plan as JSON. Use the conversation context to better understand the user's intent.`;

        // Retry with enhanced context
        response = await this.ollama.generateJSON<typeof response>(
          enhancedPrompt,
          systemPrompt,
          becasFlowSchema
        );

        logger.info('✅ BecasReasoning: Retry completed with conversation-aware reasoning');
      }

      // 🔥 POST-PROCESSING NORMALIZATION: Handle ANY AI response format
      // Small models (qwen3:1.7b) can't reliably generate BecasFlow JSON,
      // so we normalize whatever they return into the correct format
      response = this.normalizeAIResponse(response as any, query, context);

      // Validate response
      if (!response.steps || !Array.isArray(response.steps)) {
        return {
          success: false,
          error: 'AI did not return valid steps array',
        };
      }

      // 🔥 FIX: Detect if AI returned schema placeholders instead of real data
      // This happens when qwen returns natural language and extractor can't find JSON
      const hasPlaceholders = response.steps.some(step =>
        step.toolName === 'string' ||
        !step.toolName ||
        step.toolName === 'undefined' ||
        typeof step.toolName !== 'string'
      );

      if (hasPlaceholders) {
        logger.warn('⚠️ AI returned schema placeholders, not real tool data - treating as empty steps');
        response.steps = [];
      }

      // Check for missing information
      if (response.missingInfo && response.missingInfo.length > 0) {
        // 🔥 FIX: Ensure all missingInfo has valid prompts (no undefined)
        const validMissingInfo = response.missingInfo
          .filter(m => m.prompt && m.prompt !== 'undefined')
          .map((m) => ({
            param: m.param,
            prompt: m.prompt || `Please provide ${m.param}`, // Fallback prompt
            type: (m.type as 'text' | 'button' | 'select') || 'text',
            options: m.options,
          }));

        if (validMissingInfo.length > 0) {
          return {
            success: false,
            missingInfo: validMissingInfo,
          };
        }
      }

      // Build plan
      const plan: BecasPlan = {
        id: `plan_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        query,
        steps: response.steps.map((s) => this.parseStep(s)),
        metadata: {
          createdAt: Date.now(),
          ...response.metadata,
        },
      };

      // Infer missing parameters for all steps
      for (let i = 0; i < plan.steps.length; i++) {
        plan.steps[i] = await this.inferMissingParameters(plan.steps[i], context, query);
      }

      // Validate plan
      const validation = this.validatePlan(plan);
      if (!validation.valid) {
        return {
          success: false,
          error: `Invalid plan: ${validation.error}`,
        };
      }

      logger.info(`Created plan with ${plan.steps.length} steps`);

      return {
        success: true,
        plan,
      };
    } catch (error) {
      logger.error('Error creating plan:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Infer missing parameters for a step using AI
   */
  async inferMissingParameters(
    step: BecasStep,
    context: BecasContext,
    query: string
  ): Promise<BecasStep> {
    const tool = this.registry.get(step.toolName);
    if (!tool) return step;

    // Check for missing required parameters
    for (const [paramName, paramSchema] of Object.entries(tool.parameters)) {
      if (paramSchema.required && !(paramName in step.params)) {
        logger.info(`Missing required parameter: ${paramName}`);

        // Try to infer it
        const inference = await this.parameterInference.inferParameter(
          paramName,
          tool,
          query,
          context
        );

        if (inference.success && inference.value !== undefined) {
          step.params[paramName] = inference.value;
          logger.info(`Inferred ${paramName} = ${inference.value} (confidence: ${inference.confidence})`);
        } else if (inference.needsUserInput && inference.prompt) {
          // Ask user interactively (for now, just log - full implementation needs Discord interaction)
          logger.warn(`Cannot infer ${paramName}, would prompt user: ${inference.prompt.prompt}`);
          // TODO: Implement interactive prompting in BecasCore
        }
      }
    }

    return step;
  }

  /**
   * Detect missing parameters in a plan
   */
  async detectMissingParams(plan: BecasPlan, context: BecasContext): Promise<BecasMissingParam[]> {
    const missing: BecasMissingParam[] = [];

    for (const step of plan.steps) {
      const tool = this.registry.get(step.toolName);
      if (!tool) continue;

      // Check each required parameter
      for (const [paramName, paramSchema] of Object.entries(tool.parameters)) {
        if (!paramSchema.required) continue;

        // Check if parameter is missing
        const value = step.params[paramName];
        if (value === undefined || value === null) {
          // Check if tool has custom missing detection
          if (tool.detectMissing) {
            const detected = tool.detectMissing(step.params, context);
            if (detected) {
              missing.push(detected);
              continue;
            }
          }

          // Default missing parameter prompt
          missing.push({
            param: paramName,
            prompt: paramSchema.description,
            type: paramSchema.enum ? 'select' : 'text',
            options: paramSchema.enum
              ? paramSchema.enum.map((v) => ({ label: String(v), value: v }))
              : undefined,
          });
        }
      }
    }

    return missing;
  }

  /**
   * Suggest next steps using AI
   */
  async suggestNextSteps(
    context: BecasContext,
    currentResults: Map<string, any>
  ): Promise<string[]> {
    try {
      // Get recent history
      const historyText = context.getConversationSummary();

      // Build prompt
      const systemPrompt = `You are a moderation assistant that suggests helpful next actions.
Given the conversation history and current results, suggest 1-3 natural next steps.

Available tools:
${this.registry
  .getAll()
  .map((t) => `- ${t.name}: ${t.description}`)
  .join('\n')}

Return ONLY a JSON array of suggestion strings.
Example: ["Ban the user", "Delete spam messages", "Check trust score"]`;

      const prompt = `Conversation history:
${historyText}

Current results:
${this.summarizeResults(currentResults)}

What should the moderator do next? Suggest 1-3 actions.`;

      const response = await this.ollama.generateJSON<{ suggestions: string[] }>(
        prompt,
        systemPrompt
      );

      return response.suggestions || [];
    } catch (error) {
      logger.error('Error suggesting next steps:', error);
      return [];
    }
  }

  /**
   * Build planning system prompt
   */
  private buildPlanningPrompt(toolDescriptions: string, options: BecasPlanningOptions): string {
    return `You are a Discord moderation assistant that creates execution plans.

AVAILABLE TOOLS:
${toolDescriptions}

YOUR TASK:
Convert the user's query into an execution plan using the available tools.

PLAN FORMAT (JSON):
{
  "steps": [
    {
      "id": "step_1",
      "toolName": "tool_name",
      "params": { "param1": "value1" },
      "condition": { "type": "greaterThan", "field": "stepResults.step_1.score", "value": 50 }, // OPTIONAL
      "ifTrue": [ /* steps if condition true */ ], // OPTIONAL
      "ifFalse": [ /* steps if condition false */ ], // OPTIONAL
      "outputAs": "variableName", // OPTIONAL - store result in this variable
      "dependsOn": ["step_1"] // OPTIONAL - wait for these steps first
    }
  ],
  "metadata": {
    "estimatedTime": 5000,
    "requiresUserInput": false,
    "affectsUsers": 1,
    "affectsMessages": 0
  },
  "missingInfo": [ // ONLY if user input is needed
    {
      "param": "userId",
      "prompt": "Which user should I check?",
      "type": "text"
    }
  ]
}

🧠 CHAIN OF THOUGHT (CoT) REASONING - OPTIMIZE YOUR PLAN!
Think step-by-step and combine actions intelligently:

OPTIMIZATION STRATEGIES:
1. **Conditional Chaining**: Combine "check → if bad → action" into ONE step
   - Example: "check trust, if low ban" → Single step with condition
   - BAD: step_1 (check_trust) → step_2 (ban if score < 30)
   - GOOD: step_1 (check_trust with ifTrue: [ban])

2. **Parameter Inference**: Use conversation context to fill missing data
   - If user says "ban him" after mentioning someone, infer userId from context
   - Use context.lastUsers, context.variables for smart parameter resolution

3. **Multi-Target Optimization**: Batch operations when possible
   - "ban user1, user2, user3" → One ban step with array of userIds
   - Don't create 3 separate ban steps if tool supports arrays

4. **Implicit Actions**: Understand implied intentions
   - "clean up spam" → delete_messages + timeout/ban offenders
   - "handle this troll" → check_trust + timeout/ban based on score

5. **Result Reuse**: Store intermediate results with "outputAs"
   - If multiple steps need same data, fetch ONCE and reuse
   - Use "dependsOn" to ensure proper execution order

6. **Multi-Tool Data Pipelines**: Chain data manipulation tools for complex queries
   - Use data_filter, data_sort, data_slice to process query results
   - Reference previous step data with {{variable}} syntax
   - Example: "show only last 3 timeouts" → fetch → filter → slice

MULTI-TOOL PIPELINE EXAMPLES:

❌ BAD (trying to do everything in one tool):
{
  "steps": [
    {"id": "step_1", "toolName": "moderation_history", "params": {"userId": "123", "actionType": "timeout", "limit": 3}}
  ]
}

✅ GOOD (composable pipeline):
{
  "steps": [
    {"id": "step_1", "toolName": "moderation_history", "params": {"userId": "123"}, "outputAs": "all_violations"},
    {"id": "step_2", "toolName": "data_filter", "params": {"data": "{{all_violations.actions}}", "field": "type", "value": "timeout"}, "outputAs": "filtered"},
    {"id": "step_3", "toolName": "data_sort", "params": {"data": "{{filtered}}", "by": "timestamp", "order": "desc"}, "outputAs": "sorted"},
    {"id": "step_4", "toolName": "data_slice", "params": {"data": "{{sorted}}", "mode": "first", "count": 3}}
  ]
}

DATA MANIPULATION TOOLS:
- data_filter: Filter arrays by field conditions (equals, contains, greater_than, etc.)
- data_sort: Sort arrays by field (asc/desc)
- data_slice: Take first/last N items or specific range

VARIABLE REFERENCE SYNTAX:
- {{variableName}} - Reference a variable stored with outputAs
- {{step_id.field}} - Access nested field from step result
- {{step_id.data.actions}} - Access nested arrays/objects

REASONING EXAMPLES:
❌ BAD (naive, separate steps):
{
  "steps": [
    {"id": "step_1", "toolName": "check_trust", "params": {"userId": "123"}},
    {"id": "step_2", "toolName": "ban", "params": {"userId": "123"}, "dependsOn": ["step_1"]}
  ]
}

✅ GOOD (optimized, conditional):
{
  "steps": [
    {
      "id": "step_1",
      "toolName": "check_trust",
      "params": {"userId": "123"},
      "outputAs": "trustData",
      "condition": {"type": "lessThan", "field": "stepResults.step_1.score", "value": 30},
      "ifTrue": [
        {"id": "step_1_ban", "toolName": "ban", "params": {"userId": "123", "reason": "Low trust score"}}
      ]
    }
  ]
}

RULES:
1. Use ONLY tools from the available list
2. If information is missing, populate "missingInfo" array
3. Use "condition", "ifTrue", "ifFalse" for conditional logic
4. Use "dependsOn" to ensure proper execution order
5. Reference previous step results with: "stepResults.step_id.fieldName"
6. Use "outputAs" to store results for later steps
7. Maximum ${options.maxSteps || 10} steps
8. **THINK SMART**: Combine steps when possible, use conditionals for "if X then Y" logic
${options.allowLoops === false ? '9. NO loops allowed' : '9. Loops are allowed'}
${options.allowConditionals === false ? '10. NO conditionals allowed' : '10. Conditionals are allowed'}

IMPORTANT - CHAT vs COMMAND DETECTION (USE CONVERSATION CONTEXT!):
If the query is ONLY casual chat/greeting/question WITHOUT any moderation action needed, return:
{"steps": [], "metadata": {"requiresUserInput": false}}

🔥 CRITICAL: READ THE RECENT CONVERSATION HISTORY!
- "what we talked before?" = CHAT (asking about previous conversation)
- "do you remember?" = CHAT (referencing previous context)
- "i'm good too" = CHAT (continuing previous greeting)
- Questions ABOUT the conversation = CHAT
- Follow-ups without moderation keywords = CHAT
- Casual mentions of people/users WITHOUT explicit moderation action = CHAT

🔥 KEY DISTINCTION: CASUAL MENTION vs EXPLICIT COMMAND
- "I talked to John yesterday" = CHAT (just mentioning someone)
- "Check John's trust score" = COMMAND (explicit action request)
- "What did we discuss about users?" = CHAT (question about conversation)
- "Show me user stats" = COMMAND (explicit data request)

Examples of CHAT-ONLY (NO tools needed):
- "hi", "hello", "hey", "sup"
- "how are you", "what's up", "i'm good too"
- "you there?", "are you online?"
- "what we talked before?", "do you know?", "do you remember?"
- "i talked to someone", "i'm discussing with users", "people are saying..."
- Questions about previous conversation without moderation intent
- Just casual conversation without any action request
- Mentions of people/users in casual context (no action word)

Examples that NEED TOOLS (explicit action verbs OR data requests):
- "ban user123" → needs ban tool (explicit: BAN)
- "check user456's trust score" → needs check_trust tool (explicit: CHECK + trust score)
- "delete spam messages" → needs delete_messages tool (explicit: DELETE)
- "kick that user" → needs kick tool (explicit: KICK)
- "warn @john" → needs warn tool (explicit: WARN)
- "whats last violation about @user" → needs moderation_history tool (DATA REQUEST: violation history)
- "show me violations for @user" → needs moderation_history tool (DATA REQUEST: show violations)
- "what violations does @user have" → needs moderation_history tool (DATA REQUEST: violation data)
- "check violation history" → needs moderation_history tool (DATA REQUEST: check history)
- Questions asking for MODERATION DATA (violations, history, warnings, bans) = NEED TOOLS
- Must have EXPLICIT ACTION VERB OR MODERATION DATA REQUEST
- Without explicit action verb OR data request, it's just CHAT

CONDITION TYPES:
- equals, notEquals, greaterThan, lessThan, greaterThanOrEqual, lessThanOrEqual
- contains, notContains, matches, exists, notExists

RETURN ONLY THE JSON PLAN, NO OTHER TEXT.`;
  }

  /**
   * Build context information for AI
   */
  private buildContextInfo(context: BecasContext): string {
    const parts: string[] = [];

    // 🔥 DISCORD CONTEXT: Add server, user, channel information
    try {
      // User info
      if (context.member) {
        const roles = context.member.roles.cache
          .filter(r => r.name !== '@everyone')
          .map(r => r.name)
          .slice(0, 10); // Limit to 10 roles to avoid token overflow

        parts.push(`USER CONTEXT:
- Username: ${context.member.user.username} (${context.member.user.id})
- Display Name: ${context.member.displayName}
- Roles: ${roles.length > 0 ? roles.join(', ') : 'No roles'}
- Is Admin: ${context.member.permissions.has('Administrator') ? 'Yes' : 'No'}
- Is Moderator: ${context.member.permissions.has('ManageMessages') || context.member.permissions.has('KickMembers') ? 'Yes' : 'No'}`);
      }

      // Server info
      if (context.guild) {
        const channels = context.guild.channels.cache
          .filter(c => c.type === 0) // Text channels only
          .map(c => `#${c.name}`)
          .slice(0, 15); // Limit to avoid token overflow

        parts.push(`SERVER CONTEXT:
- Server Name: ${context.guild.name}
- Total Members: ${context.guild.memberCount}
- Available Channels: ${channels.join(', ')}`);
      }

      // Current channel
      if (context.channel) {
        parts.push(`CURRENT CHANNEL: #${context.channel.name} (${context.channel.id})`);
      }
    } catch (err) {
      // If Discord context fails, continue with other context
      logger.warn('Failed to build Discord context:', err);
    }

    // Add conversation history
    if (context.conversationHistory.length > 0) {
      parts.push(`Recent conversation:\n${context.getConversationSummary()}`);
    }

    // Add references
    if (context.lastUsers && context.lastUsers.length > 0) {
      parts.push(`Last referenced users: ${context.lastUsers.length} user(s)`);
    }

    if (context.lastMessages && context.lastMessages.length > 0) {
      parts.push(`Last referenced messages: ${context.lastMessages.length} message(s)`);
    }

    // Add variables
    if (context.variables.size > 0) {
      const vars = Array.from(context.variables.entries())
        .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
        .join(', ');
      parts.push(`Available variables: ${vars}`);
    }

    return parts.join('\n\n');
  }

  /**
   * Parse step from AI response
   */
  private parseStep(stepData: any): BecasStep {
    // 🔥 NORMALIZE: AI sometimes uses "tool" instead of "toolName", "args" instead of "params"
    const toolName = stepData.toolName || stepData.tool;
    const params = stepData.params || stepData.args || {};

    const step: BecasStep = {
      id: stepData.id || `step_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      toolName: toolName,
      params: params,
    };

    if (stepData.condition) {
      step.condition = stepData.condition as BecasCondition;
    }

    if (stepData.ifTrue) {
      step.ifTrue = stepData.ifTrue.map((s: any) => this.parseStep(s));
    }

    if (stepData.ifFalse) {
      step.ifFalse = stepData.ifFalse.map((s: any) => this.parseStep(s));
    }

    if (stepData.outputAs) {
      step.outputAs = stepData.outputAs;
    }

    if (stepData.dependsOn) {
      step.dependsOn = stepData.dependsOn;
    }

    return step;
  }

  /**
   * Validate plan
   */
  private validatePlan(plan: BecasPlan): { valid: boolean; error?: string } {
    // Allow empty steps for chat-only messages (no tools needed)
    if (!plan.steps || plan.steps.length === 0) {
      logger.info('Empty plan detected - chat-only message, no tools needed');
      return { valid: true };
    }

    // Validate each step
    const stepIds = new Set<string>();
    for (const step of plan.steps) {
      // Check for duplicate IDs
      if (stepIds.has(step.id)) {
        return { valid: false, error: `Duplicate step ID: ${step.id}` };
      }
      stepIds.add(step.id);

      // Check if tool exists
      const tool = this.registry.get(step.toolName);
      if (!tool) {
        return { valid: false, error: `Unknown tool: ${step.toolName}` };
      }

      // Check dependencies
      if (step.dependsOn) {
        for (const depId of step.dependsOn) {
          if (!stepIds.has(depId)) {
            return {
              valid: false,
              error: `Step ${step.id} depends on non-existent step: ${depId}`,
            };
          }
        }
      }
    }

    return { valid: true };
  }

  /**
   * Summarize results for AI
   */
  private summarizeResults(results: Map<string, any>): string {
    const summary: string[] = [];

    for (const [key, value] of results) {
      if (typeof value === 'object' && value !== null) {
        summary.push(`${key}: ${JSON.stringify(value, null, 2).substring(0, 200)}`);
      } else {
        summary.push(`${key}: ${String(value)}`);
      }
    }

    return summary.join('\n');
  }

  /**
   * 🔥 POST-PROCESSING NORMALIZATION
   *
   * Small models (qwen3:1.7b) can't reliably generate complex JSON structures.
   * This method accepts ANY response format and normalizes it into BecasFlow format.
   *
   * Handles:
   * - {"execution_plan": {...}} → converts to {"steps": [...]}
   * - {"tool": "slowmode", "arguments": {...}} → converts to proper step format
   * - Empty/missing steps → returns empty steps array
   * - Tool name mapping (slowmode → set_slowmode)
   */
  private normalizeAIResponse(response: any, query: string, context: BecasContext): any {
    logger.info('🔄 Normalizing AI response...');

    // If already has valid steps array, return as-is
    if (response.steps && Array.isArray(response.steps) && response.steps.length > 0) {
      logger.info('✅ Response already has valid steps array');
      return response;
    }

    // Check for alternative formats
    const normalized: any = {
      steps: [],
      metadata: response.metadata || {},
      missingInfo: response.missingInfo || []
    };

    // Pattern 1: {"execution_plan": {command: "/slowmode #test 6", ...}}
    if (response.execution_plan) {
      logger.info('🔄 Detected execution_plan format, extracting command...');
      const plan = response.execution_plan;

      // Parse slowmode command
      if (plan.command && plan.command.includes('slowmode')) {
        const channelMatch = plan.channel || context.channel.id;
        const durationMatch = plan.duration || 6;

        normalized.steps.push({
          id: `step_${Date.now()}`,
          toolName: 'set_slowmode',
          params: {
            channelId: channelMatch,
            duration: durationMatch * 60 // Convert to seconds
          }
        });

        logger.info(`✅ Normalized slowmode command: ${durationMatch}min on channel ${channelMatch}`);
      }
    }

    // Pattern 2: Array of {tool: "slowmode", arguments: {...}}
    if (Array.isArray(response) && response.length > 0) {
      logger.info('🔄 Detected array format with tool objects...');
      for (const item of response) {
        if (item.tool) {
          const toolName = this.mapToolName(item.tool);
          const rawParams = item.arguments || item.params || {};

          // 🔥 FIX: Map parameter names (AI sometimes uses wrong names)
          const params = this.normalizeParameterNames(toolName, rawParams);

          normalized.steps.push({
            id: `step_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            toolName,
            params
          });
        }
      }
      logger.info(`✅ Normalized ${normalized.steps.length} tool objects`);
    }

    // Pattern 3: Single {tool: "slowmode", arguments: {...}}
    if (response.tool && !Array.isArray(response)) {
      logger.info('🔄 Detected single tool object format...');
      const toolName = this.mapToolName(response.tool);
      const rawParams = response.arguments || response.params || {};

      // 🔥 FIX: Map parameter names (AI sometimes uses wrong names)
      const params = this.normalizeParameterNames(toolName, rawParams);

      normalized.steps.push({
        id: `step_${Date.now()}`,
        toolName,
        params
      });
      logger.info(`✅ Normalized single tool: ${toolName}`);
    }

    // Pattern 4: Direct command parsing from query if all else fails
    if (normalized.steps.length === 0) {
      logger.warn('⚠️ No recognizable structure, attempting direct query parsing...');
      const directStep = this.parseQueryDirect(query, context);
      if (directStep) {
        normalized.steps.push(directStep);
        logger.info(`✅ Direct parsing succeeded: ${directStep.toolName}`);
      }
    }

    logger.info(`🔄 Normalization complete: ${normalized.steps.length} steps`);
    return normalized;
  }

  /**
   * Map AI tool names to actual BecasFlow tool names
   */
  private mapToolName(aiToolName: string): string {
    const mapping: Record<string, string> = {
      'slowmode': 'set_slowmode',
      'set_slowmode': 'set_slowmode',
      'lock': 'lock_channel',
      'unlock': 'unlock_channel',
      'ban_user': 'ban',
      'kick_user': 'kick',
      'timeout_user': 'timeout',
      'warn_user': 'warn',
      'delete': 'delete_messages'
    };

    return mapping[aiToolName.toLowerCase()] || aiToolName;
  }

  /**
   * Normalize parameter names (AI sometimes uses wrong names)
   * This maps commonly confused parameter names to their correct forms
   */
  private normalizeParameterNames(toolName: string, params: Record<string, any>): Record<string, any> {
    const normalized: Record<string, any> = { ...params };

    // Tool-specific parameter mappings
    if (toolName === 'set_slowmode') {
      // Map 'value' or 'seconds' → 'duration'
      if ('value' in params && !('duration' in params)) {
        normalized.duration = params.value;
        delete normalized.value;
        logger.info(`🔄 Mapped parameter 'value' → 'duration' for set_slowmode`);
      }
      if ('seconds' in params && !('duration' in params)) {
        normalized.duration = params.seconds;
        delete normalized.seconds;
        logger.info(`🔄 Mapped parameter 'seconds' → 'duration' for set_slowmode`);
      }
      // Map 'channel' → 'channelId'
      if ('channel' in params && !('channelId' in params)) {
        normalized.channelId = params.channel;
        delete normalized.channel;
        logger.info(`🔄 Mapped parameter 'channel' → 'channelId' for set_slowmode`);
      }
    }

    // Global parameter mappings (apply to all tools)
    if ('user' in params && !('userId' in params)) {
      normalized.userId = params.user;
      delete normalized.user;
    }
    if ('target' in params && !('userId' in params)) {
      normalized.userId = params.target;
      delete normalized.target;
    }

    return normalized;
  }

  /**
   * Direct query parsing as last resort
   * Parses natural language directly without AI assistance
   */
  private parseQueryDirect(query: string, context: BecasContext): any | null {
    const queryLower = query.toLowerCase();

    // Timeout detection
    if (queryLower.includes('timeout')) {
      // Extract user ID from mention
      const userMatch = query.match(/<@!?(\d+)>/);
      if (!userMatch) {
        logger.warn('⚠️ Timeout command but no user mention found');
        return null;
      }
      const userId = userMatch[1];

      // Extract duration (default 10 minutes if not specified)
      let durationMs = 10 * 60 * 1000; // 10 minutes in milliseconds
      const durationMatch = query.match(/(\d+)\s*(min|minute|second|sec|hour|hr|day)/i);
      if (durationMatch) {
        const value = parseInt(durationMatch[1]);
        const unit = durationMatch[2].toLowerCase();

        if (unit.startsWith('sec')) {
          durationMs = value * 1000;
        } else if (unit.startsWith('min')) {
          durationMs = value * 60 * 1000;
        } else if (unit.startsWith('hour') || unit === 'hr') {
          durationMs = value * 60 * 60 * 1000;
        } else if (unit.startsWith('day')) {
          durationMs = value * 24 * 60 * 60 * 1000;
        }
      }

      // Extract reason (optional)
      const reason = 'Timed out via Becas command';

      logger.info(`✅ Parsed timeout: user=${userId}, duration=${durationMs}ms`);

      return {
        id: `step_${Date.now()}`,
        toolName: 'timeout',
        params: {
          userId,
          duration: durationMs,
          reason
        }
      };
    }

    // Slowmode detection
    if (queryLower.includes('slowmode') || queryLower.includes('slow mode')) {
      // Extract duration (default 6 minutes)
      let duration = 6;
      const durationMatch = query.match(/(\d+)\s*(min|minute|second|sec|hour|hr)/i);
      if (durationMatch) {
        const value = parseInt(durationMatch[1]);
        const unit = durationMatch[2].toLowerCase();

        if (unit.startsWith('sec')) {
          duration = value / 60; // Convert to minutes
        } else if (unit.startsWith('hour') || unit === 'hr') {
          duration = value * 60; // Convert to minutes
        } else {
          duration = value; // Already in minutes
        }
      }

      // Extract channel (default current channel)
      const channelId = context.channel.id;

      return {
        id: `step_${Date.now()}`,
        toolName: 'set_slowmode',
        params: {
          channelId,
          duration: Math.round(duration * 60) // Convert to seconds
        }
      };
    }

    // Lock channel detection
    if (queryLower.includes('lock') && queryLower.includes('channel')) {
      return {
        id: `step_${Date.now()}`,
        toolName: 'lock_channel',
        params: {
          channelId: context.channel.id
        }
      };
    }

    // Unlock channel detection
    if (queryLower.includes('unlock') && queryLower.includes('channel')) {
      return {
        id: `step_${Date.now()}`,
        toolName: 'unlock_channel',
        params: {
          channelId: context.channel.id
        }
      };
    }

    // Ban detection
    if (queryLower.includes('ban')) {
      const userMatch = query.match(/<@!?(\d+)>/);
      if (userMatch) {
        const userId = userMatch[1];
        logger.info(`✅ Parsed ban: user=${userId}`);
        return {
          id: `step_${Date.now()}`,
          toolName: 'ban',
          params: {
            userId,
            reason: 'Banned via Becas command'
          }
        };
      }
    }

    // Kick detection
    if (queryLower.includes('kick')) {
      const userMatch = query.match(/<@!?(\d+)>/);
      if (userMatch) {
        const userId = userMatch[1];
        logger.info(`✅ Parsed kick: user=${userId}`);
        return {
          id: `step_${Date.now()}`,
          toolName: 'kick',
          params: {
            userId,
            reason: 'Kicked via Becas command'
          }
        };
      }
    }

    // Warn detection
    if (queryLower.includes('warn')) {
      const userMatch = query.match(/<@!?(\d+)>/);
      if (userMatch) {
        const userId = userMatch[1];
        logger.info(`✅ Parsed warn: user=${userId}`);
        return {
          id: `step_${Date.now()}`,
          toolName: 'warn',
          params: {
            userId,
            reason: 'Warned via Becas command'
          }
        };
      }
    }

    logger.warn(`⚠️ Could not parse query directly: ${query}`);
    return null;
  }

  /**
   * Try to match common query patterns without AI
   * Returns a plan if pattern is recognized, null otherwise
   */
  private tryFastPath(query: string, context: BecasContext): BecasPlanningResult | null {
    const queryLower = query.toLowerCase();

    // Extract user mention
    const userMatch = query.match(/<@!?(\d+)>/);
    const userId = userMatch ? userMatch[1] : null;
    logger.info(`🔍 Fast path - User mention extracted: ${userId} from query: "${query}"`);

    // Pattern 0: "Who has the most warnings/violations?" - Aggregate query
    const isWhoHasMostQuery = /(?:who|which\s+user).*(?:most|highest|top).*(?:warn|violation|timeout|ban|kick)/i.test(query);
    const isCountByUserQuery = /(?:count|how many).*(?:warn|violation).*(?:by user|per user|each user)/i.test(query);

    if (isWhoHasMostQuery || isCountByUserQuery) {
      logger.info(`🎯 Fast path: "Who has the most warnings" aggregate query detected`);

      // Determine action type (warnings, bans, etc.)
      let actionType: string | undefined;
      if (/\bwarn/i.test(query)) actionType = 'warn';
      else if (/\bban/i.test(query)) actionType = 'ban';
      else if (/\btimeout/i.test(query)) actionType = 'timeout';
      else if (/\bkick/i.test(query)) actionType = 'kick';

      // Determine time range
      let period = 'all';
      if (/this week|past week|last week/i.test(query)) period = 'week';
      else if (/today|this day/i.test(query)) period = 'day';
      else if (/this month|past month|last month/i.test(query)) period = 'month';

      // Build multi-tool pipeline: fetch → filter → group → aggregate → sort → slice
      // Note: We can directly reference nested fields using dot notation (e.g., {{step_1.actions}})
      const plan: BecasPlan = {
        id: `plan_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        query,
        steps: [
          // Step 1: Fetch all moderation history
          {
            id: 'step_1',
            toolName: 'moderation_history',
            params: {
              period,
              limit: 1000 // Get all to aggregate
            },
            outputAs: 'all_history'
          },
          // Step 2: Filter by action type if specified (skip this step if actionType is not specified)
          ...(actionType ? [{
            id: 'step_2',
            toolName: 'data_filter',
            params: {
              data: '{{all_history.actions}}', // Direct nested access
              field: 'type',
              condition: 'equals',
              value: actionType
            },
            outputAs: 'filtered_actions'
          }] : []),
          // Step 3: Group by targetUserId
          {
            id: 'step_3',
            toolName: 'data_group',
            params: {
              data: actionType ? '{{filtered_actions}}' : '{{all_history.actions}}',
              by: 'targetUserId'
            },
            outputAs: 'grouped_by_user'
          },
          // Step 4: Count actions per user
          {
            id: 'step_4',
            toolName: 'data_aggregate',
            params: {
              data: '{{grouped_by_user}}',
              operation: 'count',
              field: '*'
            },
            outputAs: 'user_counts'
          },
          // Step 5: Sort by count (descending)
          {
            id: 'step_5',
            toolName: 'data_sort',
            params: {
              data: '{{user_counts}}',
              by: 'count',
              order: 'desc'
            },
            outputAs: 'sorted_users'
          },
          // Step 6: Take top 10
          {
            id: 'step_6',
            toolName: 'data_slice',
            params: {
              data: '{{sorted_users}}',
              start: 0,
              end: 10
            },
            outputAs: 'top_violators'
          }
        ],
        metadata: {
          createdAt: Date.now(),
          estimatedTime: 2000,
          requiresUserInput: false,
          affectsUsers: 0,
          affectsMessages: 0
        }
      };

      logger.info(`✅ Fast path: Created ${plan.steps.length}-step aggregation pipeline`);
      return { success: true, plan };
    }

    // Pattern 1: Violation/moderation history queries
    // Match: "show violations", "violation history", "all violations", etc.
    const isViolationQuery = /(?:show|what|whats|check|tell|get|find|display|list|give|view).*(?:all|last|recent)?.*(?:violation|warning|history|ban|kick|timeout|moderation|sicil|record)/i.test(query);
    const hasViolationWord = /violation|history|warning|sicil|record/i.test(query);

    if ((isViolationQuery || hasViolationWord) && userId) {
      logger.info(`🎯 Fast path: Violation history query detected for user ${userId}`);

      // Parse quantity modifiers to determine limit
      let limit = 10; // default
      let quantitySource = 'default';

      // Check for "all" keyword - highest priority
      if (/\ball\b/i.test(query)) {
        limit = 100;
        quantitySource = 'all keyword';
      }
      // Check for "only" or "just" without a number (implies 1)
      else if (/\b(only|just)\b/i.test(query) && !/\d+/.test(query)) {
        limit = 1;
        quantitySource = 'only/just keyword';
      }
      // Check for "last" without a number (implies 1)
      else if (/\blast\b/i.test(query) && !/\d+/.test(query)) {
        limit = 1;
        quantitySource = 'last keyword (no number)';
      }
      // Extract explicit numbers: "last 5", "first 3", "show 2", "only 3", etc.
      else {
        const numberMatch = query.match(/\b(last|first|show|get|only|just|recent)\s+(\d+)\b/i);
        if (numberMatch) {
          limit = parseInt(numberMatch[2]);
          quantitySource = `explicit number (${numberMatch[1]} ${numberMatch[2]})`;
        }
      }

      const params = {
        userId: userId,
        period: 'month',
        limit: limit
      };
      logger.info(`🔍 Fast path - Creating plan with params (limit=${limit}, source=${quantitySource}):`, params);
      return {
        success: true,
        plan: {
          id: `plan_${Date.now()}`,
          query: query,
          steps: [
            {
              id: 'step_1',
              toolName: 'moderation_history',
              params: params,
              condition: undefined,
              ifTrue: [],
              ifFalse: [],
              outputAs: undefined,
              dependsOn: []
            }
          ],
          metadata: {
            createdAt: Date.now(),
            estimatedTime: 2000,
            requiresUserInput: false,
            affectsUsers: 0,
            affectsMessages: 0
          }
        }
      };
    }

    // Pattern 2: Trust score queries
    // Match: "my trust score", "check my score", "what's my score", "check trust @user"
    const isTrustQuery = /(?:my|check|what|whats|show|tell|get).*(?:trust|score)/i.test(query);
    const hasTrustWord = /\b(?:trust|score)\b/i.test(query);

    if ((isTrustQuery || hasTrustWord)) {
      // Extract user ID - if no mention, use message author (for "my score")
      const targetUserId = userId || context.message.author.id;
      logger.info(`🎯 Fast path: Trust score query detected for user ${targetUserId}`);
      return {
        success: true,
        plan: {
          id: `plan_${Date.now()}`,
          query: query,
          steps: [
            {
              id: 'step_1',
              toolName: 'check_trust',
              params: {
                userId: targetUserId,
                detailed: true
              },
              condition: undefined,
              ifTrue: [],
              ifFalse: [],
              outputAs: undefined,
              dependsOn: []
            }
          ],
          metadata: {
            createdAt: Date.now(),
            estimatedTime: 1000,
            requiresUserInput: false,
            affectsUsers: 0,
            affectsMessages: 0
          }
        }
      };
    }

    // No fast path match
    return null;
  }
}
