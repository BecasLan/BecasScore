/**
 * BECASFLOW FRAMEWORK - CORE TYPES
 *
 * Comprehensive type definitions for the BecasFlow framework.
 * This is a Discord-specific, AI-powered execution framework with:
 * - Tool-based architecture (MCP/LangChain style)
 * - Conditional execution (if/then/else)
 * - Context chaining (referencing previous results)
 * - Self-healing (missing data detection)
 * - Interactive prompts (button-based user input)
 * - Loop support (re-execute tools based on conditions)
 */

import { Message, Guild, GuildMember, TextChannel } from 'discord.js';

// ============================================
// TOOL SYSTEM
// ============================================

/**
 * Parameter schema for a tool
 */
export interface BecasParameterSchema {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'userId' | 'channelId' | 'roleId';
  description: string;
  required: boolean;
  default?: any;
  enum?: any[];  // For limited options
  items?: BecasParameterSchema;  // For arrays
  properties?: Record<string, BecasParameterSchema>;  // For objects
}

/**
 * Missing parameter information
 */
export interface BecasMissingParam {
  param: string;
  prompt: string;  // User-friendly question
  type: 'text' | 'button' | 'select';
  options?: Array<{ label: string; value: any; description?: string }>;
}

/**
 * Tool execution result
 */
export interface BecasToolResult {
  success: boolean;
  data?: any;
  error?: string;
  message?: string;  // User-friendly message
  executionTime?: number;  // Time taken in milliseconds
  metadata?: {
    executionTime?: number;
    affectedUsers?: string[];
    affectedMessages?: string[];
    loopBack?: boolean;  // Should we re-execute this tool?
    nextSuggestedTool?: string;  // AI suggestion for next step
    [key: string]: any;  // Allow additional tool-specific metadata
  };
}

/**
 * Execution context for tools
 */
export interface BecasContext {
  // Discord context
  message: Message;
  guild: Guild;
  channel: TextChannel;
  member: GuildMember;

  // Execution state
  conversationHistory: Array<{
    query: string;
    timestamp: number;
    results: Map<string, any>;  // step name -> result
  }>;

  // Current execution
  currentPlan?: BecasPlan;
  stepResults: Map<string, any>;  // Current plan's step results
  variables: Map<string, any>;  // Shared variables across steps

  // References from previous queries
  lastUsers?: string[];  // "those users", "them"
  lastMessages?: string[];  // "those messages"
  lastChannels?: string[];  // "those channels"

  // Dependencies (injected services)
  services: {
    trustEngine?: any;
    v3Integration?: any;
    unifiedMemory?: any;
    policyEngine?: any;
    [key: string]: any;
  };

  // Methods
  addToHistory(query: string, results: Map<string, any>): void;
  resolveReference(reference: string): any;
  getStepResult(stepId: string): any;
  setStepResult(stepId: string, result: any): void;
  getVariable(name: string): any;
  setVariable(name: string, value: any): void;
  hasVariable(name: string): boolean;
  getCache(key: string): any;
  setCache(key: string, value: any): void;
  clearCache(): void;
  getConversationSummary(): string;
  getLastQuery(): string | null;
  searchHistory(keyword: string): Array<{ query: string; results: Map<string, any> }>;
  snapshot(): object;
  clone(): BecasContext;
}

/**
 * Tool definition (MCP/LangChain style)
 */
export interface BecasTool {
  // Metadata
  name: string;
  description: string;
  category: 'moderation' | 'trust' | 'analytics' | 'admin' | 'policy' | 'learning' | 'utility' | 'data' | 'intelligence';

  // Parameters
  parameters: Record<string, BecasParameterSchema>;

  // Missing data detection
  detectMissing?: (params: any, context: BecasContext) => BecasMissingParam | null;

  // Execution
  execute: (params: any, context: BecasContext) => Promise<BecasToolResult>;

  // Chaining capabilities
  canChainTo?: string[];  // Tool names this can chain to
  canLoopBack?: boolean;  // Can this tool be re-executed in a loop?

  // Conditions
  preconditions?: BecasCondition[];  // Must be true before execution
  postconditions?: BecasCondition[];  // Must be true after execution

  // UI hints
  requiresConfirmation?: boolean;  // Should ask user before executing
  confirmationMessage?: (params: any) => string;

  // Allow additional tool-specific helper methods and properties
  [key: string]: any;
}

// ============================================
// CONDITION SYSTEM
// ============================================

/**
 * Condition types
 */
export type BecasConditionType =
  | 'equals'
  | 'notEquals'
  | 'greaterThan'
  | 'lessThan'
  | 'greaterThanOrEqual'
  | 'lessThanOrEqual'
  | 'contains'
  | 'notContains'
  | 'matches'  // Regex
  | 'exists'
  | 'notExists'
  | 'custom';  // Custom function

/**
 * Condition definition
 */
