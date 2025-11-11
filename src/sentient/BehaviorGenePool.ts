/**
 * BEHAVIOR GENE POOL - Genetic Algorithm for Behavior Evolution
 *
 * Purpose: Evolve optimal moderation behaviors over time
 * - Behaviors represented as "genes" (parameter sets)
 * - Successful behaviors reproduce (crossover + mutation)
 * - Failed behaviors die off (natural selection)
 * - Population evolves toward effectiveness
 *
 * Inspired by: Genetic algorithms, evolutionary computation
 */

import { createLogger } from '../services/Logger';
import { StorageService } from '../services/StorageService';

const logger = createLogger('BehaviorGenePool');

/**
 * A gene represents a specific behavior trait
 */
export interface Gene {
  name: string;
  value: number; // 0-1 normalized
  weight: number; // How important this gene is (0-1)
}

/**
 * A chromosome is a collection of genes (complete behavior profile)
 */
export interface Chromosome {
  id: string;
  genes: Gene[];
  fitness: number; // 0-1 (how well this behavior performs)
  age: number; // How many generations it has survived
  successCount: number; // Successful outcomes
  failureCount: number; // Failed outcomes
  birthGeneration: number;
}

/**
 * Behavior outcome (used for fitness calculation)
 */
export interface BehaviorOutcome {
  chromosomeId: string;
  success: boolean;
  score: number; // 0-1
  context: string; // What situation this was used in
  timestamp: number;
}

/**
 * Evolution statistics
 */
export interface EvolutionStats {
  generation: number;
  populationSize: number;
  avgFitness: number;
  bestFitness: number;
  worstFitness: number;
  diversity: number; // Genetic diversity (0-1)
}

export class BehaviorGenePool {
  private storage: StorageService;
  private population: Chromosome[] = [];
  private generation: number = 0;

  // Genetic algorithm parameters
  private readonly POPULATION_SIZE = 20;
  private readonly ELITE_COUNT = 4; // Top performers always survive
  private readonly MUTATION_RATE = 0.15; // 15% chance of mutation
  private readonly CROSSOVER_RATE = 0.7; // 70% chance of crossover
  private readonly MIN_FITNESS_FOR_SURVIVAL = 0.3;

  // Gene definitions (behavior traits)
  private geneDefinitions: Array<{ name: string; weight: number }> = [
    { name: 'aggression', weight: 0.8 }, // How quickly to take action
    { name: 'caution', weight: 0.9 }, // How carefully to analyze
    { name: 'empathy', weight: 0.7 }, // How much to consider user intent
    { name: 'strictness', weight: 0.85 }, // How strict the rules are
    { name: 'creativity', weight: 0.6 }, // How flexible in responses
    { name: 'patience', weight: 0.7 }, // How much tolerance before action
    { name: 'vigilance', weight: 0.8 }, // How closely to monitor
    { name: 'forgiveness', weight: 0.65 }, // How quickly to forget past issues
  ];

  constructor(storage: StorageService) {
    this.storage = storage;
    logger.info('BehaviorGenePool initialized');
  }

  /**
   * Initialize the gene pool with random population
   */
  async initialize(): Promise<void> {
    // Try to load existing population
    const saved = await this.loadPopulation();

    if (saved) {
      logger.info(`Loaded ${this.population.length} chromosomes from generation ${this.generation}`);
    } else {
      // Create initial random population
      this.population = [];
      for (let i = 0; i < this.POPULATION_SIZE; i++) {
        this.population.push(this.createRandomChromosome());
      }
      logger.info(`Created initial population of ${this.POPULATION_SIZE} chromosomes`);
    }
  }

  /**
   * Create a random chromosome
   */
  private createRandomChromosome(): Chromosome {
    const genes: Gene[] = this.geneDefinitions.map(def => ({
      name: def.name,
      value: Math.random(), // Random 0-1
      weight: def.weight,
    }));

    return {
      id: this.generateId(),
      genes,
      fitness: 0.5, // Start neutral
      age: 0,
      successCount: 0,
      failureCount: 0,
      birthGeneration: this.generation,
    };
  }

  /**
   * Get best chromosome for current situation
   */
  getBestChromosome(): Chromosome {
    if (this.population.length === 0) {
      return this.createRandomChromosome();
    }

    // Return chromosome with highest fitness
    return this.population.reduce((best, current) =>
      current.fitness > best.fitness ? current : best
    );
  }

