/**
 * DREAM CYCLE - Nightly Learning & Memory Synthesis
 *
 * Purpose: Process experiences during low-activity periods
 * - Consolidate memories (like REM sleep)
 * - Extract patterns from daily interactions
 * - Update behavior strategies
 * - Synthesize insights
 * - Clean up irrelevant memories
 *
 * Runs: During low server activity (typically 2-6 AM)
 */

import { createLogger } from '../services/Logger';
import { StorageService } from '../services/StorageService';
import { VectorStore } from '../memory/VectorStore';
import { BehaviorGenePool } from './BehaviorGenePool';
import { EmotionEngine } from './EmotionEngine';
import { OllamaService } from '../services/OllamaService';

const logger = createLogger('DreamCycle');

/**
 * Memory to be processed during dream cycle
 */
export interface DreamMemory {
  id: string;
  content: string;
  type: 'interaction' | 'decision' | 'outcome' | 'pattern';
  timestamp: number;
  importance: number; // 0-1
  emotionalValence: number; // -1 to +1
  guildId?: string;
}

/**
 * Insight extracted from dreams
 */
export interface DreamInsight {
  id: string;
  category: 'pattern' | 'strategy' | 'relationship' | 'rule';
  insight: string;
  confidence: number; // 0-1
  evidence: string[]; // Memory IDs that support this
  timestamp: number;
}

/**
 * Dream cycle statistics
 */
export interface DreamCycleStats {
  lastCycle: number;
  cycleCount: number;
  memoriesProcessed: number;
  insightsGenerated: number;
  patternsFound: number;
  memoryCompressionRatio: number; // How much memory was consolidated
  avgCycleDurationMs: number;
}

export class DreamCycle {
  private storage: StorageService;
  private vectorStore: VectorStore;
  private genePool: BehaviorGenePool;
  private emotionEngine: EmotionEngine;
  private ollama: OllamaService;

  // Dream cycle scheduling
  private isActive: boolean = false;
  private scheduledCycle: NodeJS.Timeout | null = null;
  private stats: DreamCycleStats;

  // Configuration
  private readonly CYCLE_START_HOUR = 2; // 2 AM
  private readonly CYCLE_END_HOUR = 6; // 6 AM
  private readonly MIN_MEMORIES_FOR_CYCLE = 10;
  private readonly MEMORY_RETENTION_THRESHOLD = 0.3; // Below this, memory is forgotten

  constructor(
    storage: StorageService,
    vectorStore: VectorStore,
    genePool: BehaviorGenePool,
    emotionEngine: EmotionEngine,
    ollama: OllamaService
  ) {
    this.storage = storage;
    this.vectorStore = vectorStore;
    this.genePool = genePool;
    this.emotionEngine = emotionEngine;
    this.ollama = ollama;

    this.stats = {
      lastCycle: 0,
      cycleCount: 0,
      memoriesProcessed: 0,
      insightsGenerated: 0,
      patternsFound: 0,
      memoryCompressionRatio: 0,
      avgCycleDurationMs: 0,
    };

    logger.info('DreamCycle initialized');
  }

  /**
   * Start dream cycle scheduler
   */
  async start(): Promise<void> {
    if (this.isActive) return;

    // Load stats
    await this.loadStats();

    // Schedule first dream cycle
    this.scheduleCycle();

    this.isActive = true;
    logger.info('DreamCycle scheduler started');
  }

  /**
   * Stop dream cycle scheduler
   */
  stop(): void {
    if (this.scheduledCycle) {
      clearTimeout(this.scheduledCycle);
      this.scheduledCycle = null;
    }

    this.isActive = false;
    logger.info('DreamCycle scheduler stopped');
  }

  /**
   * Schedule next dream cycle
   */
  private scheduleCycle(): void {
    const now = new Date();
    const currentHour = now.getHours();

    // Calculate next dream window
    let nextCycle = new Date(now);

    if (currentHour < this.CYCLE_START_HOUR) {
      // Today's cycle hasn't started yet
      nextCycle.setHours(this.CYCLE_START_HOUR, 0, 0, 0);
    } else {
      // Schedule for tomorrow
      nextCycle.setDate(nextCycle.getDate() + 1);
      nextCycle.setHours(this.CYCLE_START_HOUR, 0, 0, 0);
    }

    const msUntilCycle = nextCycle.getTime() - now.getTime();

    logger.info(`Next dream cycle scheduled for ${nextCycle.toLocaleString()} (in ${Math.round(msUntilCycle / 1000 / 60 / 60)} hours)`);

    this.scheduledCycle = setTimeout(async () => {
      await this.runDreamCycle();
      this.scheduleCycle(); // Schedule next cycle
    }, msUntilCycle);
  }

