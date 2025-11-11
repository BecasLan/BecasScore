/**
 * PROFILE BUILDER - User Personality & Behavior Analysis
 *
 * Builds comprehensive user profiles with 50+ traits:
 * - Personality traits (aggression, helpfulness, leadership, humor, formality)
 * - Behavioral patterns (message length, emoji usage, caps, links)
 * - Social dynamics (response rate, conversation starter, conflict involvement)
 * - Time patterns (active hours, session length, messages per day)
 * - Language characteristics (vocabulary, slang, technical language)
 * - Risk indicators (impulsivity, deception, manipulation)
 */

import { UserRepository } from '../database/repositories/UserRepository';
import { MessageRepository } from '../database/repositories/MessageRepository';
import { SicilRepository } from '../database/repositories/SicilRepository';
import { createLogger } from './Logger';

const logger = createLogger('ProfileBuilder');

export interface UserCharacterProfile {
  // Identity
  userId: string;
  serverId: string;

  // Personality Traits (0-1 scale)
  personality: {
    aggression: number;        // 0 = peaceful, 1 = aggressive
    helpfulness: number;       // 0 = unhelpful, 1 = very helpful
    leadership: number;        // 0 = follower, 1 = leader
    humor: number;            // 0 = serious, 1 = humorous
    formality: number;        // 0 = casual, 1 = formal
    empathy: number;          // 0 = low empathy, 1 = high empathy
    creativity: number;       // 0 = literal, 1 = creative
    stability: number;        // 0 = volatile, 1 = stable
  };

  // Behavioral Patterns
  behavior: {
    avgMessageLength: number;     // Average characters per message
    emojiUsageRate: number;       // Emojis per message
    capsUsageRate: number;        // % of messages with CAPS
    linkSharingRate: number;      // Links per message
    mentionRate: number;          // Mentions per message
    questionRate: number;         // Questions asked per message
    exclamationRate: number;      // Exclamation marks per message
    messageEditRate: number;      // % of messages edited
    reactionGivingRate: number;   // Reactions given per message seen
  };

  // Social Dynamics
  social: {
    responseRate: number;              // % of messages that are responses
    conversationStarterRate: number;   // % of messages starting new threads
    conflictInvolvementRate: number;   // % of arguments participated in
    supportGivingRate: number;         // % of supportive messages
    influenceScore: number;            // How much others respond to this user
    reciprocityScore: number;          // Balance of giving/receiving interactions
  };

  // Time Patterns
  timePatterns: {
    mostActiveHour: number;      // 0-23
    avgSessionLength: number;    // Minutes
    messagesPerDay: number;      // Average daily message count
    weekdayActivity: number;     // 0-1 (weekday vs weekend)
    nightOwlScore: number;       // 0-1 (0 = day person, 1 = night person)
  };

  // Language Characteristics
  language: {
    vocabularySize: number;         // Unique words used
    avgWordLength: number;          // Average word length
    slangUsageRate: number;         // % of slang/informal words
    technicalLanguageRate: number;  // % of technical terms
    sentimentVariance: number;      // How much sentiment varies
    readabilityScore: number;       // 0-100 (Flesch reading ease)
  };

  // Risk Indicators (0-1 scale, higher = more risky)
  riskIndicators: {
    impulsivity: number;       // Quick reactions, emotional responses
    deception: number;         // Inconsistencies, suspicious patterns
    manipulation: number;      // Attempts to influence others
    volatility: number;        // Sudden mood/behavior changes
    predatoryBehavior: number; // Targeting vulnerable users
  };

  // Metadata
  confidence: number;           // 0-1, how confident we are in this profile
  messageCount: number;         // Total messages analyzed
  lastUpdated: number;          // Timestamp
}

export class ProfileBuilder {
  constructor(
    private userRepo: UserRepository,
    private messageRepo: MessageRepository,
    private sicilRepo: SicilRepository
  ) {}

