
import { OllamaService } from '../services/OllamaService';
import { SentimentScore } from '../types/Message.types';

export class SentimentAnalyzer {
  private llm: OllamaService;

  constructor() {
    this.llm = new OllamaService('analysis');
  }

  async analyze(text: string): Promise<SentimentScore> {
    try {
      const result = await this.llm.analyzeSentiment(text);
      
      const dominant = this.getDominant(result.positive, result.negative, result.neutral);

      return {
        positive: result.positive,
        negative: result.negative,
        neutral: result.neutral,
        dominant,
        emotions: result.emotions || [],
      };
    } catch (error) {
      console.error('Sentiment analysis error:', error);
      return {
        positive: 0,
        negative: 0,
        neutral: 1,
        dominant: 'neutral',
        emotions: [],
      };
    }
  }

  private getDominant(pos: number, neg: number, neu: number): 'positive' | 'negative' | 'neutral' {
    if (pos > neg && pos > neu) return 'positive';
    if (neg > pos && neg > neu) return 'negative';
    return 'neutral';
  }
}