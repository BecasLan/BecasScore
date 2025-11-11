
import { OllamaService } from '../services/OllamaService';
import { Intent } from '../types/Message.types';

export class IntentAnalyzer {
  private llm: OllamaService;

  constructor() {
    this.llm = new OllamaService('analysis');
  }

  async analyze(text: string, context?: string): Promise<Intent> {
    try {
      const result = await this.llm.extractIntent(text, context);

      return {
        type: this.normalizeType(result.type),
        confidence: result.confidence,
        target: result.target,
        action: result.action,
      };
    } catch (error) {
      console.error('Intent analysis error:', error);
      return {
        type: 'statement',
        confidence: 0.5,
      };
    }
  }

  private normalizeType(type: string): 'question' | 'command' | 'statement' | 'governance' | 'social' {
    const lower = type.toLowerCase();
    if (lower.includes('question')) return 'question';
    if (lower.includes('command')) return 'command';
    if (lower.includes('govern')) return 'governance';
    if (lower.includes('social')) return 'social';
    return 'statement';
  }
}