// RuleLearning.ts - Auto-discover and learn server rules
// Enables: reading #rules, understanding server-specific policies, adapting moderation

import { Guild, TextChannel, Message } from 'discord.js';
import { OllamaService } from '../services/OllamaService';
import { ServerAnalysis } from './ServerAnalysis';
import { createLogger } from '../services/Logger';

const logger = createLogger('RuleLearning');

// ============================================
// TYPES
// ============================================

export interface LearnedRules {
  guildId: string;
  guildName: string;
  learnedAt: number;
  rulesText: string;
  extractedRules: Rule[];
  prohibitedTopics: string[];
  requiredBehaviors: string[];
  punishmentGuidelines: PunishmentGuideline[];
}

export interface Rule {
  ruleNumber?: number;
  ruleText: string;
  category: string; // 'content', 'behavior', 'spam', 'nsfw', 'language', 'other'
  severity: 'low' | 'medium' | 'high' | 'critical';
  keywords: string[]; // Key terms for detection
}

export interface PunishmentGuideline {
  offense: string;
  firstOffense: string; // 'warn', 'timeout', 'kick', 'ban'
  repeatOffense: string;
  notes?: string;
}

// ============================================
// RULE LEARNING ENGINE
// ============================================

export class RuleLearning {
  private ollama: OllamaService;
  private serverAnalysis: ServerAnalysis;
  private learnedRules: Map<string, LearnedRules> = new Map(); // guildId -> rules
  private readonly CACHE_TTL = 60 * 60 * 1000; // 1 hour

  constructor(ollama: OllamaService, serverAnalysis: ServerAnalysis) {
    this.ollama = ollama;
    this.serverAnalysis = serverAnalysis;
    logger.info('RuleLearning initialized');
  }

  /**
   * Learn rules from a server's rules channel
   */
  async learnRules(guild: Guild): Promise<LearnedRules | undefined> {
    logger.info(`Learning rules for server: ${guild.name}`);

    // Check cache first
    const cached = this.learnedRules.get(guild.id);
    if (cached && Date.now() - cached.learnedAt < this.CACHE_TTL) {
      logger.debug(`Using cached rules for ${guild.name}`);
      return cached;
    }

    // Find rules channel
    const rulesChannel = await this.serverAnalysis.findRules(guild);
    if (!rulesChannel) {
      logger.warn(`No rules channel found for ${guild.name}`);
      return undefined;
    }

    logger.info(`Found rules channel: #${rulesChannel.name}`);

    // Fetch messages from rules channel
    try {
      const messages = await rulesChannel.messages.fetch({ limit: 50 });
      const rulesText = messages
        .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
        .map(m => m.content)
        .filter(c => c.length > 20) // Filter out short messages
        .join('\n\n');

      if (rulesText.length < 100) {
        logger.warn(`Rules channel has very little content (${rulesText.length} chars)`);
        return undefined;
      }

      logger.info(`Extracted ${rulesText.length} characters of rules text`);

      // Use AI to extract and parse rules
      const extractedRules = await this.extractRules(rulesText);
      const prohibitedTopics = await this.extractProhibitedTopics(rulesText);
      const punishmentGuidelines = await this.extractPunishmentGuidelines(rulesText);

      const learned: LearnedRules = {
        guildId: guild.id,
        guildName: guild.name,
        learnedAt: Date.now(),
        rulesText,
        extractedRules,
        prohibitedTopics,
        requiredBehaviors: [], // Could be expanded
        punishmentGuidelines,
      };

      this.learnedRules.set(guild.id, learned);

      logger.info(`Rules learned successfully for ${guild.name}`);
      logger.info(`  Extracted rules: ${extractedRules.length}`);
      logger.info(`  Prohibited topics: ${prohibitedTopics.length}`);
      logger.info(`  Punishment guidelines: ${punishmentGuidelines.length}`);

      return learned;

    } catch (error: any) {
      logger.error(`Failed to learn rules for ${guild.name}:`, error);
      return undefined;
    }
  }

