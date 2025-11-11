/**
 * EXECUTION ENGINE
 *
 * Orchestrates multi-intent execution with dependency management.
 * Executes intents in order, respecting dependencies between steps.
 *
 * Example:
 * - Intent 1: Ban toxic users (MODERATION_QUERY)
 * - Intent 2: Show analytics (ANALYTICS) - depends on Intent 1
 *
 * Execution: Ban users first, then show analytics on those users.
 */

import { ExecutionStep, Intent } from './IntentClassifier';
import { IntelligentQueryEngine } from './IntelligentQueryEngine';
import { ServerAnalysis } from '../systems/ServerAnalysis';
import { TrustScoreEngineDB } from '../systems/TrustScoreEngineDB';
import { GuildPolicyEngine } from './GuildPolicyEngine';
import { V3Integration } from '../integration/V3Integration';
import { OllamaService } from '../services/OllamaService';
import { Message, Guild, TextChannel, PermissionFlagsBits } from 'discord.js';
import { createLogger } from '../services/Logger';
import { BecasToolRegistry } from '../becasflow/registry/BecasToolRegistry';
import { BecasContext } from '../becasflow/types/BecasFlow.types';
import { BecasPlanner } from '../becasflow/core/BecasPlanner';
import { BecasExecutor } from '../becasflow/core/BecasExecutor';

const logger = createLogger('ExecutionEngine');

export interface ExecutionContext {
  guild: Guild;
  channel: TextChannel;
  message: Message;
  results: Map<number, any>; // Results from previous steps (indexed by step number)
}

export interface ExecutionResult {
  success: boolean;
  results: string[];
  errors: string[];
}

export class ExecutionEngine {
  private llm: OllamaService;
  private toolRegistry: BecasToolRegistry;
  private becasPlanner: BecasPlanner;
  private becasExecutor: BecasExecutor;

  constructor(
    private intelligentQueryEngine: IntelligentQueryEngine,
    private serverAnalysis: ServerAnalysis,
    private trustScoreEngine: TrustScoreEngineDB,
    private policyEngine: GuildPolicyEngine,
    private v3Integration: V3Integration
  ) {
    this.llm = new OllamaService('cognitive');
    this.toolRegistry = BecasToolRegistry.getInstance();
    this.becasPlanner = new BecasPlanner(new OllamaService('cognitive'), this.toolRegistry);
    this.becasExecutor = new BecasExecutor(this.toolRegistry);
  }

  /**
   * Execute a multi-intent plan sequentially
   */
  async execute(
    executionPlan: ExecutionStep[],
    context: ExecutionContext
  ): Promise<ExecutionResult> {
    const results: string[] = [];
    const errors: string[] = [];

    logger.info(`🚀 Starting execution of ${executionPlan.length} steps`);

    for (let i = 0; i < executionPlan.length; i++) {
      const step = executionPlan[i];

      // Check dependencies
      const dependenciesMet = this.checkDependencies(step, context.results);
      if (!dependenciesMet) {
        const error = `Step ${i} (${step.intent}) dependencies not met`;
        logger.error(error);
        errors.push(error);
        continue;
      }

      // Execute step
      try {
        logger.info(`📍 Executing step ${i + 1}/${executionPlan.length}: ${step.intent} via ${step.agent}`);

        const result = await this.executeStep(step, context);
        context.results.set(i, result);

        // Generate AI-powered natural language response
        const naturalResponse = await this.generateNaturalResponse(
          step.intent,
          step.query,
          result
        );
        results.push(naturalResponse);

        logger.info(`✅ Step ${i + 1} completed: ${step.intent}`);
      } catch (error) {
        const errorMsg = `Step ${i} (${step.intent}) failed: ${error}`;
        logger.error(errorMsg);
        errors.push(errorMsg);
      }
    }

    logger.info(`🏁 Execution complete: ${results.length} successes, ${errors.length} errors`);

    return {
      success: errors.length === 0,
      results,
      errors,
    };
  }

