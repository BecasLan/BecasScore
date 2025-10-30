// ConflictPredictor.ts - Predict and prevent conflicts before they escalate

import { OllamaService } from '../services/OllamaService';
import { AnalyzedMessage } from '../types/Message.types';

export interface ConflictPrediction {
  riskLevel: 'none' | 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
  indicators: string[];
  reasoning: string;
  suggestedIntervention?: string;
  involvedUsers: string[];
}

export interface TensionMetrics {
  channelId: string;
  tensionScore: number; // 0-1
  recentMessages: string[];
  participantIds: string[];
  escalationRate: number; // How fast tension is rising
  lastUpdated: Date;
}

export class ConflictPredictor {
  private ollama: OllamaService;
  private channelTension: Map<string, TensionMetrics> = new Map();

  constructor() {
    this.ollama = new OllamaService('analysis');
  }

  /**
   * Analyze message for conflict indicators
   */
  async analyzeForConflict(
    message: AnalyzedMessage,
    recentContext: string[]
  ): Promise<ConflictPrediction> {
    try {
      const channelKey = `${message.guildId}:${message.channelId}`;
      const tension = this.channelTension.get(channelKey);

      const prompt = `Analyze this conversation for conflict risk:

CURRENT MESSAGE:
${message.authorName}: "${message.content}"

RECENT CONTEXT:
${recentContext.slice(-5).join('\n')}

${tension ? `CHANNEL TENSION: ${(tension.tensionScore * 100).toFixed(0)}%` : ''}

MESSAGE METRICS:
- Toxicity: ${(message.toxicity * 100).toFixed(0)}%
- Sentiment: ${message.sentiment.dominant}
- Negative emotion: ${(message.sentiment.negative * 100).toFixed(0)}%

Predict:
1. Will this escalate into a fight?
2. Are multiple users getting involved?
3. Is tension building?
4. Should moderator intervene NOW?

Respond with:
- riskLevel: "none" | "low" | "medium" | "high" | "critical"
- confidence: 0-1
- indicators: array of warning signs
- reasoning: why you think conflict might occur
- suggestedIntervention: what should be done (or null)
- involvedUsers: array of usernames involved in tension`;

      const systemPrompt = `You are a conflict prevention AI. Predict drama before it happens. High confidence only for real risks.`;

      const schema = `{
  "riskLevel": string,
  "confidence": number,
  "indicators": string[],
  "reasoning": string,
  "suggestedIntervention": string,
  "involvedUsers": string[]
}`;

      const result = await this.ollama.generateJSON<ConflictPrediction>(
        prompt,
        systemPrompt,
        schema
      );

      // Update channel tension
      this.updateTension(channelKey, result.riskLevel, message);

      if (result.riskLevel !== 'none') {
        console.log(`⚠️ CONFLICT RISK: ${result.riskLevel.toUpperCase()} (${(result.confidence * 100).toFixed(0)}%)`);
        console.log(`   Indicators: ${result.indicators.join(', ')}`);
      }

      return result;
    } catch (error) {
      console.error('Conflict prediction failed:', error);
      return {
        riskLevel: 'none',
        confidence: 0,
        indicators: [],
        reasoning: 'Analysis unavailable',
        involvedUsers: [],
      };
    }
  }

  /**
   * Update channel tension metrics
   */
  private updateTension(
    channelKey: string,
    riskLevel: string,
    message: AnalyzedMessage
  ): void {
    let tension = this.channelTension.get(channelKey);

    if (!tension) {
      tension = {
        channelId: channelKey,
        tensionScore: 0,
        recentMessages: [],
        participantIds: [],
        escalationRate: 0,
        lastUpdated: new Date(),
      };
      this.channelTension.set(channelKey, tension);
    }

    // Calculate tension score based on risk level
    const riskScores = {
      none: 0,
      low: 0.2,
      medium: 0.5,
      high: 0.75,
      critical: 1.0,
    };

    const newScore = riskScores[riskLevel as keyof typeof riskScores];
    const previousScore = tension.tensionScore;

    // Weighted average (70% new, 30% old)
    tension.tensionScore = newScore * 0.7 + previousScore * 0.3;

    // Calculate escalation rate
    tension.escalationRate = newScore - previousScore;

    // Track participants
    if (!tension.participantIds.includes(message.authorId)) {
      tension.participantIds.push(message.authorId);
    }

    // Keep last 10 messages
    tension.recentMessages.push(`${message.authorName}: ${message.content.substring(0, 100)}`);
    if (tension.recentMessages.length > 10) {
      tension.recentMessages = tension.recentMessages.slice(-10);
    }

    tension.lastUpdated = new Date();

    // Auto-decay tension over time
    this.decayTension();
  }

  /**
   * Decay tension naturally over time
   */
  private decayTension(): void {
    const now = Date.now();
    for (const [key, tension] of this.channelTension.entries()) {
      const minutesSinceUpdate = (now - tension.lastUpdated.getTime()) / 60000;

      if (minutesSinceUpdate > 5) {
        // Decay 10% per 5 minutes
        tension.tensionScore *= 0.9;

        if (tension.tensionScore < 0.05) {
          this.channelTension.delete(key);
        }
      }
    }
  }

  /**
   * Get current tension for a channel
   */
  getChannelTension(guildId: string, channelId: string): TensionMetrics | undefined {
    const key = `${guildId}:${channelId}`;
    return this.channelTension.get(key);
  }

  /**
   * Get all high-tension channels
   */
  getHighTensionChannels(): TensionMetrics[] {
    return Array.from(this.channelTension.values())
      .filter(t => t.tensionScore > 0.5)
      .sort((a, b) => b.tensionScore - a.tensionScore);
  }
}
