/**
 * BECAS KERNEL - Microkernel Architecture
 *
 * The core orchestration engine - minimal, stable, extensible.
 * Inspired by Linux kernel design: small core + loadable modules.
 *
 * Design Principles:
 * - Minimal core: Only orchestration, no business logic
 * - Plugin-based: All features are plugins (can be loaded/unloaded)
 * - Event-driven: Communication via domain events
 * - Dependency injection: Loose coupling between components
 * - Hot-reload: Plugins can be updated without restarting kernel
 *
 * Architecture:
 * ┌──────────────────────────────────────────┐
 * │         BECAS KERNEL (Orchestrator)      │
 * │  - Event Bus                             │
 * │  - Plugin Manager                        │
 * │  - Service Registry                      │
 * │  - Lifecycle Management                  │
 * └──────────────┬───────────────────────────┘
 *                │
 *    ┌───────────┴───────────┐
 *    │                        │
 * ┌──▼────────┐      ┌───────▼─────────┐
 * │  PLUGINS  │      │    SERVICES     │
 * │           │      │                 │
 * │ - Moderation    │ │ - OllamaService │
 * │ - Trust Score   │ │ - RedisCache    │
 * │ - Analytics     │ │ - VectorStore   │
 * │ - BecasFlow     │ │ - Database      │
 * └───────────┘      └─────────────────┘
 */

import { EventBus, eventBus, DomainEvent } from '../domain/events/DomainEvent';
import { createLogger } from '../services/Logger';

const logger = createLogger('BecasKernel');

// ===================================
// PLUGIN SYSTEM
// ===================================

export interface Plugin {
  name: string;
  version: string;
  description: string;
  dependencies?: string[]; // Other plugin names required

  /**
   * Initialize plugin (load resources, subscribe to events)
   */
  initialize(kernel: BecasKernel): Promise<void>;

  /**
   * Shutdown plugin (cleanup resources)
   */
  shutdown(): Promise<void>;

  /**
   * Health check (is plugin working?)
   */
  healthCheck(): Promise<boolean>;
}

/**
 * Plugin metadata
 */
export interface PluginMetadata {
  name: string;
  version: string;
  description: string;
  dependencies: string[];
  status: 'loaded' | 'initialized' | 'failed' | 'unloaded';
  loadedAt?: Date;
  error?: string;
}

// ===================================
// SERVICE REGISTRY
// ===================================

export interface Service {
  name: string;
  instance: any;
  isHealthy: () => Promise<boolean>;
}

// ===================================
// BECAS KERNEL
// ===================================

export class BecasKernel {
  private plugins: Map<string, Plugin> = new Map();
  private pluginMetadata: Map<string, PluginMetadata> = new Map();
  private services: Map<string, Service> = new Map();
  private eventBus: EventBus = eventBus;
  private isShuttingDown = false;

  /**
   * Kernel lifecycle state
   */
  private state: 'initializing' | 'running' | 'shutdown' = 'initializing';

  constructor() {
    logger.info('🚀 Becas Kernel initializing...');

    // Setup global event handlers
    this.setupEventHandlers();

    // Setup graceful shutdown
    this.setupShutdownHandlers();
  }

  /**
   * Setup global event handlers (for logging, audit)
   */
  private setupEventHandlers(): void {
    // Log all events (audit trail)
    this.eventBus.onAny(async (event: DomainEvent) => {
      logger.debug(`[Event] ${event.eventName}`, {
        eventId: event.metadata.eventId,
        userId: event.metadata.userId,
        guildId: event.metadata.guildId,
      });
    });
  }