  /**
   * Execute a single step
   */
  private async executeStep(step: ExecutionStep, context: ExecutionContext): Promise<string> {
    switch (step.intent) {
      case 'MODERATION_QUERY':
        return await this.executeModerationQuery(step, context);

      case 'ANALYTICS':
        return await this.executeAnalytics(step, context);

      case 'TRUST_SCORE':
        return await this.executeTrustScore(step, context);

      case 'POLICY_MANAGEMENT':
        return await this.executePolicyManagement(step, context);

      case 'USER_PROFILE':
        return await this.executeUserProfile(step, context);

      case 'SERVER_INFO':
        return await this.executeServerInfo(step, context);

      case 'UNDO':
        return await this.executeUndo(step, context);

      case 'MODIFY':
        return await this.executeModify(step, context);

      case 'CHAT':
        return await this.executeChat(step, context);

      case 'ADMIN_ACTION':
        return await this.executeAdminAction(step, context);

      default:
        throw new Error(`Unknown intent: ${step.intent}`);
    }
  }

  /**
   * Check if all dependencies for a step are met
   */
  private checkDependencies(step: ExecutionStep, results: Map<number, any>): boolean {
    for (const depIndex of step.dependencies) {
      if (!results.has(depIndex)) {
        return false;
      }
    }
    return true;
  }

  // ============================================
  // INTENT EXECUTORS
  // ============================================

  private async executeModerationQuery(step: ExecutionStep, context: ExecutionContext): Promise<string> {
    // Route to BecasFlow for multi-tool pipeline execution
    logger.info(`🔍 Routing moderation query to BecasFlow: "${step.query}"`);

    try {
      // Create BecasContext
      const member = await context.guild.members.fetch(context.message.author.id);
      const becasContext: BecasContext = {
        guild: context.guild,
        channel: context.channel,
        member: member,
        message: context.message,
      } as BecasContext;

      // Plan execution using BecasPlanner
      const planningResult = await this.becasPlanner.createPlan(step.query, becasContext);

      if (!planningResult.success || !planningResult.plan || planningResult.plan.steps.length === 0) {
        logger.warn('BecasPlanner returned empty plan, falling back to IntelligentQueryEngine');
        return await this.intelligentQueryEngine.processNaturalLanguageQuery(
          context.guild,
          step.query,
          context.channel,
          context.message.id
        );
      }

      logger.info(`📋 BecasPlanner created ${planningResult.plan.steps.length}-step plan`);

      // Execute plan using BecasExecutor
      const result = await this.becasExecutor.execute(planningResult.plan, becasContext);

      if (!result.success) {
        const errorMsg = result.errors.length > 0 ? result.errors[0].error : 'Unknown error';
        logger.error(`BecasFlow execution failed: ${errorMsg}`);
        return `❌ Query failed: ${errorMsg}`;
      }

      // Return the final output or extract data from results
      if (result.finalOutput) {
        return result.finalOutput;
      } else if (result.results.length > 0) {
        // Get last step's data
        const lastResult = result.results[result.results.length - 1];
        if (lastResult.result.data) {
          return this.formatBecasFlowResult(lastResult.result.data, step.query);
        }
      }

      return '✅ Query executed successfully';

    } catch (error: any) {
      logger.error(`BecasFlow execution error: ${error.message}`);
      // Fallback to old system
      logger.warn('Falling back to IntelligentQueryEngine due to error');
      return await this.intelligentQueryEngine.processNaturalLanguageQuery(
        context.guild,
        step.query,
        context.channel,
        context.message.id
      );
    }
  }

  private async executeAnalytics(step: ExecutionStep, context: ExecutionContext): Promise<string> {
    // Check if this depends on a moderation query
    const hasModerationDep = step.dependencies.length > 0;

    if (hasModerationDep) {
      // Get data from previous moderation action
      const moderationResult = context.results.get(step.dependencies[0]);
      return `📊 **Analytics after moderation:**\n${moderationResult || 'No data'}\n\n(Analytics on moderated users)`;
    }

    // General analytics - use getSummary instead
    const summary = await this.serverAnalysis.getSummary(context.guild);
    return `📊 **Server Analytics:**\n${summary}`;
  }

