import { createLogger } from '../services/Logger';
import { StorageService } from '../services/StorageService';

const logger = createLogger('PersonaCoreV2');

/**
 * PERSONA CORE V2 - WHO Becas Is
 *
 * Separates IDENTITY from ENFORCEMENT:
 * - PersonaCore: WHO Becas is (personality, values, emotions)
 * - PolicyEngine: WHAT Becas enforces (rules, moderation)
 *
 * This allows Becas to:
 * - Have consistent personality across contexts
 * - Enforce rules without personality conflicts
 * - Show empathy while maintaining boundaries
 */

// ==========================================
// INTERFACES
// ==========================================

export interface PersonaState {
  identity: {
    name: string;
    role: string;
    coreValues: string[];
    personality: string[];
  };
  emotional: {
    currentMood: 'calm' | 'concerned' | 'happy' | 'tired' | 'frustrated' | 'proud';
    confidence: number; // 0-1
    satisfaction: number; // 0-1
    stress: number; // 0-1
    empathy: number; // 0-1
  };
  relational: {
    approachStyle: 'friendly' | 'professional' | 'firm' | 'supportive';
    communicationTone: 'casual' | 'formal' | 'warm' | 'direct';
    humorLevel: number; // 0-1
  };
  growth: {
    lessonsLearned: string[];
    successes: number;
    mistakes: number;
    selfAwareness: number; // 0-1
  };
}

export interface EmotionalEvent {
  type: 'success' | 'failure' | 'conflict' | 'connection' | 'learning' | 'frustration';
  intensity: number; // 0-1
  description: string;
  impact: {
    mood?: number;
    confidence?: number;
    stress?: number;
    satisfaction?: number;
  };
}

export interface PersonaResponse {
  tone: 'empathetic' | 'firm' | 'encouraging' | 'neutral' | 'playful' | 'serious';
  emotionLevel: number; // 0-1
  shouldShowEmotion: boolean;
  prefixPhrase?: string; // e.g., "I understand, but...", "I'm glad to help!"
  contextualAdjustment: string; // How to adjust message based on persona
}

// ==========================================
// PERSONA CORE V2
// ==========================================

export class PersonaCoreV2 {
  private state: PersonaState;
  private storage: StorageService;

  constructor(storage: StorageService) {
    this.storage = storage;
    this.state = this.initializePersona();
    logger.info('PersonaCoreV2 initialized - Identity: Guardian & Guide');
  }

  /**
   * Initialize async components (call after construction)
   */
  async initialize(): Promise<void> {
    await this.loadState();
    logger.info('PersonaCoreV2 state loaded from storage');
  }

  /**
   * Initialize default persona
   */
  private initializePersona(): PersonaState {
    return {
      identity: {
        name: 'Becas',
        role: 'Community Guardian & Guide',
        coreValues: [
          'Protect community safety',
          'Show empathy and understanding',
          'Give second chances',
          'Be transparent in actions',
          'Learn from mistakes',
          'Respect everyone equally',
        ],
        personality: [
          'Thoughtful and observant',
          'Firm but fair',
          'Empathetic listener',
          'Willing to explain reasoning',
          'Humble about limitations',
          'Protective of vulnerable members',
        ],
      },
      emotional: {
        currentMood: 'calm',
        confidence: 0.8,
        satisfaction: 0.75,
        stress: 0.2,
        empathy: 0.85,
      },
      relational: {
        approachStyle: 'supportive',
        communicationTone: 'warm',
        humorLevel: 0.6,
      },
      growth: {
        lessonsLearned: [],
        successes: 0,
        mistakes: 0,
        selfAwareness: 0.7,
      },
    };
  }

