/**
 * INTENT CLASSIFIER
 *
 * AI decides if a moderator message is:
 * - MODERATION_QUERY: Execute a moderation action
 * - CHAT: Normal conversation
 * - UNDO: Undo last action
 * - MODIFY: Modify last action
 *
 * No more !query commands! Just talk naturally.
 */

import { OllamaService } from '../services/OllamaService';
import { createLogger } from '../services/Logger';
import { INTENT_REGISTRY, formatIntentsForAI, getRootIntents } from './IntentRegistry';

const logger = createLogger('IntentClassifier');

export type Intent =
  | 'MODERATION_QUERY'
  | 'CHAT'
  | 'UNDO'
  | 'MODIFY'
  | 'ANALYTICS'
  | 'TRUST_SCORE'
  | 'POLICY_MANAGEMENT'
  | 'USER_PROFILE'
  | 'SERVER_INFO'
  | 'ADMIN_ACTION'
  | 'UNKNOWN';

export interface ExecutionStep {
  intent: Intent;
  agent: string;
  query: string;
  dependencies: number[]; // Indices of steps this depends on
}

export interface IntentResult {
  intents: Intent[]; // Multiple intents instead of single
  confidence: number;
  reasoning: string;
  extractedQueries: Map<Intent, string>; // Query per intent
  executionPlan: ExecutionStep[];
}

export class IntentClassifier {
  private llm: OllamaService;

  constructor() {
    this.llm = new OllamaService('cognitive');
    logger.info('🧠 IntentClassifier initialized');
  }

  /**
   * Classify the intent of a moderator message (supports multi-intent detection)
   */
  async classifyIntent(message: string, isModerator: boolean): Promise<IntentResult> {
    // Non-moderators always get CHAT
    if (!isModerator) {
      return {
        intents: ['CHAT'],
        confidence: 1.0,
        reasoning: 'Non-moderator message',
        extractedQueries: new Map([['CHAT', message]]),
        executionPlan: [
          {
            intent: 'CHAT',
            agent: 'ChatEngine',
            query: message,
            dependencies: [],
          },
        ],
      };
    }

    // Quick keyword detection for common cases (fast path)
    const quickResult = this.quickClassify(message);
    if (quickResult) {
      logger.info(`Quick classify: ${message} → ${quickResult.intents.join(', ')} (${quickResult.confidence})`);
      return quickResult;
    }

    // Use AI for complex cases
    const aiResult = await this.aiClassify(message);
    logger.info(`AI classify: ${message} → ${aiResult.intents.join(', ')} (${aiResult.confidence})`);
    return aiResult;
  }

