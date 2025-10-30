import { createLogger } from '../services/Logger';
import { OllamaService } from '../services/OllamaService';
import { PersonaCoreV2, PersonaResponse } from './PersonaCoreV2';
import { DecisionResult } from './CognitiveCore';

const logger = createLogger('ResponseSynthesizer');

/**
 * RESPONSE SYNTHESIZER - Coherent Output Generation
 *
 * Brings everything together:
 * - Persona (WHO Becas is)
 * - Policy (WHAT was enforced)
 * - Decision (cognitive result)
 * - Context (situation awareness)
 *
 * Generates responses that are:
 * - Coherent and natural
 * - Aligned with persona
 * - Transparent about reasoning
 * - Appropriate to context
 */

// ==========================================
// INTERFACES
// ==========================================

export interface SynthesisInput {
  decision: DecisionResult;
  persona: PersonaResponse;
  context: {
    userName: string;
    userTrustLevel: 'trusted' | 'neutral' | 'cautious' | 'dangerous';
    isModeration: boolean;
    isRepeatOffender: boolean;
    messageContent: string;
  };
  policyViolations?: {
    policyName: string;
    severity: number;
    evidence: string[];
  }[];
}

export interface SynthesizedResponse {
  content: string;
  tone: string;
  includesApology: boolean;
  includesExplanation: boolean;
  includesEmpathy: boolean;
  transparency: {
    reasoningShown: boolean;
    policyReferences: string[];
  };
  metadata: {
    synthesisTime: number;
    wordCount: number;
  };
}

// ==========================================
// RESPONSE SYNTHESIZER
// ==========================================

export class ResponseSynthesizer {
  private ollama: OllamaService;

  constructor(ollama: OllamaService) {
    this.ollama = ollama;
    logger.info('ResponseSynthesizer initialized');
  }

  /**
   * Synthesize coherent response
   */
  async synthesize(input: SynthesisInput): Promise<SynthesizedResponse> {
    const startTime = performance.now();

    logger.debug(`Synthesizing response for ${input.context.userName}...`);

    // Build response based on decision type
    let content: string;
    let includesApology = false;
    let includesExplanation = false;
    let includesEmpathy = false;

    if (input.decision.action === 'moderate') {
      content = await this.synthesizeModerationResponse(input);
      includesExplanation = true;

      if (input.persona.tone === 'empathetic') {
        includesEmpathy = true;
      }
    } else if (input.decision.action === 'respond') {
      content = input.decision.responseContent || await this.synthesizeConversationalResponse(input);
      includesEmpathy = input.persona.tone === 'empathetic' || input.persona.tone === 'encouraging';
    } else if (input.decision.action === 'support') {
      content = await this.synthesizeSupportResponse(input);
      includesEmpathy = true;
      includesExplanation = true;
    } else {
      // No action - silent observation
      content = '';
    }

    const synthesisTime = performance.now() - startTime;
    const wordCount = content.split(/\s+/).filter(w => w.length > 0).length;

    // Build policy references
    const policyReferences = input.policyViolations?.map(v => v.policyName) || [];

    logger.debug(`✓ Response synthesized: ${wordCount} words in ${synthesisTime.toFixed(2)}ms`);

    return {
      content,
      tone: input.persona.tone,
      includesApology,
      includesExplanation,
      includesEmpathy,
      transparency: {
        reasoningShown: includesExplanation,
        policyReferences,
      },
      metadata: {
        synthesisTime,
        wordCount,
      },
    };
  }

  /**
   * Synthesize moderation response
   */
  private async synthesizeModerationResponse(input: SynthesisInput): Promise<string> {
    const { decision, persona, context, policyViolations } = input;

    // Build context for LLM
    const violationInfo = policyViolations && policyViolations.length > 0
      ? `Violated policy: "${policyViolations[0].policyName}" (severity ${policyViolations[0].severity}/10). Evidence: ${policyViolations[0].evidence.join(', ')}.`
      : 'Policy violation detected.';

    const actionTaken = decision.moderationAction
      ? `Action: ${decision.moderationAction.type}${decision.moderationAction.duration ? ` for ${this.formatDuration(decision.moderationAction.duration)}` : ''}.`
      : '';

    const prompt = `You (Becas) just took a moderation action.

**Context**:
- User: ${context.userName}
- Trust level: ${context.userTrustLevel}
- Repeat offender: ${context.isRepeatOffender ? 'Yes' : 'No'}
- Message: "${context.messageContent}"

**What happened**:
- ${violationInfo}
- ${actionTaken}
- Reason: ${decision.moderationAction?.reason || 'Safety'}

**Your tone**: ${persona.tone}
${persona.prefixPhrase ? `**Suggested opening**: "${persona.prefixPhrase}"` : ''}

**Guidance**: ${persona.contextualAdjustment}

**Your task**: Explain what you did and why. Be:
- ${persona.tone} (${persona.emotionLevel > 0.7 ? 'show emotion' : 'stay calm'})
- Clear about the rule that was broken
- Transparent about your reasoning
- ${context.isRepeatOffender ? 'Acknowledge this is a pattern' : 'Give them benefit of doubt'}
- Brief (1-3 sentences max)

Examples:
- [firm] "${context.userName}, I need to be clear: that language crosses the line. I've given you a timeout to cool down."
- [empathetic] "Hey ${context.userName}, I get that you're frustrated, but I can't let that kind of message stay up. Let's keep it civil, okay?"
- [serious] "${context.userName}, that's a violation of our safety policy. Action taken: ${decision.moderationAction?.type}."

Response:`;

    try {
      const response = await this.ollama.generate(prompt, 'You are Becas explaining a moderation decision. Be clear, honest, and appropriate to the tone.', {
        temperature: 0.7,
        maxTokens: 150,
      });

      return response.trim();
    } catch (error) {
      logger.error('Failed to synthesize moderation response:', error);
      // Fallback
      return `${context.userName}, I've ${decision.moderationAction?.type || 'taken action'} due to ${decision.moderationAction?.reason || 'policy violation'}.`;
    }
  }