  private async executeTrustScore(step: ExecutionStep, context: ExecutionContext): Promise<string> {
    // Extract user mention or ID from query
    const userMatch = step.query.match(/<@!?(\d+)>/);

    // If no user mention, check if user is asking for their own score
    let userId: string;
    if (!userMatch) {
      // Check if query indicates the user wants their own score
      const selfQueries = ['my score', 'whats my score', 'check my score', 'my trust', 'my level'];
      const isSelfQuery = selfQueries.some(sq => step.query.toLowerCase().includes(sq));

      if (isSelfQuery) {
        // Use message author's ID
        userId = context.message.author.id;
      } else {
        return '❌ No user specified for trust score check. Try mentioning a user or ask "whats my score"';
      }
    } else {
      userId = userMatch[1];
    }

    const member = await context.guild.members.fetch(userId).catch(() => null);
    if (!member) {
      return '❌ User not found';
    }

    const trustScore = await this.trustScoreEngine.getTrustScore(userId, context.guild.id);
    return `🔍 **Trust Score for ${member.user.tag}:**\n` +
           `Score: ${trustScore.score}\n` +
           `Level: ${trustScore.level}\n` +
           `Status: ${trustScore.score >= 70 ? 'Trusted' : trustScore.score >= 40 ? 'Neutral' : 'Suspicious'}`;
  }

  private async executePolicyManagement(step: ExecutionStep, context: ExecutionContext): Promise<string> {
    // Check if user wants to list policies
    if (step.query.toLowerCase().includes('show') || step.query.toLowerCase().includes('list')) {
      const policies = await this.policyEngine.getPolicies(context.guild.id, true);
      if (policies.length === 0) {
        return '📋 No active policies found';
      }

      let response = '📋 **Active Policies:**\n\n';
      for (const policy of policies) {
        response += `**${policy.data.name}**\n`;
        response += `- ${policy.data.description}\n`;
        response += `- Triggers: ${policy.data.condition.occurrences} occurrences in ${policy.data.condition.timeWindow / 60000} minutes\n\n`;
      }
      return response;
    }

    return '📋 Policy management: Use "show policies" to list all policies';
  }

  private async executeUserProfile(step: ExecutionStep, context: ExecutionContext): Promise<string> {
    const userMatch = step.query.match(/<@!?(\d+)>/);
    if (!userMatch) {
      return '❌ No user specified for profile lookup';
    }

    const userId = userMatch[1];
    const member = await context.guild.members.fetch(userId).catch(() => null);
    if (!member) {
      return '❌ User not found';
    }

    const trustScore = await this.trustScoreEngine.getTrustScore(userId, context.guild.id);
    return `👤 **User Profile: ${member.user.tag}**\n` +
           `ID: ${userId}\n` +
           `Trust Score: ${trustScore.score} (${trustScore.level})\n` +
           `Roles: ${member.roles.cache.map(r => r.name).join(', ')}\n` +
           `Joined: ${member.joinedAt?.toLocaleDateString()}`;
  }

  private async executeServerInfo(step: ExecutionStep, context: ExecutionContext): Promise<string> {
    const guild = context.guild;
    return `🏰 **Server Info: ${guild.name}**\n` +
           `Members: ${guild.memberCount}\n` +
           `Channels: ${guild.channels.cache.size}\n` +
           `Roles: ${guild.roles.cache.size}\n` +
           `Created: ${guild.createdAt.toLocaleDateString()}`;
  }

  private async executeUndo(step: ExecutionStep, context: ExecutionContext): Promise<string> {
    const result = await this.v3Integration.handleUndoCommand(
      context.message,
      context.message.member!
    );

    if (result.success) {
      return '✅ Action undone successfully!';
    } else {
      return `❌ ${result.error || 'Could not undo action'}`;
    }
  }

  private async executeModify(step: ExecutionStep, context: ExecutionContext): Promise<string> {
    // Parse modification from query
    // This is a simplified version - you'd want to use AI to parse this
    const newActionType = step.query.toLowerCase().includes('ban') ? 'ban' :
                          step.query.toLowerCase().includes('timeout') ? 'timeout' :
                          step.query.toLowerCase().includes('kick') ? 'kick' : 'warn';

    const result = await this.v3Integration.handleModifyCommand(
      context.message,
      context.message.member!,
      newActionType as 'ban' | 'timeout' | 'kick' | 'warn'
    );

    if (result.success) {
      return `✅ Action modified to ${newActionType}!`;
    } else {
      return `❌ ${result.error || 'Could not modify action'}`;
    }
  }

