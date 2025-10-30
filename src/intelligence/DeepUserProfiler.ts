import { Guild, GuildMember, Message, Collection } from 'discord.js';
import { OllamaService } from '../services/OllamaService';
import { StorageService } from '../services/StorageService';

/**
 * DEEP USER PROFILER - Know Every User
 *
 * This system builds deep profiles of every user:
 * - What they're interested in (gaming, coding, music)
 * - What they're expert at (JavaScript, Docker, etc)
 * - Activity patterns (when active, where active)
 * - Personality traits (helpful, technical, friendly)
 *
 * Enables queries like: "find 10 people who code"
 */

export interface UserProfile {
  userId: string;
  username: string;
  interests: string[];              // ["coding", "gaming", "music"]
  expertise: Map<string, number>;   // "javascript" -> 0.85
  activityPattern: {
    activeHours: number[];          // Hours of day when active
    preferredChannels: string[];
    messageFrequency: number;       // Messages per day
    lastSeen: Date;
  };
  relationships: {
    frequentContacts: string[];     // User IDs they interact with
    mentionCount: Map<string, number>;
  };
  personalityTraits: string[];      // ["helpful", "technical", "friendly"]
  messageStats: {
    totalMessages: number;
    averageLength: number;
    codeSnippets: number;           // How often they share code
    helpfulnessScore: number;       // 0-1
  };
  lastAnalyzed: Date;
}

export class DeepUserProfiler {
  private llm: OllamaService;
  private storage: StorageService;
  private profiles: Map<string, UserProfile> = new Map();

  constructor(storage: StorageService) {
    this.llm = new OllamaService('analysis');
    this.storage = storage;
    console.log('👥 DeepUserProfiler initialized - AI knows every user');
  }

  /**
   * Build or update user profile from messages
   */
  async analyzeUser(
    userId: string,
    username: string,
    recentMessages: Message[]
  ): Promise<UserProfile> {
    console.log(`👤 Profiling user: ${username} (${recentMessages.length} messages)`);

    let profile = this.profiles.get(userId);
    if (!profile) {
      profile = this.createEmptyProfile(userId, username);
    }

    if (recentMessages.length === 0) {
      return profile;
    }

    // Analyze message content for interests and expertise
    const analysis = await this.analyzeMessageContent(recentMessages);

    // Update interests
    profile.interests = Array.from(new Set([...profile.interests, ...analysis.interests]));

    // Update expertise
    analysis.expertise.forEach((score, topic) => {
      const currentScore = profile.expertise.get(topic) || 0;
      profile.expertise.set(topic, Math.max(currentScore, score));
    });

    // Update activity pattern
    this.updateActivityPattern(profile, recentMessages);

    // Update message stats
    this.updateMessageStats(profile, recentMessages);

    // Update personality traits
    profile.personalityTraits = analysis.traits;

    profile.lastAnalyzed = new Date();

    this.profiles.set(userId, profile);
    return profile;
  }

