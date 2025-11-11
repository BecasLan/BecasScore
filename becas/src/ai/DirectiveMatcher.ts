/**
 * DIRECTIVE MATCHER - Command & Policy Intent Recognition
 *
 * Purpose: Match user messages against admin directives/commands
 * - Admin commands (ban, kick, purge, etc.)
 * - Server policies (spam rules, toxicity thresholds)
 * - Moderation actions
 * - Custom guild-specific directives
 *
 * Uses: SemanticLayer for embedding-based matching
 */

import { SemanticLayer, IntentMatch } from './SemanticLayer';
import { VectorStore, SearchResult } from '../memory/VectorStore';
import { createLogger } from '../services/Logger';

const logger = createLogger('DirectiveMatcher');

export interface Directive {
  id: string;
  name: string;
  description: string;
  examples: string[]; // Example phrases that trigger this directive
  action: string; // What action to take (ban, kick, warn, delete, etc.)
  severity: 'low' | 'medium' | 'high' | 'critical';
  requiresConfirmation: boolean;
  guildId?: string; // Guild-specific directive
  metadata?: any;
}

export interface DirectiveMatch {
  directive: Directive;
  confidence: number; // 0-1
  similarity: number; // 0-1
  matchedVia: 'semantic' | 'vector' | 'keyword';
  reasoning?: string;
}

export class DirectiveMatcher {
  private semanticLayer: SemanticLayer;
  private vectorStore: VectorStore;
  private directives: Map<string, Directive> = new Map();
  private isInitialized = false;

  constructor() {
    this.semanticLayer = new SemanticLayer();
    this.vectorStore = new VectorStore();
    logger.info('DirectiveMatcher created');
  }

  /**
   * Initialize semantic layer and vector store
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      logger.debug('Initializing DirectiveMatcher...');

      // Initialize semantic layer
      await this.semanticLayer.initialize();

      // Ensure intents are loaded (ONLY DirectiveMatcher needs this)
      await this.semanticLayer.ensureIntentsLoaded();

      // Initialize vector store (for stored directives)
      await this.vectorStore.initialize('becas_directives');

      // Load default directives
      await this.loadDefaultDirectives();

      this.isInitialized = true;
      logger.info('DirectiveMatcher initialized successfully');

    } catch (error) {
      logger.error('Failed to initialize DirectiveMatcher', error);
      throw error;
    }
  }

  /**
   * Match a message against known directives
   */
  async matchDirective(
    message: string,
    guildId?: string,
    threshold = 0.75
  ): Promise<DirectiveMatch | null> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      // Step 1: Try semantic intent matching (fast)
      const intentMatch = await this.semanticLayer.findIntent(message, threshold);

      if (intentMatch) {
        // Find directive associated with this intent
        const directive = this.findDirectiveByIntent(intentMatch.intent);

        if (directive) {
          // Check guild-specific constraints
          if (directive.guildId && directive.guildId !== guildId) {
            logger.debug(`Directive ${directive.name} is guild-specific, skipping`);
          } else {
            logger.info(`Matched directive: ${directive.name} (semantic, ${(intentMatch.confidence * 100).toFixed(1)}%)`);

            return {
              directive,
              confidence: intentMatch.confidence,
              similarity: intentMatch.similarity,
              matchedVia: 'semantic',
              reasoning: `Semantically similar to "${intentMatch.intent}"`,
            };
          }
        }
      }

      // Step 2: Try vector similarity search (stored directives)
      const vectorResults = await this.vectorStore.search(message, {
        topK: 3,
        filter: guildId ? { guildId } : undefined,
        type: 'directive',
      });

      if (vectorResults.length > 0) {
        const bestMatch = vectorResults[0];

        // Convert distance to similarity (ChromaDB uses L2 distance)
        const similarity = 1 / (1 + bestMatch.distance);

        if (similarity >= threshold) {
          const directive = this.directives.get(bestMatch.id);

          if (directive) {
            logger.info(`Matched directive: ${directive.name} (vector, ${(similarity * 100).toFixed(1)}%)`);

            return {
              directive,
              confidence: similarity,
              similarity,
              matchedVia: 'vector',
              reasoning: `Similar to stored directive: "${bestMatch.text}"`,
            };
          }
        }
      }

