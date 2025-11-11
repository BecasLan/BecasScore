/**
 * DATA AUGMENTATION PLUGIN
 *
 * Automatically generates synthetic training examples to improve model robustness
 * and handle edge cases. Uses various augmentation techniques to expand datasets.
 *
 * Augmentation Techniques:
 * - Paraphrasing (rewrite examples with different wording)
 * - Adversarial examples (intentionally challenging cases)
 * - Noise injection (typos, capitalization, punctuation)
 * - Back-translation (translate to another language and back)
 * - Entity replacement (swap names, links, etc.)
 * - Contextual variations (different emotional tones)
 *
 * Architecture:
 * AdvancedFineTuningPlugin → DataAugmentationPlugin → Generate Synthetic Examples →
 * → Quality Check → Add to Training Pool
 */

import { Plugin, BecasKernel } from '../kernel/BecasKernel';
import { AdvancedFineTuningPlugin, TrainingCategory, AdvancedTrainingExample } from './AdvancedFineTuningPlugin';
import { OllamaService } from '../services/OllamaService';
import { createLogger } from '../services/Logger';

const logger = createLogger('DataAugmentationPlugin');

export type AugmentationTechnique =
  | 'paraphrase'
  | 'adversarial'
  | 'noise_injection'
  | 'entity_replacement'
  | 'contextual_variation'
  | 'negation_flip'
  | 'intensity_variation';

export interface AugmentedExample {
  original: AdvancedTrainingExample;
  augmented: AdvancedTrainingExample;
  technique: AugmentationTechnique;
  changes: string[];
}

/**
 * Data Augmentation Plugin
 */
export class DataAugmentationPlugin implements Plugin {
  name = 'data_augmentation';
  version = '1.0.0';
  description = 'Automatic training data augmentation and synthetic example generation';
  dependencies = ['advanced_fine_tuning'];

  private kernel!: BecasKernel;
  private fineTuningPlugin!: AdvancedFineTuningPlugin;
  private ollamaService!: OllamaService;

  // Augmentation cache
  private augmentedExamples: Map<string, AugmentedExample[]> = new Map();

  // Configuration
  private readonly AUGMENTATION_RATE = 0.3; // Augment 30% of gold/silver examples
  private readonly MAX_AUGMENTATIONS_PER_EXAMPLE = 3;
  private readonly MIN_QUALITY_FOR_AUGMENTATION = 0.75; // Silver tier+

  /**
   * Initialize plugin
   */
  async initialize(kernel: BecasKernel): Promise<void> {
    this.kernel = kernel;

    logger.info('🎨 Initializing Data Augmentation Plugin...');

    // Get dependencies
    this.fineTuningPlugin = kernel.getPlugin<AdvancedFineTuningPlugin>('advanced_fine_tuning')!;
    this.ollamaService = kernel.getService<OllamaService>('ollama')!;

    if (!this.fineTuningPlugin || !this.ollamaService) {
      throw new Error('Required dependencies not found: advanced_fine_tuning, ollama');
    }

    logger.info('✅ Data Augmentation Plugin initialized');
    logger.info(`   → Augmentation rate: ${this.AUGMENTATION_RATE * 100}%`);
    logger.info(`   → Max augmentations per example: ${this.MAX_AUGMENTATIONS_PER_EXAMPLE}`);
    logger.info(`   → Min quality for augmentation: ${this.MIN_QUALITY_FOR_AUGMENTATION}`);
  }

  /**
   * Augment a training example
   */
  async augmentExample(
    example: AdvancedTrainingExample,
    techniques: AugmentationTechnique[] = ['paraphrase', 'noise_injection', 'contextual_variation']
  ): Promise<AugmentedExample[]> {
    const augmented: AugmentedExample[] = [];

    try {
      for (const technique of techniques.slice(0, this.MAX_AUGMENTATIONS_PER_EXAMPLE)) {
        const augmentedExample = await this.applyTechnique(example, technique);

        if (augmentedExample) {
          augmented.push(augmentedExample);
        }
      }

      // Cache augmentations
      this.augmentedExamples.set(example.id, augmented);

      logger.debug(`Generated ${augmented.length} augmented examples for ${example.id}`);
    } catch (error: any) {
      logger.error(`Failed to augment example ${example.id}:`, error);
    }

    return augmented;
  }

  /**
   * Apply specific augmentation technique
   */
  private async applyTechnique(
    example: AdvancedTrainingExample,
    technique: AugmentationTechnique
  ): Promise<AugmentedExample | null> {
    switch (technique) {
      case 'paraphrase':
        return this.paraphrase(example);
      case 'noise_injection':
        return this.injectNoise(example);
      case 'adversarial':
        return this.generateAdversarial(example);
      case 'entity_replacement':
        return this.replaceEntities(example);
      case 'contextual_variation':
        return this.varyContext(example);
      case 'negation_flip':
        return this.flipNegation(example);
      case 'intensity_variation':
        return this.varyIntensity(example);
      default:
        return null;
    }
  }

