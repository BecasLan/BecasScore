// IntentAnalyzer.ts - Multi-Layer Intent Analysis System
// Distinguishes between FUD, criticism, jokes, frustration, genuine concern

import { Message } from 'discord.js';
import { OllamaService } from '../services/OllamaService';
import { TrustScoreEngine } from './TrustScoreEngine';
import { createLogger } from '../services/Logger';

const logger = createLogger('IntentAnalyzer');

// ============================================
// LAYER 1: SURFACE INTENT (Fast)
// ============================================

export type SurfaceIntentCategory =
  | 'greeting'
  | 'insult'
  | 'question'
  | 'statement'
  | 'command'
  | 'joke'
  | 'complaint';

export interface SurfaceIntent {
  category: SurfaceIntentCategory;
  confidence: number;
  shouldEscalate: boolean; // true = needs deeper analysis
}

// ============================================
// LAYER 2: DEEP INTENT (AI-powered)
// ============================================

export type DeepIntentType =
  | 'fud'                  // Fear, Uncertainty, Doubt
  | 'constructive_criticism' // Valid concerns
  | 'frustration'          // User is upset but not malicious
  | 'joke'                 // Sarcasm, irony, humor
  | 'genuine_concern'      // Legitimate worry
  | 'trolling'             // Deliberate provocation
  | 'spam'                 // Repetitive/promotional
  | 'support'              // Positive/helpful
  | 'neutral';             // Just chatting

export type EmotionalState =
  | 'angry'
  | 'sad'
  | 'joking'
  | 'worried'
  | 'neutral'
  | 'excited'
  | 'frustrated';

export type UserBehaviorPattern =
  | 'first_time'           // First time showing this behavior
  | 'pattern'              // Part of recurring pattern
  | 'out_of_character'     // Unusual for this user
  | 'consistent';          // Matches their usual behavior

export interface DeepIntent {
  primaryIntent: DeepIntentType;
  secondaryIntent?: DeepIntentType; // e.g., "frustrated + genuine_concern"
  emotionalState: EmotionalState;
  userHistory: UserBehaviorPattern;
  needsModeration: boolean;
  suggestedAction: 'ignore' | 'warn' | 'discuss' | 'timeout' | 'ban' | 'monitor';
  reasoning: string;
  confidence: number; // 0-1
}

// ============================================
// LAYER 3: CONVERSATIONAL CONTEXT
// ============================================

export type TonalShift = 'escalating' | 'de-escalating' | 'stable';

export type SocialContext =
  | 'joking_with_friends'
  | 'arguing'
  | 'genuine_discussion'
  | 'monologue'
  | 'seeking_help'
  | 'group_activity';

export interface ConversationalContext {
  isResponseTo: string | null;        // replying to someone?
  isContinuation: boolean;            // continuing previous topic?
  tonalShift: TonalShift;
  socialContext: SocialContext;
  recentMessageCount: number;         // how active is user?
  conversationParticipants: string[]; // who's involved?
}

// ============================================
// UNIFIED INTENT ANALYSIS RESULT
// ============================================

export interface IntentAnalysisResult {
  surface: SurfaceIntent;
  deep: DeepIntent;
  conversational: ConversationalContext;

  // Final verdict
  overallAssessment: {
    isGenuinelyHarmful: boolean;      // Real threat?
    requiresIntervention: boolean;    // Action needed?
    interventionType: 'none' | 'gentle' | 'moderate' | 'severe';
    explanation: string;
  };
}

// ============================================
// INTENT ANALYZER
// ============================================

export class IntentAnalyzer {
  private ollama: OllamaService;
  private trustEngine: TrustScoreEngine;

  // Cache recent messages per user for context
  private userMessageHistory: Map<string, Message[]> = new Map();
  private readonly MAX_HISTORY = 10;

  constructor(trustEngine: TrustScoreEngine) {
    this.ollama = new OllamaService('analysis');
    this.trustEngine = trustEngine;
    logger.info('IntentAnalyzer initialized - Multi-layer intent analysis ready');
  }

