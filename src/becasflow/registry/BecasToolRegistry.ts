/**
 * BECAS TOOL REGISTRY
 *
 * Centralized tool registration and discovery system.
 * Singleton pattern ensures single source of truth for all tools.
 *
 * Features:
 * - Tool registration/unregistration
 * - Category-based filtering
 * - Search by name/description
 * - Validation of tool schemas
 * - Tool metadata management
 */

import { BecasTool } from '../types/BecasFlow.types';
import { createLogger } from '../../services/Logger';

const logger = createLogger('BecasToolRegistry');

export class BecasToolRegistry {
  private static instance: BecasToolRegistry;
  private tools: Map<string, BecasTool> = new Map();
  private categoryIndex: Map<string, Set<string>> = new Map();

  private constructor() {
    logger.info('BecasToolRegistry initialized');
  }

  /**
   * Get singleton instance
   */
  static getInstance(): BecasToolRegistry {
    if (!BecasToolRegistry.instance) {
      BecasToolRegistry.instance = new BecasToolRegistry();
    }
    return BecasToolRegistry.instance;
  }

  /**
   * Register a tool
   */
  register(tool: BecasTool): void {
    // Validate tool
    const validation = this.validateTool(tool);
    if (!validation.valid) {
      throw new Error(`Invalid tool "${tool.name}": ${validation.error}`);
    }

    // Check if already registered
    if (this.tools.has(tool.name)) {
      logger.warn(`Tool "${tool.name}" is already registered, overwriting`);
    }

    // Register tool
    this.tools.set(tool.name, tool);

    // Update category index
    if (!this.categoryIndex.has(tool.category)) {
      this.categoryIndex.set(tool.category, new Set());
    }
    this.categoryIndex.get(tool.category)!.add(tool.name);

    logger.info(`Registered tool: ${tool.name} (${tool.category})`);
  }

  /**
   * Unregister a tool
   */
  unregister(toolName: string): boolean {
    const tool = this.tools.get(toolName);
    if (!tool) {
      logger.warn(`Tool "${toolName}" not found`);
      return false;
    }

    // Remove from tools
    this.tools.delete(toolName);

    // Remove from category index
    const categorySet = this.categoryIndex.get(tool.category);
    if (categorySet) {
      categorySet.delete(toolName);
      if (categorySet.size === 0) {
        this.categoryIndex.delete(tool.category);
      }
    }

    logger.info(`Unregistered tool: ${toolName}`);
    return true;
  }

  /**
   * Get a tool by name
   */
  get(toolName: string): BecasTool | undefined {
    return this.tools.get(toolName);
  }

  /**
   * Get all tools
   */
  getAll(): BecasTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get tools by category
   */
  getByCategory(category: BecasTool['category']): BecasTool[] {
    const toolNames = this.categoryIndex.get(category);
    if (!toolNames) return [];

    return Array.from(toolNames)
      .map((name) => this.tools.get(name)!)
      .filter((tool) => tool !== undefined);
  }

  /**
   * Search tools by query
   * Searches in name, description, and category
   */
  search(query: string): BecasTool[] {
    const normalizedQuery = query.toLowerCase().trim();
    if (!normalizedQuery) return [];

    return Array.from(this.tools.values()).filter((tool) => {
      return (
        tool.name.toLowerCase().includes(normalizedQuery) ||
        tool.description.toLowerCase().includes(normalizedQuery) ||
        tool.category.toLowerCase().includes(normalizedQuery)
      );
    });
  }

  /**
   * Find best matching tools for a natural language query
   */
  findBestMatches(query: string, limit: number = 5): BecasTool[] {
    const normalizedQuery = query.toLowerCase().trim();
    if (!normalizedQuery) return [];

    // Score each tool
    const scored = Array.from(this.tools.values()).map((tool) => {
      let score = 0;

      // Exact name match
      if (tool.name.toLowerCase() === normalizedQuery) {
        score += 100;
      }

      // Name contains query
      if (tool.name.toLowerCase().includes(normalizedQuery)) {
        score += 50;
      }

      // Description contains query
      if (tool.description.toLowerCase().includes(normalizedQuery)) {
        score += 30;
      }

      // Category match
      if (tool.category.toLowerCase() === normalizedQuery) {
        score += 20;
      }

      // Individual word matches
      const queryWords = normalizedQuery.split(/\s+/);
      queryWords.forEach((word) => {
        if (word.length < 3) return; // Skip short words

        if (tool.name.toLowerCase().includes(word)) score += 10;
        if (tool.description.toLowerCase().includes(word)) score += 5;
      });

      return { tool, score };
    });

    // Filter and sort by score
    return scored
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((item) => item.tool);
  }

