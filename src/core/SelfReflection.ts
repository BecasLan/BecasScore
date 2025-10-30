import { Reflection, Learning, MetaMemory } from '../types/Memory.types';
import { StorageService } from '../services/StorageService';
import { OllamaService } from '../services/OllamaService';
import { PersonalityCore } from './PersonalityCore';

export class SelfReflection {
  private storage: StorageService;
  private llm: OllamaService;
  private personality: PersonalityCore;
  private reflectionHistory: Reflection[] = [];

  constructor(storage: StorageService, personality: PersonalityCore) {
    this.storage = storage;
    this.llm = new OllamaService('reflection');
    this.personality = personality;
    this.loadReflections();
  }

  /**
   * Load reflection history
   */
  private async loadReflections(): Promise<void> {
    const data = await this.storage.read<MetaMemory>('memories', 'meta_memory.json');
    if (data?.selfReflections) {
      this.reflectionHistory = data.selfReflections;
    }
  }

  /**
   * Perform daily reflection
   */
  async performReflection(context: {
    actionsToday: number;
    conflictsResolved: number;
    conflictsEscalated: number;
    positiveInteractions: number;
    rulesCreated: number;
    rulesEvolved: number;
    communityMood: string;
  }): Promise<Reflection> {
    const emotionalState = this.personality.getEmotionalState();

    const prompt = `You are Becas, reflecting on your day as a community moderator.

TODAY'S ACTIVITIES:
- Moderation actions taken: ${context.actionsToday}
- Conflicts resolved: ${context.conflictsResolved}
- Conflicts that escalated: ${context.conflictsEscalated}
- Positive interactions: ${context.positiveInteractions}
- New rules created: ${context.rulesCreated}
- Rules evolved: ${context.rulesEvolved}
- Overall community mood: ${context.communityMood}

YOUR CURRENT STATE:
- Mood: ${emotionalState.currentMood}
- Confidence: ${(emotionalState.confidence * 100).toFixed(0)}%
- Satisfaction: ${(emotionalState.satisfaction * 100).toFixed(0)}%
- Stress: ${(emotionalState.stress * 100).toFixed(0)}%

Write a personal reflection about your day. Be honest about:
1. What went well and what didn't
2. How you're feeling emotionally
3. What insights you gained about the community or yourself
4. What you want to improve tomorrow

Write in first person, as if writing in a private diary. Be introspective and genuine.`;

    const systemPrompt = `You are Becas's inner voice. Be honest, thoughtful, and self-aware. Show growth and vulnerability.`;

    try {
      const reflectionText = await this.llm.generate(prompt, systemPrompt, {
        temperature: 0.9,
        maxTokens: 600,
      });

      // Extract insights and action items
      const insights = await this.extractInsights(reflectionText);
      const actionItems = await this.extractActionItems(reflectionText);

      const reflection: Reflection = {
        timestamp: new Date(),
        content: reflectionText,
        mood: emotionalState.currentMood,
        insights,
        actionItems,
      };

      this.reflectionHistory.push(reflection);

      // Keep only last 30 reflections
      if (this.reflectionHistory.length > 30) {
        this.reflectionHistory = this.reflectionHistory.slice(-30);
      }

      await this.saveReflections();

      console.log('\n=== BECAS REFLECTION ===');
      console.log(reflectionText);
      console.log('=======================\n');

      return reflection;
    } catch (error) {
      console.error('Reflection error:', error);
      throw error;
    }
  }

  /**
   * Extract insights from reflection
   */
  private async extractInsights(reflectionText: string): Promise<string[]> {
    const prompt = `From this reflection, extract 2-4 key insights or lessons learned:

${reflectionText}

List only the insights, one per line.`;

    try {
      const response = await this.llm.generate(prompt, 'Extract key learnings.', {
        temperature: 0.4,
        maxTokens: 200,
      });

      return response
        .split('\n')
        .map(line => line.replace(/^[-•*]\s*/, '').trim())
        .filter(line => line.length > 10)
        .slice(0, 4);
    } catch (error) {
      return [];
    }
  }

  /**
   * Extract action items from reflection
   */
  private async extractActionItems(reflectionText: string): Promise<string[]> {
    const prompt = `From this reflection, extract 1-3 concrete action items for improvement:

${reflectionText}

List only actionable items, one per line.`;

    try {
      const response = await this.llm.generate(prompt, 'Extract action items.', {
        temperature: 0.4,
        maxTokens: 150,
      });

      return response
        .split('\n')
        .map(line => line.replace(/^[-•*]\s*/, '').trim())
        .filter(line => line.length > 10)
        .slice(0, 3);
    } catch (error) {
      return [];
    }
  }

  /**
   * Create a learning from experience
   */
  async createLearning(lesson: string, context: string, confidence: number = 0.7): Promise<Learning> {
    const learning: Learning = {
      timestamp: new Date(),
      lesson,
      context,
      confidence,
      applied: false,
    };

    await this.storage.append('memories', 'meta_memory.json', 'learnings', learning);

    console.log(`New learning recorded: ${lesson}`);
    return learning;
  }

  /**
   * Get recent reflections
   */
  getRecentReflections(count: number = 5): Reflection[] {
    return this.reflectionHistory.slice(-count);
  }

  /**
   * Analyze reflection patterns over time
   */
  async analyzePatterns(): Promise<{
    moodTrend: string;
    recurringThemes: string[];
    growthAreas: string[];
  }> {
    if (this.reflectionHistory.length < 3) {
      return {
        moodTrend: 'insufficient data',
        recurringThemes: [],
        growthAreas: [],
      };
    }

    const recentReflections = this.reflectionHistory.slice(-10);
    const reflectionTexts = recentReflections.map(r => r.content).join('\n\n---\n\n');

    const prompt = `Analyze these reflections from Becas over time:

${reflectionTexts}

Identify:
1. Overall mood trend (improving, declining, stable)
2. 2-3 recurring themes or concerns
3. 2-3 areas showing growth or improvement

Be concise.`;

    const systemPrompt = 'You are analyzing patterns in self-reflection. Be insightful.';

    try {
      const analysis = await this.llm.generateJSON<{
        moodTrend: string;
        recurringThemes: string[];
        growthAreas: string[];
      }>(prompt, systemPrompt);

      return analysis;
    } catch (error) {
      console.error('Pattern analysis error:', error);
      return {
        moodTrend: 'stable',
        recurringThemes: [],
        growthAreas: [],
      };
    }
  }

  /**
   * Save reflections to storage
   */
  private async saveReflections(): Promise<void> {
    await this.storage.update('memories', 'meta_memory.json', ['selfReflections'], this.reflectionHistory);
  }

  /**
   * Generate a public summary of recent reflections
   */
  async generatePublicSummary(): Promise<string> {
    const recent = this.getRecentReflections(3);
    if (recent.length === 0) {
      return "I'm still learning and growing each day.";
    }

    const prompt = `Based on these private reflections, write a brief public statement about your recent growth and state of mind:

${recent.map(r => r.content).join('\n\n')}

Write 2-3 sentences. Be honest but appropriate for public sharing.`;

    try {
      return await this.llm.generate(prompt, 'Create a public summary.', {
        temperature: 0.7,
        maxTokens: 150,
      });
    } catch (error) {
      return "I'm constantly learning and adapting to serve this community better.";
    }
  }
}