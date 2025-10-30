import { createLogger } from '../services/Logger';
import { OllamaService } from '../services/OllamaService';

const logger = createLogger('UserProfileBadges');

/**
 * USER PROFILE BADGE SYSTEM
 *
 * AI-driven user profiling that assigns descriptive badges based on behavior analysis.
 * The AI analyzes:
 * - Trust history (punishments, warnings, bans)
 * - Message patterns (toxicity, helpfulness, profanity)
 * - Community interactions (positive contributions, conflicts)
 *
 * Badges are AI-generated and can be:
 * - Positive: "Very Helpful", "Community Leader", "Respectful"
 * - Negative: "Uses Profanity", "Toxic Behavior", "Scammer"
 * - Neutral: "New Member", "Quiet Observer", "Occasional Poster"
 */

// ==========================================
// INTERFACES
// ==========================================

export interface UserBadge {
  type: 'positive' | 'negative' | 'neutral';
  label: string;
  confidence: number; // 0-1, how confident AI is about this badge
  evidence: string[]; // Specific examples that justify this badge
  assignedAt: Date;
  lastUpdated: Date;
}

export interface UserProfile {
  userId: string;
  guildId: string;
  badges: UserBadge[];
  summary: string; // AI-generated summary of user behavior
  trustScore: number;
  metadata: {
    totalMessages: number;
    avgToxicity: number;
    avgHelpfulness: number;
    conflictCount: number;
    positiveContributions: number;
    lastAnalyzed: Date;
  };
}

export interface BadgeAnalysisResult {
  badges: UserBadge[];
  summary: string;
  reasoning: string;
}

// ==========================================
// USER PROFILE BADGE SYSTEM
// ==========================================

export class UserProfileBadgeSystem {
  private profiles: Map<string, UserProfile> = new Map();
  private llm: OllamaService;

  constructor(llm: OllamaService) {
    this.llm = llm;
    logger.info('UserProfileBadgeSystem initialized');
  }

