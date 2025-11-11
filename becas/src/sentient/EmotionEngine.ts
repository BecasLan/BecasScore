/**
 * EMOTION SIMULATION ENGINE - Physics-based emotional state
 *
 * Purpose: Give Becas realistic emotional responses
 * - Emotions decay over time (physics-based)
 * - Multiple emotions can coexist (joy + anxiety)
 * - Events influence emotional state
 * - Emotions affect decision making
 *
 * Formula: emotion_state = (emotion_state * decay) + (event_intensity * event_valence)
 */

import { createLogger } from '../services/Logger';
import { StorageService } from '../services/StorageService';

const logger = createLogger('EmotionEngine');

/**
 * Core emotions (Plutchik's wheel simplified)
 */
export type EmotionType =
  | 'joy'           // Happiness, satisfaction
  | 'trust'         // Confidence in users/moderators
  | 'fear'          // Concern, anxiety about server state
  | 'surprise'      // Unexpected events
  | 'sadness'       // Disappointment, concern
  | 'disgust'       // Rejection of toxic behavior
  | 'anger'         // Response to violations
  | 'anticipation'; // Looking forward to outcomes

/**
 * Emotion state (0-1 intensity)
 */
export interface EmotionState {
  emotion: EmotionType;
  intensity: number; // 0-1
  lastUpdate: number; // timestamp
  triggers: string[]; // Recent events that triggered this
}

/**
 * Event that influences emotion
 */
export interface EmotionalEvent {
  type: 'moderation' | 'conversation' | 'achievement' | 'violation' | 'feedback';
  description: string;
  valence: number; // -1 to +1 (negative to positive)
  intensity: number; // 0-1 (how strong)
  primaryEmotion: EmotionType;
  secondaryEmotion?: EmotionType;
  guildId?: string;
}

/**
 * Emotion influence on behavior
 */
export interface EmotionalInfluence {
  confidence: number; // 0-1 (affects decision certainty)
  responseStyle: 'calm' | 'energetic' | 'cautious' | 'assertive' | 'empathetic';
  priorityShift: {
    safety: number; // -1 to +1
    engagement: number;
    learning: number;
  };
}

export class EmotionEngine {
  private emotionStates: Map<EmotionType, EmotionState> = new Map();
  private storage: StorageService;

  // Physics constants
  private readonly DECAY_RATE = 0.95; // Emotions decay 5% per update
  private readonly DECAY_INTERVAL = 60000; // Decay every 60 seconds
  private readonly MIN_INTENSITY = 0.01; // Below this, emotion is forgotten
  private readonly MAX_INTENSITY = 1.0;

  // Emotion mixing rules (which emotions reinforce/suppress others)
  private emotionInteractions: Map<EmotionType, Map<EmotionType, number>> = new Map();

  private decayTimer: NodeJS.Timeout | null = null;

  constructor(storage: StorageService) {
    this.storage = storage;
    this.initializeEmotions();
    this.setupEmotionInteractions();
    logger.info('EmotionEngine initialized');
  }

  /**
   * Initialize all emotions to neutral state
   */
  private initializeEmotions(): void {
    const emotions: EmotionType[] = [
      'joy', 'trust', 'fear', 'surprise',
      'sadness', 'disgust', 'anger', 'anticipation'
    ];

    for (const emotion of emotions) {
      this.emotionStates.set(emotion, {
        emotion,
        intensity: 0.0,
        lastUpdate: Date.now(),
        triggers: [],
      });
    }
  }

  /**
   * Setup emotion interaction rules (Plutchik's theory)
   * Some emotions reinforce each other, some suppress
   */
  private setupEmotionInteractions(): void {
    // Joy reinforces trust, suppresses sadness/fear
    this.emotionInteractions.set('joy', new Map([
      ['trust', 0.2],      // Joy increases trust
      ['anticipation', 0.1],
      ['sadness', -0.3],   // Joy suppresses sadness
      ['fear', -0.2],
    ]));

    // Trust reinforces joy, suppresses fear/disgust
    this.emotionInteractions.set('trust', new Map([
      ['joy', 0.2],
      ['anticipation', 0.1],
      ['fear', -0.3],
      ['disgust', -0.2],
    ]));

    // Fear reinforces surprise, suppresses joy/trust
    this.emotionInteractions.set('fear', new Map([
      ['surprise', 0.1],
      ['anticipation', 0.1],
      ['joy', -0.3],
      ['trust', -0.2],
    ]));

    // Anger reinforces disgust, suppresses joy/trust
    this.emotionInteractions.set('anger', new Map([
      ['disgust', 0.2],
      ['fear', 0.1],
      ['joy', -0.4],
      ['trust', -0.3],
    ]));

    // Sadness suppresses joy/anticipation
    this.emotionInteractions.set('sadness', new Map([
      ['fear', 0.1],
      ['joy', -0.4],
      ['anticipation', -0.2],
    ]));

    // Add other interactions as needed
    logger.debug('Emotion interactions configured');
  }