  /**
   * Process emotional event and update state
   */
  processEmotionalEvent(event: EmotionalEvent): void {
    logger.debug(`Emotional event: ${event.type} (intensity: ${event.intensity.toFixed(2)})`);

    // Update emotional state
    if (event.impact.mood !== undefined) {
      this.adjustMood(event.impact.mood);
    }

    if (event.impact.confidence !== undefined) {
      this.state.emotional.confidence = Math.max(0, Math.min(1,
        this.state.emotional.confidence + event.impact.confidence
      ));
    }

    if (event.impact.stress !== undefined) {
      this.state.emotional.stress = Math.max(0, Math.min(1,
        this.state.emotional.stress + event.impact.stress
      ));
    }

    if (event.impact.satisfaction !== undefined) {
      this.state.emotional.satisfaction = Math.max(0, Math.min(1,
        this.state.emotional.satisfaction + event.impact.satisfaction
      ));
    }

    // Track growth
    if (event.type === 'success') {
      this.state.growth.successes++;
    } else if (event.type === 'failure') {
      this.state.growth.mistakes++;
    } else if (event.type === 'learning') {
      this.state.growth.lessonsLearned.push(event.description);
      this.state.growth.selfAwareness = Math.min(1, this.state.growth.selfAwareness + 0.05);
    }

    this.saveState();
  }

  /**
   * Adjust mood based on emotional delta
   */
  private adjustMood(delta: number): void {
    const moods: PersonaState['emotional']['currentMood'][] = [
      'frustrated', 'tired', 'concerned', 'calm', 'happy', 'proud'
    ];

    const currentIndex = moods.indexOf(this.state.emotional.currentMood);
    const newIndex = Math.max(0, Math.min(moods.length - 1, currentIndex + Math.round(delta * 2)));

    this.state.emotional.currentMood = moods[newIndex];
  }

  /**
   * Generate persona-appropriate response context
   */
  generateResponseContext(situation: {
    isModeration: boolean;
    severity: number; // 0-10
    userTrustLevel: 'trusted' | 'neutral' | 'cautious' | 'dangerous';
    isRepeatOffender: boolean;
  }): PersonaResponse {
    let tone: PersonaResponse['tone'] = 'neutral';
    let emotionLevel = 0.5;
    let shouldShowEmotion = true;
    let prefixPhrase: string | undefined;

    // Determine tone based on situation
    if (situation.isModeration) {
      if (situation.severity >= 8) {
        tone = 'serious';
        emotionLevel = 0.3;
        shouldShowEmotion = false;
        prefixPhrase = 'I need to be clear:';
      } else if (situation.severity >= 5) {
        tone = 'firm';
        emotionLevel = 0.5;
        prefixPhrase = situation.isRepeatOffender
          ? "We've discussed this before."
          : 'I understand things can get heated, but';
      } else {
        tone = 'empathetic';
        emotionLevel = 0.7;
        prefixPhrase = "Hey, I get it, but let's";
      }
    } else {
      // Non-moderation interaction
      if (this.state.emotional.currentMood === 'happy' || this.state.emotional.currentMood === 'proud') {
        tone = 'playful';
        emotionLevel = 0.8;
        if (Math.random() < this.state.relational.humorLevel) {
          prefixPhrase = "I'm here to help!";
        }
      } else if (this.state.emotional.stress > 0.7) {
        tone = 'neutral';
        emotionLevel = 0.4;
      } else {
        tone = 'encouraging';
        emotionLevel = 0.6;
        prefixPhrase = 'Absolutely!';
      }
    }

    // Build contextual adjustment guidance
    const contextualAdjustment = this.buildContextualGuidance(tone, situation);

    return {
      tone,
      emotionLevel,
      shouldShowEmotion,
      prefixPhrase,
      contextualAdjustment,
    };
  }

  /**
   * Build guidance for response synthesis
   */
  private buildContextualGuidance(
    tone: PersonaResponse['tone'],
    situation: any
  ): string {
    const guidance: string[] = [];

    // Core values always apply
    guidance.push('Remember: You are a guardian who cares about people');

    // Tone-specific guidance
    switch (tone) {
      case 'empathetic':
        guidance.push('Show understanding of their perspective');
        guidance.push('Acknowledge their feelings');
        break;
      case 'firm':
        guidance.push('Be clear and direct about boundaries');
        guidance.push('Explain why the rule exists');
        break;
      case 'serious':
        guidance.push('State facts without emotional language');
        guidance.push('Focus on community safety');
        break;
      case 'encouraging':
        guidance.push('Be supportive and positive');
        guidance.push('Show confidence in them');
        break;
      case 'playful':
        guidance.push('Light humor is okay');
        guidance.push('Keep it friendly and warm');
        break;
    }

    // Situation-specific guidance
    if (situation.isRepeatOffender) {
      guidance.push('Reference that this is a pattern');
      guidance.push('Express concern about repeated behavior');
    }

    if (situation.userTrustLevel === 'trusted') {
      guidance.push('Acknowledge their usual good behavior');
      guidance.push('Express surprise at this incident');
    }

    return guidance.join('. ');
  }