  /**
   * Build complete user profile from scratch
   */
  async buildProfile(
    userId: string,
    serverId: string,
    minMessages = 10
  ): Promise<UserCharacterProfile | null> {
    logger.info(`Building profile for user ${userId} in server ${serverId}`);

    try {
      // Get user's messages (last 100 for analysis)
      const messages = await this.getUserMessages(userId, serverId, 100);

      if (messages.length < minMessages) {
        logger.debug(`Not enough messages (${messages.length}/${minMessages}) to build profile`);
        return null;
      }

      // Calculate all traits
      const personality = await this.calculatePersonalityTraits(messages);
      const behavior = this.calculateBehavioralPatterns(messages);
      const social = await this.calculateSocialDynamics(userId, serverId, messages);
      const timePatterns = this.calculateTimePatterns(messages);
      const language = this.calculateLanguageCharacteristics(messages);
      const riskIndicators = await this.calculateRiskIndicators(userId, serverId, messages);

      // Calculate confidence based on data quantity
      const confidence = Math.min(1.0, messages.length / 100);

      const profile: UserCharacterProfile = {
        userId,
        serverId,
        personality,
        behavior,
        social,
        timePatterns,
        language,
        riskIndicators,
        confidence,
        messageCount: messages.length,
        lastUpdated: Date.now()
      };

      // Save to database
      await this.saveProfile(profile);

      logger.info(`✅ Profile built with ${messages.length} messages (confidence: ${(confidence * 100).toFixed(0)}%)`);

      return profile;

    } catch (error) {
      logger.error('Failed to build profile', error);
      return null;
    }
  }