  /**
   * AI analyzes messages to extract interests and expertise
   */
  private async analyzeMessageContent(
    messages: Message[]
  ): Promise<{
    interests: string[];
    expertise: Map<string, number>;
    traits: string[];
  }> {
    const messageTexts = messages.slice(0, 50).map(m => m.content).join('\n');

    const prompt = `Analyze these Discord messages to understand the user:

Messages:
${messageTexts.substring(0, 3000)}

Determine:
1. INTERESTS: What topics does this user care about? (3-5 keywords)
2. EXPERTISE: What are they knowledgeable about? Rate 0-1 (e.g., "javascript": 0.8)
3. PERSONALITY: 2-3 traits (helpful, technical, friendly, casual, etc)

Respond ONLY with JSON:
{
  "interests": ["topic1", "topic2"],
  "expertise": {"skill1": 0.7, "skill2": 0.9},
  "traits": ["trait1", "trait2"]
}`;

    try {
      const response = await this.llm.generate(
        prompt,
        'You are a user profiler. Output only valid JSON.',
        { temperature: 0.3, maxTokens: 300 }
      );

      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);
        return {
          interests: data.interests || [],
          expertise: new Map(Object.entries(data.expertise || {})),
          traits: data.traits || []
        };
      }
    } catch (error) {
      console.error('User analysis error:', error);
    }

    return {
      interests: [],
      expertise: new Map(),
      traits: []
    };
  }

  /**
   * Update activity pattern
   */
  private updateActivityPattern(profile: UserProfile, messages: Message[]): void {
    const hours = messages.map(m => m.createdAt.getHours());
    profile.activityPattern.activeHours = Array.from(new Set(hours));

    const channels = messages.map(m => m.channelId);
    const channelCounts = new Map<string, number>();
    channels.forEach(ch => channelCounts.set(ch, (channelCounts.get(ch) || 0) + 1));

    const topChannels = Array.from(channelCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([ch]) => ch);

    profile.activityPattern.preferredChannels = topChannels;
    profile.activityPattern.lastSeen = messages[0]?.createdAt || new Date();
  }

  /**
   * Update message statistics
   */
  private updateMessageStats(profile: UserProfile, messages: Message[]): void {
    profile.messageStats.totalMessages += messages.length;

    const avgLength = messages.reduce((sum, m) => sum + m.content.length, 0) / messages.length;
    profile.messageStats.averageLength = avgLength;

    const codeSnippets = messages.filter(m =>
      m.content.includes('```') || m.content.includes('`')
    ).length;
    profile.messageStats.codeSnippets += codeSnippets;
  }

  /**
   * Create empty profile
   */
  private createEmptyProfile(userId: string, username: string): UserProfile {
    return {
      userId,
      username,
      interests: [],
      expertise: new Map(),
      activityPattern: {
        activeHours: [],
        preferredChannels: [],
        messageFrequency: 0,
        lastSeen: new Date()
      },
      relationships: {
        frequentContacts: [],
        mentionCount: new Map()
      },
      personalityTraits: [],
      messageStats: {
        totalMessages: 0,
        averageLength: 0,
        codeSnippets: 0,
        helpfulnessScore: 0
      },
      lastAnalyzed: new Date()
    };
  }

  /**
   * Search users by expertise
   * Example: "find people who know coding"
   */
  searchByExpertise(topic: string, limit: number = 10): UserProfile[] {
    topic = topic.toLowerCase();

    const matches: Array<{ profile: UserProfile; score: number }> = [];

    for (const profile of this.profiles.values()) {
      let score = 0;

      // Check direct expertise match
      for (const [skill, level] of profile.expertise.entries()) {
        if (skill.toLowerCase().includes(topic) || topic.includes(skill.toLowerCase())) {
          score = Math.max(score, level);
        }
      }

      // Check interests
      if (profile.interests.some(i => i.toLowerCase().includes(topic))) {
        score = Math.max(score, 0.5);
      }

      if (score > 0) {
        matches.push({ profile, score });
      }
    }

    return matches
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(m => m.profile);
  }

  /**
   * Get user profile
   */
  getProfile(userId: string): UserProfile | undefined {
    return this.profiles.get(userId);
  }

  /**
   * Get all profiles
   */
  getAllProfiles(): UserProfile[] {
    return Array.from(this.profiles.values());
  }

  /**
   * Save profiles to disk
   */
  async saveProfiles(): Promise<void> {
    const data = Array.from(this.profiles.values()).map(p => ({
      ...p,
      expertise: Array.from(p.expertise.entries()),
      relationships: {
        ...p.relationships,
        mentionCount: Array.from(p.relationships.mentionCount.entries())
      }
    }));

    await this.storage.save('user_profiles.json', data);
    console.log(`💾 Saved ${data.length} user profiles`);
  }

  /**
   * Load profiles from disk
   */
  async loadProfiles(): Promise<void> {
    try {
      const data = await this.storage.load('user_profiles.json') as any[];
      if (!data) return;

      for (const p of data) {
        this.profiles.set(p.userId, {
          ...p,
          expertise: new Map(p.expertise),
          relationships: {
            ...p.relationships,
            mentionCount: new Map(p.relationships.mentionCount)
          },
          lastAnalyzed: new Date(p.lastAnalyzed),
          activityPattern: {
            ...p.activityPattern,
            lastSeen: new Date(p.activityPattern.lastSeen)
          }
        });
      }

      console.log(`📂 Loaded ${this.profiles.size} user profiles`);
    } catch (error) {
      console.error('Failed to load profiles:', error);
    }
  }
}