  private async executeChat(step: ExecutionStep, context: ExecutionContext): Promise<string> {
    // Detect sub-intent using AI (intent tree architecture)
    const subIntent = await this.detectChatSubIntent(step.query);

    logger.info(`CHAT sub-intent detected: ${subIntent}`);

    switch (subIntent) {
      case 'HELP':
        return this.handleHelpIntent(step.query);

      case 'GREETING':
        return this.handleGreetingIntent(step.query);

      case 'THANKS':
        return this.handleThanksIntent(step.query);

      case 'STATUS':
        return this.handleStatusIntent(step.query);

      case 'CASUAL':
      default:
        return this.handleCasualIntent(step.query);
    }
  }

  /**
   * Detect CHAT sub-intent using AI
   */
  private async detectChatSubIntent(query: string): Promise<string> {
    const prompt = `Classify this chat message into ONE sub-intent:

Message: "${query}"

Sub-intents:
- HELP: User asking what the bot can do, requesting features list, capabilities, help
  Examples: "what can you do", "help", "tell me your features", "capabilities"

- GREETING: User greeting the bot
  Examples: "hello", "hi", "hey there", "good morning"

- THANKS: User thanking the bot
  Examples: "thank you", "thanks", "appreciate it"

- STATUS: User asking how the bot is doing
  Examples: "how are you", "how's it going", "you ok?"

- CASUAL: Everything else (general conversation)
  Examples: "nice work", "that's cool", random chat

Return ONLY the sub-intent name (HELP, GREETING, THANKS, STATUS, or CASUAL).
No explanations, just the name.`;

    try {
      const response = await this.llm.generate(
        prompt,
        'You are a sub-intent classifier. Return only the sub-intent name.',
        { temperature: 0.1, maxTokens: 10 }
      );

      const subIntent = response.trim().toUpperCase();
      return ['HELP', 'GREETING', 'THANKS', 'STATUS', 'CASUAL'].includes(subIntent) ? subIntent : 'CASUAL';
    } catch (error) {
      logger.error('Sub-intent detection failed:', error);
      return 'CASUAL'; // fallback
    }
  }

  /**
   * Handle HELP sub-intent - show capabilities
   */
  private handleHelpIntent(query: string): string {
    return `🤖 **Becas AI - Your Intelligent Discord Moderator**

**🛡️ Core Moderation:**
• **Smart Auto-Moderation** - Automatically detects and handles scams, phishing, toxicity, spam
• **Natural Language Commands** - Just talk to me! "ban toxic users", "timeout spammers"
• **Multi-Intent Understanding** - "ban toxic users and show me analytics" - I can do both!
• **Learning System** - Tell me "undo that" or "no, ban them instead" and I learn from corrections

**🧠 AI-Powered Features:**
• **Context Awareness** - I remember conversations and understand references like "that user"
• **Sentiment Analysis** - Track emotional tone and escalation in conversations
• **Scam Detection** - Advanced pattern matching for phishing links, fake giveaways
• **Typo Correction** - Understands "tkxic" as "toxic" - works in Turkish & English

**🔍 Investigation & Analytics:**
• **Trust Score System** - Cross-server reputation tracking (10M+ users)
• **User Investigation** - "investigate @user" for detailed behavior analysis
• **Server Analytics** - Real-time stats, trends, threat reports
• **Pattern Recognition** - Identifies repeat offenders and coordinated attacks

**⚡ Quick Commands (Natural Language):**
\`\`\`
becas ban toxic users in last 20 messages
becas investigate @user
becas show me server analytics
becas what's the trust score of @user
becas timeout spammers for 1 hour
becas undo that action
\`\`\`

**🌐 Cross-Server Intelligence:**
• **Federation Network** - Share threats with other servers running Becas
• **Global Ban Lists** - Automatically receive known scammer reports
• **Decentralized Trust** - Blockchain-backed reputation (optional)

**🎯 Smart Workflows:**
• **Auto-Ban Policies** - "If user posts 3 toxic messages in 5 minutes, timeout 1 hour"
• **Escalation Paths** - Warn → Timeout → Kick → Ban (customizable)
• **Safe Testing** - Test mode channel to try features without real actions

**💎 Powered by Local AI:**
• **Qwen3:8b** - 8B parameter model running on your hardware
• **100% Private** - No data sent to external APIs
• **Fast Responses** - 8-12 second analysis times
• **Multilingual** - Turkish & English support

**📚 Get Started:**
• Tag me or say "becas" to start conversations
• Reply to my messages to continue talking
• Check dashboard: http://localhost:3000
• Visit: https://becascore.xyz

Need specific help? Just ask! I understand natural language. 😊`;
  }