  /**
   * Quick keyword-based classification (no AI needed) - supports multi-intent
   */
  private quickClassify(message: string): IntentResult | null {
    const lower = message.toLowerCase().trim();
    const detectedIntents: Intent[] = [];
    const queries = new Map<Intent, string>();

    // UNDO patterns (always single intent, highest priority)
    const undoPatterns = ['undo that', 'take it back', 'revert', 'cancel that', 'geri al'];
    if (undoPatterns.some(p => lower.includes(p))) {
      return {
        intents: ['UNDO'],
        confidence: 0.95,
        reasoning: 'Undo keyword detected',
        extractedQueries: new Map([['UNDO', message]]),
        executionPlan: [
          {
            intent: 'UNDO',
            agent: 'V3Integration',
            query: message,
            dependencies: [],
          },
        ],
      };
    }

    // MODIFY patterns (always single intent, high priority)
    const modifyPatterns = [
      'no, ban',
      'no ban',
      'instead',
      'change to',
      'make it',
      'değiştir',
      'hayır ban',
    ];
    if (modifyPatterns.some(p => lower.includes(p))) {
      return {
        intents: ['MODIFY'],
        confidence: 0.9,
        reasoning: 'Modify keyword detected',
        extractedQueries: new Map([['MODIFY', message]]),
        executionPlan: [
          {
            intent: 'MODIFY',
            agent: 'V3Integration',
            query: message,
            dependencies: [],
          },
        ],
      };
    }

    // 🔥 CRITICAL: Detect QUESTIONS vs COMMANDS
    const questionKeywords = [
      'what', 'whats', "what's", 'show', 'check', 'who', 'which',
      'when', 'where', 'tell me', 'give me', 'list', 'how many',
      'count', 'find', 'get', 'display', 'see',
    ];
    const isQuestion = questionKeywords.some(k => lower.startsWith(k) || lower.includes(' ' + k + ' '));

    // MODERATION_QUERY patterns (COMMANDS ONLY)
    const moderationKeywords = [
      'ban', 'timeout', 'kick', 'warn', 'delete', 'remove',
      'mute', 'unmute', 'unban', 'untimeout',
    ];
    const categoryKeywords = [
      'toxic', 'toxicity', 'spam', 'spammer', 'fud',
      'profanity', 'scam', 'nsfw', 'offensive', 'violation',
    ];
    const timeKeywords = [
      'last', 'recent', 'messages', 'hours', 'minutes',
      'son', 'dakika', 'saat', 'mesaj',
    ];

    const hasModerationKeyword = moderationKeywords.some(k => lower.includes(k));
    const hasCategoryKeyword = categoryKeywords.some(k => lower.includes(k));
    const hasTimeKeyword = timeKeywords.some(k => lower.includes(k));

    // Check for user mention - DIRECT USER ACTION pattern
    const hasUserMention = /<@!?\d+>/.test(message) || /@\w+/.test(message);

    // Strong moderation signal - BUT NOT if it's a question!
    if (hasModerationKeyword && (hasCategoryKeyword || hasTimeKeyword || hasUserMention) && !isQuestion) {
      detectedIntents.push('MODERATION_QUERY');
      queries.set('MODERATION_QUERY', message);
    }

    // ANALYTICS patterns
    const analyticsKeywords = [
      'analytics', 'stats', 'statistics', 'report', 'analysis',
      'show me', 'istatistik', 'rapor', 'analiz',
    ];
    if (analyticsKeywords.some(k => lower.includes(k))) {
      detectedIntents.push('ANALYTICS');
      queries.set('ANALYTICS', message);
    }

    // TRUST_SCORE patterns
    const trustKeywords = [
      'trust score', 'trust', 'güven skoru', 'güven',
      'reputation', 'itibar',
    ];
    if (trustKeywords.some(k => lower.includes(k))) {
      detectedIntents.push('TRUST_SCORE');
      queries.set('TRUST_SCORE', message);
    }

    // POLICY_MANAGEMENT patterns
    const policyKeywords = [
      'policy', 'policies', 'rule', 'rules', 'kural', 'kurallar',
      'create policy', 'add rule', 'politika',
    ];
    if (policyKeywords.some(k => lower.includes(k))) {
      detectedIntents.push('POLICY_MANAGEMENT');
      queries.set('POLICY_MANAGEMENT', message);
    }

    // USER_PROFILE patterns
    const profileKeywords = [
      'profile', 'user info', 'who is', 'kullanıcı bilgisi', 'profil',
    ];
    // 🔥 CRITICAL: Don't classify as USER_PROFILE if asking about violations/history
    // Let BecasFlow's moderation_history tool handle those queries instead
    const isViolationQuery = /violation|history|warning|ban|kick|timeout|moderation/i.test(message);
    if (profileKeywords.some(k => lower.includes(k)) && !isViolationQuery) {
      detectedIntents.push('USER_PROFILE');
      queries.set('USER_PROFILE', message);
    }

    // SERVER_INFO patterns
    const serverKeywords = [
      'server', 'guild', 'sunucu', 'server info', 'guild info',
    ];
    if (serverKeywords.some(k => lower.includes(k))) {
      detectedIntents.push('SERVER_INFO');
      queries.set('SERVER_INFO', message);
    }

    // If we detected multiple intents, create execution plan
    if (detectedIntents.length > 1) {
      const executionPlan = this.createExecutionPlan(detectedIntents, queries);
      return {
        intents: detectedIntents,
        confidence: 0.85,
        reasoning: `Multiple intents detected: ${detectedIntents.join(', ')}`,
        extractedQueries: queries,
        executionPlan,
      };
    }

    // If we detected single intent
    if (detectedIntents.length === 1) {
      const intent = detectedIntents[0];
      return {
        intents: [intent],
        confidence: 0.9,
        reasoning: `Single intent detected: ${intent}`,
        extractedQueries: queries,
        executionPlan: [
          {
            intent,
            agent: this.getAgentForIntent(intent),
            query: queries.get(intent) || message,
            dependencies: [],
          },
        ],
      };
    }

    // Weak moderation signal (might be query or chat)
    if (hasModerationKeyword || hasCategoryKeyword) {
      // Let AI decide
      return null;
    }

    // CHAT patterns (obvious non-moderation)
    const chatPatterns = [
      'hello', 'hi', 'hey', 'how are you', 'what\'s up',
      'thanks', 'thank you', 'good job', 'nice',
      'merhaba', 'nasılsın', 'teşekkür',
    ];
    if (chatPatterns.some(p => lower.includes(p)) && !hasModerationKeyword) {
      return {
        intents: ['CHAT'],
        confidence: 0.9,
        reasoning: 'Conversational keywords detected',
        extractedQueries: new Map([['CHAT', message]]),
        executionPlan: [
          {
            intent: 'CHAT',
            agent: 'ChatEngine',
            query: message,
            dependencies: [],
          },
        ],
      };
    }

    // Uncertain, let AI decide
    return null;
  }

