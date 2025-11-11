import { Guild, Message, TextChannel } from 'discord.js';
import { OllamaService } from '../services/OllamaService';
import { createLogger } from '../services/Logger';
import { UnifiedMemoryStore } from '../persistence/UnifiedMemoryStore';
import { TrustScoreEngineDB } from '../systems/TrustScoreEngineDB';
import { V3Integration } from '../integration/V3Integration';
import { v4 as uuidv4 } from 'uuid';

const logger = createLogger('IntelligentQueryEngine');

/**
 * INTELLIGENT QUERY ENGINE - AKILLI SORGULAMA SİSTEMİ
 *
 * This is NOT a simple "get info" system. This is a THINKING AI that:
 * - Understands complex conditional queries
 * - Can filter, categorize, and analyze with multiple criteria
 * - Provides intelligent insights, not just data dumps
 *
 * Examples of what this AI can do:
 * - "son 50 mesajdan hangisi FUD içeriyor, hangisi küfür içeriyor"
 * - "en toksik 3 mesajı bul ve kim yazdığını söyle"
 * - "son 100 mesajda kaç kişi şikayet etti ve neden"
 * - "hangi kullanıcılar spam atıyor ve kaç mesaj attılar"
 */

export interface QueryCondition {
  type: 'contains' | 'toxicity' | 'sentiment' | 'length' | 'user' | 'time' | 'custom' | 'category';
  operator: '>' | '<' | '=' | 'contains' | 'not_contains' | 'includes';
  value: any;
  weight?: number;  // For scoring/ranking
}

export interface QueryRequest {
  source: 'messages' | 'users' | 'channels';
  limit: number;
  conditions: QueryCondition[];
  groupBy?: string;  // Group results by field
  sortBy?: string;   // Sort by field
  sortOrder?: 'asc' | 'desc';
  returnFormat: 'summary' | 'detailed' | 'json';
  action?: {  // NEW: Action to take on results
    type: 'timeout' | 'ban' | 'kick' | 'delete' | 'warn' | 'none';
    duration?: string;  // For timeout (e.g., "1h", "30m")
    reason?: string;
    targetUser?: string;  // For direct user actions (e.g., "timeout <@799311717502287923>")
  };
  excludeRoles?: string[];  // NEW: Exclude users with these roles (e.g., "moderator")
}

export interface AnalyzedMessageData {
  message: Message;
  toxicity: number;
  sentiment: string;
  categories: string[];  // ['FUD', 'profanity', 'accusation', etc.]
  score: number;  // Combined score based on query conditions
}

export class IntelligentQueryEngine {
  private llm: OllamaService;          // Main LLM for reasoning AND JSON parsing (qwen3:8b)
  private memory?: UnifiedMemoryStore;
  private trustEngine?: TrustScoreEngineDB;
  private v3Integration?: V3Integration;

  constructor(
    memory?: UnifiedMemoryStore,
    trustEngine?: TrustScoreEngineDB,
    v3Integration?: V3Integration
  ) {
    this.llm = new OllamaService('analysis');  // qwen3:8b for everything
    this.memory = memory;
    this.trustEngine = trustEngine;
    this.v3Integration = v3Integration;
    logger.info('🧠 IntelligentQueryEngine initialized - AKILLI SORGULAMA HAZIR');
    logger.info('   💡 Using qwen3:8b for both reasoning AND JSON parsing');
    logger.info(`   🔗 Integrations: Memory=${!!memory}, TrustScore=${!!trustEngine}, V3=${!!v3Integration}`);
  }