      // No match found
      logger.debug(`No directive match found for: "${message.substring(0, 50)}..."`);
      return null;

    } catch (error) {
      logger.error('Directive matching failed', error);
      return null;
    }
  }

  /**
   * Register a new directive
   */
  async registerDirective(directive: Directive): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      // Store in memory
      this.directives.set(directive.id, directive);

      // Register intent in semantic layer (will skip if already exists due to deduplication)
      await this.semanticLayer.registerIntent(
        directive.name,
        directive.examples,
        {
          directiveId: directive.id,
          action: directive.action,
          severity: directive.severity,
        }
      );

      // Store in vector database (for persistence) - ONLY if not default directive
      // Default directives are already handled by SemanticLayer's loadKnownIntents()
      if (!this.isDefaultDirective(directive.name)) {
        await this.vectorStore.store({
          id: directive.id,
          text: `${directive.name}: ${directive.description}. Examples: ${directive.examples.join(', ')}`,
          metadata: {
            timestamp: Date.now(),
            guildId: directive.guildId,
            type: 'directive',
            action: directive.action,
            severity: directive.severity,
            requiresConfirmation: directive.requiresConfirmation,
          },
        });
      }

      logger.debug(`Registered directive: ${directive.name} (${directive.examples.length} examples)`);

    } catch (error) {
      logger.error(`Failed to register directive: ${directive.name}`, error);
    }
  }

  /**
   * Check if directive is a default one (already loaded by SemanticLayer)
   */
  private isDefaultDirective(name: string): boolean {
    const defaultIntents = [
      'ban_user',
      'delete_messages',
      'warn_user',
      'get_stats',
      'find_user',
      'create_rule',
      'kick_user',     // We'll add these to SemanticLayer
      'timeout_user',  // We'll add these to SemanticLayer
    ];
    return defaultIntents.includes(name);
  }

  /**
   * Register multiple directives (batch)
   */
  async registerDirectives(directives: Directive[]): Promise<void> {
    logger.debug(`Registering ${directives.length} directives...`);

    for (const directive of directives) {
      await this.registerDirective(directive);
    }

    logger.info(`All directives registered`);
  }

  /**
   * Remove a directive
   */
  async removeDirective(directiveId: string): Promise<void> {
    this.directives.delete(directiveId);
    await this.vectorStore.delete(directiveId);
    logger.info(`Removed directive: ${directiveId}`);
  }

  /**
   * Get all registered directives
   */
  getAllDirectives(): Directive[] {
    return Array.from(this.directives.values());
  }

  /**
   * Get directives for a specific guild
   */
  getGuildDirectives(guildId: string): Directive[] {
    return Array.from(this.directives.values()).filter(
      d => !d.guildId || d.guildId === guildId
    );
  }

  /**
   * Find directive by intent name
   */
  private findDirectiveByIntent(intentName: string): Directive | undefined {
    for (const directive of this.directives.values()) {
      if (directive.name === intentName) {
        return directive;
      }
    }
    return undefined;
  }

  /**
   * Load default moderation directives
   *
   * NOTE: This method is now DISABLED because all intents are already loaded
   * by SemanticLayer.loadKnownIntents(). We only need to create the directive
   * metadata that maps to those existing intents.
   */
  private async loadDefaultDirectives(): Promise<void> {
    logger.info('✅ Default directives already loaded by SemanticLayer (skipping duplicate registration)');

    // Just create directive metadata (no embedding generation)
    const defaultDirectives: Directive[] = [
      {
        id: 'dir_ban_user',
        name: 'ban_user',
        description: 'Permanently ban a user from the server',
        examples: [],  // Empty - already embedded by SemanticLayer
        action: 'ban',
        severity: 'critical',
        requiresConfirmation: true,
      },
      {
        id: 'dir_kick_user',
        name: 'kick_user',
        description: 'Kick a user from the server (they can rejoin)',
        examples: [],
        action: 'kick',
        severity: 'high',
        requiresConfirmation: true,
      },
      {
        id: 'dir_warn_user',
        name: 'warn_user',
        description: 'Issue a warning to a user',
        examples: [],
        action: 'warn',
        severity: 'medium',
        requiresConfirmation: false,
      },
      {
        id: 'dir_delete_messages',
        name: 'delete_messages',
        description: 'Delete messages from the channel',
        examples: [],
        action: 'purge',
        severity: 'medium',
        requiresConfirmation: true,
      },
      {
        id: 'dir_timeout_user',
        name: 'timeout_user',
        description: 'Temporarily mute a user',
        examples: [],
        action: 'timeout',
        severity: 'medium',
        requiresConfirmation: false,
      },
      {
        id: 'dir_get_stats',
        name: 'get_stats',
        description: 'Show server or user statistics',
        examples: [],
        action: 'query_stats',
        severity: 'low',
        requiresConfirmation: false,
      },
      {
        id: 'dir_find_user',
        name: 'find_user',
        description: 'Search for a user in the server',
        examples: [],
        action: 'query_user',
        severity: 'low',
        requiresConfirmation: false,
      },
      {
        id: 'dir_create_rule',
        name: 'create_rule',
        description: 'Create a new server rule or policy',
        examples: [],
        action: 'governance_create',
        severity: 'high',
        requiresConfirmation: true,
      },
    ];

    // Only store metadata in memory (no embedding generation!)
    for (const directive of defaultDirectives) {
      this.directives.set(directive.id, directive);
    }

    logger.info(`✅ Loaded ${defaultDirectives.length} default directive metadata (intents already embedded)`);
  }

  /**
   * Get stats about directives
   */
  async getStats() {
    const vectorStats = await this.vectorStore.getStats();

    return {
      totalDirectives: this.directives.size,
      vectorStoreCount: vectorStats.count,
      vectorStoreAvailable: vectorStats.isAvailable,
      registeredIntents: this.semanticLayer.getRegisteredIntents().length,
    };
  }
}
