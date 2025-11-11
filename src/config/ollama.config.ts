// ollama.config.ts

import { ENV } from './environment';

export interface OllamaConfig {
  baseUrl: string;
  model: string;
  temperature: number;
  maxTokens: number;
  contextWindow: number;
}

// OPTIMIZED MODEL STRATEGY (Qwen3:1.7B Ultra-Fast Approach)
//
// QWEN3:1.7B (PRIMARY - 2-4s, ULTRA-FAST):
//   - 🎯 Scam detection (fast context understanding)
//   - 🧠 Cognitive reasoning (threat analysis, decisions)
//   - 💬 Dialogue & conversation (smart + context-aware)
//   - 🔍 Toxicity analysis (nuance + cultural understanding)
//   - 🔧 Typo correction (Turkish + English)
//   - ⚖️ All moderation decisions
//   - 🚀 BecasFlow intent classification
//
// QWEN2.5:0.5B (JSON PARSER - <1s, STRUCTURED OUTPUT):
//   - 📝 JSON extraction from AI responses
//   - 🔧 Structured data parsing
//   - ⚡ Lightning-fast structured output
//   - ONLY used for JSON parsing, not reasoning
//
// Why Qwen3:1.7B?
// - 4x faster than 8B model (2-4s vs 8-12s)
// - Still intelligent enough for moderation decisions
// - Much lower memory usage (1.7B vs 8B parameters)
// - Better user experience (faster responses)
// - One model = simpler system

// Use single model for everything
const SINGLE_MODEL = 'qwen3:1.7b';