  /**
   * Extract structured rules from rules text using AI
   */
  private async extractRules(rulesText: string): Promise<Rule[]> {
    const prompt = `You are analyzing server rules. Extract individual rules and categorize them.

RULES TEXT:
${rulesText.substring(0, 3000)} // Limit to avoid token overflow

YOUR TASK:
Extract each rule as a structured object. Return JSON array:
[
  {
    "ruleNumber": 1 | null,
    "ruleText": "brief description",
    "category": "content" | "behavior" | "spam" | "nsfw" | "language" | "other",
    "severity": "low" | "medium" | "high" | "critical",
    "keywords": ["word1", "word2"]
  }
]

CATEGORIES:
- content: What content is allowed/disallowed
- behavior: How users should behave
- spam: Anti-spam rules
- nsfw: NSFW/adult content rules
- language: Language restrictions
- other: Other rules

SEVERITY:
- low: Minor infractions (off-topic chat)
- medium: Moderate issues (mild spam, caps)
- high: Serious violations (hate speech, harassment)
- critical: Instant ban offenses (illegal content, doxxing)

KEYWORDS: Extract 2-5 key terms for detecting violations

Output ONLY valid JSON array.`;

    try {
      const response = await this.ollama.generate(
        prompt,
        'You are a JSON generator. Output ONLY a valid JSON array.'
      );

      let cleaned = response.trim().replace(/```json\s*/g, '').replace(/```\s*/g, '');
      const firstBracket = cleaned.indexOf('[');
      const lastBracket = cleaned.lastIndexOf(']');

      if (firstBracket === -1 || lastBracket === -1) {
        logger.warn('No JSON array found in rules extraction');
        return [];
      }

      const jsonStr = cleaned.substring(firstBracket, lastBracket + 1);
      const parsed = JSON.parse(jsonStr);

      logger.debug(`Extracted ${parsed.length} rules from text`);
      return parsed;

    } catch (error: any) {
      logger.error('Failed to extract rules:', error);
      return [];
    }
  }

  /**
   * Extract prohibited topics from rules
   */
  private async extractProhibitedTopics(rulesText: string): Promise<string[]> {
    const prompt = `Extract PROHIBITED TOPICS from these server rules.

RULES:
${rulesText.substring(0, 2000)}

Return JSON array of prohibited topics (e.g., "politics", "religion", "crypto shilling"):
["topic1", "topic2", ...]

Output ONLY JSON array.`;

    try {
      const response = await this.ollama.generate(
        prompt,
        'Output ONLY a JSON array of strings.'
      );

      let cleaned = response.trim().replace(/```json\s*/g, '').replace(/```\s*/g, '');
      const firstBracket = cleaned.indexOf('[');
      const lastBracket = cleaned.lastIndexOf(']');

      if (firstBracket === -1 || lastBracket === -1) {
        return [];
      }

      const jsonStr = cleaned.substring(firstBracket, lastBracket + 1);
      const parsed = JSON.parse(jsonStr);

      return parsed;

    } catch (error: any) {
      logger.error('Failed to extract prohibited topics:', error);
      return [];
    }
  }

  /**
   * Extract punishment guidelines from rules
   */
  private async extractPunishmentGuidelines(rulesText: string): Promise<PunishmentGuideline[]> {
    const prompt = `Extract PUNISHMENT GUIDELINES from these server rules.

RULES:
${rulesText.substring(0, 2000)}

Look for escalation patterns like:
- "First offense: warning, second: timeout, third: ban"
- "Spam results in immediate timeout"
- "NSFW = instant ban"

Return JSON array:
[
  {
    "offense": "spam",
    "firstOffense": "warn" | "timeout" | "kick" | "ban",
    "repeatOffense": "warn" | "timeout" | "kick" | "ban",
    "notes": "optional context"
  }
]

If no explicit guidelines, infer reasonable ones based on severity mentioned.

Output ONLY JSON array.`;

    try {
      const response = await this.ollama.generate(
        prompt,
        'Output ONLY a JSON array.'
      );

      let cleaned = response.trim().replace(/```json\s*/g, '').replace(/```\s*/g, '');
      const firstBracket = cleaned.indexOf('[');
      const lastBracket = cleaned.lastIndexOf(']');

      if (firstBracket === -1 || lastBracket === -1) {
        return [];
      }

      const jsonStr = cleaned.substring(firstBracket, lastBracket + 1);
      const parsed = JSON.parse(jsonStr);

      return parsed;

    } catch (error: any) {
      logger.error('Failed to extract punishment guidelines:', error);
      return [];
    }
  }