  /**
   * Process an emotional event (main entry point)
   */
  async processEvent(event: EmotionalEvent): Promise<void> {
    const now = Date.now();

    // Primary emotion response
    const primaryState = this.emotionStates.get(event.primaryEmotion);
    if (primaryState) {
      // Apply physics formula: new_intensity = (old * decay) + (event_intensity * valence)
      const decayFactor = this.calculateDecay(primaryState.lastUpdate, now);
      const eventContribution = event.intensity * Math.abs(event.valence);

      let newIntensity = (primaryState.intensity * decayFactor) + eventContribution;
      newIntensity = Math.max(0, Math.min(this.MAX_INTENSITY, newIntensity));

      primaryState.intensity = newIntensity;
      primaryState.lastUpdate = now;
      primaryState.triggers.push(event.description);

      // Keep only last 5 triggers
      if (primaryState.triggers.length > 5) {
        primaryState.triggers.shift();
      }

      logger.debug(`Emotion ${event.primaryEmotion} → ${(newIntensity * 100).toFixed(1)}% (event: ${event.description})`);
    }

    // Secondary emotion (weaker response)
    if (event.secondaryEmotion) {
      const secondaryState = this.emotionStates.get(event.secondaryEmotion);
      if (secondaryState) {
        const decayFactor = this.calculateDecay(secondaryState.lastUpdate, now);
        const eventContribution = (event.intensity * 0.5) * Math.abs(event.valence);

        let newIntensity = (secondaryState.intensity * decayFactor) + eventContribution;
        newIntensity = Math.max(0, Math.min(this.MAX_INTENSITY, newIntensity));

        secondaryState.intensity = newIntensity;
        secondaryState.lastUpdate = now;
      }
    }

    // Apply emotion interactions (emotions affect each other)
    this.applyEmotionInteractions(event.primaryEmotion);

    // Persist emotional state
    await this.saveEmotionalState();
  }

  /**
   * Calculate decay factor based on time elapsed
   */
  private calculateDecay(lastUpdate: number, now: number): number {
    const timePassed = now - lastUpdate;
    const decayIntervals = timePassed / this.DECAY_INTERVAL;
    return Math.pow(this.DECAY_RATE, decayIntervals);
  }

  /**
   * Apply emotion interactions (emotions influence each other)
   */
  private applyEmotionInteractions(triggerEmotion: EmotionType): void {
    const interactions = this.emotionInteractions.get(triggerEmotion);
    if (!interactions) return;

    const triggerState = this.emotionStates.get(triggerEmotion);
    if (!triggerState) return;

    for (const [targetEmotion, influence] of interactions.entries()) {
      const targetState = this.emotionStates.get(targetEmotion);
      if (!targetState) continue;

      // Influence strength depends on trigger emotion intensity
      const effectStrength = triggerState.intensity * influence;

      let newIntensity = targetState.intensity + effectStrength;
      newIntensity = Math.max(0, Math.min(this.MAX_INTENSITY, newIntensity));

      targetState.intensity = newIntensity;
      targetState.lastUpdate = Date.now();

      if (Math.abs(effectStrength) > 0.05) {
        logger.debug(`  ${triggerEmotion} influenced ${targetEmotion}: ${effectStrength > 0 ? '+' : ''}${(effectStrength * 100).toFixed(1)}%`);
      }
    }
  }

  /**
   * Periodic decay of all emotions
   */
  private applyDecay(): void {
    const now = Date.now();

    for (const [emotion, state] of this.emotionStates.entries()) {
      const decayFactor = this.calculateDecay(state.lastUpdate, now);
      state.intensity *= decayFactor;
      state.lastUpdate = now;

      // Forget emotions below threshold
      if (state.intensity < this.MIN_INTENSITY) {
        state.intensity = 0;
        state.triggers = [];
      }
    }

    logger.debug('Applied emotion decay');
  }

  /**
   * Start decay timer
   */
  startDecay(): void {
    if (this.decayTimer) return;

    this.decayTimer = setInterval(() => {
      this.applyDecay();
      this.saveEmotionalState();
    }, this.DECAY_INTERVAL);

    logger.info('Emotion decay timer started');
  }

  /**
   * Stop decay timer
   */
  stopDecay(): void {
    if (this.decayTimer) {
      clearInterval(this.decayTimer);
      this.decayTimer = null;
      logger.info('Emotion decay timer stopped');
    }
  }