  /**
   * Handle GREETING sub-intent
   */
  private handleGreetingIntent(query: string): string {
    return '👋 Hello! How can I help you moderate your server today?';
  }

  /**
   * Handle THANKS sub-intent
   */
  private handleThanksIntent(query: string): string {
    return '😊 You\'re welcome! Happy to help!';
  }

  /**
   * Handle STATUS sub-intent
   */
  private handleStatusIntent(query: string): string {
    return '🤖 I\'m operational and ready to assist with moderation!';
  }

  /**
   * Handle CASUAL sub-intent - general conversation (AI-powered)
   */
  private async handleCasualIntent(query: string): Promise<string> {
    try {
      // Model is already warmed up in constructor - just generate response
      const prompt = `User said: "${query}"

Your response:`

      const systemPrompt = 'You are Becas, a friendly Discord bot. Respond in 1-2 sentences. Be casual and helpful.';

      logger.info(`🔍 DEBUG CASUAL CHAT - User query: "${query}"`);
      logger.info(`🔍 DEBUG CASUAL CHAT - Prompt: ${prompt}`);
      logger.info(`🔍 DEBUG CASUAL CHAT - System: ${systemPrompt}`);
      logger.info(`🔍 DEBUG CASUAL CHAT - Options: temp=0.7, maxTokens=400`);

      const response = await this.llm.generate(
        prompt,
        systemPrompt,
        { temperature: 0.7, maxTokens: 400 } // Increased to allow complete responses without truncation
      );

      logger.info(`🔍 DEBUG CASUAL CHAT - RAW RESPONSE: "${response}"`);
      logger.info(`🔍 DEBUG CASUAL CHAT - RESPONSE LENGTH: ${response.length}`);

      const trimmed = response.trim();
      logger.info(`🔍 DEBUG CASUAL CHAT - FINAL RESPONSE: "${trimmed}"`);

      return trimmed || '💬 I\'m here to help! What can I do for you?';
    } catch (error) {
      logger.error('Failed to generate casual response:', error);
      return '💬 I\'m here to help! What can I do for you?';
    }
  }

