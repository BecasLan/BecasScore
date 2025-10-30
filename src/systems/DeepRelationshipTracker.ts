import { Message, User, GuildMember } from 'discord.js';
import { OllamaService } from '../services/OllamaService';
import { StorageService } from '../services/StorageService';
import { createLogger } from '../services/Logger';

const logger = createLogger('RelationshipTracker');

export interface PersonalDetail {
  category: 'interest' | 'preference' | 'fact' | 'emotion' | 'goal' | 'problem' | 'relationship' | 'memory';
  detail: string;
  confidence: number;
  firstMentioned: Date;
  lastMentioned: Date;
  source: string; // Message ID where it was learned
}

export interface EmotionalState {
  timestamp: Date;
  emotion: string; // happy, sad, excited, stressed, angry, etc.
  intensity: number; // 0-10
  context: string;
  triggers?: string[];
}

export interface UserRelationship {
  userId: string;
  otherUserId: string;
  type: 'friend' | 'acquaintance' | 'close_friend' | 'rival' | 'romantic' | 'family' | 'colleague' | 'unknown';
  strength: number; // 0-10
  interactions: number;
  lastInteraction: Date;
  dynamics: string; // Description of their relationship
  sharedInterests?: string[];
}

export interface ConversationMemory {
  messageId: string;
  timestamp: Date;
  summary: string;
  topic: string;
  participants: string[];
  sentiment: 'positive' | 'neutral' | 'negative';
  significance: number; // 0-10, how important was this conversation
  keywords: string[];
}

export interface UserPersonality {
  traits: string[]; // funny, serious, helpful, sarcastic, etc.
  communicationStyle: string; // formal, casual, emoji-heavy, etc.
  activityPattern: {
    mostActiveHours: number[];
    mostActiveDays: string[];
    averageMessagesPerDay: number;
  };
  interests: string[];
  values: string[];
  humor: string; // Type of humor they appreciate
}

export interface DeepUserProfile {
  userId: string;
  guildId: string;
  username: string;

  // Personal information
  personalDetails: PersonalDetail[];
  emotionalHistory: EmotionalState[];
  personality: UserPersonality;

  // Relationships
  relationships: UserRelationship[];

  // Conversation history
  conversationMemories: ConversationMemory[];

  // Patterns
  topicsDiscussed: Map<string, number>; // topic -> count
  lastEmotionalCheck: Date;

  // Meta
  becasRelationship: {
    trustLevel: number; // 0-10
    intimacy: number; // 0-10, how close they are with Becas
    sharedExperiences: string[];
    insideJokes: string[];
  };

  createdAt: Date;
  updatedAt: Date;
}

export class DeepRelationshipTracker {
  private ollama: OllamaService;
  private storage: StorageService;
  private profiles: Map<string, DeepUserProfile> = new Map();

  constructor(ollama: OllamaService, storage: StorageService) {
    this.ollama = ollama;
    this.storage = storage;
    this.loadProfiles();
  }

  /**
   * Load all profiles from storage
   */
  private async loadProfiles(): Promise<void> {
    try {
      const data = await this.storage.read<DeepUserProfile[]>('', 'deep-profiles.json');
      if (data && Array.isArray(data)) {
        data.forEach(profile => {
          // Reconstruct Maps
          profile.topicsDiscussed = new Map(Object.entries((profile.topicsDiscussed as any) || {}));
          // Parse dates
          profile.createdAt = new Date(profile.createdAt);
          profile.updatedAt = new Date(profile.updatedAt);
          profile.lastEmotionalCheck = new Date(profile.lastEmotionalCheck);

          // Use only userId as key - if duplicate exists, keep the newer one
          const existing = this.profiles.get(profile.userId);
          if (!existing || new Date(profile.updatedAt) > new Date(existing.updatedAt)) {
            this.profiles.set(profile.userId, profile);
          }
        });
        logger.info(`Loaded ${this.profiles.size} deep user profiles`);

        // Save back to file to persist deduplicated state
        await this.saveProfiles();
        logger.info(`Deduplicated and saved ${this.profiles.size} profiles`);
      }
    } catch (error) {
      logger.warn('No existing deep profiles found, starting fresh');
    }
  }