export interface BecasCondition {
  type: BecasConditionType;
  field: string;  // Path to value in context (e.g., "stepResults.check_trust.trustScore")
  operator?: BecasConditionType;  // Alias for type
  value?: any;
  customFn?: (context: BecasContext) => boolean;  // For custom conditions
  message?: string;  // Error message if condition fails
}

/**
 * Conditional branch
 */
export interface BecasConditionalBranch {
  condition: BecasCondition | BecasCondition[];  // AND logic if array
  steps: BecasStep[];
}

// ============================================
// EXECUTION PLAN
// ============================================

/**
 * Execution step
 */
export interface BecasStep {
  id: string;
  toolName: string;
  params: Record<string, any>;

  // Conditional execution
  condition?: BecasCondition | BecasCondition[];  // Execute only if true
  ifTrue?: BecasStep[];  // Execute these if condition is true
  ifFalse?: BecasStep[];  // Execute these if condition is false

  // Branching
  switch?: {
    field: string;
    cases: Record<string, BecasStep[]>;
    default?: BecasStep[];
  };

  // Looping
  loop?: {
    condition: BecasCondition;
    maxIterations?: number;
    steps: BecasStep[];
  };

  // Error handling
  onError?: {
    retry?: number;
    fallback?: BecasStep[];
    continueOnError?: boolean;
  };

  // Output mapping
  outputAs?: string;  // Store result in this variable

  // Dependencies
  dependsOn?: string[];  // Step IDs that must complete first
}

/**
 * Execution plan
 */
export interface BecasPlan {
  id: string;
  query: string;  // Original user query
  steps: BecasStep[];
  metadata?: {
    createdAt: number;
    estimatedTime?: number;
    requiresUserInput?: boolean;
    affectsUsers?: number;
    affectsMessages?: number;
  };
}

// ============================================
// PLANNER
// ============================================

/**
 * Planning result
 */
export interface BecasPlanningResult {
  success: boolean;
  plan?: BecasPlan;
  error?: string;
  missingInfo?: BecasMissingParam[];  // Need user input
  suggestions?: string[];  // AI suggestions for the user
}

/**
 * Planning options
 */
export interface BecasPlanningOptions {
  maxSteps?: number;
  allowLoops?: boolean;
  allowConditionals?: boolean;
  requireConfirmation?: boolean;
  temperature?: number;  // AI creativity
}

// ============================================
// EXECUTION
// ============================================

/**
 * Execution result
 */
export interface BecasExecutionResult {
  success: boolean;
  results: Array<{
    stepId: string;
    toolName: string;
    result: BecasToolResult;
    executionTime: number;
  }>;
  errors: Array<{
    stepId: string;
    error: string;
  }>;
  finalOutput: string;  // Natural language summary
  metadata?: {
    totalTime: number;
    stepsExecuted: number;
    stepsSkipped: number;
    loopsExecuted: number;
  };
}

/**
 * Execution options
 */
export interface BecasExecutionOptions {
  dryRun?: boolean;  // Don't actually execute, just simulate
  verbose?: boolean;  // Detailed logging
  pauseOnError?: boolean;  // Stop execution on first error
  maxExecutionTime?: number;  // Timeout in milliseconds
}

// ============================================
// INTERACTIVE
// ============================================

/**
 * User prompt type
 */
export type BecasPromptType = 'text' | 'button' | 'select' | 'confirm';

/**
 * Interactive prompt
 */
export interface BecasPrompt {
  type: BecasPromptType;
  message: string;
  param: string;  // Which parameter this prompt is for

  // For button/select
  options?: Array<{
    label: string;
    value: any;
    description?: string;
    emoji?: string;
  }>;

  // For text
  placeholder?: string;
  validation?: (input: string) => boolean | string;  // true or error message

  // For confirm
  defaultValue?: boolean;

  timeout?: number;  // Auto-cancel after X ms
}

/**
 * Prompt response
 */
export interface BecasPromptResponse {
  success: boolean;
  value?: any;
  cancelled?: boolean;
  timedOut?: boolean;
}

// ============================================
// REGISTRY
// ============================================

/**
 * Tool registry
 */
export interface BecasToolRegistry {
  register(tool: BecasTool): void;
  unregister(toolName: string): void;
  get(toolName: string): BecasTool | undefined;
  getAll(): BecasTool[];
  getByCategory(category: BecasTool['category']): BecasTool[];
  search(query: string): BecasTool[];
}

// ============================================
// LEARNING & FEEDBACK
// ============================================

/**
 * Execution feedback
 */
export interface BecasFeedback {
  planId: string;
  wasCorrect: boolean;
  correction?: {
    shouldHaveDone: string;  // Natural language
    suggestedTools?: string[];
    reason?: string;
  };
  rating?: number;  // 1-5
  comment?: string;
  providedBy: {
    userId: string;
    username: string;
    role: 'admin' | 'moderator' | 'user';
  };
}

// ============================================
// EXPORTS
// ============================================

export type {
  Message,
  Guild,
  GuildMember,
  TextChannel,
};
