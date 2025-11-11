// AILearningSystem.ts - AI learns from moderator corrections
// When mods undo AI decisions, AI learns what it did wrong

import { StorageService } from '../services/StorageService';
import { createLogger } from '../services/Logger';

const logger = createLogger('AILearningSystem');

export interface Correction {
  id: string;
  timestamp: Date;
  guildId: string;

  // Original AI decision
  aiDecision: {
    action: string;
    target: string;
    reason: string;
    confidence: number;
    context: string;
  };

  // Moderator correction
  moderatorAction: {
    type: 'undo' | 'modify' | 'escalate' | 'deescalate';
    moderatorId: string;
    moderatorName: string;
    reason?: string;
  };

  // Learning insights
  aiMistake: string;
  lesson: string;
  category: 'false_positive' | 'too_harsh' | 'too_lenient' | 'context_missed' | 'cultural_misunderstanding';
}

export class AILearningSystem {
  private storage: StorageService;
  private corrections: Correction[] = [];
  private learnings: Map<string, number> = new Map(); // Pattern -> count

  constructor(storage: StorageService) {
    this.storage = storage;
    this.loadCorrections();
  }

  /**
   * Record a correction when moderator undoes AI action
   */
  async recordCorrection(
    guildId: string,
    aiDecision: {
      action: string;
      target: string;
      reason: string;
      confidence: number;
      context: string;
    },
    moderatorAction: {
      type: 'undo' | 'modify' | 'escalate' | 'deescalate';
      moderatorId: string;
      moderatorName: string;
      reason?: string;
    }
  ): Promise<void> {
    // Analyze what AI did wrong
    const analysis = this.analyzeCorrection(aiDecision, moderatorAction);

    const correction: Correction = {
      id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      guildId,
      aiDecision,
      moderatorAction,
      aiMistake: analysis.mistake,
      lesson: analysis.lesson,
      category: analysis.category,
    };

    this.corrections.push(correction);

    // Update learning patterns
    const patternKey = `${analysis.category}:${aiDecision.action}`;
    this.learnings.set(patternKey, (this.learnings.get(patternKey) || 0) + 1);

    logger.warn(`🎓 AI LEARNED FROM CORRECTION:`);
    logger.warn(`   Mistake: ${analysis.mistake}`);
    logger.warn(`   Lesson: ${analysis.lesson}`);
    logger.warn(`   Category: ${analysis.category}`);

    await this.saveCorrections();
  }

  /**
   * Analyze what went wrong
   */
  private analyzeCorrection(
    aiDecision: any,
    moderatorAction: any
  ): { mistake: string; lesson: string; category: Correction['category'] } {
    let mistake = '';
    let lesson = '';
    let category: Correction['category'] = 'false_positive';

    if (moderatorAction.type === 'undo') {
      mistake = `AI applied ${aiDecision.action} but moderator undid it`;
      lesson = `Context: "${aiDecision.context}" was NOT worth ${aiDecision.action}. Be more careful with similar contexts.`;
      category = 'false_positive';

      // Analyze confidence
      if (aiDecision.confidence < 0.7) {
        lesson += ` AI confidence was low (${(aiDecision.confidence * 100).toFixed(0)}%) - should have asked for approval first.`;
      }
    } else if (moderatorAction.type === 'deescalate') {
      mistake = `AI action was too harsh: ${aiDecision.action}`;
      lesson = `For context "${aiDecision.context}", a lighter action would be more appropriate. Consider cultural context and intent.`;
      category = 'too_harsh';
    } else if (moderatorAction.type === 'escalate') {
      mistake = `AI action was too lenient: ${aiDecision.action}`;
      lesson = `Context "${aiDecision.context}" was more serious than AI assessed. Be stricter with similar violations.`;
      category = 'too_lenient';
    }

    return { mistake, lesson, category };
  }