  /**
   * Paraphrase: Rewrite with different wording but same meaning
   */
  private async paraphrase(example: AdvancedTrainingExample): Promise<AugmentedExample | null> {
    try {
      const prompt = `Paraphrase this text while preserving the exact meaning:

Original: "${this.extractMessageFromInput(example.input)}"

Requirements:
- Different wording, same meaning
- Natural language
- Similar length
- No information loss

Provide only the paraphrased text.`;

      const paraphrased = await this.ollamaService.generate(prompt, undefined, { temperature: 0.7 });

      const augmentedInput = example.input.replace(
        this.extractMessageFromInput(example.input),
        paraphrased.trim()
      );

      const augmentedExample: AdvancedTrainingExample = {
        ...example,
        id: `${example.id}_paraphrase`,
        input: augmentedInput,
        metadata: {
          ...example.metadata,
          augmented: true,
          augmentationTechnique: 'paraphrase',
        },
      };

      return {
        original: example,
        augmented: augmentedExample,
        technique: 'paraphrase',
        changes: ['Paraphrased message content'],
      };
    } catch (error: any) {
      logger.error('Paraphrasing failed:', error);
      return null;
    }
  }

  /**
   * Noise Injection: Add typos, capitalization changes, punctuation
   */
  private async injectNoise(example: AdvancedTrainingExample): Promise<AugmentedExample | null> {
    try {
      const message = this.extractMessageFromInput(example.input);
      const changes: string[] = [];

      let noisyMessage = message;

      // Random typos (10% of words)
      const words = noisyMessage.split(' ');
      const numTypos = Math.floor(words.length * 0.1);

      for (let i = 0; i < numTypos; i++) {
        const randomIndex = Math.floor(Math.random() * words.length);
        const word = words[randomIndex];

        if (word.length > 3) {
          // Swap two adjacent characters
          const charIndex = Math.floor(Math.random() * (word.length - 1));
          const chars = word.split('');
          [chars[charIndex], chars[charIndex + 1]] = [chars[charIndex + 1], chars[charIndex]];
          words[randomIndex] = chars.join('');
          changes.push(`Typo in word: ${word} → ${words[randomIndex]}`);
        }
      }

      noisyMessage = words.join(' ');

      // Random capitalization (20% of words)
      const numCaps = Math.floor(words.length * 0.2);
      for (let i = 0; i < numCaps; i++) {
        const randomIndex = Math.floor(Math.random() * words.length);
        words[randomIndex] = Math.random() > 0.5
          ? words[randomIndex].toUpperCase()
          : words[randomIndex].toLowerCase();
      }

      noisyMessage = words.join(' ');

      // Random punctuation removal
      if (Math.random() > 0.5) {
        noisyMessage = noisyMessage.replace(/[.,!?]/g, '');
        changes.push('Removed punctuation');
      }

      const augmentedInput = example.input.replace(message, noisyMessage);

      const augmentedExample: AdvancedTrainingExample = {
        ...example,
        id: `${example.id}_noise`,
        input: augmentedInput,
        metadata: {
          ...example.metadata,
          augmented: true,
          augmentationTechnique: 'noise_injection',
        },
      };

      return {
        original: example,
        augmented: augmentedExample,
        technique: 'noise_injection',
        changes,
      };
    } catch (error: any) {
      logger.error('Noise injection failed:', error);
      return null;
    }
  }

  /**
   * Adversarial: Generate intentionally challenging cases
   */
  private async generateAdversarial(example: AdvancedTrainingExample): Promise<AugmentedExample | null> {
    try {
      const message = this.extractMessageFromInput(example.input);

      const prompt = `Generate an adversarial example that is similar to this message but intentionally challenging for AI to classify correctly:

Original: "${message}"
Category: ${example.category}

Requirements:
- Subtle changes that make classification harder
- Edge case scenario
- Still falls under the same category
- More ambiguous than original

Provide only the adversarial message.`;

      const adversarial = await this.ollamaService.generate(prompt, undefined, { temperature: 0.8 });

      const augmentedInput = example.input.replace(message, adversarial.trim());

      // Slightly reduce quality for adversarial examples
      const augmentedExample: AdvancedTrainingExample = {
        ...example,
        id: `${example.id}_adversarial`,
        input: augmentedInput,
        quality: {
          ...example.quality,
          score: Math.max(0.6, example.quality.score * 0.9),
          factors: {
            ...example.quality.factors,
            isEdgeCase: true,
          },
        },
        metadata: {
          ...example.metadata,
          augmented: true,
          augmentationTechnique: 'adversarial',
        },
      };

      return {
        original: example,
        augmented: augmentedExample,
        technique: 'adversarial',
        changes: ['Generated adversarial edge case'],
      };
    } catch (error: any) {
      logger.error('Adversarial generation failed:', error);
      return null;
    }
  }