  /**
   * Analyze user and assign AI-driven badges
   */
  async analyzeAndAssignBadges(
    userId: string,
    guildId: string,
    trustHistory: any[],
    messageHistory: any[],
    trustScore: number
  ): Promise<BadgeAnalysisResult> {
    logger.info(`🔍 Analyzing user ${userId} for badge assignment...`);

    // Build context for AI analysis
    const context = this.buildAnalysisContext(trustHistory, messageHistory, trustScore);

    // Ask AI to analyze user behavior and suggest badges
    const prompt = `You are analyzing a Discord user's behavior to assign descriptive profile badges.

USER ANALYSIS DATA:
${context}

Your task:
1. Analyze the user's behavior patterns
2. Assign 2-5 descriptive badges that accurately describe this user
3. Provide evidence for each badge

Badge Types:
- POSITIVE: "Very Helpful", "Community Leader", "Respectful", "Constructive", "Welcoming"
- NEGATIVE: "Uses Profanity", "Toxic Behavior", "Manipulative", "Scammer", "Aggressive"
- NEUTRAL: "New Member", "Quiet Observer", "Occasional Poster", "Lurker"

Return ONLY a JSON object:
{
  "badges": [
    {
      "type": "positive|negative|neutral",
      "label": "Badge Label",
      "confidence": 0.85,
      "evidence": ["Evidence 1", "Evidence 2"]
    }
  ],
  "summary": "Brief 1-2 sentence summary of user behavior",
  "reasoning": "Explanation of badge assignments"
}`;

    const systemPrompt = `You are a behavioral analyst. You assess user behavior objectively and assign accurate, descriptive badges. Be fair and evidence-based.`;

    try {
      const response = await this.llm.generate(prompt, systemPrompt);

      // Clean response
      let cleaned = response.trim();
      cleaned = cleaned.replace(/```json\s*/g, '');
      cleaned = cleaned.replace(/```\s*/g, '');
      cleaned = cleaned.trim();

      // Extract JSON
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        cleaned = jsonMatch[0];
      }

      const result: BadgeAnalysisResult = JSON.parse(cleaned);

      // Add timestamps to badges
      result.badges.forEach(badge => {
        (badge as any).assignedAt = new Date();
        (badge as any).lastUpdated = new Date();
      });

      logger.info(`✅ Assigned ${result.badges.length} badges to user ${userId}`);
      logger.info(`   Summary: ${result.summary}`);

      // Store profile
      this.storeProfile(userId, guildId, result, trustScore, messageHistory.length);

      return result;

    } catch (error) {
      logger.error('Badge analysis failed:', error);

      // Fallback: Basic badge assignment
      return this.fallbackBadgeAssignment(trustScore, trustHistory);
    }
  }

  /**
   * Build analysis context from user data
   */
  private buildAnalysisContext(
    trustHistory: any[],
    messageHistory: any[],
    trustScore: number
  ): string {
    const lines: string[] = [];

    // Trust Score
    lines.push(`Trust Score: ${trustScore}/100`);

    // Trust History Analysis
    if (trustHistory.length > 0) {
      const recentHistory = trustHistory.slice(-10);
      const punishments = recentHistory.filter(h => h.action === 'timeout' || h.action === 'ban');
      const warnings = recentHistory.filter(h => h.reason?.includes('warn'));

      lines.push(`\nTrust History (last 10 events):`);
      lines.push(`- Total events: ${recentHistory.length}`);
      lines.push(`- Punishments (timeout/ban): ${punishments.length}`);
      lines.push(`- Warnings: ${warnings.length}`);

      if (punishments.length > 0) {
        lines.push(`\nRecent Punishments:`);
        punishments.slice(-3).forEach(p => {
          lines.push(`  - ${p.action}: ${p.reason}`);
        });
      }
    } else {
      lines.push(`\nTrust History: Clean record (no violations)`);
    }

    // Message Pattern Analysis
    if (messageHistory.length > 0) {
      const avgToxicity = messageHistory.reduce((sum, m) => sum + (m.toxicity || 0), 0) / messageHistory.length;
      const profanityCount = messageHistory.filter(m => m.content?.match(/\b(fuck|shit|damn|bitch|ass)\b/i)).length;
      const helpfulCount = messageHistory.filter(m => m.sentiment === 'positive' && m.content.length > 50).length;

      lines.push(`\nMessage Patterns:`);
      lines.push(`- Total messages: ${messageHistory.length}`);
      lines.push(`- Average toxicity: ${(avgToxicity * 100).toFixed(0)}%`);
      lines.push(`- Messages with profanity: ${profanityCount}`);
      lines.push(`- Helpful/constructive messages: ${helpfulCount}`);
    }

    return lines.join('\n');
  }

  /**
   * Fallback badge assignment (if AI fails)
   */
  private fallbackBadgeAssignment(
    trustScore: number,
    trustHistory: any[]
  ): BadgeAnalysisResult {
    const badges: UserBadge[] = [];

    // Trust-based badges
    if (trustScore >= 80) {
      badges.push({
        type: 'positive',
        label: 'Trusted Member',
        confidence: 0.9,
        evidence: [`High trust score: ${trustScore}`],
        assignedAt: new Date(),
        lastUpdated: new Date(),
      });
    } else if (trustScore <= 30) {
      badges.push({
        type: 'negative',
        label: 'Untrusted',
        confidence: 0.9,
        evidence: [`Low trust score: ${trustScore}`],
        assignedAt: new Date(),
        lastUpdated: new Date(),
      });
    }

    // History-based badges
    const punishments = trustHistory.filter(h => h.action === 'timeout' || h.action === 'ban');
    if (punishments.length > 3) {
      badges.push({
        type: 'negative',
        label: 'Repeat Offender',
        confidence: 0.95,
        evidence: [`${punishments.length} punishments in history`],
        assignedAt: new Date(),
        lastUpdated: new Date(),
      });
    }

    if (trustHistory.length === 0) {
      badges.push({
        type: 'neutral',
        label: 'New Member',
        confidence: 0.8,
        evidence: ['Clean history, recently joined'],
        assignedAt: new Date(),
        lastUpdated: new Date(),
      });
    }

    return {
      badges,
      summary: `User with trust score ${trustScore}`,
      reasoning: 'Fallback analysis based on trust score and history',
    };
  }

  /**
   * Store user profile
   */
  private storeProfile(
    userId: string,
    guildId: string,
    analysis: BadgeAnalysisResult,
    trustScore: number,
    messageCount: number
  ): void {
    const key = `${guildId}:${userId}`;

    this.profiles.set(key, {
      userId,
      guildId,
      badges: analysis.badges,
      summary: analysis.summary,
      trustScore,
      metadata: {
        totalMessages: messageCount,
        avgToxicity: 0, // Would be calculated from message history
        avgHelpfulness: 0,
        conflictCount: 0,
        positiveContributions: 0,
        lastAnalyzed: new Date(),
      },
    });

    logger.info(`✓ Stored profile for user ${userId}`);
  }

  /**
   * Get user profile
   */
  getProfile(userId: string, guildId: string): UserProfile | undefined {
    const key = `${guildId}:${userId}`;
    return this.profiles.get(key);
  }

  /**
   * Filter users by badge
   */
  filterByBadge(guildId: string, badgeLabel: string): UserProfile[] {
    const results: UserProfile[] = [];

    for (const [key, profile] of this.profiles.entries()) {
      if (key.startsWith(`${guildId}:`)) {
        const hasBadge = profile.badges.some(b =>
          b.label.toLowerCase().includes(badgeLabel.toLowerCase())
        );
        if (hasBadge) {
          results.push(profile);
        }
      }
    }

    return results;
  }

  /**
   * Rank users by trust score
   */
  rankUsersByTrust(guildId: string, limit: number = 10): UserProfile[] {
    const guildProfiles: UserProfile[] = [];

    for (const [key, profile] of this.profiles.entries()) {
      if (key.startsWith(`${guildId}:`)) {
        guildProfiles.push(profile);
      }
    }

    return guildProfiles
      .sort((a, b) => b.trustScore - a.trustScore)
      .slice(0, limit);
  }

  /**
   * Get all profiles for a guild
   */
  getAllProfiles(guildId: string): UserProfile[] {
    const results: UserProfile[] = [];

    for (const [key, profile] of this.profiles.entries()) {
      if (key.startsWith(`${guildId}:`)) {
        results.push(profile);
      }
    }

    return results;
  }

  /**
   * Add custom badge to user
   */
  addCustomBadge(
    userId: string,
    guildId: string,
    badge: Omit<UserBadge, 'assignedAt' | 'lastUpdated'>
  ): void {
    const key = `${guildId}:${userId}`;
    const profile = this.profiles.get(key);

    if (profile) {
      profile.badges.push({
        ...badge,
        assignedAt: new Date(),
        lastUpdated: new Date(),
      });

      logger.info(`✓ Added custom badge "${badge.label}" to user ${userId}`);
    }
  }

  /**
   * Remove badge from user
   */
  removeBadge(userId: string, guildId: string, badgeLabel: string): void {
    const key = `${guildId}:${userId}`;
    const profile = this.profiles.get(key);

    if (profile) {
      profile.badges = profile.badges.filter(b => b.label !== badgeLabel);
      logger.info(`✓ Removed badge "${badgeLabel}" from user ${userId}`);
    }
  }
}