  /**
   * 🔥 MAIN METHOD: Analyze message intent across all layers
   */
  async analyzeIntent(message: Message): Promise<IntentAnalysisResult> {
    const userId = message.author.id;
    const guildId = message.guild!.id;

    // Update user message history
    this.updateMessageHistory(userId, message);

    // Layer 1: Surface Intent (fast heuristics)
    const surface = this.analyzeSurfaceIntent(message);

    // Layer 2: Deep Intent (AI-powered)
    const deep = await this.analyzeDeepIntent(message, surface);

    // Layer 3: Conversational Context
    const conversational = this.analyzeConversationalContext(message);

    // Final assessment
    const overallAssessment = this.synthesizeAssessment(surface, deep, conversational, message);

    logger.info(`Intent analysis for ${message.author.tag}: ${deep.primaryIntent} (${(deep.confidence * 100).toFixed(0)}%)`);

    return {
      surface,
      deep,
      conversational,
      overallAssessment
    };
  }

  /**
   * 🔥 LAYER 1: Surface Intent (Fast)
   */
  private analyzeSurfaceIntent(message: Message): SurfaceIntent {
    const content = message.content.toLowerCase();

    // Quick pattern matching for obvious cases
    const greetingWords = ['hi', 'hello', 'hey', 'good morning', 'gm', 'sup'];
    const questionWords = ['?', 'how', 'what', 'why', 'when', 'where', 'who'];
    const insultWords = ['fuck', 'shit', 'idiot', 'stupid', 'retard', 'moron'];
    const jokeIndicators = ['lol', 'lmao', 'haha', 'jk', 'kidding', '😂', '🤣'];
    const complaintWords = ['hate', 'sucks', 'terrible', 'awful', 'worst', 'disappointed'];

    let category: SurfaceIntentCategory = 'statement';
    let confidence = 0.5;
    let shouldEscalate = true; // default: escalate to deep analysis

    if (greetingWords.some(w => content.startsWith(w))) {
      category = 'greeting';
      confidence = 0.9;
      shouldEscalate = false; // greetings don't need deep analysis
    } else if (questionWords.some(w => content.includes(w))) {
      category = 'question';
      confidence = 0.7;
    } else if (insultWords.some(w => content.includes(w))) {
      category = 'insult';
      confidence = 0.8;
      shouldEscalate = true; // ALWAYS escalate insults
    } else if (jokeIndicators.some(w => content.includes(w))) {
      category = 'joke';
      confidence = 0.6;
    } else if (complaintWords.some(w => content.includes(w))) {
      category = 'complaint';
      confidence = 0.7;
      shouldEscalate = true; // complaints need deep analysis
    }

    return { category, confidence, shouldEscalate };
  }