  /**
   * Run a complete dream cycle
   */
  async runDreamCycle(): Promise<void> {
    const startTime = Date.now();
    logger.info('🌙 ===== DREAM CYCLE STARTING =====');

    try {
      // Step 1: Gather memories from today
      logger.info('Step 1: Gathering memories...');
      const memories = await this.gatherMemories();
      logger.info(`  Collected ${memories.length} memories`);

      if (memories.length < this.MIN_MEMORIES_FOR_CYCLE) {
        logger.info('  Not enough memories to process. Skipping cycle.');
        return;
      }

      // Step 2: Consolidate similar memories
      logger.info('Step 2: Consolidating memories...');
      const consolidatedCount = await this.consolidateMemories(memories);
      logger.info(`  Consolidated ${consolidatedCount} similar memories`);

      // Step 3: Extract patterns
      logger.info('Step 3: Extracting patterns...');
      const patterns = await this.extractPatterns(memories);
      logger.info(`  Found ${patterns.length} behavioral patterns`);

      // Step 4: Generate insights
      logger.info('Step 4: Generating insights...');
      const insights = await this.generateInsights(memories, patterns);
      logger.info(`  Generated ${insights.length} insights`);

      // Step 5: Update behavior strategies
      logger.info('Step 5: Updating behavior strategies...');
      await this.updateBehaviorStrategies(insights);

      // Step 6: Process emotional patterns
      logger.info('Step 6: Processing emotional patterns...');
      await this.processEmotionalPatterns(memories);

      // Step 7: Cleanup old memories
      logger.info('Step 7: Cleaning up old memories...');
      const cleanedCount = await this.cleanupOldMemories();
      logger.info(`  Removed ${cleanedCount} low-importance memories`);

      // Update stats
      const duration = Date.now() - startTime;
      this.stats.lastCycle = startTime;
      this.stats.cycleCount++;
      this.stats.memoriesProcessed += memories.length;
      this.stats.insightsGenerated += insights.length;
      this.stats.patternsFound += patterns.length;
      this.stats.memoryCompressionRatio = consolidatedCount / memories.length;
      this.stats.avgCycleDurationMs =
        (this.stats.avgCycleDurationMs * (this.stats.cycleCount - 1) + duration) / this.stats.cycleCount;

      await this.saveStats();

      logger.info(`🌙 ===== DREAM CYCLE COMPLETE (${Math.round(duration / 1000)}s) =====`);

    } catch (error) {
      logger.error('Dream cycle failed', error);
    }
  }

  /**
   * Gather memories from storage
   */
  private async gatherMemories(): Promise<DreamMemory[]> {
    // In real implementation, this would query recent interactions
    // For now, return empty array
    // TODO: Integrate with VectorStore to get recent memories
    return [];
  }

  /**
   * Consolidate similar memories (compress storage)
   */
  private async consolidateMemories(memories: DreamMemory[]): Promise<number> {
    // Group similar memories together and create summary
    // This is like how human brain consolidates memories during sleep

    let consolidatedCount = 0;

    // Group by similarity (using embeddings)
    const groups: Map<string, DreamMemory[]> = new Map();

    for (const memory of memories) {
      // Search for similar memories
      const similar = await this.vectorStore.search(memory.content, {
        topK: 3,
        type: 'conversation',
      });

      if (similar.length > 1) {
        // Found similar memories - group them
        const groupKey = similar[0].id;
        if (!groups.has(groupKey)) {
          groups.set(groupKey, []);
        }
        groups.get(groupKey)!.push(memory);
      }
    }

    // Consolidate each group into a single memory
    for (const [groupKey, groupMemories] of groups.entries()) {
      if (groupMemories.length >= 3) {
        // Create consolidated memory
        const avgImportance = groupMemories.reduce((sum, m) => sum + m.importance, 0) / groupMemories.length;

        // Store consolidated memory
        await this.vectorStore.store({
          id: `consolidated_${Date.now()}`,
          text: `Pattern: ${groupMemories.length} similar interactions`,
          metadata: {
            timestamp: Date.now(),
            type: 'pattern',
            importance: avgImportance,
            originalCount: groupMemories.length,
          },
        });

        consolidatedCount += groupMemories.length - 1; // -1 because we keep the consolidated one
      }
    }

    return consolidatedCount;
  }

