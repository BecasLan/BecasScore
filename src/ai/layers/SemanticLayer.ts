/**
 * SEMANTIC LAYER - Intent, Sentiment & Emotion Analysis (System 2 Thinking)
 *
 * Deep semantic understanding using Qwen3:8b (fast, accurate, local).
 * Analyzes message meaning, intent, sentiment, and emotional context.
 *
 * Purpose:
 * - Understand what user is trying to do (intent)
 * - Detect emotional state (sentiment, emotion)
 * - Use user profile for context-aware analysis
 * - Detect manipulation attempts
 *
 * Used when:
 * - Reflex Layer classifies as SUSPICIOUS
 * - Need deeper understanding of intent
 * - Profile-aware analysis needed
 */

import { Message } from 'discord.js';
import { OllamaService } from '../../services/OllamaService';
import { UserCharacterProfile } from '../../services/ProfileBuilder';
import { TrustScore } from '../../types/Trust.types';
import { createLogger } from '../../services/Logger';

const logger = createLogger('SemanticLayer');

export interface SemanticResult {
  // Intent
  intent: {
    type: 'question' | 'statement' | 'command' | 'request' | 'threat' | 'manipulation';
    target?: string; // What/who is the intent directed at
    action?: string; // What action is intended
    confidence: number;
  };

  // Sentiment
  sentiment: {
    polarity: 'positive' | 'neutral' | 'negative';
    intensity: number; // 0-1
    emotions: string[]; // joy, anger, fear, sadness, surprise, disgust
  };

  // Manipulation Detection
  manipulation: {
    isManipulative: boolean;
    techniques: string[]; // guilt-tripping, gaslighting, love-bombing, etc.
    confidence: number;
  };

  // Context
  context: {
    profileUsed: boolean;
    userPattern: string; // Normal, unusual, concerning
    emotionalState: string; // Based on recent history
  };

  processingTime: number;
}

export class SemanticLayer {
  private ollama: OllamaService;

  constructor() {
    this.ollama = new OllamaService('analysis'); // Qwen3:8b
    logger.info('SemanticLayer initialized with Qwen3:8b');
  }

  /**
   * Analyze message semantics with profile context
   */
  async analyze(
    message: Message,
    profile?: UserCharacterProfile,
    trustScore?: TrustScore
  ): Promise<SemanticResult> {
    const startTime = Date.now();

    try {
      // Parallel analysis for speed
      const [intentResult, sentimentResult, manipulationResult] = await Promise.all([
        this.analyzeIntent(message, profile),
        this.analyzeSentiment(message, profile),
        this.detectManipulation(message, profile),
      ]);

      // Determine user pattern
      const userPattern = this.determineUserPattern(message, profile, trustScore);

      // Estimate emotional state (simplified)
      const emotionalState = this.estimateEmotionalState(sentimentResult, profile);

      return {
        intent: intentResult,
        sentiment: sentimentResult,
        manipulation: manipulationResult,
        context: {
          profileUsed: !!profile,
          userPattern,
          emotionalState,
        },
        processingTime: Date.now() - startTime,
      };

    } catch (error) {
      logger.error('Semantic analysis failed', error);

      // Fallback result
      return {
        intent: {
          type: 'statement',
          confidence: 0.5,
        },
        sentiment: {
          polarity: 'neutral',
          intensity: 0.5,
          emotions: [],
        },
        manipulation: {
          isManipulative: false,
          techniques: [],
          confidence: 0,
        },
        context: {
          profileUsed: false,
          userPattern: 'unknown',
          emotionalState: 'unknown',
        },
        processingTime: Date.now() - startTime,
      };
    }
  }

  /**
   * Analyze message intent using Qwen3:8b
   */
  private async analyzeIntent(
    message: Message,
    profile?: UserCharacterProfile
  ): Promise<SemanticResult['intent']> {
    const prompt = `Analyze the intent of this Discord message. Consider the user's profile if provided.

Message: "${message.content}"

${profile ? `User Profile:
- Aggression: ${profile.personality.aggression.toFixed(2)}
- Helpfulness: ${profile.personality.helpfulness.toFixed(2)}
- Formality: ${profile.personality.formality.toFixed(2)}
- Deception risk: ${profile.riskIndicators.deception.toFixed(2)}
- Manipulation risk: ${profile.riskIndicators.manipulation.toFixed(2)}` : ''}

Classify the intent as ONE of: question, statement, command, request, threat, manipulation

Respond ONLY with JSON:
{
  "type": "question|statement|command|request|threat|manipulation",
  "target": "what/who this is about (optional)",
  "action": "what action is intended (optional)",
  "confidence": 0.0-1.0
}`;

    try {
      const result = await this.ollama.generate(prompt, undefined, {
        temperature: 0.1, // Low temp for consistent classification
        maxTokens: 100,
      });

      const parsed = JSON.parse(result);
      return {
        type: parsed.type || 'statement',
        target: parsed.target,
        action: parsed.action,
        confidence: parsed.confidence || 0.5,
      };
    } catch (error) {
      logger.error('Intent analysis failed', error);
      return {
        type: 'statement',
        confidence: 0.5,
      };
    }
  }