  /**
   * 🔥 LAYER 2: Deep Intent (AI-powered)
   */
  private async analyzeDeepIntent(message: Message, surface: SurfaceIntent): Promise<DeepIntent> {
    const userId = message.author.id;
    const guildId = message.guild!.id;

    // Get user history
    const recentMessages = this.userMessageHistory.get(userId) || [];
    const trustScore = this.trustEngine.getTrustScore(userId, guildId);

    const prompt = `You are an expert at understanding human intent in online communities. Analyze this message DEEPLY.

MESSAGE: "${message.content}"

CONTEXT:
- User: ${message.author.tag}
- Trust Score: ${trustScore.score}/100
- Recent messages: ${recentMessages.length}
- Surface intent: ${surface.category}

RECENT USER MESSAGES (last 5):
${recentMessages.slice(-5).map((m, i) => `${i+1}. "${m.content}"`).join('\n')}

THINK DEEPLY:
1. Is this FUD (spreading fear about project), or just expressing frustration?
2. Is this a joke/sarcasm, or genuine negativity?
3. Is the user trolling, or do they have a valid concern?
4. What is their emotional state?
5. Is this behavior typical for them, or unusual?

PRIMARY INTENT OPTIONS:
- fud: Spreading fear, uncertainty, doubt
- constructive_criticism: Valid concerns with helpful intent
- frustration: User is upset but not trying to harm
- joke: Sarcasm, irony, humor
- genuine_concern: Legitimate worry about something
- trolling: Deliberate provocation
- spam: Repetitive/promotional
- support: Positive/helpful
- neutral: Just chatting

EMOTIONAL STATE OPTIONS: angry, sad, joking, worried, neutral, excited, frustrated

USER BEHAVIOR PATTERN:
- first_time: First time showing this behavior
- pattern: Part of recurring pattern
- out_of_character: Unusual for this user
- consistent: Matches their usual behavior

SUGGESTED ACTION:
- ignore: Not worth any action
- warn: Send a friendly warning
- discuss: Engage in conversation
- timeout: Temporary timeout needed
- ban: Permanent ban needed
- monitor: Watch closely

Output JSON ONLY:
{
  "primaryIntent": "...",
  "secondaryIntent": "..." | null,
  "emotionalState": "...",
  "userHistory": "...",
  "needsModeration": true/false,
  "suggestedAction": "...",
  "reasoning": "Brief explanation of your analysis",
  "confidence": 0.0-1.0
}`;

    try {
      const response = await this.ollama.generate(prompt, 'You are a JSON generator. Output ONLY valid JSON.');

      // Extract JSON
      let cleaned = response.trim().replace(/```json\s*/g, '').replace(/```\s*/g, '');
      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');

      if (firstBrace === -1 || lastBrace === -1) {
        throw new Error('No JSON found in AI response');
      }

      const jsonStr = cleaned.substring(firstBrace, lastBrace + 1);
      const parsed = JSON.parse(jsonStr);

      return {
        primaryIntent: parsed.primaryIntent as DeepIntentType,
        secondaryIntent: parsed.secondaryIntent as DeepIntentType | undefined,
        emotionalState: parsed.emotionalState as EmotionalState,
        userHistory: parsed.userHistory as UserBehaviorPattern,
        needsModeration: parsed.needsModeration,
        suggestedAction: parsed.suggestedAction,
        reasoning: parsed.reasoning,
        confidence: parsed.confidence
      };
    } catch (error) {
      logger.error('Deep intent analysis failed:', error);

      // Fallback to surface intent
      return {
        primaryIntent: surface.category === 'insult' ? 'trolling' : 'neutral',
        emotionalState: 'neutral',
        userHistory: 'first_time',
        needsModeration: surface.category === 'insult',
        suggestedAction: surface.category === 'insult' ? 'warn' : 'ignore',
        reasoning: 'Fallback: AI analysis failed',
        confidence: 0.3
      };
    }
  }

  /**
   * 🔥 LAYER 3: Conversational Context
   */
  private analyzeConversationalContext(message: Message): ConversationalContext {
    const userId = message.author.id;
    const recentMessages = this.userMessageHistory.get(userId) || [];

    // Check if replying to someone
    const isResponseTo = message.reference?.messageId || null;

    // Check if continuing previous topic (simple heuristic: similar words)
    const isContinuation = recentMessages.length > 0 &&
      this.hasSimilarWords(message.content, recentMessages[recentMessages.length - 1].content);

    // Tonal shift detection (simplified)
    const tonalShift = this.detectTonalShift(recentMessages);

    // Social context (simplified)
    const socialContext = this.detectSocialContext(message, recentMessages);

    // Count participants in recent conversation
    const conversationParticipants = Array.from(new Set(
      recentMessages.map(m => m.author.id)
    ));

    return {
      isResponseTo,
      isContinuation,
      tonalShift,
      socialContext,
      recentMessageCount: recentMessages.length,
      conversationParticipants
    };
  }