  /**
   * AI-based classification for complex cases (supports multi-intent)
   * Uses IntentRegistry for description-based matching
   */
  private async aiClassify(message: string): Promise<IntentResult> {
    // Get all root intents from registry
    const rootIntents = getRootIntents();
    const intentDescriptions = formatIntentsForAI(rootIntents);

    const prompt = `You are an intent classifier for a Discord moderation bot.

Classify this moderator message. Messages can have MULTIPLE intents!

⚠️ CRITICAL RULE: QUESTION vs COMMAND DETECTION ⚠️

QUESTIONS (READ-ONLY) - Use CHAT intent, NOT MODERATION_QUERY:
If message asks a QUESTION, it's requesting information, NOT executing actions:
- Starts with: "what", "whats", "what's", "show", "check", "who", "which", "when", "where", "tell me", "give me", "list", "how many"
- These are READ-ONLY requests - classify as CHAT, NEVER as MODERATION_QUERY

COMMANDS (ACTIONS) - Use MODERATION_QUERY:
Only if message explicitly COMMANDS an action:
- "ban @user", "timeout spammers for 1h", "kick @user", "delete toxic messages"
- These execute moderation actions

EXAMPLES OF QUESTIONS (→ CHAT, NOT MODERATION_QUERY):
- "whats last violation about @user" → CHAT (asking for info)
- "show me toxic messages" → CHAT (requesting display)
- "check who posted spam" → CHAT (asking question)
- "tell me violations from @user" → CHAT (requesting data)

EXAMPLES OF COMMANDS (→ MODERATION_QUERY):
- "timeout @user for 1h" → MODERATION_QUERY (executing action)
- "ban spammers" → MODERATION_QUERY (executing action)
- "delete toxic messages" → MODERATION_QUERY (executing action)

Available intents:
${intentDescriptions}

Message to classify: "${message}"

Respond in JSON format:
{
  "intents": ["INTENT1", "INTENT2", ...],
  "confidence": 0.0 to 1.0,
  "reasoning": "why you chose these intents",
  "queries": {
    "INTENT1": "extracted query for intent 1",
    "INTENT2": "extracted query for intent 2"
  }
}

Example 1: "ban toxic users and show me analytics"
{
  "intents": ["MODERATION_QUERY", "ANALYTICS"],
  "confidence": 0.95,
  "reasoning": "Two intents: moderation action + analytics request",
  "queries": {
    "MODERATION_QUERY": "ban toxic users",
    "ANALYTICS": "show me analytics"
  }
}

Example 2: "hello how are you"
{
  "intents": ["CHAT"],
  "confidence": 0.98,
  "reasoning": "Simple greeting",
  "queries": {
    "CHAT": "hello how are you"
  }
}

Example 3: "can you create a channel named announcements"
{
  "intents": ["ADMIN_ACTION"],
  "confidence": 0.95,
  "reasoning": "User wants to create a channel - this is server administration",
  "queries": {
    "ADMIN_ACTION": "create a channel named announcements"
  }
}

Example 4: "whats last violation about @user"
{
  "intents": ["CHAT"],
  "confidence": 0.9,
  "reasoning": "Question asking for information (starts with 'whats'), not a command - classify as CHAT",
  "queries": {
    "CHAT": "whats last violation about @user"
  }
}`;

    try {
      const response = await this.llm.generate(prompt);
      const cleaned = this.extractJSON(response);
      const parsed = JSON.parse(cleaned);

      const intents = Array.isArray(parsed.intents) ? parsed.intents : ['UNKNOWN'];
      const queriesObj = parsed.queries || {};
      const queriesMap = new Map<Intent, string>();

      for (const intent of intents) {
        queriesMap.set(intent as Intent, queriesObj[intent] || message);
      }

      const executionPlan = this.createExecutionPlan(intents, queriesMap);

      return {
        intents,
        confidence: parsed.confidence || 0.5,
        reasoning: parsed.reasoning || 'AI classification',
        extractedQueries: queriesMap,
        executionPlan,
      };
    } catch (error) {
      logger.error('AI classification failed:', error);
      return {
        intents: ['UNKNOWN'],
        confidence: 0.0,
        reasoning: 'Classification error',
        extractedQueries: new Map([['UNKNOWN', message]]),
        executionPlan: [],
      };
    }
  }

