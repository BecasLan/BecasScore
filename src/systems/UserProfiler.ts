// UserProfiler.ts - Deep behavioral profiling and anomaly detection

import { StorageService } from '../services/StorageService';
import { OllamaService } from '../services/OllamaService';
import { AnalyzedMessage } from '../types/Message.types';

export interface UserProfile {
  userId: string;
  userName: string;
  guildId: string;

  // Behavioral baseline
  avgToxicity: number;
  avgMessageLength: number;
  commonTopics: string[];
  typicalSentiment: string;
  activeHours: number[]; // Hours of day when active
  messagingFrequency: number; // Messages per hour average

  // Patterns
  usesEmoji: boolean;
  usesSlang: boolean;
  languageStyle: string;

  // Anomaly detection
  recentAnomalies: {
    type: string;
    severity: number;
    timestamp: Date;
    description: string;
  }[];

  // Metadata
  firstSeen: Date;
  lastSeen: Date;
  messageCount: number;
}

export interface AnomalyDetection {
  isAnomaly: boolean;
  type: 'behavior_change' | 'account_takeover' | 'bot_activity' | 'none';
  confidence: number;
  reasoning: string;
  suggestedAction?: string;
}

export class UserProfiler {
  private storage: StorageService;
  private ollama: OllamaService;
  private profiles: Map<string, UserProfile> = new Map();

  constructor(storage: StorageService) {
    this.storage = storage;
    this.ollama = new OllamaService('analysis');
    this.loadProfiles();
  }

  private async loadProfiles(): Promise<void> {
    try {
      const data = await this.storage.read<any>('profiles', 'user_profiles.json');
      if (data && data.profiles) {
        Object.entries(data.profiles).forEach(([key, profile]: [string, any]) => {
          profile.firstSeen = new Date(profile.firstSeen);
          profile.lastSeen = new Date(profile.lastSeen);
          profile.recentAnomalies = profile.recentAnomalies.map((a: any) => ({
            ...a,
            timestamp: new Date(a.timestamp),
          }));
          this.profiles.set(key, profile);
        });
        console.log(`✓ Loaded ${this.profiles.size} user profiles`);
      }
    } catch (error) {
      console.log('No existing profiles, starting fresh');
    }
  }

  /**
   * Update profile with new message
   */
  async updateProfile(message: AnalyzedMessage): Promise<void> {
    const key = `${message.guildId}:${message.authorId}`;
    let profile = this.profiles.get(key);

    if (!profile) {
      profile = this.createNewProfile(message);
      this.profiles.set(key, profile);
    }

    // Update baseline metrics
    profile.messageCount++;
    profile.avgToxicity = (profile.avgToxicity * (profile.messageCount - 1) + message.toxicity) / profile.messageCount;
    profile.avgMessageLength = (profile.avgMessageLength * (profile.messageCount - 1) + message.content.length) / profile.messageCount;
    profile.typicalSentiment = message.sentiment.dominant;
    profile.lastSeen = new Date();

    // Update activity hours
    const hour = new Date().getHours();
    if (!profile.activeHours.includes(hour)) {
      profile.activeHours.push(hour);
    }

    await this.saveProfiles();
  }

  /**
   * Detect anomalies in user behavior
   */
  async detectAnomaly(message: AnalyzedMessage): Promise<AnomalyDetection> {
    const key = `${message.guildId}:${message.authorId}`;
    const profile = this.profiles.get(key);

    if (!profile || profile.messageCount < 20) {
      // Need baseline data
      return {
        isAnomaly: false,
        type: 'none',
        confidence: 0,
        reasoning: 'Insufficient data for baseline',
      };
    }

    try {
      const prompt = `Analyze this message for behavioral anomalies:

CURRENT MESSAGE:
"${message.content}"
- Toxicity: ${(message.toxicity * 100).toFixed(0)}%
- Sentiment: ${message.sentiment.dominant}
- Length: ${message.content.length} chars

USER BASELINE:
- Avg toxicity: ${(profile.avgToxicity * 100).toFixed(0)}%
- Avg sentiment: ${profile.typicalSentiment}
- Avg length: ${profile.avgMessageLength.toFixed(0)} chars
- Messages: ${profile.messageCount}
- Style: ${profile.languageStyle}

ANOMALIES TO DETECT:
1. Sudden change in toxicity (+30%+)
2. Dramatically different writing style
3. Unusual activity hours
4. Bot-like behavior (repetitive, unnatural)
5. Account takeover signs

Is this message anomalous compared to user's baseline?`;

      const systemPrompt = `You detect account takeovers and behavioral anomalies. High confidence only for clear deviations.`;

      const schema = `{
  "isAnomaly": boolean,
  "type": "behavior_change" | "account_takeover" | "bot_activity" | "none",
  "confidence": number,
  "reasoning": string,
  "suggestedAction": string
}`;

      const result = await this.ollama.generateJSON<AnomalyDetection>(
        prompt,
        systemPrompt,
        schema
      );

      if (result.isAnomaly) {
        console.log(`🚨 ANOMALY DETECTED: ${result.type} (${(result.confidence * 100).toFixed(0)}%)`);
        console.log(`   User: ${message.authorName}`);
        console.log(`   Reasoning: ${result.reasoning}`);

        // Record anomaly
        profile.recentAnomalies.push({
          type: result.type,
          severity: result.confidence,
          timestamp: new Date(),
          description: result.reasoning,
        });

        // Keep only last 10 anomalies
        if (profile.recentAnomalies.length > 10) {
          profile.recentAnomalies = profile.recentAnomalies.slice(-10);
        }

        await this.saveProfiles();
      }

      return result;
    } catch (error) {
      console.error('Anomaly detection failed:', error);
      return {
        isAnomaly: false,
        type: 'none',
        confidence: 0,
        reasoning: 'Analysis failed',
      };
    }
  }

  /**
   * Create new profile
   */
  private createNewProfile(message: AnalyzedMessage): UserProfile {
    return {
      userId: message.authorId,
      userName: message.authorName,
      guildId: message.guildId,
      avgToxicity: message.toxicity,
      avgMessageLength: message.content.length,
      commonTopics: [],
      typicalSentiment: message.sentiment.dominant,
      activeHours: [new Date().getHours()],
      messagingFrequency: 0,
      usesEmoji: /[\u{1F600}-\u{1F6FF}]/u.test(message.content),
      usesSlang: false,
      languageStyle: 'casual',
      recentAnomalies: [],
      firstSeen: new Date(),
      lastSeen: new Date(),
      messageCount: 1,
    };
  }

  /**
   * Get profile
   */
  getProfile(userId: string, guildId: string): UserProfile | undefined {
    const key = `${guildId}:${userId}`;
    return this.profiles.get(key);
  }

  /**
   * Save profiles to storage
   */
  private async saveProfiles(): Promise<void> {
    const data = {
      profiles: Object.fromEntries(this.profiles),
      lastUpdated: new Date().toISOString(),
    };
    await this.storage.write('profiles', 'user_profiles.json', data);
  }
}
