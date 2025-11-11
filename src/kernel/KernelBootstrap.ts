/**
 * KERNEL BOOTSTRAP
 *
 * Initializes and wires up the BecasKernel architecture alongside existing BecasCore.
 * This allows gradual migration - both systems run in parallel.
 *
 * Architecture:
 * Discord Client → DiscordAdapter → Kernel → Plugins
 *                ↘ BecasCore (existing) ↗
 */

import { Client } from 'discord.js';
import { BecasKernel } from './BecasKernel';
import { DiscordAdapter } from './DiscordAdapter';
import { ModerationPlugin } from '../plugins/ModerationPlugin';
import { EnforcementPlugin } from '../plugins/EnforcementPlugin';
import { TrustScorePlugin } from '../plugins/TrustScorePlugin';
import { AnalyticsPlugin } from '../plugins/AnalyticsPlugin';
import { VectorStorePlugin } from '../plugins/VectorStorePlugin';
import { RAGPlugin } from '../plugins/RAGPlugin';
import { FineTuningPlugin } from '../plugins/FineTuningPlugin';
import { AdvancedFineTuningPlugin } from '../plugins/AdvancedFineTuningPlugin';
import { ModelABTestingPlugin } from '../plugins/ModelABTestingPlugin';
import { FineTuningOrchestratorPlugin } from '../plugins/FineTuningOrchestratorPlugin';
import { ActiveLearningPlugin } from '../plugins/ActiveLearningPlugin';
import { ContinuousFineTuningPlugin } from '../plugins/ContinuousFineTuningPlugin';
import { MultiGuildModelPlugin } from '../plugins/MultiGuildModelPlugin';
import { ModelEnsemblePlugin } from '../plugins/ModelEnsemblePlugin';
import { ExplainabilityPlugin } from '../plugins/ExplainabilityPlugin';
import { AdversarialRobustnessPlugin } from '../plugins/AdversarialRobustnessPlugin';
import { PerformanceMonitoringPlugin } from '../plugins/PerformanceMonitoringPlugin';
import { DatasetVersioningPlugin } from '../plugins/DatasetVersioningPlugin';
import { HyperparameterOptimizationPlugin } from '../plugins/HyperparameterOptimizationPlugin';
import { ModelCompressionPlugin } from '../plugins/ModelCompressionPlugin';
import { OllamaService } from '../services/OllamaService';
import { createLogger } from '../services/Logger';

const logger = createLogger('KernelBootstrap');

export interface KernelBootstrapOptions {
  client: Client;
  ollamaService?: OllamaService;
}

export class KernelBootstrap {
  private kernel: BecasKernel;
  private adapter: DiscordAdapter;
  private client: Client;

  constructor(options: KernelBootstrapOptions) {
    this.client = options.client;
    this.kernel = new BecasKernel();
    this.adapter = new DiscordAdapter(this.client, this.kernel);
  }

  /**
   * Initialize kernel + plugins + adapter
   */
  async initialize(options: { ollamaService?: OllamaService } = {}): Promise<void> {
    logger.info('');
    logger.info('═'.repeat(60));
    logger.info('🚀 BECAS KERNEL ARCHITECTURE - INITIALIZING');
    logger.info('═'.repeat(60));

    try {
      // Step 1: Register services in kernel
      logger.info('📦 Step 1: Registering services...');
      this.registerServices(options.ollamaService);

      // Step 2: Register plugins
      logger.info('🔌 Step 2: Registering plugins...');
      this.registerPlugins();

      // Step 3: Start kernel (initializes all plugins)
      logger.info('⚡ Step 3: Starting kernel...');
      await this.kernel.start();

      // Step 4: Initialize Discord adapter
      logger.info('🔗 Step 4: Connecting Discord adapter...');
      await this.adapter.initialize();

      logger.info('');
      logger.info('✅ KERNEL ARCHITECTURE READY');
      logger.info('═'.repeat(60));
      logger.info('🎯 Event Flow:');
      logger.info('   Discord.js → DiscordAdapter → Kernel Event Bus → Plugins');
      logger.info('');
      logger.info('🔌 Active Plugins:');
      const plugins = this.kernel.getAllPluginMetadata();
      for (const plugin of plugins) {
        const status = plugin.status === 'initialized' ? '✅' : '❌';
        logger.info(`   ${status} ${plugin.name} v${plugin.version}`);
      }
      logger.info('═'.repeat(60));
      logger.info('');
    } catch (error: any) {
      logger.error('❌ Failed to initialize kernel architecture:', error);
      throw error;
    }
  }

  /**
   * Register services in kernel's service registry
   */
  private registerServices(ollamaService?: OllamaService): void {
    // Register Discord client
    this.kernel.registerService('discord_client', this.client);
    logger.info('   ✓ discord_client');

    // Register Ollama service if provided
    if (ollamaService) {
      this.kernel.registerService('ollama', ollamaService);
      logger.info('   ✓ ollama');
    }

    logger.info('   → 2 services registered');
  }