  /**
   * MAIN ENTRY: Natural language to intelligent query
   *
   * User says: "son 50 mesajdan hangisi FUD içeriyor ve en toksik 3'ünü bul"
   * AI converts to: QueryRequest with conditions and sorting
   */
  async processNaturalLanguageQuery(
    guild: Guild,
    query: string,
    channel?: TextChannel,
    commandMessageId?: string
  ): Promise<string> {
    logger.info(`🎯 Processing intelligent query: "${query}"`);

    try {
      // Step 0: Pre-extract user mentions BEFORE AI parsing (more reliable)
      const userMentionMatch = query.match(/<@!?(\d+)>/);
      const extractedUserId = userMentionMatch ? userMentionMatch[1] : null;

      if (extractedUserId) {
        logger.info(`🎯 PRE-EXTRACTED USER MENTION: ${extractedUserId}`);
      }

      // Step 1: Convert natural language to structured query
      const structuredQuery = await this.parseQueryToStructure(query);

      // Step 1.5: Inject pre-extracted user ID if AI failed to extract it
      if (extractedUserId && structuredQuery.action && !structuredQuery.action.targetUser) {
        logger.warn(`⚠️ AI FAILED TO EXTRACT USER ID - Injecting pre-extracted ID: ${extractedUserId}`);
        structuredQuery.action.targetUser = extractedUserId;
        // Clear message-based conditions since this is a direct user action
        structuredQuery.conditions = [];
        structuredQuery.limit = 0;
      }

      logger.info(`✓ Parsed query structure:`, JSON.stringify(structuredQuery, null, 2));

      // DIRECT USER ACTION SHORTCUT: If action.targetUser exists, skip message fetching
      if (structuredQuery.action?.targetUser) {
        logger.info(`🎯 DIRECT USER ACTION DETECTED: ${structuredQuery.action.type} on user ${structuredQuery.action.targetUser}`);

        try {
          const member = await guild.members.fetch(structuredQuery.action.targetUser);

          if (!member) {
            return `❌ User <@${structuredQuery.action.targetUser}> not found in this server.`;
          }

          // Execute action directly on the user
          let actionResult = '';
          const duration = structuredQuery.action.duration || '1h';
          const reason = structuredQuery.action.reason || 'Automated moderation';
          let actionSuccess = false;
          let actionType = '';

          switch (structuredQuery.action.type) {
            case 'timeout':
              const durationMs = this.parseDuration(duration);
              await member.timeout(durationMs, reason);
              actionSuccess = true;
              actionType = 'timeout';
              break;

            case 'ban':
              await member.ban({ reason });
              actionSuccess = true;
              actionType = 'ban';
              break;

            case 'kick':
              await member.kick(reason);
              actionSuccess = true;
              actionType = 'kick';
              break;

            default:
              actionResult = `❌ Action type "${structuredQuery.action.type}" not supported for direct user actions.`;
          }

          // Generate AI-powered friendly commentary for successful actions
          if (actionSuccess) {
            try {
              const aiCommentaryPrompt = `You are a Discord server assistant. You successfully completed a moderation action on a user and need to inform the requestor in a natural, friendly way.

Action performed: ${actionType}
User affected: ${member.user.tag}
Duration: ${duration}
Reason: ${reason}

CRITICAL: NO THINKING OUT LOUD! Give me the DIRECT RESPONSE ONLY! Start with "Done!" or similar confirmation.

Tell the user in 3-4 sentences with ALL these details:
1. Start with confirmation: "Done!" or "All set!"
2. Clearly state what action was taken on which user (use their full username)
3. If timeout/ban: mention the specific duration
4. State the reason for the action
5. End with asking if they need anything else

Example responses:
- "Done! I've successfully timed out ${member.user.tag} for ${duration} because of ${reason}. The timeout is now active and they won't be able to send messages during this period. Let me know if you need anything else!"
- "All set! ${member.user.tag} has been timed out for ${duration}. Reason: ${reason}. Is there anything else you'd like me to help with?"

Respond in English with a friendly, professional tone. You can use emojis sparingly (1-2 max).`;

              actionResult = await this.llm.generate(
                aiCommentaryPrompt,
                'You are a helpful Discord assistant. Speak naturally and friendly in English.',
                { temperature: 0.7, maxTokens: 180 }
              );
              actionResult = actionResult.trim();
            } catch (error) {
              logger.error('Failed to generate AI commentary for direct action:', error);
              // Fallback to technical message
              switch (actionType) {
                case 'timeout':
                  actionResult = `✅ ${member.user.tag} has been timed out for ${duration}.`;
                  break;
                case 'ban':
                  actionResult = `✅ ${member.user.tag} has been banned.`;
                  break;
                case 'kick':
                  actionResult = `✅ ${member.user.tag} has been kicked.`;
                  break;
              }
            }
          }

          // 🔥 TRUST SCORE UPDATE: DISABLED - Trust scores should ONLY be modified when AI autonomously detects violations
          // Manual moderation actions should NOT affect trust scores
          // if (this.trustEngine && structuredQuery.action.type !== 'none') {
          //   const penaltyMap = {
          //     'warn': -5,
          //     'timeout': -10,
          //     'kick': -15,
          //     'ban': -25,
          //     'delete': -3
          //   };
          //   const penalty = penaltyMap[structuredQuery.action.type as keyof typeof penaltyMap] || -10;
          //
          //   await this.trustEngine.modifyTrust(
          //     member.id,
          //     guild.id,
          //     penalty,
          //     `Direct action: ${structuredQuery.action.type}`,
          //     reason
          //   );
          //   logger.info(`📉 Trust score updated: ${member.user.tag} penalty ${penalty}`);
          // }

          // 🔥 V3 INTEGRATION: Record action to unified memory
          if (this.v3Integration) {
            await this.v3Integration.recordAction({
              type: structuredQuery.action.type as any,
              targetUserId: member.id,
              targetUsername: member.user.tag,
              executedBy: 'system',
              executedByName: 'Becas AI',
              reason,
              duration: structuredQuery.action.type === 'timeout' ? this.parseDuration(duration) : undefined,
              guildId: guild.id,
              channelId: channel?.id || '',
              messageId: commandMessageId
            });
            logger.info(`💾 Action recorded to V3 integration`);
          }

          logger.info(`✅ Direct user action executed: ${actionResult}`);
          return actionResult;

        } catch (error) {
          logger.error('Direct user action failed:', error);
          return `❌ Failed to execute action on user: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
      }

      // Step 2: Fetch messages ITERATIVELY (smart filtering on-the-fly)
      // Fetch messages in chunks, filter & exclude as we go, stop when we have enough
      const finalMessages: AnalyzedMessageData[] = [];
      let fetchedCount = 0;
      const MAX_FETCH = 200;  // Safety limit to prevent infinite loop
      const CHUNK_SIZE = 20;  // Fetch 20 at a time
      let lastMessageId: string | undefined = undefined;  // Track pagination
      let userMessagesSeen = 0;  // Count NON-MODERATOR messages seen (for "last 10 messages" limit)

      logger.info(`🔄 Starting iterative fetch: need ${structuredQuery.limit} USER messages, excluding roles: ${structuredQuery.excludeRoles?.join(', ') || 'none'}`);

      while (userMessagesSeen < structuredQuery.limit && fetchedCount < MAX_FETCH) {
        // Fetch next chunk (before lastMessageId to go back in time)
        const fetchOptions: any = { limit: CHUNK_SIZE };
        if (lastMessageId) {
          fetchOptions.before = lastMessageId;
        }

        const chunkMessagesCollection = await channel.messages.fetch(fetchOptions);
        const messagesArray: Message[] = Array.from((chunkMessagesCollection as any).values());

        if (messagesArray.length === 0) {
          logger.info(`✓ No more messages to fetch (reached end of history)`);
          break;  // No more messages
        }

        // Update lastMessageId to the oldest message in this chunk (for pagination)
        lastMessageId = messagesArray[messagesArray.length - 1]?.id;

        fetchedCount += messagesArray.length;
        logger.info(`  Fetched chunk: ${messagesArray.length} messages (total fetched: ${fetchedCount}, oldest ID: ${lastMessageId})`);

        // Analyze this chunk
        const analyzedChunk = await this.analyzeMessages(messagesArray, structuredQuery);

        // Filter & exclude iteratively
        for (const analyzed of analyzedChunk) {
          // FIRST: Check if this is a moderator (to track userMessagesSeen correctly)
          let isModerator = false;
          if (structuredQuery.excludeRoles && structuredQuery.excludeRoles.length > 0) {
            const member = guild.members.cache.get(analyzed.message.author.id);
            if (member) {
              // Check if "moderator" is in excludeRoles - use PERMISSIONS instead of role name
              if (structuredQuery.excludeRoles.some(r => r.toLowerCase().includes('moderator') || r.toLowerCase().includes('mod'))) {
                const hasModPerms = member.permissions.has('KickMembers') ||
                                   member.permissions.has('BanMembers') ||
                                   member.permissions.has('ManageMessages') ||
                                   member.permissions.has('ModerateMembers');
                if (hasModPerms) isModerator = true;
              }

              // Check for admin permissions
              if (structuredQuery.excludeRoles.some(r => r.toLowerCase().includes('admin'))) {
                if (member.permissions.has('Administrator')) isModerator = true;
              }

              // Check by role name
              if (!isModerator) {
                const hasExcludedRole = structuredQuery.excludeRoles.some(roleName =>
                  member.roles.cache.some(role =>
                    role.name.toLowerCase().includes(roleName.toLowerCase())
                  )
                );
                if (hasExcludedRole) isModerator = true;
              }
            }
          }

          // If NOT moderator, increment userMessagesSeen (we've seen one more USER message)
          if (!isModerator) {
            userMessagesSeen++;
            logger.info(`  👤 USER message #${userMessagesSeen}: ${analyzed.message.author.username}`);
          } else {
            logger.info(`  ⏭️ MODERATOR message (not counting): ${analyzed.message.author.username}`);
            continue;  // Skip moderators entirely
          }

          // Stop if we've seen enough USER messages (regardless of conditions)
          if (userMessagesSeen > structuredQuery.limit) {
            logger.info(`  🛑 Reached ${structuredQuery.limit} USER messages, stopping`);
            break;
          }

          // NOW check conditions (e.g., contains "spam")
          const matchesConditions = structuredQuery.conditions.every(condition => {
            switch (condition.type) {
              case 'contains':
                if (condition.operator === 'contains') {
                  return analyzed.message.content.toLowerCase().includes(condition.value.toLowerCase());
                }
                return true;
              case 'toxicity':
                if (condition.operator === '>') return analyzed.toxicity > condition.value;
                if (condition.operator === '<') return analyzed.toxicity < condition.value;
                return true;
              case 'category':
                if (condition.operator === 'includes') {
                  const categoryMatch = analyzed.categories.some(cat =>
                    cat.toLowerCase() === condition.value.toLowerCase()
                  );
                  logger.info(`  🏷️ Category check: "${condition.value}" in [${analyzed.categories.join(', ')}] = ${categoryMatch}`);
                  return categoryMatch;
                }
                return true;
              default:
                return true;
            }
          });

          if (!matchesConditions) {
            logger.info(`  ⏭️ Message doesn't match conditions: ${analyzed.message.author.username}`);
            continue;  // SKIP - doesn't match conditions
          }

          // This message PASSED all filters!
          finalMessages.push(analyzed);
          logger.info(`  ✅ COUNTED (${finalMessages.length}): ${analyzed.message.author.username} - "${analyzed.message.content.substring(0, 50)}"`);

          if (finalMessages.length >= structuredQuery.limit) {
            logger.info(`✓ Reached target: ${structuredQuery.limit} messages`);
            break;  // Got enough messages!
          }
        }

        if (finalMessages.length >= structuredQuery.limit) break;
      }

      logger.info(`✅ FINAL RESULT: ${finalMessages.length} messages (fetched ${fetchedCount} total, skipped moderators on-the-fly)`);

      if (finalMessages.length === 0) {
        return 'No messages matched your specific conditions (after excluding moderators).';
      }

      // Step 7: Execute action if requested
      let actionResults = '';
      if (structuredQuery.action && structuredQuery.action.type !== 'none') {
        actionResults = await this.executeAction(guild, finalMessages, structuredQuery.action, commandMessageId);
        logger.info(`✓ Action executed: ${structuredQuery.action.type}`);
      }

      // Step 8: Format response
      const response = await this.formatResponse(finalMessages, structuredQuery, query, actionResults);
      logger.info(`✓ Response generated`);

      return response;

    } catch (error) {
      logger.error('Intelligent query processing failed:', error);
      return `Error processing your query: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  /**
   * Convert natural language to structured query using AI
   */
  private async parseQueryToStructure(query: string): Promise<QueryRequest> {
    const prompt = `Parse this moderation query into JSON. NO explanations, JUST JSON.

Query: "${query}"

OUTPUT FORMAT:
{
  "source": "messages",
  "limit": 10,
  "conditions": [{"type": "contains", "operator": "contains", "value": "spam"}],
  "sortBy": "time",
  "sortOrder": "desc",
  "returnFormat": "summary",
  "action": {"type": "timeout", "duration": "1h", "reason": "spam"},
  "excludeRoles": ["moderator", "admin"]
}

⚠️ CRITICAL: QUESTION vs COMMAND DETECTION ⚠️

QUESTIONS (READ-ONLY) - action.type = "none":
If query starts with question words, it's a READ-ONLY request:
- "what" / "what's" / "whats" → asking for information
- "show" / "show me" → requesting display
- "check" / "check if" → requesting verification
- "who" / "which" / "when" / "where" → asking questions
- "tell me" / "give me" / "list" → requesting data
- "how many" / "count" → requesting statistics

COMMANDS (ACTIONS) - action.type = "timeout|ban|kick|etc":
Only if query explicitly commands an action:
- "ban" / "timeout" / "kick" / "warn" / "delete" → moderation command
- "remove" / "mute" / "unmute" → moderation command

EXAMPLE QUESTIONS (action.type = "none"):
"whats last violation about @user" → action: {type: "none"}
"show me toxic messages" → action: {type: "none"}
"check who posted spam" → action: {type: "none"}
"tell me violations from @user" → action: {type: "none"}

EXAMPLE COMMANDS (action.type != "none"):
"timeout @user for 1h" → action: {type: "timeout", duration: "1h", targetUser: "..."}
"ban spammers" → action: {type: "ban"}
"delete toxic messages" → action: {type: "delete"}

FIELD RULES:
- source: always "messages"
- limit: extract number (default 50)
- conditions: MUST include "operator" field!
  * type: "contains" | "toxicity" | "sentiment" | "custom" | "category"
  * operator: "contains" | ">" | "<" | "=" | "includes"
  * value: keyword or number or category name
  * CATEGORY TYPE: Use when query mentions content categories like FUD, profanity, toxicity, spam detection
- action: extract from "timeout/ban/kick/delete" + duration + reason
  * If QUESTION (what/show/check/who/tell/etc) → action.type = "none"
  * If NO action word → action.type = "none"
  * duration examples: "1h", "30m", "1d"
- excludeRoles: extract from "except moderators/admins"
  * Common: ["moderator", "admin", "mod"]

EXAMPLES:
"timeout everyone who said 'spam' except mods for 1 hour"
→ action: {type: "timeout", duration: "1h"}, excludeRoles: ["moderator"], conditions: [{type:"contains", operator:"contains", value:"spam"}]

"find toxic messages in last 50"
→ action: {type: "none"}, conditions: [{type:"toxicity", operator:">", value:0.7}]

"ban everyone who posted FUD in last 20 messages"
→ action: {type: "ban"}, conditions: [{type:"category", operator:"includes", value:"FUD"}], limit: 20

"timeout users with profanity for 1 hour"
→ action: {type: "timeout", duration: "1h"}, conditions: [{type:"category", operator:"includes", value:"profanity"}]

"timeout <@799311717502287923> for 5 minutes"
→ action: {type: "timeout", duration: "5m", targetUser: "799311717502287923"}, conditions: [], limit: 0

"ban <@123456789> for spam"
→ action: {type: "ban", targetUser: "123456789", reason: "spam"}, conditions: [], limit: 0

DIRECT USER ACTION RULE:
If query mentions a specific user (e.g., <@ID> or @username), extract:
- action.targetUser = "USER_ID" (numbers only, no <@> or ! symbols)
- conditions = [] (no message filtering needed)
- limit = 0 (not fetching messages)

USER MENTION EXTRACTION EXAMPLES:
"timeout <@799311717502287923> for 5 minutes" → targetUser: "799311717502287923"
"ban <@!123456789>" → targetUser: "123456789"
"kick @deephell" → targetUser: "@deephell"
"timeout everyone" → NO targetUser (bulk action)

CRITICAL: Use REGEX pattern /<@!?(\d+)>/ to extract user ID from Discord mentions.

START WITH { END WITH } - NOTHING ELSE.`;

    try {
      // Use schema-based JSON generation for guaranteed valid JSON
      const schema = {
        type: 'object',
        properties: {
          source: { type: 'string', enum: ['messages', 'users', 'channels'] },
          limit: { type: 'number' },
          conditions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string' },
                operator: { type: 'string' },  // REQUIRED!
                value: {}
              },
              required: ['type', 'operator', 'value']
            }
          },
          sortBy: { type: 'string' },
          sortOrder: { type: 'string', enum: ['asc', 'desc'] },
          returnFormat: { type: 'string', enum: ['summary', 'detailed', 'json'] },
          action: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['timeout', 'ban', 'kick', 'delete', 'warn', 'none'] },
              duration: { type: 'string' },
              reason: { type: 'string' },
              targetUser: { type: 'string' }  // For direct user actions (e.g., "timeout <@ID>")
            }
          },
          excludeRoles: {
            type: 'array',
            items: { type: 'string' }
          }
        }
      };

      // Use generateJSON for proper two-step extraction (qwen3:8b reasoning + llama3.1 JSON extraction)
      // generateJSON already returns a parsed object, no need to parse again!
      const parsed = await this.llm.generateJSON<any>(
        prompt,
        'You are a JSON-only query parser. CRITICAL: Output ONLY valid JSON. NO explanations, NO markdown, NO text - JUST the raw JSON object starting with { and ending with }. If you add ANY text before or after the JSON, the system will FAIL.',
        JSON.stringify(schema)  // Convert schema object to string
      );

      // Log FULL parsed JSON for debugging
      logger.info(`✅ FULL PARSED JSON:`, JSON.stringify(parsed, null, 2));

      // Validate and set defaults
      const result: QueryRequest = {
        source: parsed.source || 'messages',
        limit: parsed.limit || 50,
        conditions: parsed.conditions || [],
        groupBy: parsed.groupBy,
        sortBy: parsed.sortBy || 'time',
        sortOrder: parsed.sortOrder || 'desc',
        returnFormat: parsed.returnFormat || 'summary',
        action: parsed.action || { type: 'none' },  // DEFAULT ACTION
        excludeRoles: parsed.excludeRoles || []
      };

      // ⚠️ CRITICAL ACTION LOGGING - helps debug why actions aren't executing
      if (!parsed.action || !parsed.action.type || parsed.action.type === 'none') {
        logger.warn(`⚠️ NO ACTION PARSED from query: "${query}"`);
        logger.warn(`   AI returned action: ${JSON.stringify(parsed.action)}`);
        logger.warn(`   This query will ONLY ANALYZE, not execute any moderation actions!`);
      } else {
        logger.info(`✅ ACTION DETECTED: ${parsed.action.type}`);
        logger.info(`   Duration: ${parsed.action.duration || 'N/A'}`);
        logger.info(`   Reason: ${parsed.action.reason || 'Automated moderation'}`);
        logger.info(`   🔨 This query WILL execute moderation actions!`);
      }

      return result;

    } catch (error) {
      logger.error('Query parsing failed, using defaults:', error);
      // Fallback: return default query
      return {
        source: 'messages',
        limit: 50,
        conditions: [],
        sortBy: 'time',
        sortOrder: 'desc',
        returnFormat: 'summary',
      };
    }
  }

  /**
   * Fetch messages from guild
   */
  private async fetchMessages(
    guild: Guild,
    query: QueryRequest,
    channel?: TextChannel
  ): Promise<Message[]> {
    const messages: Message[] = [];
    const limit = Math.min(query.limit, 200);  // Safety limit

    if (channel) {
      // Fetch from specific channel
      const fetched = await channel.messages.fetch({ limit });
      messages.push(...Array.from(fetched.values()));
    } else {
      // Fetch from all text channels
      const channels = guild.channels.cache.filter(ch => ch.isTextBased());
      for (const [_, ch] of channels) {
        try {
          const fetched = await (ch as any).messages.fetch({ limit: 30 });
          messages.push(...Array.from(fetched.values() as Iterable<Message>));
          if (messages.length >= limit) break;
        } catch (err) {
          // Skip inaccessible channels
        }
      }
    }

    return messages.slice(0, limit);
  }

  /**
   * Analyze messages with AI - AKILLI ANALİZ
   */
  private async analyzeMessages(
    messages: Message[],
    query: QueryRequest
  ): Promise<AnalyzedMessageData[]> {
    logger.info(`🔍 Analyzing ${messages.length} messages with AI...`);

    const analyzed: AnalyzedMessageData[] = [];

    // 🚨 CRITICAL: Filter out bot messages and moderators BEFORE analyzing
    const filteredMessages = messages.filter(msg => {
      // Skip bot's own messages
      if (msg.author.bot) {
        logger.debug(`   ⏭️ Skipping bot message from: ${msg.author.tag}`);
        return false;
      }

      // Skip moderators/admins (they should never be actioned)
      const member = msg.member;
      if (member) {
        const isModerator = member.permissions.has('Administrator') ||
                           member.permissions.has('ModerateMembers') ||
                           member.permissions.has('ManageMessages');
        if (isModerator) {
          logger.debug(`   ⏭️ Skipping moderator message from: ${msg.author.tag}`);
          return false;
        }
      }

      return true;
    });

    logger.info(`   📊 Filtered: ${messages.length} → ${filteredMessages.length} messages (excluded ${messages.length - filteredMessages.length} bot/mod messages)`);

    // Batch analyze for performance (10 at a time)
    const batchSize = 10;
    for (let i = 0; i < filteredMessages.length; i += batchSize) {
      const batch = filteredMessages.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(msg => this.analyzeSingleMessage(msg))
      );
      analyzed.push(...batchResults);
    }

    return analyzed;
  }

  /**
   * Analyze single message with AI
   */
  private async analyzeSingleMessage(message: Message): Promise<AnalyzedMessageData> {
    const content = message.content;

    // Quick heuristic checks first (fast)
    const quickCategories: string[] = [];

    // Profanity detection (Turkish & English)
    if (/fuck|shit|damn|amk|sik|götür|orospu|piç/i.test(content)) {
      quickCategories.push('profanity');
    }

    // FUD detection
    if (/scam|rug|ponzi|fake|dolandır|sahtekarlık|hile/i.test(content)) {
      quickCategories.push('FUD');
    }

    // Accusation detection
    if (/suçlu|blame|fault|senin yüzünden|sen yaptın/i.test(content)) {
      quickCategories.push('accusation');
    }

    // Spam detection
    if (content.length > 500 || /(.)\1{10,}/.test(content)) {
      quickCategories.push('spam');
    }

    // AI-based analysis for complex cases
    let aiCategories: string[] = [];
    let toxicity = 0;
    let sentiment = 'neutral';

    if (content.length > 10) {
      try {
        const analysisPrompt = `Analyze this message:

"${content.substring(0, 500)}"

Determine:
1. TOXICITY (0.0-1.0): How toxic/harmful is this?
2. SENTIMENT (positive/negative/neutral)
3. CATEGORIES: Does it contain FUD, profanity, accusation, spam, threat, harassment?

Return ONLY JSON:
{"toxicity": 0.5, "sentiment": "negative", "categories": ["profanity", "FUD"]}`;

        const response = await this.llm.generate(
          analysisPrompt,
          'You are a content analyzer. Output ONLY valid JSON.',
          { temperature: 0.1, maxTokens: 150 }
        );

        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const analysis = JSON.parse(jsonMatch[0]);
          toxicity = analysis.toxicity || 0;
          sentiment = analysis.sentiment || 'neutral';
          aiCategories = analysis.categories || [];
        }
      } catch (error) {
        logger.debug('AI analysis failed for message, using heuristics');
      }
    }

    // Combine quick heuristics + AI analysis
    const allCategories = Array.from(new Set([...quickCategories, ...aiCategories]));

    // Calculate score (for sorting)
    let score = toxicity;
    if (allCategories.includes('FUD')) score += 0.2;
    if (allCategories.includes('profanity')) score += 0.3;
    if (allCategories.includes('accusation')) score += 0.15;
    if (allCategories.includes('threat')) score += 0.5;

    return {
      message,
      toxicity,
      sentiment,
      categories: allCategories,
      score,
    };
  }

  /**
   * Filter messages by conditions
   */
  private filterByConditions(
    messages: AnalyzedMessageData[],
    conditions: QueryCondition[]
  ): AnalyzedMessageData[] {
    return messages.filter(analyzed => {
      // Check all conditions
      return conditions.every(condition => {
        switch (condition.type) {
          case 'toxicity':
            if (condition.operator === '>') return analyzed.toxicity > condition.value;
            if (condition.operator === '<') return analyzed.toxicity < condition.value;
            if (condition.operator === '=') return Math.abs(analyzed.toxicity - condition.value) < 0.1;
            return true;

          case 'sentiment':
            return analyzed.sentiment === condition.value;

          case 'contains':
            if (condition.operator === 'contains') {
              return analyzed.message.content.toLowerCase().includes(condition.value.toLowerCase());
            }
            if (condition.operator === 'not_contains') {
              return !analyzed.message.content.toLowerCase().includes(condition.value.toLowerCase());
            }
            return true;

          case 'custom':
            // Category check (FUD, profanity, etc.)
            if (typeof condition.value === 'string') {
              return analyzed.categories.includes(condition.value);
            }
            return true;

          default:
            return true;
        }
      });
    });
  }

  /**
   * Sort and limit results
   */
  private sortAndLimit(
    messages: AnalyzedMessageData[],
    query: QueryRequest
  ): AnalyzedMessageData[] {
    const sorted = [...messages].sort((a, b) => {
      let aVal: any;
      let bVal: any;

      switch (query.sortBy) {
        case 'toxicity':
          aVal = a.toxicity;
          bVal = b.toxicity;
          break;
        case 'score':
          aVal = a.score;
          bVal = b.score;
          break;
        case 'time':
          aVal = a.message.createdTimestamp;
          bVal = b.message.createdTimestamp;
          break;
        case 'length':
          aVal = a.message.content.length;
          bVal = b.message.content.length;
          break;
        default:
          aVal = a.score;
          bVal = b.score;
      }

      if (query.sortOrder === 'desc') {
        return bVal - aVal;
      } else {
        return aVal - bVal;
      }
    });

    return sorted.slice(0, query.limit);
  }

  /**
   * Execute action on filtered users/messages
   */
  private async executeAction(
    guild: Guild,
    results: AnalyzedMessageData[],
    action: { type: string; duration?: string; reason?: string },
    commandMessageId?: string
  ): Promise<string> {
    logger.info(`🔨 Executing action: ${action.type} on ${results.length} messages`);

    const uniqueUsers = new Set<string>();
    results.forEach(r => uniqueUsers.add(r.message.author.id));

    const successCount = {
      timeout: 0,
      ban: 0,
      kick: 0,
      delete: 0,
      warn: 0,
      failed: 0
    };

    for (const userId of uniqueUsers) {
      try {
        let member = guild.members.cache.get(userId);

        // If not in cache, try fetching from API
        if (!member) {
          logger.info(`⚠️ User ${userId} not in cache, fetching from API...`);
          try {
            member = await guild.members.fetch(userId);
            logger.info(`✅ Fetched member from API: ${member.user.username}`);
          } catch (fetchError) {
            logger.warn(`⚠️ User ${userId} not found in guild (even after API fetch), skipping`);
            successCount.failed++;
            continue;
          }
        }

        logger.info(`🔨 Attempting ${action.type} on user: ${member.user.username} (${userId})`);

        const reason = action.reason || 'Automated moderation action';

        switch (action.type) {
          case 'timeout':
            const durationMs = this.parseDuration(action.duration || '1h');
            logger.info(`⏱️ Timeout duration: ${durationMs}ms (${action.duration})`);
            await member.timeout(durationMs, reason);
            successCount.timeout++;
            logger.info(`✅ Successfully timed out ${member.user.username}`);
            break;

          case 'ban':
            await member.ban({ reason });
            successCount.ban++;
            logger.info(`✅ Successfully banned ${member.user.username}`);
            break;

          case 'kick':
            await member.kick(reason);
            successCount.kick++;
            logger.info(`✅ Successfully kicked ${member.user.username}`);
            break;

          case 'warn':
            // TODO: Implement warning system
            successCount.warn++;
            logger.info(`✅ Successfully warned ${member.user.username}`);
            break;
        }

        // 🔥 TRUST SCORE UPDATE: Decrease trust for moderated user
        if (this.trustEngine) {
          const penaltyMap = {
            'warn': -5,
            'timeout': -10,
            'kick': -15,
            'ban': -25,
            'delete': -3
          };
          const penalty = penaltyMap[action.type as keyof typeof penaltyMap] || -10;

          await this.trustEngine.modifyTrust(
            userId,
            guild.id,
            penalty,
            `Message-based action: ${action.type} - ${reason}`
          );
          logger.info(`📉 Trust score updated: ${member.user.username} penalty ${penalty}`);
        }

        // 🔥 V3 INTEGRATION: Record action to unified memory
        if (this.v3Integration) {
          await this.v3Integration.recordAction({
            type: action.type as any,
            targetUserId: userId,
            targetUsername: member.user.username,
            executedBy: 'system',
            executedByName: 'Becas AI',
            reason,
            duration: action.type === 'timeout' ? this.parseDuration(action.duration || '1h') : undefined,
            guildId: guild.id,
            channelId: '', // Not available in this context
            messageId: commandMessageId
          });
          logger.info(`💾 Action recorded to V3 integration for ${member.user.username}`);
        }

      } catch (error: any) {
        logger.error(`❌ Failed to ${action.type} user ${userId}:`);
        logger.error(`   Error code: ${error?.code}`);
        logger.error(`   Error message: ${error?.message}`);
        logger.error(`   Full error:`, error);
        successCount.failed++;
      }
    }

    // Also delete messages if requested
    if (action.type === 'delete') {
      for (const result of results) {
        try {
          await result.message.delete();
          successCount.delete++;
        } catch (error) {
          logger.error(`Failed to delete message:`, error);
          successCount.failed++;
        }
      }
    }

    // Generate AI-powered friendly commentary instead of dry summary
    const aiCommentaryPrompt = `You are a Discord server assistant. You successfully completed a moderation action and need to inform the user in a natural, friendly way.

Action performed: ${action.type}
Successfully actioned: ${successCount[action.type as keyof typeof successCount]} ${action.type === 'delete' ? 'messages' : 'users'}
Failed: ${successCount.failed}
Duration: ${action.duration || 'N/A'}
Reason: ${action.reason || 'Automated moderation'}

CRITICAL: NO THINKING OUT LOUD! Give me the DIRECT RESPONSE ONLY! Start with "Done!" or similar confirmation.

Tell the user in 3-4 sentences with ALL these details:
1. Start with confirmation: "Done!" or "All set!" or "Completed!"
2. Clearly state what action was taken (${action.type}) and exact number affected
3. Mention the duration if applicable (${action.duration || 'N/A'})
4. State the reason for the action
5. If there were failures, briefly mention how many failed
6. End with asking if they need anything else

Example responses:
- "Done! I've successfully ${action.type}ed ${successCount[action.type as keyof typeof successCount]} ${action.type === 'delete' ? 'messages' : 'users'} ${action.duration ? 'for ' + action.duration : ''}. Reason: ${action.reason || 'Automated moderation'}. ${successCount.failed > 0 ? successCount.failed + ' failed.' : ''} Let me know if you need anything else!"
- "All set! Completed the ${action.type} action on ${successCount[action.type as keyof typeof successCount]} ${action.type === 'delete' ? 'messages' : 'users'}. The reason was ${action.reason || 'Automated moderation'}. Is there anything else you'd like me to do?"

Respond in English with a friendly, professional tone. You can use emojis sparingly (1-2 max).`;

    let summary: string;
    try {
      summary = await this.llm.generate(
        aiCommentaryPrompt,
        'You are a helpful Discord assistant. Speak naturally and friendly in English.',
        { temperature: 0.7, maxTokens: 180 }
      );
      summary = summary.trim();
    } catch (error) {
      logger.error('Failed to generate AI commentary for moderation action:', error);
      // Fallback to technical summary if AI fails
      summary = `\n\n**⚡ Action Taken: ${action.type.toUpperCase()}**\n`;
      summary += `✅ Successfully actioned: ${successCount[action.type as keyof typeof successCount]} ${action.type === 'delete' ? 'messages' : 'users'}\n`;
      if (successCount.failed > 0) {
        summary += `❌ Failed: ${successCount.failed}\n`;
      }
      if (action.duration) {
        summary += `⏱️ Duration: ${action.duration}\n`;
      }
      summary += `📝 Reason: ${action.reason || 'Automated moderation'}\n`;
    }

    // Store action in unified memory for undo/modify capabilities
    if (this.memory) {
      try {
        const actionId = await this.memory.store({
          type: 'action',
          guildId: guild.id,
          data: {
            actionType: action.type,
            targets: Array.from(uniqueUsers),
            reason: action.reason || 'Automated moderation',
            duration: action.duration,
            successCount,
            timestamp: Date.now()
          },
          relations: {
            relatedTo: commandMessageId ? [commandMessageId] : [],
            causedBy: commandMessageId
          }
        });
        logger.info(`💾 Action stored in memory with ID: ${actionId}`);
      } catch (error) {
        logger.error('Failed to store action in memory:', error);
      }
    }

    return summary;
  }

  /**
   * Parse duration string to milliseconds
   */
  private parseDuration(duration: string): number {
    const match = duration.match(/^(\d+)([smhd])$/);
    if (!match) return 60 * 60 * 1000;  // Default 1 hour

    const value = parseInt(match[1]);
    const unit = match[2];

    switch (unit) {
      case 's': return value * 1000;
      case 'm': return value * 60 * 1000;
      case 'h': return value * 60 * 60 * 1000;
      case 'd': return value * 24 * 60 * 60 * 1000;
      default: return 60 * 60 * 1000;
    }
  }

  /**
   * Format response for user
   */
  private async formatResponse(
    results: AnalyzedMessageData[],
    query: QueryRequest,
    originalQuery: string,
    actionResults?: string
  ): Promise<string> {
    if (query.returnFormat === 'summary') {
      // Generate intelligent summary
      let response = `**🎯 Analiz Sonuçları: "${originalQuery}"**\n\n`;
      response += `📊 **${results.length} mesaj bulundu**\n\n`;

      // Group by category
      const categoryGroups = new Map<string, AnalyzedMessageData[]>();
      results.forEach(r => {
        r.categories.forEach(cat => {
          if (!categoryGroups.has(cat)) categoryGroups.set(cat, []);
          categoryGroups.get(cat)!.push(r);
        });
      });

      if (categoryGroups.size > 0) {
        response += `**📂 Kategoriler:**\n`;
        for (const [category, items] of categoryGroups.entries()) {
          response += `- **${category}**: ${items.length} mesaj\n`;
        }
        response += '\n';
      }

      // Top 3 most toxic
      response += `**🔥 En Toksik 3 Mesaj:**\n`;
      results.slice(0, 3).forEach((r, index) => {
        const preview = r.message.content.substring(0, 100);
        response += `${index + 1}. **${r.message.author.username}** (toxicity: ${(r.toxicity * 100).toFixed(0)}%)\n`;
        response += `   "${preview}${r.message.content.length > 100 ? '...' : ''}"\n`;
        response += `   Kategoriler: ${r.categories.join(', ') || 'none'}\n\n`;
      });

      // Add action results if any
      if (actionResults) {
        response += actionResults;
      }

      return response;

    } else {
      // Detailed format
      let response = `**📋 Detaylı Sonuçlar**\n\n`;
      results.forEach((r, index) => {
        response += `**${index + 1}. ${r.message.author.username}** (${r.message.createdAt.toLocaleString()})\n`;
        response += `Toxicity: ${(r.toxicity * 100).toFixed(0)}% | Sentiment: ${r.sentiment}\n`;
        response += `Categories: ${r.categories.join(', ') || 'none'}\n`;
        response += `Message: "${r.message.content.substring(0, 200)}"\n\n`;
      });
      return response;
    }
  }
}