  /**
   * Get tools that can chain to a given tool
   */
  getChainableFrom(toolName: string): BecasTool[] {
    return Array.from(this.tools.values()).filter((tool) => {
      return tool.canChainTo?.includes(toolName) ?? false;
    });
  }

  /**
   * Get tools that can be chained from a given tool
   */
  getChainableTo(toolName: string): BecasTool[] {
    const tool = this.tools.get(toolName);
    if (!tool || !tool.canChainTo) return [];

    return tool.canChainTo
      .map((name) => this.tools.get(name))
      .filter((t): t is BecasTool => t !== undefined);
  }

  /**
   * Get all loopable tools
   */
  getLoopableTools(): BecasTool[] {
    return Array.from(this.tools.values()).filter((tool) => tool.canLoopBack ?? false);
  }

  /**
   * Validate tool schema
   */
  private validateTool(tool: BecasTool): { valid: boolean; error?: string } {
    // Check required fields
    if (!tool.name || typeof tool.name !== 'string') {
      return { valid: false, error: 'Tool name is required and must be a string' };
    }

    if (!tool.description || typeof tool.description !== 'string') {
      return { valid: false, error: 'Tool description is required and must be a string' };
    }

    if (!tool.category) {
      return { valid: false, error: 'Tool category is required' };
    }

    if (!tool.parameters || typeof tool.parameters !== 'object') {
      return { valid: false, error: 'Tool parameters must be an object' };
    }

    if (typeof tool.execute !== 'function') {
      return { valid: false, error: 'Tool execute must be a function' };
    }

    // Validate parameters
    for (const [paramName, paramSchema] of Object.entries(tool.parameters)) {
      if (!paramSchema.type) {
        return {
          valid: false,
          error: `Parameter "${paramName}" must have a type`,
        };
      }

      if (paramSchema.description === undefined || paramSchema.description === null) {
        return {
          valid: false,
          error: `Parameter "${paramName}" must have a description`,
        };
      }

      if (paramSchema.required === undefined || paramSchema.required === null) {
        return {
          valid: false,
          error: `Parameter "${paramName}" must specify if it's required`,
        };
      }
    }

    return { valid: true };
  }

  /**
   * Get registry statistics
   */
  getStats(): {
    totalTools: number;
    categories: Record<string, number>;
    loopableTools: number;
    toolsWithChaining: number;
  } {
    const categories: Record<string, number> = {};
    let loopableCount = 0;
    let chainingCount = 0;

    for (const tool of this.tools.values()) {
      categories[tool.category] = (categories[tool.category] || 0) + 1;

      if (tool.canLoopBack) loopableCount++;
      if (tool.canChainTo && tool.canChainTo.length > 0) chainingCount++;
    }

    return {
      totalTools: this.tools.size,
      categories,
      loopableTools: loopableCount,
      toolsWithChaining: chainingCount,
    };
  }

  /**
   * Clear all tools (for testing)
   */
  clear(): void {
    this.tools.clear();
    this.categoryIndex.clear();
    logger.warn('Registry cleared');
  }

  /**
   * Export tools as JSON
   */
  exportTools(): string {
    const tools = Array.from(this.tools.values()).map((tool) => ({
      name: tool.name,
      description: tool.description,
      category: tool.category,
      parameters: tool.parameters,
      canChainTo: tool.canChainTo,
      canLoopBack: tool.canLoopBack,
      requiresConfirmation: tool.requiresConfirmation,
    }));

    return JSON.stringify(tools, null, 2);
  }
}

// Export singleton instance getter
export const toolRegistry = BecasToolRegistry.getInstance();