  /**
   * Record outcome of using a chromosome (for fitness calculation)
   */
  async recordOutcome(outcome: BehaviorOutcome): Promise<void> {
    const chromosome = this.population.find(c => c.id === outcome.chromosomeId);

    if (!chromosome) {
      logger.warn(`Chromosome ${outcome.chromosomeId} not found`);
      return;
    }

    // Update success/failure counts
    if (outcome.success) {
      chromosome.successCount++;
    } else {
      chromosome.failureCount++;
    }

    // Calculate new fitness (weighted average of past and new score)
    const totalOutcomes = chromosome.successCount + chromosome.failureCount;
    const alpha = 0.3; // Learning rate

    chromosome.fitness = (1 - alpha) * chromosome.fitness + alpha * outcome.score;

    logger.debug(
      `Chromosome ${outcome.chromosomeId.substring(0, 8)} updated: ` +
      `fitness=${(chromosome.fitness * 100).toFixed(1)}%, ` +
      `outcomes=${totalOutcomes} (${chromosome.successCount}/${chromosome.failureCount})`
    );

    // Auto-evolve every 50 outcomes
    const totalOutcomesAcrossPopulation = this.population.reduce(
      (sum, c) => sum + c.successCount + c.failureCount, 0
    );

    if (totalOutcomesAcrossPopulation % 50 === 0) {
      logger.info('Auto-evolving population based on outcomes...');
      await this.evolve();
    }
  }

  /**
   * Evolve the population (main genetic algorithm)
   */
  async evolve(): Promise<void> {
    logger.info(`🧬 EVOLUTION STARTING - Generation ${this.generation} → ${this.generation + 1}`);

    // 1. Sort by fitness
    this.population.sort((a, b) => b.fitness - a.fitness);

    const statsBefore = this.getStats();
    logger.info(`  Before: avg=${(statsBefore.avgFitness * 100).toFixed(1)}%, best=${(statsBefore.bestFitness * 100).toFixed(1)}%`);

    // 2. Elite selection (keep best performers)
    const newPopulation: Chromosome[] = this.population.slice(0, this.ELITE_COUNT).map(c => ({
      ...c,
      age: c.age + 1,
    }));

    logger.info(`  Kept ${this.ELITE_COUNT} elite chromosomes`);

    // 3. Selection + Crossover + Mutation
    while (newPopulation.length < this.POPULATION_SIZE) {
      // Tournament selection (pick 2 random, choose best)
      const parent1 = this.tournamentSelect();
      const parent2 = this.tournamentSelect();

      let offspring: Chromosome;

      // Crossover or clone
      if (Math.random() < this.CROSSOVER_RATE) {
        offspring = this.crossover(parent1, parent2);
      } else {
        offspring = this.clone(parent1);
      }

      // Mutation
      if (Math.random() < this.MUTATION_RATE) {
        this.mutate(offspring);
      }

      newPopulation.push(offspring);
    }

    // 4. Replace population
    this.population = newPopulation;
    this.generation++;

    const statsAfter = this.getStats();
    logger.info(`  After: avg=${(statsAfter.avgFitness * 100).toFixed(1)}%, best=${(statsAfter.bestFitness * 100).toFixed(1)}%`);
    logger.info(`🧬 EVOLUTION COMPLETE - Generation ${this.generation}, diversity=${(statsAfter.diversity * 100).toFixed(1)}%`);

    // Save population
    await this.savePopulation();
  }

  /**
   * Tournament selection (select best of N random)
   */
  private tournamentSelect(tournamentSize: number = 3): Chromosome {
    const candidates: Chromosome[] = [];

    for (let i = 0; i < tournamentSize; i++) {
      const randomIndex = Math.floor(Math.random() * this.population.length);
      candidates.push(this.population[randomIndex]);
    }

    return candidates.reduce((best, current) =>
      current.fitness > best.fitness ? current : best
    );
  }