  /**
   * Analyze sentiment and emotions using Qwen3:8b
   */
  private async analyzeSentiment(
    message: Message,
    profile?: UserCharacterProfile
  ): Promise<SemanticResult['sentiment']> {
    const prompt = `Analyze the sentiment and emotions in this message.

Message: "${message.content}"

Detect:
1. Polarity: positive, neutral, or negative
2. Intensity: 0.0 (mild) to 1.0 (extreme)
3. Emotions present: joy, anger, fear, sadness, surprise, disgust

Respond ONLY with JSON:
{
  "polarity": "positive|neutral|negative",
  "intensity": 0.0-1.0,
  "emotions": ["emotion1", "emotion2", ...]
}`;

    try {
      const result = await this.ollama.generate(prompt, undefined, {
        temperature: 0.2,
        maxTokens: 100,
      });

      const parsed = JSON.parse(result);
      return {
        polarity: parsed.polarity || 'neutral',
        intensity: parsed.intensity || 0.5,
        emotions: parsed.emotions || [],
      };
    } catch (error) {
      logger.error('Sentiment analysis failed', error);
      return {
        polarity: 'neutral',
        intensity: 0.5,
        emotions: [],
      };
    }
  }

  /**
   * Detect manipulation attempts using Qwen3:8b
   */
  private async detectManipulation(
    message: Message,
    profile?: UserCharacterProfile
  ): Promise<SemanticResult['manipulation']> {
    const prompt = `Analyze this message for manipulation techniques.

Message: "${message.content}"

${profile ? `User's manipulation risk score: ${profile.riskIndicators.manipulation.toFixed(2)}` : ''}

Common manipulation techniques:
- Guilt-tripping: Making others feel guilty
- Gaslighting: Distorting reality
- Love-bombing: Excessive flattery/affection
- Triangulation: Creating drama between people
- Playing victim: Acting helpless to gain sympathy
- Pressure tactics: "Act now or lose out"

Respond ONLY with JSON:
{
  "isManipulative": true/false,
  "techniques": ["technique1", "technique2", ...],
  "confidence": 0.0-1.0
}`;

    try {
      const result = await this.ollama.generate(prompt, undefined, {
        temperature: 0.1,
        maxTokens: 150,
      });

      const parsed = JSON.parse(result);
      return {
        isManipulative: parsed.isManipulative || false,
        techniques: parsed.techniques || [],
        confidence: parsed.confidence || 0,
      };
    } catch (error) {
      logger.error('Manipulation detection failed', error);
      return {
        isManipulative: false,
        techniques: [],
        confidence: 0,
      };
    }
  }

  /**
   * Determine if user's behavior is normal or unusual
   */
  private determineUserPattern(
    message: Message,
    profile?: UserCharacterProfile,
    trustScore?: TrustScore
  ): string {
    if (!profile) return 'no_profile';

    // Check if behavior matches profile
    const messageLength = message.content.length;
    const avgLength = profile.behavior.avgMessageLength;
    const lengthDeviation = Math.abs(messageLength - avgLength) / avgLength;

    const capsRate = (message.content.match(/[A-Z]/g) || []).length / message.content.length;
    const normalCapsRate = profile.behavior.capsUsageRate;
    const capsDeviation = Math.abs(capsRate - normalCapsRate);

    // If behavior deviates significantly
    if (lengthDeviation > 2.0 || capsDeviation > 0.5) {
      return 'unusual';
    }

    // If trust score is low
    if (trustScore && trustScore.score < 30) {
      return 'concerning';
    }

    return 'normal';
  }

  /**
   * Estimate emotional state based on sentiment + profile
   */
  private estimateEmotionalState(
    sentiment: SemanticResult['sentiment'],
    profile?: UserCharacterProfile
  ): string {
    if (!profile) {
      return sentiment.polarity; // Just use sentiment
    }

    // Consider profile stability
    if (profile.personality.stability < 0.3 && sentiment.polarity === 'negative') {
      return 'volatile';
    }

    if (sentiment.intensity > 0.7) {
      return `highly_${sentiment.polarity}`;
    }

    return sentiment.polarity;
  }
}