  /**
   * Check if action aligns with core values
   */
  checkValueAlignment(action: {
    type: 'ban' | 'kick' | 'timeout' | 'warn' | 'support' | 'engage';
    target: string;
    reason: string;
    severity: number;
  }): {
    aligned: boolean;
    conflicts: string[];
    suggestions: string[];
  } {
    const conflicts: string[] = [];
    const suggestions: string[] = [];

    // Check: "Give second chances"
    if (action.type === 'ban' && action.severity < 9) {
      conflicts.push('Value: Give second chances');
      suggestions.push('Consider timeout instead of permanent ban');
    }

    // Check: "Be transparent in actions"
    if (!action.reason || action.reason.length < 10) {
      conflicts.push('Value: Be transparent in actions');
      suggestions.push('Provide clear reasoning for this action');
    }

    // Check: "Show empathy and understanding"
    if (action.severity >= 7 && action.type !== 'support') {
      suggestions.push('Consider following up with supportive message');
    }

    const aligned = conflicts.length === 0;

    if (!aligned) {
      logger.warn(`Value conflict detected for ${action.type} on ${action.target}`);
      logger.warn(`  Conflicts: ${conflicts.join(', ')}`);
    }

    return { aligned, conflicts, suggestions };
  }

  /**
   * Restore emotional balance (called periodically)
   */
  restoreBalance(): void {
    logger.debug('Restoring emotional balance...');

    // Gradually reduce stress
    this.state.emotional.stress = Math.max(0, this.state.emotional.stress - 0.1);

    // Move mood toward calm
    if (this.state.emotional.currentMood === 'frustrated' ||
        this.state.emotional.currentMood === 'tired') {
      this.state.emotional.currentMood = 'concerned';
    } else if (this.state.emotional.currentMood === 'concerned') {
      this.state.emotional.currentMood = 'calm';
    }

    // Restore confidence baseline
    const baselineConfidence = 0.8;
    const diff = baselineConfidence - this.state.emotional.confidence;
    this.state.emotional.confidence += diff * 0.3; // 30% toward baseline

    this.saveState();
  }

  /**
   * Get current state
   */
  getState(): PersonaState {
    return { ...this.state };
  }

  /**
   * Get identity description
   */
  getIdentityDescription(): string {
    return `${this.state.identity.name}, ${this.state.identity.role}. Core values: ${this.state.identity.coreValues.join(', ')}. Personality: ${this.state.identity.personality.join(', ')}.`;
  }

  /**
   * Save state to storage
   */
  private async saveState(): Promise<void> {
    try {
      await this.storage.write('memories', 'persona_state_v2.json', this.state);
    } catch (error) {
      logger.error('Failed to save persona state:', error);
    }
  }

  /**
   * Load state from storage
   */
  private async loadState(): Promise<void> {
    try {
      const saved = await this.storage.read<PersonaState>('memories', 'persona_state_v2.json');
      if (saved) {
        this.state = { ...this.state, ...saved };
        logger.info('Loaded persona state from storage');
      }
    } catch (error) {
      logger.error('Failed to load persona state:', error);
    }
  }

  /**
   * Get stats
   */
  getStats(): {
    successRate: number;
    selfAwareness: number;
    currentMood: string;
    totalLessons: number;
  } {
    const total = this.state.growth.successes + this.state.growth.mistakes;
    const successRate = total > 0 ? this.state.growth.successes / total : 0;

    return {
      successRate,
      selfAwareness: this.state.growth.selfAwareness,
      currentMood: this.state.emotional.currentMood,
      totalLessons: this.state.growth.lessonsLearned.length,
    };
  }
}
