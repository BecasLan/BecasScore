/**
 * BECAS CONTEXT - CONVERSATION MEMORY & STATE MANAGEMENT
 *
 * Manages conversation history, execution state, and context chaining.
 * Enables AI to reference previous results ("them", "those users", "that channel").
 *
 * Features:
 * - Conversation history (last N queries and results)
 * - Reference resolution ("ban them" → resolves "them" from previous query)
 * - Variable storage (shared state across steps)
 * - Service injection (trustEngine, v3Integration, etc.)
 * - Smart caching (frequently accessed data)
 */

import { Message, Guild, GuildMember, TextChannel } from 'discord.js';
import { BecasContext as IBecasContext } from '../types/BecasFlow.types';
import { createLogger } from '../../services/Logger';

const logger = createLogger('BecasContext');

export class BecasContext implements IBecasContext {
  // Discord context
  message: Message;
  guild: Guild;
  channel: TextChannel;
  member: GuildMember;

  // Execution state
  conversationHistory: Array<{
    query: string;
    timestamp: number;
    results: Map<string, any>;
  }> = [];

  currentPlan?: any;
  stepResults: Map<string, any> = new Map();
  variables: Map<string, any> = new Map();

  // References from previous queries
  lastUsers?: string[];
  lastMessages?: string[];
  lastChannels?: string[];

  // Dependencies
  services: {
    trustEngine?: any;
    v3Integration?: any;
    unifiedMemory?: any;
    policyEngine?: any;
    [key: string]: any;
  } = {};

  // Cache
  private cache: Map<string, { value: any; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor(
    message: Message,
    services: {
      trustEngine?: any;
      v3Integration?: any;
      unifiedMemory?: any;
      policyEngine?: any;
      [key: string]: any;
    } = {}
  ) {
    this.message = message;
    this.guild = message.guild!;
    this.channel = message.channel as TextChannel;
    this.member = message.member!;
    this.services = services;
  }

  /**
   * Add query to conversation history
   */
  addToHistory(query: string, results: Map<string, any>): void {
    this.conversationHistory.push({
      query,
      timestamp: Date.now(),
      results: new Map(results), // Clone to prevent mutation
    });

    // Keep only last 10 queries
    if (this.conversationHistory.length > 10) {
      this.conversationHistory = this.conversationHistory.slice(-10);
    }

    // Update references from results
    this.updateReferences(results);
  }

  /**
   * Update references (lastUsers, lastMessages, lastChannels) from results
   */
  private updateReferences(results: Map<string, any>): void {
    for (const [stepId, result] of results) {
      if (!result) continue;

      // Extract user IDs
      if (result.users || result.affectedUsers) {
        this.lastUsers = result.users || result.affectedUsers;
      }

      // Extract message IDs
      if (result.messages || result.affectedMessages) {
        this.lastMessages = result.messages || result.affectedMessages;
      }

      // Extract channel IDs
      if (result.channels || result.affectedChannels) {
        this.lastChannels = result.channels || result.affectedChannels;
      }

      // Handle arrays of objects
      if (Array.isArray(result)) {
        const userIds = result
          .filter((item: any) => item.userId || item.id)
          .map((item: any) => item.userId || item.id);

        if (userIds.length > 0) {
          this.lastUsers = userIds;
        }
      }
    }
  }

  /**
   * Resolve reference ("them", "those users", "that channel")
   */
  resolveReference(reference: string): any {
    const normalized = reference.toLowerCase().trim();

    // User references
    if (
      normalized.includes('them') ||
      normalized.includes('those users') ||
      normalized.includes('these users') ||
      normalized.includes('the users')
    ) {
      return this.lastUsers;
    }

    // Message references
    if (
      normalized.includes('those messages') ||
      normalized.includes('these messages') ||
      normalized.includes('the messages')
    ) {
      return this.lastMessages;
    }

    // Channel references
    if (
      normalized.includes('that channel') ||
      normalized.includes('those channels') ||
      normalized.includes('the channel')
    ) {
      return this.lastChannels;
    }

    // Generic "that" - return last users by default
    if (normalized === 'that' || normalized === 'it') {
      return this.lastUsers || this.lastMessages || this.lastChannels;
    }

    return null;
  }

  /**
   * Get value from previous step
   */
  getStepResult(stepId: string): any {
    return this.stepResults.get(stepId);
  }

  /**
   * Set step result
   */
  setStepResult(stepId: string, result: any): void {
    this.stepResults.set(stepId, result);
  }

  /**
   * Get variable
   */
  getVariable(name: string): any {
    return this.variables.get(name);
  }

  /**
   * Set variable
   */
  setVariable(name: string, value: any): void {
    this.variables.set(name, value);
  }

  /**
   * Check if variable exists
   */
  hasVariable(name: string): boolean {
    return this.variables.has(name);
  }

  /**
   * Get from cache
   */
  getCache(key: string): any {
    const cached = this.cache.get(key);
    if (!cached) return null;

    // Check if expired
    if (Date.now() - cached.timestamp > this.CACHE_TTL) {
      this.cache.delete(key);
      return null;
    }

    return cached.value;
  }

  /**
   * Set cache
   */
  setCache(key: string, value: any): void {
    this.cache.set(key, {
      value,
      timestamp: Date.now(),
    });
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get conversation summary (for AI context)
   */
  getConversationSummary(): string {
    if (this.conversationHistory.length === 0) {
      return 'No previous conversation';
    }

    const recent = this.conversationHistory.slice(-3);
    return recent
      .map((entry, idx) => {
        const resultCount = entry.results.size;
        return `${idx + 1}. "${entry.query}" (${resultCount} results)`;
      })
      .join('\n');
  }

  /**
   * Get last query
   */
  getLastQuery(): string | null {
    if (this.conversationHistory.length === 0) return null;
    return this.conversationHistory[this.conversationHistory.length - 1].query;
  }

  /**
   * Search conversation history
   */
  searchHistory(keyword: string): Array<{ query: string; results: Map<string, any> }> {
    return this.conversationHistory.filter((entry) =>
      entry.query.toLowerCase().includes(keyword.toLowerCase())
    );
  }

  /**
   * Get context snapshot (for debugging)
   */
  snapshot(): object {
    return {
      guild: this.guild.name,
      channel: this.channel.name,
      member: this.member.user.tag,
      conversationHistory: this.conversationHistory.length,
      stepResults: this.stepResults.size,
      variables: Object.fromEntries(this.variables),
      lastUsers: this.lastUsers?.length || 0,
      lastMessages: this.lastMessages?.length || 0,
      lastChannels: this.lastChannels?.length || 0,
      cacheSize: this.cache.size,
    };
  }

  /**
   * Clone context (for parallel execution)
   */
  clone(): BecasContext {
    const cloned = new BecasContext(this.message, this.services);
    cloned.conversationHistory = [...this.conversationHistory];
    cloned.stepResults = new Map(this.stepResults);
    cloned.variables = new Map(this.variables);
    cloned.lastUsers = this.lastUsers ? [...this.lastUsers] : undefined;
    cloned.lastMessages = this.lastMessages ? [...this.lastMessages] : undefined;
    cloned.lastChannels = this.lastChannels ? [...this.lastChannels] : undefined;
    return cloned;
  }
}
