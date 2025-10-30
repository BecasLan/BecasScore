import { Guild, Message, TextChannel } from 'discord.js';
import { OllamaService } from '../services/OllamaService';
import { createLogger } from '../services/Logger';

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
  type: 'contains' | 'toxicity' | 'sentiment' | 'length' | 'user' | 'time' | 'custom';
  operator: '>' | '<' | '=' | 'contains' | 'not_contains';
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
}

export interface AnalyzedMessageData {
  message: Message;
  toxicity: number;
  sentiment: string;
  categories: string[];  // ['FUD', 'profanity', 'accusation', etc.]
  score: number;  // Combined score based on query conditions
}

export class IntelligentQueryEngine {
  private llm: OllamaService;

  constructor() {
    this.llm = new OllamaService('analysis');
    logger.info('🧠 IntelligentQueryEngine initialized - AKILLI SORGULAMA HAZIR');
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
    channel?: TextChannel
  ): Promise<string> {
    logger.info(`🎯 Processing intelligent query: "${query}"`);

    try {
      // Step 1: Convert natural language to structured query
      const structuredQuery = await this.parseQueryToStructure(query);
      logger.info(`✓ Parsed query structure:`, JSON.stringify(structuredQuery, null, 2));

      // Step 2: Fetch messages based on source
      const messages = await this.fetchMessages(guild, structuredQuery, channel);
      logger.info(`✓ Fetched ${messages.length} messages`);

      if (messages.length === 0) {
        return 'No messages found matching your criteria.';
      }

      // Step 3: Analyze messages with AI (toxicity, sentiment, categories)
      const analyzedMessages = await this.analyzeMessages(messages, structuredQuery);
      logger.info(`✓ Analyzed ${analyzedMessages.length} messages with AI`);

      // Step 4: Filter based on conditions
      const filteredMessages = this.filterByConditions(analyzedMessages, structuredQuery.conditions);
      logger.info(`✓ Filtered to ${filteredMessages.length} messages`);

      if (filteredMessages.length === 0) {
        return 'No messages matched your specific conditions.';
      }

      // Step 5: Sort and limit results
      const sortedMessages = this.sortAndLimit(filteredMessages, structuredQuery);
      logger.info(`✓ Sorted and limited to ${sortedMessages.length} results`);

      // Step 6: Format response
      const response = await this.formatResponse(sortedMessages, structuredQuery, query);
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
    const prompt = `You are a query parser. Convert this natural language query into a structured format.

User query: "${query}"

Extract:
1. SOURCE: What to analyze? (messages, users, channels)
2. LIMIT: How many items? (default 50)
3. CONDITIONS: What filters to apply?
   - toxicity > X
   - contains "keyword"
   - sentiment = negative/positive/neutral
   - category = FUD/profanity/accusation/spam
4. SORT_BY: What to sort by? (toxicity, time, length, score)
5. SORT_ORDER: asc or desc?
6. RETURN_FORMAT: summary or detailed?

Common patterns:
- "hangisi FUD içeriyor" → condition: category contains FUD
- "en toksik 3'ünü" → sortBy: toxicity, sortOrder: desc, limit: 3
- "son 50 mesaj" → source: messages, limit: 50
- "küfür içeren" → condition: category contains profanity

Return ONLY valid JSON:
{
  "source": "messages",
  "limit": 50,
  "conditions": [
    {"type": "toxicity", "operator": ">", "value": 0.5},
    {"type": "contains", "operator": "contains", "value": "keyword"}
  ],
  "sortBy": "toxicity",
  "sortOrder": "desc",
  "returnFormat": "summary"
}`;

    try {
      const response = await this.llm.generate(
        prompt,
        'You are a query parser. Output ONLY valid JSON.',
        { temperature: 0.2, maxTokens: 500 }
      );

      // Extract JSON
      let cleaned = response.trim();
      cleaned = cleaned.replace(/```json\s*/g, '');
      cleaned = cleaned.replace(/```\s*/g, '');
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) cleaned = jsonMatch[0];

      const parsed = JSON.parse(cleaned);

      // Validate and set defaults
      return {
        source: parsed.source || 'messages',
        limit: parsed.limit || 50,
        conditions: parsed.conditions || [],
        groupBy: parsed.groupBy,
        sortBy: parsed.sortBy || 'time',
        sortOrder: parsed.sortOrder || 'desc',
        returnFormat: parsed.returnFormat || 'summary',
      };

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

    // Batch analyze for performance (10 at a time)
    const batchSize = 10;
    for (let i = 0; i < messages.length; i += batchSize) {
      const batch = messages.slice(i, i + batchSize);
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
   * Format response for user
   */
  private async formatResponse(
    results: AnalyzedMessageData[],
    query: QueryRequest,
    originalQuery: string
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
