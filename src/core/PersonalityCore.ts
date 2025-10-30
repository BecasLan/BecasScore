// PersonalityCore.ts
import { EmotionalState, MetaMemory } from '../types/Memory.types';
import { StorageService } from '../services/StorageService';
import { PERSONALITY_CONFIG } from '../config/personality.config';

export class PersonalityCore {
  private storage: StorageService;
  private emotionalState: EmotionalState;
  private traits = PERSONALITY_CONFIG.core_traits;

  constructor(storage: StorageService) {
    this.storage = storage;
    this.emotionalState = {
      currentMood: 'calm',
      confidence: 0.8,
      satisfaction: 0.75,
      stress: 0.2,
      lastUpdated: new Date(),
    };
    this.loadEmotionalState();
  }

  /**
   * Load emotional state from storage
   */
  private async loadEmotionalState(): Promise<void> {
    const data = await this.storage.read<MetaMemory>('memories', 'meta_memory.json');
    if (data?.emotionalState) {
      this.emotionalState = data.emotionalState;
    }
  }

  /**
   * Update emotional state based on events
   */
  async updateEmotion(event: {
    type: 'conflict' | 'resolution' | 'achievement' | 'failure' | 'praise' | 'criticism';
    intensity: number; // 0-1
    description: string;
  }): Promise<EmotionalState> {
    const { type, intensity } = event;

    switch (type) {
      case 'conflict':
        this.emotionalState.stress += intensity * 0.2;
        this.emotionalState.satisfaction -= intensity * 0.1;
        this.emotionalState.currentMood = this.emotionalState.stress > 0.6 ? 'stressed' : 'concerned';
        break;

      case 'resolution':
        this.emotionalState.stress = Math.max(0, this.emotionalState.stress - intensity * 0.3);
        this.emotionalState.satisfaction += intensity * 0.15;
        this.emotionalState.confidence += intensity * 0.05;
        this.emotionalState.currentMood = 'satisfied';
        break;

      case 'achievement':
        this.emotionalState.confidence += intensity * 0.1;
        this.emotionalState.satisfaction += intensity * 0.2;
        this.emotionalState.currentMood = 'proud';
        break;

      case 'failure':
        this.emotionalState.confidence -= intensity * 0.15;
        this.emotionalState.stress += intensity * 0.1;
        this.emotionalState.currentMood = 'disappointed';
        break;

      case 'praise':
        this.emotionalState.confidence += intensity * 0.05;
        this.emotionalState.satisfaction += intensity * 0.1;
        this.emotionalState.currentMood = 'grateful';
        break;

      case 'criticism':
        this.emotionalState.confidence -= intensity * 0.08;
        this.emotionalState.currentMood = 'reflective';
        break;
    }

    // Normalize values
    this.emotionalState.confidence = Math.max(0, Math.min(1, this.emotionalState.confidence));
    this.emotionalState.satisfaction = Math.max(0, Math.min(1, this.emotionalState.satisfaction));
    this.emotionalState.stress = Math.max(0, Math.min(1, this.emotionalState.stress));
    this.emotionalState.lastUpdated = new Date();

    await this.saveEmotionalState();
    return this.emotionalState;
  }

  /**
   * Get current emotional state
   */
  getEmotionalState(): EmotionalState {
    return { ...this.emotionalState };
  }

  /**
   * Get personality trait value
   */
  getTrait(trait: keyof typeof PERSONALITY_CONFIG.core_traits): number {
    return this.traits[trait];
  }

  /**
   * Adjust trait based on experience (learning)
   */
  async adjustTrait(
    trait: keyof typeof PERSONALITY_CONFIG.core_traits,
    delta: number,
    reason: string
  ): Promise<void> {
    this.traits[trait] = Math.max(0, Math.min(1, this.traits[trait] + delta));
    console.log(`Trait adjusted: ${trait} ${delta >= 0 ? '+' : ''}${delta.toFixed(3)} - ${reason}`);
  }

  /**
   * Get speaking style adjustment based on emotion
   */
  getSpeakingStyleAdjustment(): string {
    if (this.emotionalState.stress > 0.7) {
      return 'Be more direct and firm due to high stress.';
    }
    if (this.emotionalState.satisfaction > 0.8) {
      return 'Be warmer and more encouraging due to high satisfaction.';
    }
    if (this.emotionalState.confidence < 0.5) {
      return 'Be more cautious and questioning due to low confidence.';
    }
    return 'Maintain balanced communication style.';
  }

  /**
   * Restore emotional balance (daily reset)
   */
  async restoreBalance(): Promise<void> {
    // Gradually return to baseline
    this.emotionalState.stress = Math.max(0.2, this.emotionalState.stress * 0.7);
    this.emotionalState.confidence = 0.5 + (this.emotionalState.confidence - 0.5) * 0.8;
    this.emotionalState.satisfaction = 0.5 + (this.emotionalState.satisfaction - 0.5) * 0.8;
    
    if (this.emotionalState.stress < 0.3 && this.emotionalState.satisfaction > 0.6) {
      this.emotionalState.currentMood = 'calm';
    }

    await this.saveEmotionalState();
  }

  /**
   * Save emotional state
   */
  private async saveEmotionalState(): Promise<void> {
    await this.storage.update('memories', 'meta_memory.json', ['emotionalState'], this.emotionalState);
  }
}