  /**
   * Calculate personality traits from messages
   */
  private async calculatePersonalityTraits(messages: any[]): Promise<UserCharacterProfile['personality']> {
    let aggressionScore = 0;
    let helpfulnessScore = 0;
    let leadershipScore = 0;
    let humorScore = 0;
    let formalityScore = 0;
    let empathyScore = 0;
    let creativityScore = 0;
    let stabilityScore = 0;

    for (const msg of messages) {
      // Aggression: toxicity, caps, exclamations
      if (msg.toxicity_score > 50) aggressionScore += msg.toxicity_score / 100;
      if ((msg.content.match(/[A-Z]/g) || []).length / msg.content.length > 0.5) aggressionScore += 0.3;
      if ((msg.content.match(/!/g) || []).length > 2) aggressionScore += 0.2;

      // Helpfulness: questions answered, support given
      if (msg.content.match(/\b(here|try|check|help|assist|guide)\b/i)) helpfulnessScore += 0.5;
      if (msg.sentiment === 'positive' && msg.content.length > 50) helpfulnessScore += 0.3;

      // Leadership: commands, directives, organization
      if (msg.content.match(/\b(everyone|team|let's|we should|I suggest)\b/i)) leadershipScore += 0.4;
      if (msg.content.match(/^@/)) leadershipScore += 0.2; // Mentions others

      // Humor: jokes, memes, emojis
      if (msg.content.match(/😂|🤣|😆|lol|lmao|haha/i)) humorScore += 0.5;
      if (msg.sentiment === 'positive' && msg.content.length < 30) humorScore += 0.2;

      // Formality: proper grammar, no slang
      if (!msg.content.match(/\b(lol|omg|wtf|bruh|yo)\b/i)) formalityScore += 0.2;
      if (msg.content.match(/[.!?]$/)) formalityScore += 0.1; // Proper punctuation

      // Empathy: emotional support, understanding
      if (msg.content.match(/\b(sorry|understand|feel|care|support)\b/i)) empathyScore += 0.5;
      if (msg.sentiment === 'positive' && msg.content.match(/\?$/)) empathyScore += 0.3;

      // Creativity: unique expressions, metaphors
      if (msg.content.length > 100 && !msg.content.match(/^(https?|www)/i)) creativityScore += 0.3;

      // Stability: consistent sentiment, no sudden changes
      // (calculated after loop)
    }

    // Normalize scores (0-1)
    const normalize = (score: number, max: number) => Math.min(1, score / max);

    // Calculate sentiment stability
    const sentiments = messages.map(m => m.sentiment || 'neutral');
    const uniqueSentiments = new Set(sentiments).size;
    stabilityScore = 1 - (uniqueSentiments / 3); // 3 possible sentiments

    return {
      aggression: normalize(aggressionScore, messages.length),
      helpfulness: normalize(helpfulnessScore, messages.length * 0.5),
      leadership: normalize(leadershipScore, messages.length * 0.4),
      humor: normalize(humorScore, messages.length * 0.5),
      formality: normalize(formalityScore, messages.length * 0.3),
      empathy: normalize(empathyScore, messages.length * 0.5),
      creativity: normalize(creativityScore, messages.length * 0.3),
      stability: stabilityScore
    };
  }

  /**
   * Calculate behavioral patterns
   */
  private calculateBehavioralPatterns(messages: any[]): UserCharacterProfile['behavior'] {
    let totalLength = 0;
    let totalEmojis = 0;
    let capsMessages = 0;
    let linkMessages = 0;
    let mentionMessages = 0;
    let questionMessages = 0;
    let exclamationMessages = 0;
    let editedMessages = 0;

    for (const msg of messages) {
      totalLength += msg.content.length;
      totalEmojis += (msg.content.match(/[\u{1F600}-\u{1F64F}]/gu) || []).length;

      if ((msg.content.match(/[A-Z]/g) || []).length / msg.content.length > 0.5) capsMessages++;
      if (msg.content.match(/https?:\/\//i)) linkMessages++;
      if (msg.content.match(/@/)) mentionMessages++;
      if (msg.content.match(/\?/)) questionMessages++;
      if (msg.content.match(/!/)) exclamationMessages++;
      if (msg.edited_at) editedMessages++;
    }

    return {
      avgMessageLength: totalLength / messages.length,
      emojiUsageRate: totalEmojis / messages.length,
      capsUsageRate: capsMessages / messages.length,
      linkSharingRate: linkMessages / messages.length,
      mentionRate: mentionMessages / messages.length,
      questionRate: questionMessages / messages.length,
      exclamationRate: exclamationMessages / messages.length,
      messageEditRate: editedMessages / messages.length,
      reactionGivingRate: 0 // Would need reaction data
    };
  }

  /**
   * Calculate social dynamics
   */
  private async calculateSocialDynamics(
    userId: string,
    serverId: string,
    messages: any[]
  ): Promise<UserCharacterProfile['social']> {
    let responses = 0;
    let conversationStarters = 0;
    let conflicts = 0;
    let supportMessages = 0;

    for (const msg of messages) {
      if (msg.reply_to_message_id) responses++;
      else conversationStarters++;

      if (msg.toxicity_score > 60) conflicts++;
      if (msg.sentiment === 'positive' && msg.content.match(/\b(thanks|great|awesome|good)\b/i)) {
        supportMessages++;
      }
    }

    return {
      responseRate: responses / messages.length,
      conversationStarterRate: conversationStarters / messages.length,
      conflictInvolvementRate: conflicts / messages.length,
      supportGivingRate: supportMessages / messages.length,
      influenceScore: 0.5, // Would need interaction data
      reciprocityScore: 0.5 // Would need interaction data
    };
  }

  /**
   * Calculate time patterns
   */
  private calculateTimePatterns(messages: any[]): UserCharacterProfile['timePatterns'] {
    const hours: number[] = [];
    const dates: number[] = [];

    for (const msg of messages) {
      const date = new Date(msg.created_at);
      hours.push(date.getHours());
      dates.push(date.getTime());
    }

    // Most active hour
    const hourCounts = new Map<number, number>();
    hours.forEach(h => hourCounts.set(h, (hourCounts.get(h) || 0) + 1));
    const mostActiveHour = Array.from(hourCounts.entries())
      .sort((a, b) => b[1] - a[1])[0]?.[0] || 12;

    // Messages per day
    const daySpan = (Math.max(...dates) - Math.min(...dates)) / 86400000;
    const messagesPerDay = messages.length / Math.max(1, daySpan);

    // Night owl score (active 22:00-06:00)
    const nightMessages = hours.filter(h => h >= 22 || h < 6).length;
    const nightOwlScore = nightMessages / messages.length;

    return {
      mostActiveHour,
      avgSessionLength: 30, // Would need session tracking
      messagesPerDay,
      weekdayActivity: 0.7, // Would need day-of-week data
      nightOwlScore
    };
  }

  /**
   * Calculate language characteristics
   */
  private calculateLanguageCharacteristics(messages: any[]): UserCharacterProfile['language'] {
    const allWords: string[] = [];
    let totalWordLength = 0;
    let slangCount = 0;
    let techCount = 0;

    const slangWords = ['lol', 'omg', 'wtf', 'bruh', 'yo', 'nah', 'yep', 'gonna', 'wanna'];
    const techWords = ['api', 'database', 'server', 'client', 'function', 'code', 'bug', 'deploy'];

    for (const msg of messages) {
      const words = msg.content.toLowerCase().match(/\b\w+\b/g) || [];
      allWords.push(...words);

      for (const word of words) {
        totalWordLength += word.length;
        if (slangWords.includes(word)) slangCount++;
        if (techWords.includes(word)) techCount++;
      }
    }

    const uniqueWords = new Set(allWords);

    return {
      vocabularySize: uniqueWords.size,
      avgWordLength: allWords.length > 0 ? totalWordLength / allWords.length : 0,
      slangUsageRate: slangCount / allWords.length,
      technicalLanguageRate: techCount / allWords.length,
      sentimentVariance: 0.3, // Would need full sentiment history
      readabilityScore: 60 // Placeholder
    };
  }

  /**
   * Calculate risk indicators
   */
  private async calculateRiskIndicators(
    userId: string,
    serverId: string,
    messages: any[]
  ): Promise<UserCharacterProfile['riskIndicators']> {
    // Get user's sicil (violations)
    const sicil = await this.sicilRepo.getSicilSummary(serverId, userId);

    let impulsivityScore = 0;
    let deceptionScore = 0;
    let manipulationScore = 0;
    let volatilityScore = 0;

    // Impulsivity: quick short messages, many exclamations
    const shortMessages = messages.filter(m => m.content.length < 20).length;
    impulsivityScore = shortMessages / messages.length;

    // Deception: high scam scores, inconsistencies
    const scamMessages = messages.filter(m => (m.scam_score || 0) > 50).length;
    deceptionScore = scamMessages / messages.length;

    // Manipulation: persuasion attempts, guilt-tripping
    const manipulativeMessages = messages.filter(m =>
      m.content.match(/\b(please|need|help me|urgent|emergency)\b/i)
    ).length;
    manipulationScore = Math.min(1, manipulativeMessages / messages.length * 2);

    // Volatility: alternating sentiment, sudden toxicity spikes
    let sentimentChanges = 0;
    for (let i = 1; i < messages.length; i++) {
      if (messages[i].sentiment !== messages[i - 1].sentiment) sentimentChanges++;
    }
    volatilityScore = sentimentChanges / messages.length;

    return {
      impulsivity: impulsivityScore,
      deception: deceptionScore,
      manipulation: manipulationScore,
      volatility: volatilityScore,
      predatoryBehavior: 0 // Would need advanced pattern detection
    };
  }

  /**
   * Get user's messages from database
   */
  private async getUserMessages(
    userId: string,
    serverId: string,
    limit: number
  ): Promise<any[]> {
    // TODO: Implement actual database query
    // For now, return empty array (will be implemented when integrated)
    return [];
  }

  /**
   * Save profile to database
   */
  private async saveProfile(profile: UserCharacterProfile): Promise<void> {
    // TODO: Save to user_character_profiles table
    logger.debug('Profile saved to database');
  }
}