export const OLLAMA_CONFIGS: Record<string, OllamaConfig> = {
  dialogue: {
    baseUrl: ENV.OLLAMA_BASE_URL,
    model: SINGLE_MODEL,
    temperature: 0.7,
    maxTokens: -1, // No limit - let model decide naturally when to stop
    contextWindow: 4096,
  },

  analysis: {
    baseUrl: ENV.OLLAMA_BASE_URL,
    model: SINGLE_MODEL,
    temperature: 0.3,
    maxTokens: -1, // Let model decide when to stop
    contextWindow: 4096,
  },

  reflection: {
    baseUrl: ENV.OLLAMA_BASE_URL,
    model: SINGLE_MODEL,
    temperature: 0.6,
    maxTokens: -1, // Let model decide when to stop
    contextWindow: 4096,
  },

  governance: {
    baseUrl: ENV.OLLAMA_BASE_URL,
    model: SINGLE_MODEL,
    temperature: 0.4,
    maxTokens: -1, // Let model decide when to stop
    contextWindow: 4096,
  },

  vision: {
    baseUrl: ENV.OLLAMA_BASE_URL,
    model: SINGLE_MODEL,
    temperature: 0.2,
    maxTokens: -1, // Let model decide when to stop
    contextWindow: 2048,
  },

  reflex: {
    baseUrl: ENV.OLLAMA_BASE_URL,
    model: SINGLE_MODEL,
    temperature: 0.1,
    maxTokens: 200, // Keep reflex short for fast responses
    contextWindow: 512,
  },

  strategic: {
    baseUrl: ENV.OLLAMA_BASE_URL,
    model: SINGLE_MODEL,
    temperature: 0.5,
    maxTokens: -1, // Let model decide when to stop
    contextWindow: 4096,
  },

  cognitive: {
    baseUrl: ENV.OLLAMA_BASE_URL,
    model: SINGLE_MODEL,
    temperature: 0.4,
    maxTokens: -1, // Let model decide when to stop (FIXED: was 600)
    contextWindow: 4096,
  },

  // JSON parsing - ultra-lightweight model for structured output only
  parser: {
    baseUrl: ENV.OLLAMA_BASE_URL,
    model: 'qwen2.5:0.5b',  // qwen2.5:0.5b - lightning-fast JSON parsing (<1s)
    temperature: 0.1,        // Very low - we want deterministic JSON output
    maxTokens: 500,          // JSON doesn't need many tokens
    contextWindow: 2048,
  },

  // BecasFlow Planning - fine-tuned model for tool selection
  becasflow: {
    baseUrl: ENV.OLLAMA_BASE_URL,
    model: 'becasflow-planner:latest',  // Fine-tuned qwen2.5:0.5b for BecasFlow
    temperature: 0.1,        // Very low - we want consistent tool selection
    maxTokens: 1000,         // Enough for multi-step plans
    contextWindow: 4096,     // Large context for examples in system prompt
  },

  // ============================================================================
  // BECASFLOW AI ENHANCEMENTS - Advanced AI-powered pipeline features
  // ============================================================================

  // Result Synthesis - Smart formatting of pipeline results
  resultSynthesis: {
    baseUrl: ENV.OLLAMA_BASE_URL,
    model: SINGLE_MODEL,
    temperature: 0.3,        // Low-medium - consistent but natural formatting
    maxTokens: 500,          // Concise summaries
    contextWindow: 2048,
  },

  // Parameter Inference - Infer missing parameters from context
  parameterInference: {
    baseUrl: ENV.OLLAMA_BASE_URL,
    model: SINGLE_MODEL,
    temperature: 0.1,        // Very low - accurate inference
    maxTokens: 300,          // Short parameter values
    contextWindow: 2048,
  },

  // Self-Healing - Auto-fix failed pipeline steps
  selfHealing: {
    baseUrl: ENV.OLLAMA_BASE_URL,
    model: SINGLE_MODEL,
    temperature: 0.3,        // Low-medium - creative but safe fixes
    maxTokens: 400,          // Alternative suggestions
    contextWindow: 2048,
  },

  // Safety Validation - Prevent dangerous operations
  safetyValidation: {
    baseUrl: ENV.OLLAMA_BASE_URL,
    model: SINGLE_MODEL,
    temperature: 0.1,        // Very low - strict safety checks
    maxTokens: 200,          // Simple yes/no + reason
    contextWindow: 1024,
  },

  // Loop Detection - Decide if steps should re-execute
  loopDetection: {
    baseUrl: ENV.OLLAMA_BASE_URL,
    model: SINGLE_MODEL,
    temperature: 0.2,        // Low - consistent loop decisions
    maxTokens: 200,          // Simple loop decision
    contextWindow: 1024,
  },

  // Chain Suggestion - Suggest next tools after execution
  chainSuggestion: {
    baseUrl: ENV.OLLAMA_BASE_URL,
    model: SINGLE_MODEL,
    temperature: 0.4,        // Medium - creative but relevant suggestions
    maxTokens: 400,          // List of suggestions
    contextWindow: 2048,
  },

  // Context Selection - Choose tools based on server context
  contextSelection: {
    baseUrl: ENV.OLLAMA_BASE_URL,
    model: SINGLE_MODEL,
    temperature: 0.3,        // Low-medium - context-aware but focused
    maxTokens: 500,          // Tool selection reasoning
    contextWindow: 4096,     // Large - needs full server context
  },

  // Conflict Resolution - Resolve multi-tool conflicts
  conflictResolution: {
    baseUrl: ENV.OLLAMA_BASE_URL,
    model: SINGLE_MODEL,
    temperature: 0.2,        // Low - deterministic conflict resolution
    maxTokens: 300,          // Execution order decision
    contextWindow: 2048,
  },

  // Intent Enhancement - Enhanced intent classification
  intentEnhancement: {
    baseUrl: ENV.OLLAMA_BASE_URL,
    model: SINGLE_MODEL,
    temperature: 0.2,        // Low - accurate intent detection
    maxTokens: 300,          // Intent classification + confidence
    contextWindow: 2048,
  },

  // Reasoning Engine - Analyze results and decide next steps
  reasoning: {
    baseUrl: ENV.OLLAMA_BASE_URL,
    model: SINGLE_MODEL,
    temperature: 0.4,        // Medium - thoughtful reasoning
    maxTokens: 600,          // Detailed reasoning
    contextWindow: 4096,     // Large - needs full context
  },

  // ============================================================================
  // GUILD POLICY SYSTEM - AI Configs
  // ============================================================================

  // Core Violation Detection - Detect profanity, hate speech, harassment (GLOBAL)
  coreViolationDetection: {
    baseUrl: ENV.OLLAMA_BASE_URL,
    model: SINGLE_MODEL,
    temperature: 0.1,        // Very low - accurate detection
    maxTokens: 400,          // Violation type + confidence + severity
    contextWindow: 2048,
  },

  // Guild Policy Matching - Match user actions to guild-specific policies (LOCAL)
  guildPolicyMatching: {
    baseUrl: ENV.OLLAMA_BASE_URL,
    model: SINGLE_MODEL,
    temperature: 0.2,        // Low - accurate policy matching
    maxTokens: 300,          // Match result + reasoning
    contextWindow: 2048,
  },

  // Policy Discovery - Extract and interpret server rules
  policyDiscovery: {
    baseUrl: ENV.OLLAMA_BASE_URL,
    model: SINGLE_MODEL,
    temperature: 0.3,        // Low-medium - structured interpretation
    maxTokens: 800,          // Multiple rules + interpretations
    contextWindow: 4096,     // Large - full server rules
  },

  // Policy Learning - Learn patterns from moderation actions
  policyLearning: {
    baseUrl: ENV.OLLAMA_BASE_URL,
    model: SINGLE_MODEL,
    temperature: 0.4,        // Medium - pattern recognition
    maxTokens: 500,          // Pattern description + suggested policy
    contextWindow: 3072,
  },

  // Policy Synthesis - Create structured policies from patterns
  policySynthesis: {
    baseUrl: ENV.OLLAMA_BASE_URL,
    model: SINGLE_MODEL,
    temperature: 0.2,        // Low - structured output
    maxTokens: 400,          // Policy JSON + reasoning
    contextWindow: 2048,
  },
};