  /**
   * Execute ADMIN_ACTION intent - delegates to create_channel tool via BecasFlow
   */
  private async executeAdminAction(step: ExecutionStep, context: ExecutionContext): Promise<string> {
    if (!context.message.guild) {
      return '❌ This command can only be used in a server';
    }

    // Check if user has admin permissions
    if (!context.message.member?.permissions.has(PermissionFlagsBits.Administrator)) {
      return '❌ You need Administrator permissions to use admin commands';
    }

    try {
      // Extract channel name using AI with JSON mode for reliability
      const extractionPrompt = `Extract the channel name from this admin command.

Query: "${step.query}"

Examples:
"create a channel named announcements" → {"channelName": "announcements"}
"make a voice channel called gaming" → {"channelName": "gaming"}
"create text channel support" → {"channelName": "support"}
"becas create channel named harun" → {"channelName": "harun"}

Return ONLY valid JSON with the channelName field. If no name found, use "general".`;

      const response = await this.llm.generate(
        extractionPrompt,
        'You are a data extraction system. Return ONLY valid JSON with channelName field.',
        { temperature: 0.0, maxTokens: 30, format: 'json' }
      );

      let channelName = 'general';
      try {
        const parsed = JSON.parse(response.trim());
        channelName = parsed.channelName || 'general';
      } catch {
        // Fallback: try to extract name directly
        const match = step.query.match(/named?\s+([a-zA-Z0-9-_]+)/i);
        channelName = match ? match[1] : 'general';
      }
      const isVoice = step.query.toLowerCase().includes('voice');
      const channelType = isVoice ? 'voice' : 'text';

      // Get create_channel tool from registry
      const createChannelTool = this.toolRegistry.get('create_channel');
      if (!createChannelTool) {
        logger.error('create_channel tool not found in registry!');
        return '❌ Internal error: create_channel tool not registered';
      }

      // Build minimal BecasContext for tool execution (using 'as any' to bypass full context requirements)
      const becasContext = {
        guild: context.message.guild,
        channel: context.message.channel as TextChannel,
        member: context.message.member,
        message: context.message,
        services: {
          v3Integration: this.v3Integration,
        },
      } as any;

      // Execute the tool directly
      const result = await createChannelTool.execute(
        {
          name: channelName,
          type: channelType,
          reason: `Created via admin command: "${step.query}"`,
        },
        becasContext
      );

      if (result.success) {
        logger.info(`✅ Created ${channelType} channel: ${channelName} via BecasFlow`);

        // Generate friendly AI commentary about successful action
        const aiCommentaryPrompt = `You are a Discord server assistant. You successfully completed an action and need to inform the user in a natural, friendly way.

Action performed: "${step.query}"
Result: Created ${channelType} channel (#${channelName})
Channel ID: <#${result.data.channelId}>

Tell the user:
1. Confirm that the channel was created
2. Mention the channel name and type (text/voice)
3. Ask if they need anything else

Respond in English with a friendly and helpful tone. You can use emojis but don't overdo it.`;

        const aiResponse = await this.llm.generate(
          aiCommentaryPrompt,
          'You are a helpful Discord assistant. Speak naturally and friendly in English.',
          { temperature: 0.7, maxTokens: 120 }
        );

        return aiResponse.trim();
      } else {
        logger.error(`❌ Failed to create channel via BecasFlow: ${result.error}`);

        // Generate friendly AI commentary about failed action
        const aiErrorPrompt = `You are a Discord server assistant. An action failed and you need to explain it to the user with empathy.

Attempted action: "${step.query}"
Error: ${result.error}

Tell the user:
1. Gently explain that the action failed
2. Clearly state the error
3. Suggest an alternative solution or what they can do

Respond in English with an understanding and helpful tone.`;

        const aiResponse = await this.llm.generate(
          aiErrorPrompt,
          'You are a helpful Discord assistant. Show empathy with errors. Respond in English.',
          { temperature: 0.7, maxTokens: 120 }
        );

        return aiResponse.trim();
      }
    } catch (error) {
      logger.error('Failed to execute admin action:', error);

      // Generate friendly AI commentary about unexpected error
      const aiErrorPrompt = `You are a Discord server assistant. An unexpected error occurred and you need to explain it to the user with empathy.

Attempted action: "${step.query}"
Error: ${error}

Tell the user:
1. Gently explain that an unexpected issue occurred
2. Suggest they try again or try again later
3. Mention that you want to help

Respond in English with an understanding and helpful tone.`;

      try {
        const aiResponse = await this.llm.generate(
          aiErrorPrompt,
          'You are a helpful Discord assistant. Show empathy with errors. Respond in English.',
          { temperature: 0.7, maxTokens: 120 }
        );
        return aiResponse.trim();
      } catch (aiError) {
        // If AI also fails, return basic error message
        return `❌ An unexpected error occurred. Please try again later.`;
      }
    }
  }

