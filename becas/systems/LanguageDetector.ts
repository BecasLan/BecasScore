// LanguageDetector.ts - Multi-language support for global moderation

import { OllamaService } from '../services/OllamaService';

export interface LanguageAnalysis {
  language: string;
  confidence: number;
  translatedToEnglish?: string;
  originalText: string;
}

export class LanguageDetector {
  private ollama: OllamaService;
  private languageCache: Map<string, string> = new Map();

  constructor() {
    this.ollama = new OllamaService('analysis');
  }

  /**
   * Detect language and translate if needed
   */
  async analyze(text: string): Promise<LanguageAnalysis> {
    // Check cache
    const cached = this.languageCache.get(text);
    if (cached) {
      return JSON.parse(cached);
    }

    try {
      const prompt = `Analyze this text and determine the language:

"${text}"

Respond with:
- language: ISO 639-1 code (en, es, fr, de, ja, zh, ar, etc.)
- confidence: 0-1
- translation: If NOT English, translate to English. If already English, return original text.

Be accurate. Consider slang and informal language.`;

      const systemPrompt = `You are a language detection expert. Detect language accurately and translate naturally.`;

      const schema = `{
  "language": string,
  "confidence": number,
  "translation": string
}`;

      const result = await this.ollama.generateJSON<{
        language: string;
        confidence: number;
        translation: string;
      }>(prompt, systemPrompt, schema);

      const analysis: LanguageAnalysis = {
        language: result.language,
        confidence: result.confidence,
        translatedToEnglish: result.language !== 'en' ? result.translation : undefined,
        originalText: text,
      };

      // Cache result
      this.languageCache.set(text, JSON.stringify(analysis));

      // Cleanup cache if too large
      if (this.languageCache.size > 1000) {
        const firstKey = this.languageCache.keys().next().value;
        if (firstKey) {
          this.languageCache.delete(firstKey);
        }
      }

      return analysis;
    } catch (error) {
      console.error('Language detection failed:', error);
      return {
        language: 'en',
        confidence: 0.5,
        originalText: text,
      };
    }
  }

  /**
   * Translate text to specific language
   */
  async translate(text: string, targetLanguage: string): Promise<string> {
    try {
      const prompt = `Translate this text to ${targetLanguage}:

"${text}"

Provide ONLY the translation, nothing else.`;

      const systemPrompt = `You are a professional translator. Translate naturally and accurately.`;

      const translation = await this.ollama.generate(prompt, systemPrompt, {
        temperature: 0.3,
        maxTokens: 500,
      });

      return translation.trim();
    } catch (error) {
      console.error('Translation failed:', error);
      return text; // Return original if translation fails
    }
  }

  /**
   * Analyze toxicity in original language
   */
  async analyzeToxicityMultilingual(text: string, language: string): Promise<number> {
    try {
      const prompt = `Analyze toxicity in this ${language} text:

"${text}"

Rate toxicity from 0-1:
- 0 = completely benign
- 0.3 = slightly negative
- 0.5 = moderately toxic
- 0.7 = highly toxic
- 1.0 = extremely toxic/dangerous

Consider cultural context and language-specific insults.

Respond with ONLY a number between 0 and 1.`;

      const systemPrompt = `You are a multilingual toxicity expert. Understand context and cultural nuances.`;

      const result = await this.ollama.generate(prompt, systemPrompt, {
        temperature: 0.2,
        maxTokens: 10,
      });

      const toxicity = parseFloat(result.trim());
      return isNaN(toxicity) ? 0 : Math.max(0, Math.min(1, toxicity));
    } catch (error) {
      console.error('Multilingual toxicity analysis failed:', error);
      return 0;
    }
  }
}