  /**
   * Get AI performance metrics
   */
  getPerformanceMetrics(guildId?: string): {
    totalCorrections: number;
    correctionsByCategory: Record<Correction['category'], number>;
    mostCommonMistakes: Array<{ pattern: string; count: number }>;
    falsePositiveRate: number;
    improvementTrend: 'improving' | 'stable' | 'declining';
  } {
    const corrections = guildId
      ? this.corrections.filter(c => c.guildId === guildId)
      : this.corrections;

    const byCategory: any = {
      false_positive: 0,
      too_harsh: 0,
      too_lenient: 0,
      context_missed: 0,
      cultural_misunderstanding: 0,
    };

    corrections.forEach(c => {
      byCategory[c.category]++;
    });

    // Calculate false positive rate
    const totalDecisions = corrections.length * 10; // Estimate (1 correction per 10 decisions)
    const falsePositiveRate = corrections.length > 0 ? (byCategory.false_positive / totalDecisions) * 100 : 0;

    // Get most common mistakes
    const mostCommon = Array.from(this.learnings.entries())
      .map(([pattern, count]) => ({ pattern, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Analyze trend (last 20 vs previous 20)
    const recent = corrections.slice(-20);
    const previous = corrections.slice(-40, -20);

    let improvementTrend: 'improving' | 'stable' | 'declining' = 'stable';
    if (recent.length > 10 && previous.length > 10) {
      if (recent.length < previous.length * 0.8) {
        improvementTrend = 'improving';
      } else if (recent.length > previous.length * 1.2) {
        improvementTrend = 'declining';
      }
    }

    return {
      totalCorrections: corrections.length,
      correctionsByCategory: byCategory,
      mostCommonMistakes: mostCommon,
      falsePositiveRate,
      improvementTrend,
    };
  }

  /**
   * Get lessons learned for specific context
   */
  getLessonsForContext(context: string): string[] {
    const relevant = this.corrections.filter(c =>
      c.aiDecision.context.toLowerCase().includes(context.toLowerCase())
    );

    return relevant.map(c => c.lesson).slice(-5); // Last 5 lessons
  }

  /**
   * Check if AI should be more careful with this action
   */
  shouldBeCareful(action: string, confidence: number): {
    beCareful: boolean;
    reason: string;
    suggestedThreshold: number;
  } {
    const falsePositives = this.corrections.filter(
      c => c.category === 'false_positive' && c.aiDecision.action === action
    );

    const tooHarsh = this.corrections.filter(
      c => c.category === 'too_harsh' && c.aiDecision.action === action
    );

    const totalIssues = falsePositives.length + tooHarsh.length;

    if (totalIssues > 5) {
      return {
        beCareful: true,
        reason: `AI has ${totalIssues} corrections for ${action} actions (${falsePositives.length} false positives, ${tooHarsh.length} too harsh)`,
        suggestedThreshold: 0.85, // Require higher confidence
      };
    }

    if (confidence < 0.75) {
      return {
        beCareful: true,
        reason: 'Low confidence - should ask for moderator approval',
        suggestedThreshold: 0.75,
      };
    }

    return {
      beCareful: false,
      reason: 'AI performance is acceptable',
      suggestedThreshold: 0.7,
    };
  }

  /**
   * Get improvement suggestions for AI
   */
  getImprovementSuggestions(): string[] {
    const metrics = this.getPerformanceMetrics();
    const suggestions: string[] = [];

    if (metrics.falsePositiveRate > 10) {
      suggestions.push(`High false positive rate (${metrics.falsePositiveRate.toFixed(1)}%). AI should require higher confidence before taking action.`);
    }

    if (metrics.correctionsByCategory.too_harsh > metrics.correctionsByCategory.too_lenient) {
      suggestions.push('AI tends to be too harsh. Consider more lenient initial actions and escalate only if necessary.');
    } else if (metrics.correctionsByCategory.too_lenient > metrics.correctionsByCategory.too_harsh) {
      suggestions.push('AI tends to be too lenient. Consider stricter enforcement of community guidelines.');
    }

    if (metrics.correctionsByCategory.cultural_misunderstanding > 3) {
      suggestions.push('AI has cultural misunderstandings. Improve context awareness for different cultures and languages.');
    }

    if (metrics.improvementTrend === 'declining') {
      suggestions.push('⚠️ AI performance is declining. Review recent corrections and adjust confidence thresholds.');
    } else if (metrics.improvementTrend === 'improving') {
      suggestions.push('✅ AI is improving! Corrections are decreasing.');
    }

    return suggestions;
  }

  /**
   * Load corrections from storage
   */
  private async loadCorrections(): Promise<void> {
    try {
      const data = await this.storage.read<{ corrections: Correction[] }>('learning', 'ai_corrections.json');
      if (data?.corrections) {
        this.corrections = data.corrections.map(c => ({
          ...c,
          timestamp: new Date(c.timestamp),
        }));

        // Rebuild learnings map
        this.corrections.forEach(c => {
          const patternKey = `${c.category}:${c.aiDecision.action}`;
          this.learnings.set(patternKey, (this.learnings.get(patternKey) || 0) + 1);
        });

        logger.info(`📚 Loaded ${this.corrections.length} AI corrections`);
      }
    } catch (error) {
      logger.warn('No AI corrections found, starting fresh');
    }
  }

  /**
   * Save corrections to storage
   */
  private async saveCorrections(): Promise<void> {
    try {
      await this.storage.write('learning', 'ai_corrections.json', {
        corrections: this.corrections,
        savedAt: new Date(),
      });
    } catch (error) {
      logger.error('Failed to save AI corrections:', error);
    }
  }

  /**
   * Clean up old corrections (older than 60 days)
   */
  async cleanup(daysToKeep: number = 60): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const before = this.corrections.length;
    this.corrections = this.corrections.filter(c => c.timestamp >= cutoffDate);
    const removed = before - this.corrections.length;

    if (removed > 0) {
      await this.saveCorrections();
      logger.info(`🗑️ Cleaned up ${removed} old AI corrections`);
    }

    return removed;
  }
}