  /**
   * Check if content violates server-specific rules
   */
  async checkAgainstRules(guild: Guild, content: string): Promise<{
    violatesRules: boolean;
    violatedRules: Rule[];
    suggestedAction?: string;
  }> {
    const learned = await this.getRules(guild);

    if (!learned || learned.extractedRules.length === 0) {
      return {
        violatesRules: false,
        violatedRules: [],
      };
    }

    const contentLower = content.toLowerCase();
    const violatedRules: Rule[] = [];

    // Check against extracted rules
    for (const rule of learned.extractedRules) {
      const matchesKeywords = rule.keywords.some(keyword =>
        contentLower.includes(keyword.toLowerCase())
      );

      if (matchesKeywords) {
        violatedRules.push(rule);
      }
    }

    // Check against prohibited topics
    for (const topic of learned.prohibitedTopics) {
      if (contentLower.includes(topic.toLowerCase())) {
        violatedRules.push({
          ruleText: `Prohibited topic: ${topic}`,
          category: 'content',
          severity: 'medium',
          keywords: [topic],
        });
      }
    }

    // Suggest action based on highest severity violation
    let suggestedAction: string | undefined;
    if (violatedRules.length > 0) {
      const highestSeverity = violatedRules.reduce((max, r) => {
        const severityLevels: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 };
        const rSev = severityLevels[r.severity];
        const maxSev = severityLevels[max];
        return rSev > maxSev ? r.severity : max;
      }, 'low' as 'low' | 'medium' | 'high' | 'critical');

      switch (highestSeverity) {
        case 'low':
          suggestedAction = 'warn';
          break;
        case 'medium':
          suggestedAction = 'timeout';
          break;
        case 'high':
          suggestedAction = 'timeout';
          break;
        case 'critical':
          suggestedAction = 'ban';
          break;
      }
    }

    return {
      violatesRules: violatedRules.length > 0,
      violatedRules,
      suggestedAction,
    };
  }

  /**
   * Get learned rules for a guild (from cache or learn)
   */
  async getRules(guild: Guild): Promise<LearnedRules | undefined> {
    const cached = this.learnedRules.get(guild.id);
    if (cached && Date.now() - cached.learnedAt < this.CACHE_TTL) {
      return cached;
    }
    return await this.learnRules(guild);
  }

  /**
   * Clear cached rules for a guild
   */
  clearCache(guildId: string): void {
    this.learnedRules.delete(guildId);
    logger.info(`Cleared rule cache for guild ${guildId}`);
  }

  /**
   * Get a summary of learned rules
   */
  async getSummary(guild: Guild): Promise<string | undefined> {
    const learned = await this.getRules(guild);
    if (!learned) {
      return 'No rules learned for this server yet.';
    }

    const lines = [
      `📚 **Learned Rules: ${learned.guildName}**`,
      `📝 Total rules: ${learned.extractedRules.length}`,
      `🚫 Prohibited topics: ${learned.prohibitedTopics.join(', ') || 'None'}`,
      '',
      '**Rule Categories:**',
    ];

    const categories: Record<string, number> = {};
    for (const rule of learned.extractedRules) {
      categories[rule.category] = (categories[rule.category] || 0) + 1;
    }

    for (const [category, count] of Object.entries(categories)) {
      lines.push(`  ${category}: ${count}`);
    }

    return lines.join('\n');
  }
}