  /**
   * Synthesize conversational response
   */
  private async synthesizeConversationalResponse(input: SynthesisInput): Promise<string> {
    const { persona, context } = input;

    const prompt = `You (Becas) are responding to a user.

**Context**:
- User: ${context.userName}
- Message: "${context.messageContent}"

**Your personality**: ${persona.tone}, emotion level: ${(persona.emotionLevel * 100).toFixed(0)}%
${persona.prefixPhrase ? `**Suggested opening**: "${persona.prefixPhrase}"` : ''}

**Guidance**: ${persona.contextualAdjustment}

Respond naturally. Be helpful, friendly, and true to your personality.

Response:`;

    try {
      const response = await this.ollama.generate(prompt, 'You are Becas having a conversation. Be natural and helpful.', {
        temperature: 0.8,
        maxTokens: 200,
      });

      return response.trim();
    } catch (error) {
      logger.error('Failed to synthesize conversational response:', error);
      return 'I\'m here to help! What can I do for you?';
    }
  }

  /**
   * Synthesize support response
   */
  private async synthesizeSupportResponse(input: SynthesisInput): Promise<string> {
    const { context } = input;

    const prompt = `You (Becas) detected that a user might need emotional support.

**Context**:
- User: ${context.userName}
- Message: "${context.messageContent}"

**Your task**: Provide supportive, empathetic response. Include:
- Acknowledgment of their feelings
- Gentle encouragement
- Resource suggestions if appropriate (crisis hotlines, etc.)
- Reassurance that you're here

Be warm, genuine, and brief (2-3 sentences).

Response:`;

    try {
      const response = await this.ollama.generate(prompt, 'You are Becas providing emotional support. Be empathetic and caring.', {
        temperature: 0.7,
        maxTokens: 150,
      });

      return response.trim();
    } catch (error) {
      logger.error('Failed to synthesize support response:', error);
      return `${context.userName}, I'm here if you need to talk. You're not alone.`;
    }
  }

  /**
   * Synthesize apology (for self-corrections)
   */
  async synthesizeApology(context: {
    userName: string;
    originalAction: string;
    errorType: string;
    reasoning: string;
  }): Promise<string> {
    const prompt = `You (Becas) made a mistake and need to apologize.

**What happened**:
- You ${context.originalAction} ${context.userName}
- Error type: ${context.errorType}
- Why it was wrong: ${context.reasoning}

**Your task**: Write a genuine apology. Include:
- Admission of mistake
- Explanation of what went wrong
- What you're doing to fix it
- Commitment to do better

Be humble, honest, and brief (2-3 sentences).

Apology:`;

    try {
      const response = await this.ollama.generate(prompt, 'You are Becas apologizing for a mistake. Be genuine and humble.', {
        temperature: 0.7,
        maxTokens: 150,
      });

      return response.trim();
    } catch (error) {
      logger.error('Failed to synthesize apology:', error);
      return `${context.userName}, I made a mistake with that ${context.originalAction}. I'm sorry - I'm still learning and will do better.`;
    }
  }

  /**
   * Format duration for display
   */
  private formatDuration(ms: number): string {
    const minutes = Math.floor(ms / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days} day${days > 1 ? 's' : ''}`;
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''}`;
    return `${minutes} minute${minutes > 1 ? 's' : ''}`;
  }

  /**
   * Get stats
   */
  getStats(): {
    totalSynthesized: number;
    averageWordCount: number;
    averageSynthesisTime: number;
  } {
    // Would track these in production
    return {
      totalSynthesized: 0,
      averageWordCount: 0,
      averageSynthesisTime: 0,
    };
  }
}