  /**
   * Get current emotional influence on behavior
   */
  getEmotionalInfluence(): EmotionalInfluence {
    const dominantEmotion = this.getDominantEmotion();
    const emotionIntensity = dominantEmotion ? dominantEmotion.intensity : 0;

    // Determine response style based on dominant emotion
    let responseStyle: EmotionalInfluence['responseStyle'] = 'calm';

    if (dominantEmotion) {
      switch (dominantEmotion.emotion) {
        case 'joy':
        case 'anticipation':
          responseStyle = 'energetic';
          break;
        case 'fear':
        case 'surprise':
          responseStyle = 'cautious';
          break;
        case 'anger':
        case 'disgust':
          responseStyle = 'assertive';
          break;
        case 'sadness':
        case 'trust':
          responseStyle = 'empathetic';
          break;
      }
    }

    // Calculate confidence (high trust/joy → high confidence, high fear/sadness → low)
    const trust = this.emotionStates.get('trust')?.intensity || 0;
    const joy = this.emotionStates.get('joy')?.intensity || 0;
    const fear = this.emotionStates.get('fear')?.intensity || 0;
    const sadness = this.emotionStates.get('sadness')?.intensity || 0;

    const confidence = 0.5 + (trust * 0.3) + (joy * 0.2) - (fear * 0.3) - (sadness * 0.2);

    // Calculate priority shifts
    const anger = this.emotionStates.get('anger')?.intensity || 0;
    const disgust = this.emotionStates.get('disgust')?.intensity || 0;
    const anticipation = this.emotionStates.get('anticipation')?.intensity || 0;

    return {
      confidence: Math.max(0, Math.min(1, confidence)),
      responseStyle,
      priorityShift: {
        safety: (fear * 0.5) + (anger * 0.3) - (joy * 0.2),
        engagement: (joy * 0.5) + (trust * 0.3) - (fear * 0.3),
        learning: (trust * 0.4) + (anticipation * 0.3) - (anger * 0.2),
      },
    };
  }

  /**
   * Get dominant emotion
   */
  getDominantEmotion(): EmotionState | null {
    let dominant: EmotionState | null = null;
    let maxIntensity = 0;

    for (const state of this.emotionStates.values()) {
      if (state.intensity > maxIntensity) {
        maxIntensity = state.intensity;
        dominant = state;
      }
    }

    return dominant && dominant.intensity > 0.1 ? dominant : null;
  }

  /**
   * Get all current emotions (for debugging/display)
   */
  getAllEmotions(): Map<EmotionType, EmotionState> {
    return new Map(this.emotionStates);
  }

  /**
   * Get current emotional state (for external access)
   */
  getEmotionalState(): Map<EmotionType, EmotionState> {
    return new Map(this.emotionStates);
  }

  /**
   * Get emotional summary (human-readable)
   */
  getEmotionalSummary(): string {
    const dominant = this.getDominantEmotion();

    if (!dominant) {
      return 'Calm and neutral';
    }

    const secondaryEmotions = Array.from(this.emotionStates.values())
      .filter(s => s.intensity > 0.2 && s.emotion !== dominant.emotion)
      .sort((a, b) => b.intensity - a.intensity)
      .slice(0, 2);

    let summary = `Feeling ${dominant.emotion} (${(dominant.intensity * 100).toFixed(0)}%)`;

    if (secondaryEmotions.length > 0) {
      summary += `, with hints of ${secondaryEmotions.map(e => e.emotion).join(' and ')}`;
    }

    return summary;
  }

  /**
   * Reset all emotions (for testing or special events)
   */
  reset(): void {
    for (const state of this.emotionStates.values()) {
      state.intensity = 0;
      state.triggers = [];
      state.lastUpdate = Date.now();
    }
    logger.info('Emotions reset to neutral');
  }

  /**
   * Save emotional state to storage
   */
  private async saveEmotionalState(): Promise<void> {
    try {
      const stateData = Array.from(this.emotionStates.entries()).map(([emotion, state]) => ({
        emotion,
        intensity: state.intensity,
        lastUpdate: state.lastUpdate,
        triggers: state.triggers,
      }));

      await this.storage.save('emotion_state.json', stateData);
    } catch (error) {
      logger.error('Failed to save emotional state', error);
    }
  }

  /**
   * Load emotional state from storage
   */
  async loadEmotionalState(): Promise<void> {
    try {
      const stateData = await this.storage.load<any[]>('emotion_state.json');

      if (stateData && Array.isArray(stateData)) {
        for (const data of stateData) {
          this.emotionStates.set(data.emotion, {
            emotion: data.emotion,
            intensity: data.intensity,
            lastUpdate: data.lastUpdate,
            triggers: data.triggers || [],
          });
        }
        logger.info('Emotional state loaded from storage');
      }
    } catch (error) {
      logger.error('Failed to load emotional state', error);
    }
  }
}