  /**
   * Extract JSON from AI response (handles markdown code blocks)
   */
  private extractJSON(text: string): string {
    // Remove markdown code blocks
    let cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '');

    // Find JSON object
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      return match[0];
    }

    return cleaned.trim();
  }

  /**
   * Create execution plan for multiple intents
   * Determines order and dependencies
   */
  private createExecutionPlan(intents: Intent[], queries: Map<Intent, string>): ExecutionStep[] {
    const steps: ExecutionStep[] = [];

    // Execution order priority:
    // 1. MODERATION_QUERY (highest priority - must execute first)
    // 2. ANALYTICS (depends on moderation if both present)
    // 3. TRUST_SCORE (can run independently)
    // 4. USER_PROFILE (can run independently)
    // 5. POLICY_MANAGEMENT (can run independently)
    // 6. SERVER_INFO (lowest priority)

    const priorityOrder: Intent[] = [
      'MODERATION_QUERY',
      'ANALYTICS',
      'TRUST_SCORE',
      'USER_PROFILE',
      'POLICY_MANAGEMENT',
      'SERVER_INFO',
    ];

    // Sort intents by priority
    const sortedIntents = intents.sort((a, b) => {
      const aIndex = priorityOrder.indexOf(a);
      const bIndex = priorityOrder.indexOf(b);
      return aIndex - bIndex;
    });

    // Build execution steps
    for (let i = 0; i < sortedIntents.length; i++) {
      const intent = sortedIntents[i];
      const dependencies: number[] = [];

      // ANALYTICS depends on MODERATION_QUERY if both are present
      if (intent === 'ANALYTICS') {
        const moderationIndex = sortedIntents.indexOf('MODERATION_QUERY');
        if (moderationIndex !== -1 && moderationIndex < i) {
          dependencies.push(moderationIndex);
        }
      }

      steps.push({
        intent,
        agent: this.getAgentForIntent(intent),
        query: queries.get(intent) || '',
        dependencies,
      });
    }

    return steps;
  }

  /**
   * Map intent to agent
   */
  private getAgentForIntent(intent: Intent): string {
    switch (intent) {
      case 'MODERATION_QUERY':
        return 'IntelligentQueryEngine';
      case 'ANALYTICS':
        return 'ServerAnalytics';
      case 'TRUST_SCORE':
        return 'TrustScoreEngine';
      case 'POLICY_MANAGEMENT':
        return 'GuildPolicyEngine';
      case 'USER_PROFILE':
        return 'V3Integration';
      case 'SERVER_INFO':
        return 'ServerAnalytics';
      case 'UNDO':
      case 'MODIFY':
        return 'V3Integration';
      case 'ADMIN_ACTION':
        return 'AdminActionEngine';
      case 'CHAT':
        return 'ChatEngine';
      default:
        return 'Unknown';
    }
  }
}