  /**
   * Crossover (combine two parents)
   */
  private crossover(parent1: Chromosome, parent2: Chromosome): Chromosome {
    const genes: Gene[] = [];

    for (let i = 0; i < this.geneDefinitions.length; i++) {
      // Randomly pick gene from parent1 or parent2
      const useParent1 = Math.random() < 0.5;
      const parentGene = useParent1 ? parent1.genes[i] : parent2.genes[i];

      genes.push({
        name: parentGene.name,
        value: parentGene.value,
        weight: parentGene.weight,
      });
    }

    return {
      id: this.generateId(),
      genes,
      fitness: (parent1.fitness + parent2.fitness) / 2, // Average of parents
      age: 0,
      successCount: 0,
      failureCount: 0,
      birthGeneration: this.generation,
    };
  }

  /**
   * Clone a chromosome
   */
  private clone(chromosome: Chromosome): Chromosome {
    return {
      id: this.generateId(),
      genes: chromosome.genes.map(g => ({ ...g })),
      fitness: chromosome.fitness,
      age: 0,
      successCount: 0,
      failureCount: 0,
      birthGeneration: this.generation,
    };
  }

  /**
   * Mutate a chromosome (random gene changes)
   */
  private mutate(chromosome: Chromosome): void {
    // Mutate 1-2 random genes
    const genesToMutate = Math.floor(Math.random() * 2) + 1;

    for (let i = 0; i < genesToMutate; i++) {
      const geneIndex = Math.floor(Math.random() * chromosome.genes.length);
      const gene = chromosome.genes[geneIndex];

      // Small random change (-0.2 to +0.2)
      const mutation = (Math.random() - 0.5) * 0.4;
      gene.value = Math.max(0, Math.min(1, gene.value + mutation));
    }

    logger.debug(`Mutated chromosome ${chromosome.id.substring(0, 8)}`);
  }

  /**
   * Get evolution statistics
   */
  getStats(): EvolutionStats {
    if (this.population.length === 0) {
      return {
        generation: this.generation,
        populationSize: 0,
        avgFitness: 0,
        bestFitness: 0,
        worstFitness: 0,
        diversity: 0,
      };
    }

    const fitnesses = this.population.map(c => c.fitness);
    const avgFitness = fitnesses.reduce((sum, f) => sum + f, 0) / fitnesses.length;
    const bestFitness = Math.max(...fitnesses);
    const worstFitness = Math.min(...fitnesses);

    // Calculate genetic diversity (average distance between chromosomes)
    let totalDistance = 0;
    let comparisons = 0;

    for (let i = 0; i < this.population.length; i++) {
      for (let j = i + 1; j < this.population.length; j++) {
        totalDistance += this.geneticDistance(this.population[i], this.population[j]);
        comparisons++;
      }
    }

    const diversity = comparisons > 0 ? totalDistance / comparisons : 0;

    return {
      generation: this.generation,
      populationSize: this.population.length,
      avgFitness,
      bestFitness,
      worstFitness,
      diversity,
    };
  }

  /**
   * Calculate genetic distance between two chromosomes
   */
  private geneticDistance(c1: Chromosome, c2: Chromosome): number {
    let distance = 0;

    for (let i = 0; i < c1.genes.length; i++) {
      distance += Math.abs(c1.genes[i].value - c2.genes[i].value);
    }

    return distance / c1.genes.length;
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `chr_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Save population to storage
   */
  private async savePopulation(): Promise<void> {
    try {
      await this.storage.save('behavior_genepool.json', {
        generation: this.generation,
        population: this.population,
      });
      logger.debug('Gene pool saved to storage');
    } catch (error) {
      logger.error('Failed to save gene pool', error);
    }
  }

  /**
   * Load population from storage
   */
  private async loadPopulation(): Promise<boolean> {
    try {
      const data = await this.storage.load<any>('behavior_genepool.json');

      if (data && data.population && Array.isArray(data.population)) {
        this.population = data.population;
        this.generation = data.generation || 0;
        return true;
      }

      return false;
    } catch (error) {
      logger.error('Failed to load gene pool', error);
      return false;
    }
  }

  /**
   * Get human-readable representation of chromosome
   */
  describeChromosome(chromosome: Chromosome): string {
    const traits = chromosome.genes
      .filter(g => g.value > 0.6 || g.value < 0.4) // Only mention extreme traits
      .map(g => {
        const level = g.value > 0.6 ? 'high' : 'low';
        return `${level} ${g.name}`;
      })
      .join(', ');

    return traits || 'balanced temperament';
  }
}
