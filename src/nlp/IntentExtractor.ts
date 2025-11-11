// IntentExtractor.ts

import { OllamaService } from '../services/OllamaService';

export interface ExtractedIntent {
  primary: string; // main action
  secondary?: string; // follow-up action
  modifiers: string[]; // conditions, time, etc
  entities: Map<string, any>; // users, times, reasons
  confidence: number;
  isComplex: boolean;
}

export class IntentExtractor {
  private llm: OllamaService;

  constructor() {
    this.llm = new OllamaService('analysis');
  }

  /**
   * Extract detailed intent from text
   */
  async extract(text: string): Promise<ExtractedIntent> {
    const lower = text.toLowerCase();

    // Quick pattern-based extraction for simple cases
    const quickIntent = this.quickExtract(lower);
    
    if (quickIntent.confidence > 0.8 && !quickIntent.isComplex) {
      return quickIntent;
    }

    // Use LLM for complex cases
    return await this.deepExtract(text);
  }

  /**
   * Quick pattern-based extraction
   */
  private quickExtract(text: string): ExtractedIntent {
    const entities = new Map<string, any>();
    const modifiers: string[] = [];

    // Extract primary action
    let primary = 'unknown';
    const actions = ['timeout', 'ban', 'kick', 'warn', 'mute'];
    
    for (const action of actions) {
      if (text.includes(action)) {
        primary = action;
        break;
      }
    }

    // Check complexity
    const complexityIndicators = ['if', 'then', 'unless', 'after', 'before', 'watch', 'but'];
    const isComplex = complexityIndicators.some(word => text.includes(word));

    // Extract modifiers
    if (text.includes('if')) modifiers.push('conditional');
    if (text.includes('after') || text.includes('in')) modifiers.push('delayed');
    if (text.includes('watch') || text.includes('monitor')) modifiers.push('monitoring');

    // Calculate confidence
    const confidence = primary !== 'unknown' ? 0.7 : 0.3;

    return {
      primary,
      modifiers,
      entities,
      confidence,
      isComplex,
    };
  }

  /**
   * Deep LLM-based extraction for complex intents
   */
  private async deepExtract(text: string): Promise<ExtractedIntent> {
    const prompt = `Analyze this moderation request and extract the intent:

"${text}"

Extract:
1. Primary action (timeout, ban, kick, warn, etc)
2. Secondary action (if any)
3. Conditions/modifiers (if any)
4. Is this a complex multi-step request?

Respond with JSON only.`;

    const systemPrompt = `You are an intent extraction system. Extract structured intent from moderation requests.`;

    const schema = `{
  "primary": string,
  "secondary": string | null,
  "modifiers": string[],
  "isComplex": boolean,
  "confidence": number
}`;

    try {
      const result = await this.llm.generateJSON<{
        primary: string;
        secondary?: string;
        modifiers: string[];
        isComplex: boolean;
        confidence: number;
      }>(prompt, systemPrompt, schema);

      return {
        primary: result.primary,
        secondary: result.secondary,
        modifiers: result.modifiers || [],
        entities: new Map(),
        confidence: result.confidence,
        isComplex: result.isComplex,
      };
    } catch (error) {
      console.error('Deep intent extraction failed:', error);
      return this.quickExtract(text.toLowerCase());
    }
  }

  /**
   * Check if intent is actionable
   */
  isActionable(intent: ExtractedIntent): boolean {
    const actionableIntents = ['timeout', 'ban', 'kick', 'warn', 'mute', 'monitor'];
    return actionableIntents.includes(intent.primary.toLowerCase());
  }

  /**
   * Get intent priority (urgency)
   */
  getPriority(intent: ExtractedIntent): number {
    // 1-10 scale
    const urgentActions = ['ban', 'kick'];
    const moderateActions = ['timeout', 'warn'];
    
    if (urgentActions.includes(intent.primary)) return 8;
    if (moderateActions.includes(intent.primary)) return 5;
    if (intent.modifiers.includes('delayed')) return 3;
    
    return 5; // default
  }
}