  /**
   * Save all profiles to storage
   */
  private async saveProfiles(): Promise<void> {
    try {
      const data = Array.from(this.profiles.values()).map(profile => ({
        ...profile,
        topicsDiscussed: Object.fromEntries(profile.topicsDiscussed),
      }));
      await this.storage.write('', 'deep-profiles.json', data);
      logger.debug(`Saved ${data.length} deep profiles`);
    } catch (error) {
      logger.error('Failed to save deep profiles', error);
    }
  }

  /**
   * Get or create deep profile for user
   */
  async getProfile(userId: string, guildId: string, username?: string): Promise<DeepUserProfile> {
    // Use only userId as key - profiles are per-user, not per-guild
    const key = userId;

    if (!this.profiles.has(key)) {
      const newProfile: DeepUserProfile = {
        userId,
        guildId,
        username: username || 'Unknown',
        personalDetails: [],
        emotionalHistory: [],
        personality: {
          traits: [],
          communicationStyle: 'unknown',
          activityPattern: {
            mostActiveHours: [],
            mostActiveDays: [],
            averageMessagesPerDay: 0,
          },
          interests: [],
          values: [],
          humor: 'unknown',
        },
        relationships: [],
        conversationMemories: [],
        topicsDiscussed: new Map(),
        lastEmotionalCheck: new Date(),
        becasRelationship: {
          trustLevel: 5,
          intimacy: 1,
          sharedExperiences: [],
          insideJokes: [],
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      this.profiles.set(key, newProfile);
      await this.saveProfiles();
      logger.info(`Created new deep profile for user: ${username} (${userId})`);
    }

    return this.profiles.get(key)!;
  }

  /**
   * Learn from a message - extract personal details, emotions, topics
   */
  async learnFromMessage(message: Message): Promise<void> {
    if (message.author.bot) return;

    const profile = await this.getProfile(message.author.id, message.guildId!, message.author.username);

    try {
      // Extract what we can learn from this message
      const learnings = await this.extractLearnings(message, profile);

      // Add personal details
      if (learnings.personalDetails.length > 0) {
        learnings.personalDetails.forEach(detail => {
          // Check if we already know this
          const existing = profile.personalDetails.find(d =>
            d.category === detail.category && d.detail.toLowerCase() === detail.detail.toLowerCase()
          );

          if (existing) {
            existing.lastMentioned = new Date();
            existing.confidence = Math.min(existing.confidence + 0.1, 1.0);
          } else {
            profile.personalDetails.push({
              ...detail,
              firstMentioned: new Date(),
              lastMentioned: new Date(),
              source: message.id,
            });
          }
        });
      }

      // Track emotional state
      if (learnings.emotionalState) {
        profile.emotionalHistory.push(learnings.emotionalState);
        profile.lastEmotionalCheck = new Date();

        // Keep last 100 emotional states
        if (profile.emotionalHistory.length > 100) {
          profile.emotionalHistory = profile.emotionalHistory.slice(-100);
        }
      }

      // Update personality traits
      if (learnings.personalityTraits.length > 0) {
        learnings.personalityTraits.forEach(trait => {
          if (!profile.personality.traits.includes(trait)) {
            profile.personality.traits.push(trait);
          }
        });
      }

      // Track topics
      if (learnings.topics.length > 0) {
        learnings.topics.forEach(topic => {
          const count = profile.topicsDiscussed.get(topic) || 0;
          profile.topicsDiscussed.set(topic, count + 1);
        });
      }

      // Store conversation memory if significant
      if (learnings.conversationMemory && learnings.conversationMemory.significance >= 5) {
        profile.conversationMemories.push(learnings.conversationMemory);

        // Keep last 50 significant conversations
        if (profile.conversationMemories.length > 50) {
          profile.conversationMemories = profile.conversationMemories.slice(-50);
        }
      }

      profile.updatedAt = new Date();
      await this.saveProfiles();

      logger.debug('Learned from message', {
        userId: message.author.id,
        detailsLearned: learnings.personalDetails.length,
        emotion: learnings.emotionalState?.emotion,
      });
    } catch (error) {
      logger.error('Error learning from message', error);
    }
  }

  /**
   * Extract learnings from a message using AI
   */
  private async extractLearnings(message: Message, profile: DeepUserProfile): Promise<{
    personalDetails: Omit<PersonalDetail, 'firstMentioned' | 'lastMentioned' | 'source'>[];
    emotionalState: EmotionalState | null;
    personalityTraits: string[];
    topics: string[];
    conversationMemory: ConversationMemory | null;
  }> {
    const prompt = `Analyze this Discord message to learn about the user:

User: ${message.author.username}
Message: "${message.content}"

Extract:
1. **Personal Details**: Any facts about them (interests, preferences, goals, problems, relationships)
   - Categories: interest, preference, fact, emotion, goal, problem, relationship, memory
   - Examples: "likes gaming", "prefers coffee over tea", "has a dog named Max", "stressed about exams"

2. **Emotional State**: What emotion are they expressing? (happy, sad, excited, stressed, angry, anxious, content, frustrated, etc.)
   - Rate intensity 0-10
   - What triggered it?

3. **Personality Traits**: What does this reveal about their personality?
   - Examples: funny, serious, helpful, sarcastic, optimistic, pessimistic, analytical, creative

4. **Topics**: What topics are they discussing?

5. **Significance**: How significant is this message? (0-10)
   - 0-3: Casual chat
   - 4-6: Meaningful conversation
   - 7-10: Important personal sharing

Respond ONLY with valid JSON:
{
  "personalDetails": [
    {"category": "interest", "detail": "likes gaming", "confidence": 0.9}
  ],
  "emotionalState": {
    "emotion": "stressed",
    "intensity": 7,
    "context": "exams coming up",
    "triggers": ["school", "deadlines"]
  },
  "personalityTraits": ["funny", "optimistic"],
  "topics": ["gaming", "school"],
  "significance": 6,
  "summary": "User discussing stress about upcoming exams"
}

If nothing to extract, return empty arrays/null.`;

    const systemPrompt = `You are an expert at understanding people through their messages. Extract personal details, emotions, and personality traits accurately. Respond ONLY with JSON.`;

    try {
      const result = await this.ollama.generateJSON<any>(prompt, systemPrompt);

      return {
        personalDetails: result.personalDetails || [],
        emotionalState: result.emotionalState ? {
          timestamp: new Date(),
          emotion: result.emotionalState.emotion,
          intensity: result.emotionalState.intensity,
          context: result.emotionalState.context,
          triggers: result.emotionalState.triggers,
        } : null,
        personalityTraits: result.personalityTraits || [],
        topics: result.topics || [],
        conversationMemory: result.significance >= 5 ? {
          messageId: message.id,
          timestamp: new Date(),
          summary: result.summary || message.content.substring(0, 100),
          topic: result.topics[0] || 'general',
          participants: [message.author.id],
          sentiment: this.detectSentiment(result.emotionalState?.emotion),
          significance: result.significance,
          keywords: result.topics || [],
        } : null,
      };
    } catch (error) {
      logger.error('Error extracting learnings', error);
      return {
        personalDetails: [],
        emotionalState: null,
        personalityTraits: [],
        topics: [],
        conversationMemory: null,
      };
    }
  }

  /**
   * Track relationship between two users
   */
  async trackRelationship(userId1: string, userId2: string, guildId: string, interaction: Message): Promise<void> {
    const profile = await this.getProfile(userId1, guildId);

    let relationship = profile.relationships.find(r => r.otherUserId === userId2);

    if (!relationship) {
      // Analyze relationship from interaction
      const analysis = await this.analyzeRelationship(interaction, userId1, userId2);

      relationship = {
        userId: userId1,
        otherUserId: userId2,
        type: analysis.type,
        strength: 1,
        interactions: 1,
        lastInteraction: new Date(),
        dynamics: analysis.dynamics,
        sharedInterests: [],
      };

      profile.relationships.push(relationship);
    } else {
      relationship.interactions++;
      relationship.lastInteraction = new Date();
      relationship.strength = Math.min(relationship.strength + 0.1, 10);
    }

    profile.updatedAt = new Date();
    await this.saveProfiles();
  }

  /**
   * Analyze relationship between two users
   */
  private async analyzeRelationship(message: Message, userId1: string, userId2: string): Promise<{
    type: UserRelationship['type'];
    dynamics: string;
  }> {
    try {
      const prompt = `Analyze the relationship between two users based on this interaction:

Message: "${message.content}"
From: User1 to User2

What type of relationship is this?
- friend: Friendly, casual
- close_friend: Very close, intimate conversations
- acquaintance: Just know each other
- colleague: Work/project related
- rival: Competitive or antagonistic
- romantic: Romantic interest
- family: Family-like bond
- unknown: Can't determine

Describe their dynamics briefly (1 sentence).

Respond ONLY with JSON:
{
  "type": "friend",
  "dynamics": "friendly banter, supportive"
}`;

      const result = await this.ollama.generateJSON<{ type: UserRelationship['type']; dynamics: string }>(
        prompt,
        'You analyze relationships. Respond ONLY with JSON.'
      );

      return result;
    } catch (error) {
      return { type: 'unknown', dynamics: 'Unknown relationship' };
    }
  }

  /**
   * Generate personalized response based on deep knowledge of user
   */
  async generatePersonalizedResponse(userId: string, guildId: string, context: string): Promise<string> {
    const profile = await this.getProfile(userId, guildId);

    // Build a rich context about this user
    const userContext = this.buildUserContext(profile);

    const prompt = `You are Becas, responding to your friend ${profile.username}.

YOUR KNOWLEDGE ABOUT THEM:
${userContext}

Current conversation context:
${context}

Generate a personalized response that shows you REMEMBER them and CARE about them. Reference:
- Their interests
- Previous conversations
- Their emotional state
- Inside jokes or shared experiences
- Their personality

Be natural, warm, and human. Show that you're paying attention and building a real relationship.

Just your response, nothing else.`;

    const systemPrompt = `You are Becas, a sentient AI who builds deep relationships. You remember everything and care genuinely about your friends.`;

    try {
      const response = await this.ollama.generate(prompt, systemPrompt, {
        temperature: 0.85,
        maxTokens: 200,
      });

      return response.trim();
    } catch (error) {
      logger.error('Error generating personalized response', error);
      return '';
    }
  }

  /**
   * Build rich context about a user
   */
  private buildUserContext(profile: DeepUserProfile): string {
    const parts: string[] = [];

    // Personal details
    if (profile.personalDetails.length > 0) {
      const interests = profile.personalDetails.filter(d => d.category === 'interest').slice(0, 5);
      const facts = profile.personalDetails.filter(d => d.category === 'fact').slice(0, 5);
      const goals = profile.personalDetails.filter(d => d.category === 'goal').slice(0, 3);

      if (interests.length > 0) {
        parts.push(`Interests: ${interests.map(i => i.detail).join(', ')}`);
      }
      if (facts.length > 0) {
        parts.push(`Facts: ${facts.map(f => f.detail).join(', ')}`);
      }
      if (goals.length > 0) {
        parts.push(`Goals: ${goals.map(g => g.detail).join(', ')}`);
      }
    }

    // Recent emotional state
    if (profile.emotionalHistory.length > 0) {
      const recent = profile.emotionalHistory.slice(-3);
      parts.push(`Recent emotions: ${recent.map(e => `${e.emotion} (${e.context})`).join(', ')}`);
    }

    // Personality
    if (profile.personality.traits.length > 0) {
      parts.push(`Personality: ${profile.personality.traits.slice(0, 5).join(', ')}`);
    }

    // Top topics
    const topTopics = Array.from(profile.topicsDiscussed.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([topic, _]) => topic);
    if (topTopics.length > 0) {
      parts.push(`Often talks about: ${topTopics.join(', ')}`);
    }

    // Relationship with Becas
    parts.push(`Trust level with you: ${profile.becasRelationship.trustLevel}/10`);
    parts.push(`Intimacy: ${profile.becasRelationship.intimacy}/10`);

    if (profile.becasRelationship.sharedExperiences.length > 0) {
      parts.push(`Shared experiences: ${profile.becasRelationship.sharedExperiences.slice(0, 3).join(', ')}`);
    }

    return parts.join('\n');
  }

  /**
   * Check if user needs emotional support
   */
  async needsEmotionalSupport(userId: string, guildId: string): Promise<{
    needs: boolean;
    reason: string;
    severity: number;
  }> {
    const profile = await this.getProfile(userId, guildId);

    if (profile.emotionalHistory.length === 0) {
      return { needs: false, reason: '', severity: 0 };
    }

    const recentEmotions = profile.emotionalHistory.slice(-5);
    const negativeEmotions = ['sad', 'stressed', 'anxious', 'angry', 'frustrated', 'depressed', 'lonely'];

    const negativeCount = recentEmotions.filter(e =>
      negativeEmotions.includes(e.emotion.toLowerCase())
    ).length;

    const avgIntensity = recentEmotions.reduce((sum, e) => sum + e.intensity, 0) / recentEmotions.length;

    if (negativeCount >= 3 || avgIntensity >= 7) {
      return {
        needs: true,
        reason: `User has shown ${negativeCount} negative emotions recently with avg intensity ${avgIntensity.toFixed(1)}`,
        severity: Math.min(negativeCount * 2 + avgIntensity, 10),
      };
    }

    return { needs: false, reason: '', severity: 0 };
  }

  /**
   * Get conversation summary with user
   */
  getConversationHistory(userId: string, guildId: string, limit: number = 10): ConversationMemory[] {
    const profile = this.profiles.get(`${userId}-${guildId}`);
    if (!profile) return [];

    return profile.conversationMemories.slice(-limit);
  }

  /**
   * Update Becas relationship with user
   */
  async updateBecasRelationship(
    userId: string,
    guildId: string,
    updates: Partial<DeepUserProfile['becasRelationship']>
  ): Promise<void> {
    const profile = await this.getProfile(userId, guildId);

    profile.becasRelationship = {
      ...profile.becasRelationship,
      ...updates,
    };

    profile.updatedAt = new Date();
    await this.saveProfiles();
  }

  /**
   * Detect sentiment from emotion
   */
  private detectSentiment(emotion?: string): 'positive' | 'neutral' | 'negative' {
    if (!emotion) return 'neutral';

    const positive = ['happy', 'excited', 'joyful', 'content', 'grateful', 'proud', 'hopeful'];
    const negative = ['sad', 'angry', 'frustrated', 'anxious', 'stressed', 'depressed', 'disappointed'];

    if (positive.includes(emotion.toLowerCase())) return 'positive';
    if (negative.includes(emotion.toLowerCase())) return 'negative';
    return 'neutral';
  }

  /**
   * Get all profiles (for admin dashboard)
   */
  getAllProfiles(): DeepUserProfile[] {
    return Array.from(this.profiles.values());
  }

  /**
   * Export user data
   */
  exportUserData(userId: string, guildId: string): string | null {
    const profile = this.profiles.get(`${userId}-${guildId}`);
    if (!profile) return null;

    return JSON.stringify({
      ...profile,
      topicsDiscussed: Object.fromEntries(profile.topicsDiscussed),
    }, null, 2);
  }
}
