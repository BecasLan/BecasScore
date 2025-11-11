// ModeratorLearning.ts - Learn from moderator actions

import { StorageService } from '../services/StorageService';
import { OllamaService } from '../services/OllamaService';

export interface ModAction {
  actionType: 'ban' | 'kick' | 'timeout' | 'warn';
  targetMessage: string;
  targetUserId: string;
  moderatorId: string;
  reason: string;
  timestamp: Date;
  context: string;
}

export interface LearnedPattern {
  pattern: string;
  actionTaken: string;
  frequency: number;
  confidence: number;
  examples: string[];
}

export class ModeratorLearning {
  private storage: StorageService;
  private ollama: OllamaService;
  private modActions: ModAction[] = [];
  private learnedPatterns: LearnedPattern[] = [];

  constructor(storage: StorageService) {
    this.storage = storage;
    this.ollama = new OllamaService('analysis');
  }

  /**
   * Record moderator action for learning
   */
  async recordAction(action: ModAction): Promise<void> {
    this.modActions.push(action);

    console.log(`📚 Learning from moderator action: ${action.actionType} on "${action.targetMessage.substring(0, 50)}..."`);

    // Analyze patterns every 10 actions
    if (this.modActions.length % 10 === 0) {
      await this.analyzePatterns();
    }
  }

  /**
   * Analyze patterns in moderator actions
   */
  private async analyzePatterns(): Promise<void> {
    if (this.modActions.length < 5) return;

    try {
      const recentActions = this.modActions.slice(-20);

      const prompt = `Analyze these moderator actions and identify patterns:

${recentActions.map(a => `- ${a.actionType} for: "${a.targetMessage}" (Reason: ${a.reason})`).join('\n')}

What patterns do moderators consistently enforce?

Respond with array of patterns:
{
  "patterns": [
    {
      "pattern": "description of what triggers action",
      "actionTaken": "ban/kick/timeout/warn",
      "confidence": 0-1,
      "examples": ["example1", "example2"]
    }
  ]
}`;

      const systemPrompt = `You learn from moderator behavior. Identify what they consistently punish.`;

      const schema = `{
  "patterns": array
}`;

      const result = await this.ollama.generateJSON<{ patterns: LearnedPattern[] }>(
        prompt,
        systemPrompt,
        schema
      );

      // Update learned patterns
      for (const newPattern of result.patterns) {
        const existing = this.learnedPatterns.find(p => p.pattern === newPattern.pattern);
        if (existing) {
          existing.frequency++;
          existing.confidence = (existing.confidence + newPattern.confidence) / 2;
        } else {
          this.learnedPatterns.push({...newPattern, frequency: 1});
        }
      }

      console.log(`✓ Learned ${result.patterns.length} new patterns from moderator actions`);
    } catch (error) {
      console.error('Pattern analysis failed:', error);
    }
  }

  /**
   * Get learned patterns
   */
  getPatterns(): LearnedPattern[] {
    return this.learnedPatterns.sort((a, b) => b.frequency - a.frequency);
  }

  /**
   * Check if message matches learned patterns
   */
  matchesLearnedPattern(message: string): { match: boolean; pattern?: LearnedPattern } {
    for (const pattern of this.learnedPatterns) {
      if (pattern.confidence > 0.7 && message.toLowerCase().includes(pattern.pattern.toLowerCase())) {
        return { match: true, pattern };
      }
    }
    return { match: false };
  }
}