  /**
   * 🔥 FINAL ASSESSMENT: Synthesize all layers
   */
  private synthesizeAssessment(
    surface: SurfaceIntent,
    deep: DeepIntent,
    conversational: ConversationalContext,
    message: Message
  ): IntentAnalysisResult['overallAssessment'] {
    let isGenuinelyHarmful = false;
    let requiresIntervention = false;
    let interventionType: 'none' | 'gentle' | 'moderate' | 'severe' = 'none';
    let explanation = '';

    // Rule 1: FUD + High confidence = Harmful
    if (deep.primaryIntent === 'fud' && deep.confidence > 0.7) {
      isGenuinelyHarmful = true;
      requiresIntervention = true;
      interventionType = 'moderate';
      explanation = `Genuine FUD detected (${(deep.confidence * 100).toFixed(0)}% confidence). ${deep.reasoning}`;
    }
    // Rule 2: Trolling + Pattern = Harmful
    else if (deep.primaryIntent === 'trolling' && deep.userHistory === 'pattern') {
      isGenuinelyHarmful = true;
      requiresIntervention = true;
      interventionType = 'severe';
      explanation = `Repeated trolling behavior. User has a pattern of provocative messages.`;
    }
    // Rule 3: Joke + Friends context = Not harmful
    else if (deep.primaryIntent === 'joke' && conversational.socialContext === 'joking_with_friends') {
      isGenuinelyHarmful = false;
      requiresIntervention = false;
      explanation = `User is joking with friends. Context suggests playful banter, not genuine toxicity.`;
    }
    // Rule 4: Frustration + First time = Gentle warning
    else if (deep.primaryIntent === 'frustration' && deep.userHistory === 'first_time') {
      isGenuinelyHarmful = false;
      requiresIntervention = true;
      interventionType = 'gentle';
      explanation = `User is frustrated. This is first time showing negative behavior. Gentle reminder appropriate.`;
    }
    // Rule 5: Constructive criticism = No intervention
    else if (deep.primaryIntent === 'constructive_criticism') {
      isGenuinelyHarmful = false;
      requiresIntervention = false;
      explanation = `Valid criticism detected. User is expressing genuine concerns constructively.`;
    }
    // Rule 6: Genuine concern = Monitor
    else if (deep.primaryIntent === 'genuine_concern') {
      isGenuinelyHarmful = false;
      requiresIntervention = false;
      explanation = `User has legitimate concerns. No action needed, but worth monitoring.`;
    }
    // Default: Use AI suggestion
    else {
      requiresIntervention = deep.needsModeration;
      isGenuinelyHarmful = ['fud', 'trolling', 'spam'].includes(deep.primaryIntent);

      switch (deep.suggestedAction) {
        case 'ban':
          interventionType = 'severe';
          break;
        case 'timeout':
          interventionType = 'moderate';
          break;
        case 'warn':
          interventionType = 'gentle';
          break;
        default:
          interventionType = 'none';
      }

      explanation = deep.reasoning;
    }

    return {
      isGenuinelyHarmful,
      requiresIntervention,
      interventionType,
      explanation
    };
  }

  // ============================================
  // HELPER METHODS
  // ============================================

  private updateMessageHistory(userId: string, message: Message): void {
    if (!this.userMessageHistory.has(userId)) {
      this.userMessageHistory.set(userId, []);
    }

    const history = this.userMessageHistory.get(userId)!;
    history.push(message);

    // Keep only last N messages
    if (history.length > this.MAX_HISTORY) {
      history.shift();
    }
  }

  private hasSimilarWords(text1: string, text2: string): boolean {
    const words1 = new Set(text1.toLowerCase().split(/\s+/));
    const words2 = new Set(text2.toLowerCase().split(/\s+/));

    let matchCount = 0;
    for (const word of words1) {
      if (words2.has(word) && word.length > 3) { // Only count words >3 chars
        matchCount++;
      }
    }

    return matchCount >= 2; // At least 2 common words
  }

  private detectTonalShift(recentMessages: Message[]): TonalShift {
    if (recentMessages.length < 2) return 'stable';

    // Simple heuristic: check if negativity is increasing
    const lastMessage = recentMessages[recentMessages.length - 1].content.toLowerCase();
    const previousMessage = recentMessages[recentMessages.length - 2].content.toLowerCase();

    const negativeWords = ['hate', 'sucks', 'terrible', 'awful', 'worst', 'fuck', 'shit'];

    const lastNegativity = negativeWords.filter(w => lastMessage.includes(w)).length;
    const prevNegativity = negativeWords.filter(w => previousMessage.includes(w)).length;

    if (lastNegativity > prevNegativity) return 'escalating';
    if (lastNegativity < prevNegativity) return 'de-escalating';
    return 'stable';
  }

  private detectSocialContext(message: Message, recentMessages: Message[]): SocialContext {
    const content = message.content.toLowerCase();

    // Check for help-seeking
    if (content.includes('help') || content.includes('how do i') || content.includes('?')) {
      return 'seeking_help';
    }

    // Check for arguing (multiple participants + negative tone)
    const participants = new Set(recentMessages.map(m => m.author.id));
    const negativeWords = ['wrong', 'no', 'disagree', 'bullshit'];
    const hasNegative = negativeWords.some(w => content.includes(w));

    if (participants.size > 1 && hasNegative) {
      return 'arguing';
    }

    // Check for jokes
    if (content.includes('lol') || content.includes('haha') || content.includes('😂')) {
      return 'joking_with_friends';
    }

    // Default: genuine discussion
    return participants.size > 1 ? 'genuine_discussion' : 'monologue';
  }
}
