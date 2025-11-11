// MemoryManager.ts

import { ShortTermMemory, LongTermMemory, UserProfile, Interaction } from '../types/Memory.types';
import { AnalyzedMessage } from '../types/Message.types';
import { StorageService } from '../services/StorageService';
import { OllamaService } from '../services/OllamaService';

export class MemoryManager {
  private storage: StorageService;
  private llm: OllamaService;
  private shortTermMemories: Map<string, ShortTermMemory> = new Map();
  private longTermMemories: Map<string, LongTermMemory> = new Map();

  constructor(storage: StorageService) {
    this.storage = storage;
    this.llm = new OllamaService('analysis');
    this.loadMemories();
  }

  /**
   * Load memories from storage
   */
  private async loadMemories(): Promise<void> {
    const longTerm = await this.storage.read<{ users: Record<string, LongTermMemory> }>(
      'memories',
      'long_term.json'
    );

    if (longTerm?.users) {
      Object.entries(longTerm.users).forEach(([key, memory]) => {
        this.longTermMemories.set(key, memory);
      });
    }
  }

  /**
   * Add message to short-term memory
   */
  async addToShortTerm(message: AnalyzedMessage, conversationId: string): Promise<void> {
    let memory = this.shortTermMemories.get(conversationId);

    if (!memory) {
      memory = {
        conversationId,
        messages: [],
        participants: new Set(),
        context: '',
        startTime: new Date(),
        lastActivity: new Date(),
        emotionalTone: message.sentiment,
      };
      this.shortTermMemories.set(conversationId, memory);
    }

    memory.messages.push(message);
    memory.participants.add(message.authorId);
    memory.lastActivity = new Date();

    // Keep only last 50 messages
    if (memory.messages.length > 50) {
      memory.messages = memory.messages.slice(-50);
    }

    // Update emotional tone (average of recent messages)
    const recentMessages = memory.messages.slice(-10);
    memory.emotionalTone = this.calculateAverageSentiment(recentMessages);
  }

  /**
   * Get short-term context
   */
  getShortTermContext(conversationId: string, lastN: number = 10): string {
    const memory = this.shortTermMemories.get(conversationId);
    if (!memory) return '';

    const recentMessages = memory.messages.slice(-lastN);
    return recentMessages
      .map(m => `${m.authorName}: ${m.content}`)
      .join('\n');
  }

  /**
   * Update long-term memory for user
   */
  async updateLongTerm(
    userId: string,
    guildId: string,
    interaction: Interaction
  ): Promise<void> {
    const key = `${guildId}:${userId}`;
    let memory = this.longTermMemories.get(key);

    if (!memory) {
      memory = {
        userId,
        userName: '',
        guildId,
        profile: this.createDefaultProfile(),
        interactions: [],
        patterns: [],
        summary: '',
        lastSeen: new Date(),
      };
      this.longTermMemories.set(key, memory);
    }

    memory.interactions.push(interaction);
    memory.lastSeen = new Date();

    // Update profile based on interaction
    this.updateProfile(memory.profile, interaction);

    // Keep only last 200 interactions
    if (memory.interactions.length > 200) {
      memory.interactions = memory.interactions.slice(-200);
    }

    // Regenerate summary periodically
    if (memory.interactions.length % 20 === 0) {
      memory.summary = await this.generateUserSummary(memory);
    }

    await this.saveLongTermMemories();
  }

  /**
   * Get user summary
   */
  getUserSummary(userId: string, guildId: string): string | undefined {
    const key = `${guildId}:${userId}`;
    return this.longTermMemories.get(key)?.summary;
  }

  /**
   * Get user profile
   */
  getUserProfile(userId: string, guildId: string): UserProfile | undefined {
    const key = `${guildId}:${userId}`;
    return this.longTermMemories.get(key)?.profile;
  }

  /**
   * Create default user profile
   */
  private createDefaultProfile(): UserProfile {
    return {
      trustScore: 100,
      preferredTopics: [],
      communicationStyle: 'unknown',
      helpfulness: 0.5,
      conflictTendency: 0.3,
      emotionalStability: 0.7,
      authorityResponse: 'neutral',
    };
  }

  /**
   * Update profile based on interaction
   */
  private updateProfile(profile: UserProfile, interaction: Interaction): void {
    const weight = 0.1; // Learning rate

    switch (interaction.type) {
      case 'positive':
        profile.helpfulness = Math.min(1, profile.helpfulness + weight);
        profile.emotionalStability = Math.min(1, profile.emotionalStability + weight * 0.5);
        break;

      case 'negative':
        profile.conflictTendency = Math.min(1, profile.conflictTendency + weight);
        profile.emotionalStability = Math.max(0, profile.emotionalStability - weight * 0.3);
        break;

      case 'governance':
        // Observe how they respond to authority
        if (interaction.description.includes('complied') || interaction.description.includes('accepted')) {
          profile.authorityResponse = 'respectful';
        } else if (interaction.description.includes('argued') || interaction.description.includes('resisted')) {
          profile.authorityResponse = 'resistant';
        }
        break;
    }
  }

  /**
   * Generate user summary using LLM
   */
  private async generateUserSummary(memory: LongTermMemory): Promise<string> {
    const recentInteractions = memory.interactions.slice(-20);
    const interactionSummary = recentInteractions
      .map(i => `${i.type}: ${i.description}`)
      .join('\n');

    const prompt = `Based on these interactions, create a brief 2-3 sentence personality summary for this user:

${interactionSummary}

Focus on: communication style, helpfulness, conflict tendency, and overall behavior patterns.`;

    const systemPrompt = 'You are a behavioral analyst. Be objective and insightful.';

    try {
      return await this.llm.generate(prompt, systemPrompt, { temperature: 0.6, maxTokens: 150 });
    } catch (error) {
      console.error('Summary generation error:', error);
      return 'User profile being developed.';
    }
  }

  /**
   * Calculate average sentiment
   */
  private calculateAverageSentiment(messages: AnalyzedMessage[]): any {
    if (messages.length === 0) {
      return { positive: 0, negative: 0, neutral: 1, dominant: 'neutral', emotions: [] };
    }

    const avg = messages.reduce(
      (acc, m) => ({
        positive: acc.positive + m.sentiment.positive,
        negative: acc.negative + m.sentiment.negative,
        neutral: acc.neutral + m.sentiment.neutral,
      }),
      { positive: 0, negative: 0, neutral: 0 }
    );

    const count = messages.length;
    avg.positive /= count;
    avg.negative /= count;
    avg.neutral /= count;

    let dominant: 'positive' | 'negative' | 'neutral' = 'neutral';
    if (avg.positive > avg.negative && avg.positive > avg.neutral) dominant = 'positive';
    else if (avg.negative > avg.positive && avg.negative > avg.neutral) dominant = 'negative';

    return { ...avg, dominant, emotions: [] };
  }

  /**
   * Save long-term memories
   */
  private async saveLongTermMemories(): Promise<void> {
    const users: Record<string, LongTermMemory> = {};
    this.longTermMemories.forEach((memory, key) => {
      users[key] = memory;
    });
    await this.storage.write('memories', 'long_term.json', { users });
  }

  /**
   * Clean old short-term memories
   */
  cleanupShortTerm(maxAge: number = 3600000): void {
    const now = Date.now();
    for (const [key, memory] of this.shortTermMemories.entries()) {
      if (now - memory.lastActivity.getTime() > maxAge) {
        this.shortTermMemories.delete(key);
      }
    }
  }
}