  /**
   * Generate natural language response using AI
   */
  private async generateNaturalResponse(
    intent: Intent,
    query: string,
    technicalResult: string
  ): Promise<string> {
    // For some intents, technical result is already good - return directly
    // CHAT: Already has natural responses from handleChatIntent
    // MODERATION_QUERY: Already formatted by IntelligentQueryEngine
    // ADMIN_ACTION: Already formatted by AdminActionEngine
    if (intent === 'MODERATION_QUERY' || intent === 'CHAT' || intent === 'ADMIN_ACTION') {
      return technicalResult;
    }

    // For other intents, convert technical output to natural language
    const prompt = `You are a friendly Discord moderation bot. Convert this technical output into a natural, conversational response.

User's request: "${query}"
Intent: ${intent}
Technical output:
${technicalResult}

Respond naturally in 1-3 sentences. Be friendly and informative. You can use Turkish or English based on the user's language.

Your response:`;

    try {
      const response = await this.llm.generate(
        prompt,
        'You are a friendly Discord moderation bot assistant. Respond naturally and conversationally.',
        { temperature: 0.7, maxTokens: 400 }
      );

      return response.trim();
    } catch (error) {
      logger.error('Failed to generate natural response:', error);
      // Fallback to technical result
      return technicalResult;
    }
  }

  /**
   * Format BecasFlow result into user-friendly response
   */
  private formatBecasFlowResult(data: any, query: string): string {
    // If data is an array, format as a list
    if (Array.isArray(data)) {
      if (data.length === 0) {
        return '📭 No results found for your query.';
      }

      // Check if this is moderation history data
      if (data[0] && ('action_type' in data[0] || 'type' in data[0])) {
        return this.formatModerationHistory(data, query);
      }

      // Generic array formatting
      return `📊 **Results (${data.length} items):**\n\n` +
             data.slice(0, 10).map((item, i) => `${i + 1}. ${JSON.stringify(item)}`).join('\n') +
             (data.length > 10 ? `\n\n...and ${data.length - 10} more` : '');
    }

    // If data is an object with aggregation results
    if (typeof data === 'object' && data !== null) {
      // Check if it's a count/sum/average result
      if ('count' in data || 'sum' in data || 'average' in data) {
        return this.formatAggregationResult(data, query);
      }

      // Generic object formatting
      return '📊 **Result:**\n' + JSON.stringify(data, null, 2);
    }

    // Primitive value
    return `✅ Result: ${data}`;
  }

  /**
   * Format moderation history data
   */
  private formatModerationHistory(data: any[], query: string): string {
    const actionType = data[0].action_type || data[0].type;
    const count = data.length;

    let response = `📋 **Moderation History (${count} ${actionType || 'action'}${count !== 1 ? 's' : ''}):**\n\n`;

    for (let i = 0; i < Math.min(data.length, 10); i++) {
      const item = data[i];
      const user = item.user_id ? `<@${item.user_id}>` : 'Unknown';
      const moderator = item.moderator_id ? `<@${item.moderator_id}>` : 'System';
      const reason = item.reason || 'No reason provided';
      const timestamp = item.timestamp ? new Date(item.timestamp).toLocaleString() : 'Unknown';

      response += `${i + 1}. **${item.action_type || item.type}** - ${user}\n`;
      response += `   By: ${moderator} | ${timestamp}\n`;
      response += `   Reason: ${reason}\n\n`;
    }

    if (data.length > 10) {
      response += `...and ${data.length - 10} more actions`;
    }

    return response;
  }

  /**
   * Format aggregation result (count, sum, average, etc.)
   */
  private formatAggregationResult(data: any, query: string): string {
    if (typeof data === 'number') {
      // Simple count/sum/average
      if (query.toLowerCase().includes('count') || query.toLowerCase().includes('how many')) {
        return `📊 **Count:** ${data}`;
      } else if (query.toLowerCase().includes('sum') || query.toLowerCase().includes('total')) {
        return `📊 **Total:** ${data}`;
      } else if (query.toLowerCase().includes('average') || query.toLowerCase().includes('avg')) {
        return `📊 **Average:** ${data.toFixed(2)}`;
      }
      return `📊 **Result:** ${data}`;
    }

    // Grouped aggregation (object with keys)
    if (typeof data === 'object' && data !== null) {
      let response = '📊 **Results:**\n\n';
      for (const [key, value] of Object.entries(data)) {
        response += `**${key}**: ${value}\n`;
      }
      return response;
    }

    return `📊 **Result:** ${JSON.stringify(data)}`;
  }
}