  /**
   * Setup graceful shutdown handlers
   */
  private setupShutdownHandlers(): void {
    const gracefulShutdown = async () => {
      if (this.isShuttingDown) return;

      logger.warn('⚠️ Shutdown signal received, gracefully shutting down...');
      this.isShuttingDown = true;

      await this.shutdown();
      process.exit(0);
    };

    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);
  }

  // ===================================
  // PLUGIN MANAGEMENT
  // ===================================

  /**
   * Register plugin (doesn't initialize yet)
   */
  registerPlugin(plugin: Plugin): void {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin already registered: ${plugin.name}`);
    }

    this.plugins.set(plugin.name, plugin);
    this.pluginMetadata.set(plugin.name, {
      name: plugin.name,
      version: plugin.version,
      description: plugin.description,
      dependencies: plugin.dependencies || [],
      status: 'loaded',
    });

    logger.info(`📦 Plugin registered: ${plugin.name} v${plugin.version}`);
  }

  /**
   * Initialize plugin (with dependency resolution)
   */
  async initializePlugin(pluginName: string): Promise<void> {
    const plugin = this.plugins.get(pluginName);
    if (!plugin) {
      throw new Error(`Plugin not found: ${pluginName}`);
    }

    const metadata = this.pluginMetadata.get(pluginName)!;

    // Check if already initialized
    if (metadata.status === 'initialized') {
      logger.warn(`Plugin already initialized: ${pluginName}`);
      return;
    }

    // Resolve dependencies first
    for (const depName of metadata.dependencies) {
      const depMetadata = this.pluginMetadata.get(depName);

      if (!depMetadata) {
        throw new Error(`Dependency not found: ${depName} (required by ${pluginName})`);
      }

      if (depMetadata.status !== 'initialized') {
        logger.info(`Initializing dependency: ${depName} (required by ${pluginName})`);
        await this.initializePlugin(depName);
      }
    }

    // Initialize plugin
    try {
      logger.info(`🔧 Initializing plugin: ${pluginName}...`);
      await plugin.initialize(this);

      metadata.status = 'initialized';
      metadata.loadedAt = new Date();

      logger.info(`✅ Plugin initialized: ${pluginName}`);
    } catch (error: any) {
      metadata.status = 'failed';
      metadata.error = error.message;

      logger.error(`❌ Plugin initialization failed: ${pluginName}`, error);
      throw error;
    }
  }

  /**
   * Initialize all registered plugins (in dependency order)
   */
  async initializeAllPlugins(): Promise<void> {
    logger.info('🔧 Initializing all plugins...');

    // Build dependency graph and initialize in correct order
    const pluginNames = Array.from(this.plugins.keys());

    for (const pluginName of pluginNames) {
      const metadata = this.pluginMetadata.get(pluginName)!;

      if (metadata.status !== 'initialized') {
        await this.initializePlugin(pluginName);
      }
    }

    logger.info(`✅ All plugins initialized (${pluginNames.length} total)`);
  }

  /**
   * Unload plugin (cleanup and remove)
   */
  async unloadPlugin(pluginName: string): Promise<void> {
    const plugin = this.plugins.get(pluginName);
    if (!plugin) {
      throw new Error(`Plugin not found: ${pluginName}`);
    }

    logger.info(`🔌 Unloading plugin: ${pluginName}...`);

    try {
      await plugin.shutdown();

      this.plugins.delete(pluginName);
      const metadata = this.pluginMetadata.get(pluginName)!;
      metadata.status = 'unloaded';

      logger.info(`✅ Plugin unloaded: ${pluginName}`);
    } catch (error: any) {
      logger.error(`❌ Plugin unload failed: ${pluginName}`, error);
      throw error;
    }
  }

  /**
   * Get plugin by name
   */
  getPlugin<T extends Plugin>(pluginName: string): T | undefined {
    return this.plugins.get(pluginName) as T | undefined;
  }

  /**
   * Get all plugin metadata (for admin dashboard)
   */
  getAllPluginMetadata(): PluginMetadata[] {
    return Array.from(this.pluginMetadata.values());
  }

  // ===================================
  // SERVICE REGISTRY
  // ===================================

  /**
   * Register service (for dependency injection)
   */
  registerService(name: string, instance: any, isHealthy?: () => Promise<boolean>): void {
    if (this.services.has(name)) {
      throw new Error(`Service already registered: ${name}`);
    }

    this.services.set(name, {
      name,
      instance,
      isHealthy: isHealthy || (async () => true),
    });

    logger.info(`🔧 Service registered: ${name}`);
  }

  /**
   * Get service by name (dependency injection)
   */
  getService<T>(name: string): T {
    const service = this.services.get(name);
    if (!service) {
      throw new Error(`Service not found: ${name}`);
    }
    return service.instance as T;
  }

  /**
   * Check if service exists
   */
  hasService(name: string): boolean {
    return this.services.has(name);
  }

  // ===================================
  // EVENT BUS ACCESS
  // ===================================

  /**
   * Get event bus (for plugins to subscribe to events)
   */
  getEventBus(): EventBus {
    return this.eventBus;
  }

  /**
   * Publish event (convenience method)
   */
  async publishEvent<T>(event: DomainEvent<T>): Promise<void> {
    await this.eventBus.publish(event);
  }

  // ===================================
  // KERNEL LIFECYCLE
  // ===================================

  /**
   * Start kernel
   */
  async start(): Promise<void> {
    logger.info('🚀 Becas Kernel starting...');

    this.state = 'initializing';

    // Initialize all plugins
    await this.initializeAllPlugins();

    // Run health checks
    await this.runHealthChecks();

    this.state = 'running';

    logger.info('✅ Becas Kernel running');
  }

  /**
   * Shutdown kernel
   */
  async shutdown(): Promise<void> {
    if (this.state === 'shutdown') {
      logger.warn('Kernel already shutdown');
      return;
    }

    logger.info('🛑 Becas Kernel shutting down...');
    this.state = 'shutdown';

    // Shutdown all plugins (in reverse order)
    const pluginNames = Array.from(this.plugins.keys()).reverse();

    for (const pluginName of pluginNames) {
      try {
        await this.unloadPlugin(pluginName);
      } catch (error) {
        logger.error(`Error unloading plugin ${pluginName}:`, error);
      }
    }

    // Clear event bus
    this.eventBus.clear();

    logger.info('✅ Becas Kernel shutdown complete');
  }

  /**
   * Health check for all components
   */
  async runHealthChecks(): Promise<{
    healthy: boolean;
    plugins: { name: string; healthy: boolean }[];
    services: { name: string; healthy: boolean }[];
  }> {
    logger.info('🏥 Running health checks...');

    // Check plugins
    const pluginHealth: { name: string; healthy: boolean }[] = [];

    for (const [name, plugin] of this.plugins) {
      try {
        const healthy = await plugin.healthCheck();
        pluginHealth.push({ name, healthy });

        if (!healthy) {
          logger.warn(`⚠️ Plugin unhealthy: ${name}`);
        }
      } catch (error) {
        logger.error(`❌ Plugin health check failed: ${name}`, error);
        pluginHealth.push({ name, healthy: false });
      }
    }

    // Check services
    const serviceHealth: { name: string; healthy: boolean }[] = [];

    for (const [name, service] of this.services) {
      try {
        const healthy = await service.isHealthy();
        serviceHealth.push({ name, healthy });

        if (!healthy) {
          logger.warn(`⚠️ Service unhealthy: ${name}`);
        }
      } catch (error) {
        logger.error(`❌ Service health check failed: ${name}`, error);
        serviceHealth.push({ name, healthy: false });
      }
    }

    const allHealthy =
      pluginHealth.every(p => p.healthy) &&
      serviceHealth.every(s => s.healthy);

    if (allHealthy) {
      logger.info('✅ All components healthy');
    } else {
      logger.warn('⚠️ Some components unhealthy');
    }

    return {
      healthy: allHealthy,
      plugins: pluginHealth,
      services: serviceHealth,
    };
  }

  /**
   * Get kernel status (for monitoring)
   */
  getStatus(): {
    state: string;
    uptime: number;
    plugins: number;
    services: number;
    eventBusStats: any;
  } {
    return {
      state: this.state,
      uptime: process.uptime(),
      plugins: this.plugins.size,
      services: this.services.size,
      eventBusStats: this.eventBus.getStats(),
    };
  }
}

// ===================================
// SINGLETON KERNEL INSTANCE
// ===================================

export const kernel = new BecasKernel();