  /**
   * Entity Replacement: Replace names, URLs, etc.
   */
  private async replaceEntities(example: AdvancedTrainingExample): Promise<AugmentedExample | null> {
    try {
      const message = this.extractMessageFromInput(example.input);
      let modifiedMessage = message;
      const changes: string[] = [];

      // Replace URLs
      const urlRegex = /(https?:\/\/[^\s]+)/gi;
      const urls = message.match(urlRegex);

      if (urls) {
        const replacementUrls = [
          'https://example.com/phishing',
          'https://scam-site.xyz',
          'https://malicious-link.com',
          'https://fake-airdrop.io',
        ];

        urls.forEach((url, index) => {
          const replacement = replacementUrls[index % replacementUrls.length];
          modifiedMessage = modifiedMessage.replace(url, replacement);
          changes.push(`Replaced URL: ${url} → ${replacement}`);
        });
      }

      // Replace common names
      const names = ['John', 'Alice', 'Bob', 'Charlie', 'David', 'Emma'];
      names.forEach(name => {
        if (message.includes(name)) {
          const replacement = names[Math.floor(Math.random() * names.length)];
          modifiedMessage = modifiedMessage.replace(new RegExp(name, 'g'), replacement);
          changes.push(`Replaced name: ${name} → ${replacement}`);
        }
      });

      if (changes.length === 0) return null;

      const augmentedInput = example.input.replace(message, modifiedMessage);

      const augmentedExample: AdvancedTrainingExample = {
        ...example,
        id: `${example.id}_entity_replace`,
        input: augmentedInput,
        metadata: {
          ...example.metadata,
          augmented: true,
          augmentationTechnique: 'entity_replacement',
        },
      };

      return {
        original: example,
        augmented: augmentedExample,
        technique: 'entity_replacement',
        changes,
      };
    } catch (error: any) {
      logger.error('Entity replacement failed:', error);
      return null;
    }
  }

  /**
   * Contextual Variation: Change emotional tone while preserving content
   */
  private async varyContext(example: AdvancedTrainingExample): Promise<AugmentedExample | null> {
    try {
      const message = this.extractMessageFromInput(example.input);

      const tones = ['angry', 'sarcastic', 'frustrated', 'joking', 'serious', 'worried'];
      const tone = tones[Math.floor(Math.random() * tones.length)];

      const prompt = `Rewrite this message with a ${tone} tone while preserving the core content:

Original: "${message}"

Requirements:
- Same core message
- ${tone} emotional tone
- Natural language
- Similar length

Provide only the rewritten message.`;

      const varied = await this.ollamaService.generate(prompt, undefined, { temperature: 0.7 });

      const augmentedInput = example.input.replace(message, varied.trim());

      const augmentedExample: AdvancedTrainingExample = {
        ...example,
        id: `${example.id}_context_${tone}`,
        input: augmentedInput,
        metadata: {
          ...example.metadata,
          augmented: true,
          augmentationTechnique: 'contextual_variation',
          emotionalTone: tone,
        },
      };

      return {
        original: example,
        augmented: augmentedExample,
        technique: 'contextual_variation',
        changes: [`Changed tone to: ${tone}`],
      };
    } catch (error: any) {
      logger.error('Contextual variation failed:', error);
      return null;
    }
  }

  /**
   * Negation Flip: Add or remove negations
   */
  private async flipNegation(example: AdvancedTrainingExample): Promise<AugmentedExample | null> {
    try {
      const message = this.extractMessageFromInput(example.input);

      const prompt = `Add or remove negations in this message to create a contrasting example:

Original: "${message}"

Requirements:
- Flip meaning through negation
- Natural language
- Clear opposite meaning
- Update expected output accordingly

Provide only the modified message.`;

      const flipped = await this.ollamaService.generate(prompt, undefined, { temperature: 0.6 });

      const augmentedInput = example.input.replace(message, flipped.trim());

      // Need to flip the expected output as well
      const augmentedOutput = example.output.replace(/YES/g, 'TEMP')
        .replace(/NO/g, 'YES')
        .replace(/TEMP/g, 'NO');

      const augmentedExample: AdvancedTrainingExample = {
        ...example,
        id: `${example.id}_negation_flip`,
        input: augmentedInput,
        output: augmentedOutput,
        metadata: {
          ...example.metadata,
          augmented: true,
          augmentationTechnique: 'negation_flip',
        },
      };

      return {
        original: example,
        augmented: augmentedExample,
        technique: 'negation_flip',
        changes: ['Flipped negations'],
      };
    } catch (error: any) {
      logger.error('Negation flip failed:', error);
      return null;
    }
  }