  /**
   * Extract behavioral patterns from memories
   */
  private async extractPatterns(memories: DreamMemory[]): Promise<string[]> {
    // Use AI to identify recurring patterns
    const patterns: string[] = [];

    try {
      const memoryText = memories.slice(0, 20).map(m => m.content).join('\n');

      const prompt = `Analyze these interactions and identify behavioral patterns:

${memoryText}

List 3-5 key patterns you notice. Be specific and actionable.`;

      const response = await this.ollama.generateJSON<{ patterns: string[] }>(
        prompt,
        'You are analyzing behavioral patterns. Return JSON: { "patterns": ["pattern1", "pattern2", ...] }'
      );

      if (response.patterns && Array.isArray(response.patterns)) {
        patterns.push(...response.patterns);
      }

    } catch (error) {
      logger.error('Pattern extraction failed', error);
    }

    return patterns;
  }

  /**
   * Generate insights from patterns
   */
  private async generateInsights(memories: DreamMemory[], patterns: string[]): Promise<DreamInsight[]> {
    const insights: DreamInsight[] = [];

    for (const pattern of patterns) {
      insights.push({
        id: `insight_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        category: 'pattern',
        insight: pattern,
        confidence: 0.7,
        evidence: memories.slice(0, 3).map(m => m.id),
        timestamp: Date.now(),
      });
    }

    // Store insights
    for (const insight of insights) {
      await this.vectorStore.store({
        id: insight.id,
        text: insight.insight,
        metadata: {
          timestamp: insight.timestamp,
          type: 'outcome',
          category: insight.category,
          confidence: insight.confidence,
        },
      });
    }

    return insights;
  }

  /**
   * Update behavior strategies based on insights
   */
  private async updateBehaviorStrategies(insights: DreamInsight[]): Promise<void> {
    // Trigger gene pool evolution based on insights
    const genePoolStats = this.genePool.getStats();

    if (genePoolStats.generation > 0 && insights.length > 0) {
      logger.info('Triggering behavior evolution based on insights...');
      await this.genePool.evolve();
    }
  }

  /**
   * Process emotional patterns
   */
  private async processEmotionalPatterns(memories: DreamMemory[]): Promise<void> {
    // Analyze emotional trends
    const avgValence = memories.reduce((sum, m) => sum + m.emotionalValence, 0) / memories.length;

    logger.debug(`Average emotional valence: ${avgValence.toFixed(2)}`);

    // If consistently negative, adjust emotional baseline
    if (avgValence < -0.3) {
      logger.info('Detected negative emotional pattern - adjusting baseline');
      // Could trigger emotional reset or adjustment here
    }
  }

  /**
   * Clean up old, low-importance memories
   */
  private async cleanupOldMemories(): Promise<number> {
    // TODO: Implement memory cleanup
    // Delete memories older than 30 days with importance < threshold
    return 0;
  }

  /**
   * Get dream cycle statistics
   */
  getStats(): DreamCycleStats {
    return { ...this.stats };
  }

  /**
   * Force run dream cycle (for testing)
   */
  async forceRun(): Promise<void> {
    logger.info('🌙 Manual dream cycle triggered');
    await this.runDreamCycle();
  }

  /**
   * Save stats to storage
   */
  private async saveStats(): Promise<void> {
    try {
      await this.storage.save('dreamcycle_stats.json', this.stats);
    } catch (error) {
      logger.error('Failed to save dream cycle stats', error);
    }
  }

  /**
   * Load stats from storage
   */
  private async loadStats(): Promise<void> {
    try {
      const saved = await this.storage.load<DreamCycleStats>('dreamcycle_stats.json');
      if (saved) {
        this.stats = saved;
        logger.info(`Loaded dream cycle stats: ${this.stats.cycleCount} cycles completed`);
      }
    } catch (error) {
      logger.error('Failed to load dream cycle stats', error);
    }
  }
}
