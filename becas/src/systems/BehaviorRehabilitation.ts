// BehaviorRehabilitation.ts - Help toxic users improve

import { OllamaService } from '../services/OllamaService';
import { StorageService } from '../services/StorageService';

export interface RehabilitationPlan {
  userId: string;
  userName: string;
  guildId: string;
  issues: string[];
  suggestions: string[];
  progress: {
    date: Date;
    improvement: string;
    score: number; // 0-1
  }[];
  startDate: Date;
  currentPhase: 'awareness' | 'practice' | 'mastery';
}

export class BehaviorRehabilitation {
  private ollama: OllamaService;
  private storage: StorageService;
  private plans: Map<string, RehabilitationPlan> = new Map();

  constructor(storage: StorageService) {
    this.ollama = new OllamaService('dialogue');
    this.storage = storage;
  }

  /**
   * Generate personalized feedback for toxic behavior
   */
  async generateFeedback(
    message: string,
    toxicityScore: number,
    userName: string
  ): Promise<string> {
    const prompt = `A user said something toxic:

"${message}"

Toxicity: ${(toxicityScore * 100).toFixed(0)}%

Provide kind, constructive feedback to help them improve. Be:
- Empathetic, not judgmental
- Specific about what was problematic
- Suggest better phrasing
- Encourage positive change

Keep it brief (2-3 sentences).`;

    const systemPrompt = `You help people become better communicators. Be supportive, not harsh.`;

    try {
      const feedback = await this.ollama.generate(prompt, systemPrompt, {
        temperature: 0.7,
        maxTokens: 150,
      });

      return feedback.trim();
    } catch (error) {
      return "Hey, that came across pretty harsh. Maybe try rephrasing that more kindly?";
    }
  }

  /**
   * Track improvement over time
   */
  async trackProgress(
    userId: string,
    guildId: string,
    userName: string,
    currentBehavior: { toxicity: number; sentiment: string }
  ): Promise<{ improved: boolean; message?: string }> {
    const key = `${guildId}:${userId}`;
    let plan = this.plans.get(key);

    if (!plan) {
      // Create new rehabilitation plan
      plan = {
        userId,
        userName,
        guildId,
        issues: [],
        suggestions: [],
        progress: [],
        startDate: new Date(),
        currentPhase: 'awareness',
      };
      this.plans.set(key, plan);
    }

    // Calculate improvement
    const avgPastToxicity = plan.progress.length > 0
      ? plan.progress.reduce((sum, p) => sum + (1 - p.score), 0) / plan.progress.length
      : 0.8;

    const improved = currentBehavior.toxicity < avgPastToxicity;

    // Record progress
    plan.progress.push({
      date: new Date(),
      improvement: improved ? 'improved' : 'same',
      score: 1 - currentBehavior.toxicity, // Higher = better
    });

    // Update phase
    if (plan.progress.length >= 10) {
      const recentAvg = plan.progress.slice(-10).reduce((sum, p) => sum + p.score, 0) / 10;
      if (recentAvg > 0.8) plan.currentPhase = 'mastery';
      else if (recentAvg > 0.6) plan.currentPhase = 'practice';
    }

    // Generate encouragement if improved
    if (improved && plan.progress.length > 5) {
      return {
        improved: true,
        message: `🌟 Hey ${userName}, I've noticed you've been more positive lately. Keep it up!`,
      };
    }

    return { improved };
  }
}