  /**
   * Register all plugins
   */
  private registerPlugins(): void {
    // Core Moderation Plugins
    // 1. ModerationPlugin - detects violations
    this.kernel.registerPlugin(new ModerationPlugin());
    logger.info('   ✓ moderation - AI-powered violation detection');

    // 2. EnforcementPlugin - executes moderation actions
    this.kernel.registerPlugin(new EnforcementPlugin());
    logger.info('   ✓ enforcement - automatic action execution');

    // 3. TrustScorePlugin - manages user trust scores
    this.kernel.registerPlugin(new TrustScorePlugin());
    logger.info('   ✓ trust_score - reputation management');

    // 4. AnalyticsPlugin - tracks all events
    this.kernel.registerPlugin(new AnalyticsPlugin());
    logger.info('   ✓ analytics - event tracking & monitoring');

    // AI Enhancement Plugins
    // 5. VectorStorePlugin - semantic message storage
    this.kernel.registerPlugin(new VectorStorePlugin());
    logger.info('   ✓ vector_store - semantic message storage & retrieval');

    // 6. RAGPlugin - context-aware AI decisions
    this.kernel.registerPlugin(new RAGPlugin());
    logger.info('   ✓ rag - context-aware AI enhancement');

    // 7. FineTuningPlugin - basic training data collection
    this.kernel.registerPlugin(new FineTuningPlugin());
    logger.info('   ✓ fine_tuning - basic training data collection');

    // 8. AdvancedFineTuningPlugin - comprehensive multi-model training data
    this.kernel.registerPlugin(new AdvancedFineTuningPlugin());
    logger.info('   ✓ advanced_fine_tuning - 14 category comprehensive collection');

    // 9. ModelABTestingPlugin - model performance comparison
    this.kernel.registerPlugin(new ModelABTestingPlugin());
    logger.info('   ✓ model_ab_testing - automated model comparison & validation');

    // 10. FineTuningOrchestratorPlugin - complete fine-tuning pipeline
    this.kernel.registerPlugin(new FineTuningOrchestratorPlugin());
    logger.info('   ✓ fine_tuning_orchestrator - end-to-end pipeline automation');

    // Ultimate Fine-Tuning System Plugins
    // 11. ActiveLearningPlugin - intelligent uncertainty-based labeling
    this.kernel.registerPlugin(new ActiveLearningPlugin());
    logger.info('   ✓ active_learning - uncertainty sampling & human-in-the-loop');

    // 12. ContinuousFineTuningPlugin - incremental model updates
    this.kernel.registerPlugin(new ContinuousFineTuningPlugin());
    logger.info('   ✓ continuous_fine_tuning - online learning & replay buffers');

    // 13. MultiGuildModelPlugin - per-server customization
    this.kernel.registerPlugin(new MultiGuildModelPlugin());
    logger.info('   ✓ multi_guild_model - federated learning & guild-specific models');

    // 14. ModelEnsemblePlugin - multi-model predictions
    this.kernel.registerPlugin(new ModelEnsemblePlugin());
    logger.info('   ✓ model_ensemble - voting & confidence-weighted aggregation');

    // 15. ExplainabilityPlugin - AI decision transparency
    this.kernel.registerPlugin(new ExplainabilityPlugin());
    logger.info('   ✓ explainability - feature importance & decision explanations');

    // 16. AdversarialRobustnessPlugin - attack resilience
    this.kernel.registerPlugin(new AdversarialRobustnessPlugin());
    logger.info('   ✓ adversarial_robustness - attack testing & defensive training');

    // 17. PerformanceMonitoringPlugin - real-time metrics
    this.kernel.registerPlugin(new PerformanceMonitoringPlugin());
    logger.info('   ✓ performance_monitoring - drift detection & alerts');

    // 18. DatasetVersioningPlugin - dataset version control
    this.kernel.registerPlugin(new DatasetVersioningPlugin());
    logger.info('   ✓ dataset_versioning - diffing, merging & deduplication');

    // 19. HyperparameterOptimizationPlugin - automated tuning
    this.kernel.registerPlugin(new HyperparameterOptimizationPlugin());
    logger.info('   ✓ hyperparameter_optimization - Bayesian & grid search');

    // 20. ModelCompressionPlugin - size reduction
    this.kernel.registerPlugin(new ModelCompressionPlugin());
    logger.info('   ✓ model_compression - quantization, pruning & distillation');

    logger.info('   → 20 plugins registered (10 core + 10 ultimate fine-tuning)');
  }

  /**
   * Get kernel instance (for accessing plugins)
   */
  getKernel(): BecasKernel {
    return this.kernel;
  }

  /**
   * Get specific plugin by type
   */
  getPlugin<T>(pluginName: string): T | undefined {
    return this.kernel.getPlugin<any>(pluginName) as T | undefined;
  }

  /**
   * Get analytics plugin (for dashboard integration)
   */
  getAnalyticsPlugin(): AnalyticsPlugin | undefined {
    return this.kernel.getPlugin<AnalyticsPlugin>('analytics');
  }

  /**
   * Get trust score plugin (for dashboard integration)
   */
  getTrustScorePlugin(): TrustScorePlugin | undefined {
    return this.kernel.getPlugin<TrustScorePlugin>('trust_score');
  }

  /**
   * Run health checks on all components
   */
  async healthCheck(): Promise<{
    healthy: boolean;
    details: {
      kernel: boolean;
      adapter: boolean;
      plugins: Array<{ name: string; healthy: boolean }>;
    };
  }> {
    const kernelHealth = await this.kernel.runHealthChecks();
    const adapterHealth = await this.adapter.healthCheck();

    const healthy = kernelHealth.healthy && adapterHealth;

    return {
      healthy,
      details: {
        kernel: kernelHealth.healthy,
        adapter: adapterHealth,
        plugins: kernelHealth.plugins,
      },
    };
  }

  /**
   * Shutdown kernel architecture
   */
  async shutdown(): Promise<void> {
    logger.info('🛑 Shutting down kernel architecture...');

    try {
      // Shutdown adapter first
      await this.adapter.shutdown();

      // Then shutdown kernel (which shuts down all plugins)
      await this.kernel.shutdown();

      logger.info('✅ Kernel architecture shutdown complete');
    } catch (error: any) {
      logger.error('Error during kernel shutdown:', error);
    }
  }
}