  /**
   * Intensity Variation: Increase or decrease severity/intensity
   */
  private async varyIntensity(example: AdvancedTrainingExample): Promise<AugmentedExample | null> {
    try {
      const message = this.extractMessageFromInput(example.input);

      const direction = Math.random() > 0.5 ? 'increase' : 'decrease';

      const prompt = `${direction === 'increase' ? 'Intensify' : 'Soften'} this message:

Original: "${message}"

Requirements:
- ${direction === 'increase' ? 'More extreme/aggressive' : 'More subtle/mild'}
- Same core topic
- Natural language

Provide only the modified message.`;

      const varied = await this.ollamaService.generate(prompt, undefined, { temperature: 0.7 });

      const augmentedInput = example.input.replace(message, varied.trim());

      const augmentedExample: AdvancedTrainingExample = {
        ...example,
        id: `${example.id}_intensity_${direction}`,
        input: augmentedInput,
        metadata: {
          ...example.metadata,
          augmented: true,
          augmentationTechnique: 'intensity_variation',
          intensityDirection: direction,
        },
      };

      return {
        original: example,
        augmented: augmentedExample,
        technique: 'intensity_variation',
        changes: [`${direction === 'increase' ? 'Increased' : 'Decreased'} intensity`],
      };
    } catch (error: any) {
      logger.error('Intensity variation failed:', error);
      return null;
    }
  }

  /**
   * Extract message content from input prompt
   */
  private extractMessageFromInput(input: string): string {
    // Try to extract message between quotes
    const match = input.match(/"([^"]*)"/);
    if (match && match[1]) {
      return match[1];
    }

    // Fallback: extract after "Message:"
    const messageMatch = input.match(/Message:\s*(.+?)(?:\n|$)/);
    if (messageMatch && messageMatch[1]) {
      return messageMatch[1];
    }

    // Last resort: use first line
    return input.split('\n')[0];
  }

  /**
   * Batch augment multiple examples
   */
  async batchAugment(
    examples: AdvancedTrainingExample[],
    techniques: AugmentationTechnique[] = ['paraphrase', 'noise_injection']
  ): Promise<AugmentedExample[]> {
    const allAugmented: AugmentedExample[] = [];

    logger.info(`🎨 Batch augmenting ${examples.length} examples...`);

    for (const example of examples) {
      // Only augment high-quality examples
      if (example.quality.score < this.MIN_QUALITY_FOR_AUGMENTATION) {
        continue;
      }

      // Random sampling based on augmentation rate
      if (Math.random() > this.AUGMENTATION_RATE) {
        continue;
      }

      const augmented = await this.augmentExample(example, techniques);
      allAugmented.push(...augmented);
    }

    logger.info(`✅ Generated ${allAugmented.length} augmented examples`);

    return allAugmented;
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalAugmented: number;
    byTechnique: Record<AugmentationTechnique, number>;
    avgQualityImprovement: number;
  } {
    const stats = {
      totalAugmented: 0,
      byTechnique: {} as Record<AugmentationTechnique, number>,
      avgQualityImprovement: 0,
    };

    let totalQualityDelta = 0;

    for (const augmentations of this.augmentedExamples.values()) {
      stats.totalAugmented += augmentations.length;

      for (const aug of augmentations) {
        stats.byTechnique[aug.technique] = (stats.byTechnique[aug.technique] || 0) + 1;
        totalQualityDelta += aug.augmented.quality.score - aug.original.quality.score;
      }
    }

    if (stats.totalAugmented > 0) {
      stats.avgQualityImprovement = totalQualityDelta / stats.totalAugmented;
    }

    return stats;
  }

  /**
   * Shutdown plugin
   */
  async shutdown(): Promise<void> {
    logger.info('🛑 Shutting down Data Augmentation Plugin...');

    const stats = this.getStats();
    logger.info(`   → ${stats.totalAugmented} augmented examples generated`);

    if (stats.totalAugmented > 0) {
      logger.info('   → By technique:');
      for (const [technique, count] of Object.entries(stats.byTechnique)) {
        logger.info(`      • ${technique}: ${count}`);
      }
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    return this.fineTuningPlugin !== undefined && this.ollamaService !== undefined;
  }
}
