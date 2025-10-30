/**
 * INTENT RECOGNIZER - Natural Language → Structured Intent
 *
 * Uses Qwen3:8b to extract command intent and parameters from natural language.
 * Supports Turkish and English, with context-aware parameter extraction.
 */

import { OllamaService } from '../services/OllamaService';
import { COMMAND_DICTIONARY, CommandDefinition, getCommandByIntent } from '../commands/CommandDictionary';
import { createLogger } from '../services/Logger';

const logger = createLogger('IntentRecognizer');

export interface RecognizedIntent {
  intent: string; // Command intent (e.g., 'timeout', 'ban')
  confidence: number; // 0.0-1.0
  parameters: {
    [key: string]: any; // Extracted parameter values
  };
  missingParams: string[]; // Parameters that couldn't be extracted
  rawMessage: string; // Original moderator message
  language: 'tr' | 'en' | 'mixed';
}

export class IntentRecognizer {
  constructor(private ollama: OllamaService) {}

  /**
   * Recognize intent from natural language moderator message
   */
  async recognizeIntent(
    moderatorMessage: string,
    contextHints?: {
      lastMentionedUser?: string;
      repliedToUser?: string;
      currentChannel?: string;
    }
  ): Promise<RecognizedIntent | null> {
    try {
      logger.info(`Recognizing intent from: "${moderatorMessage}"`);

      // Build prompt for Qwen3
      const prompt = this.buildIntentPrompt(moderatorMessage, contextHints);

      // Query Qwen3:8b using generateJSON for structured output
      const systemPrompt = `You are an expert at extracting Discord moderation command intents from natural language.
You understand both Turkish and English.
Your job is to analyze moderator messages and extract:
1. Command intent (timeout, ban, kick, warn, delete, etc.)
2. Parameters (target user, duration, reason, etc.)
3. Confidence level

Return ONLY valid JSON, no other text.`;

      const schema = `{
  "intent": "command_intent_here",
  "confidence": 0.85,
  "parameters": {
    "target": "extracted_user_or_null",
    "duration": "10m",
    "reason": "extracted_reason_or_null"
  },
  "language": "tr" | "en" | "mixed"
}`;

      const rawResponse = await this.ollama.generateJSON<any>(prompt, systemPrompt, schema);

      // Parse AI response
      const result = this.parseAIResponse(JSON.stringify(rawResponse));

      if (!result) {
        logger.warn('Failed to parse AI response');
        return null;
      }

      logger.info(`Recognized intent: ${result.intent} (confidence: ${result.confidence})`);
      return result;

    } catch (error) {
      logger.error('Intent recognition failed', error);
      return null;
    }
  }

  /**
   * Build prompt for AI with command dictionary and context
   */
  private buildIntentPrompt(message: string, contextHints?: any): string {
    // Get all available commands
    const commands = COMMAND_DICTIONARY.map(cmd => ({
      intent: cmd.intent,
      keywords_tr: cmd.keywords.tr,
      keywords_en: cmd.keywords.en,
      parameters: cmd.parameters.map(p => ({
        name: p.name,
        type: p.type,
        required: p.required
      }))
    }));

    return `**TASK:** Extract command intent and parameters from this moderator message.

**MODERATOR MESSAGE:**
"${message}"

**AVAILABLE COMMANDS:**
${JSON.stringify(commands, null, 2)}

${contextHints ? `**CONTEXT HINTS:**
- Last mentioned user: ${contextHints.lastMentionedUser || 'none'}
- Replied to user: ${contextHints.repliedToUser || 'none'}
- Current channel: ${contextHints.currentChannel || 'unknown'}
` : ''}

**INSTRUCTIONS:**
1. Match the message to one of the available commands
2. Extract parameter values from the message
3. Use context hints if parameters are ambiguous
4. Mark parameters as null if not found
5. Calculate confidence (0.0-1.0) based on keyword match and parameter clarity

**RETURN FORMAT (JSON only, no markdown):**
{
  "intent": "command_intent_here",
  "confidence": 0.85,
  "parameters": {
    "target": "extracted_user_or_null",
    "duration": "10m",
    "reason": "extracted_reason_or_null"
  },
  "language": "tr" | "en" | "mixed"
}

**EXAMPLES:**

Message: "Şu adamı 10 dakikalığına sustur"
Response:
{
  "intent": "timeout",
  "confidence": 0.75,
  "parameters": {
    "target": null,
    "duration": "10m",
    "reason": null
  },
  "language": "tr"
}

Message: "Ban this scammer"
Response:
{
  "intent": "ban",
  "confidence": 0.90,
  "parameters": {
    "target": "this",
    "reason": "scammer",
    "delete_days": null
  },
  "language": "en"
}

Now extract from the moderator message above:`;
  }

  /**
   * Parse AI response and validate structure
   */
  private parseAIResponse(aiResponse: string): RecognizedIntent | null {
    try {
      // Clean response (remove markdown code blocks if present)
      let cleaned = aiResponse.trim();
      if (cleaned.startsWith('```json')) {
        cleaned = cleaned.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      } else if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/```\n?/g, '');
      }

      // Parse JSON
      const parsed = JSON.parse(cleaned);

      // Validate structure
      if (!parsed.intent || typeof parsed.confidence !== 'number') {
        logger.warn('Invalid AI response structure');
        return null;
      }

      // Get command definition
      const commandDef = getCommandByIntent(parsed.intent);
      if (!commandDef) {
        logger.warn(`Unknown intent: ${parsed.intent}`);
        return null;
      }

      // Identify missing parameters
      const missingParams: string[] = [];
      for (const param of commandDef.parameters) {
        if (param.required && !parsed.parameters[param.name]) {
          missingParams.push(param.name);
        }
      }

      return {
        intent: parsed.intent,
        confidence: Math.min(1.0, Math.max(0.0, parsed.confidence)),
        parameters: parsed.parameters || {},
        missingParams,
        rawMessage: '', // Will be set by caller
        language: parsed.language || 'mixed'
      };

    } catch (error) {
      logger.error('Failed to parse AI response', error);
      logger.debug('AI response was:', aiResponse);
      return null;
    }
  }

  /**
   * Quick keyword-based intent detection (fallback if AI fails)
   */
  async quickIntent(message: string): Promise<string | null> {
    const normalizedMessage = message.toLowerCase();

    for (const cmd of COMMAND_DICTIONARY) {
      // Check Turkish keywords
      for (const keyword of cmd.keywords.tr) {
        if (normalizedMessage.includes(keyword.toLowerCase())) {
          return cmd.intent;
        }
      }

      // Check English keywords
      for (const keyword of cmd.keywords.en) {
        if (normalizedMessage.includes(keyword.toLowerCase())) {
          return cmd.intent;
        }
      }
    }

    return null;
  }
}
