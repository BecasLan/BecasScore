// ollama.config.ts

import { ENV } from './environment';

export interface OllamaConfig {
  baseUrl: string;
  model: string;
  temperature: number;
  maxTokens: number;
  contextWindow: number;
}

// OPTIMIZED MODEL STRATEGY (Qwen3-First Approach)
//
// QWEN3:8B (PRIMARY - 8-12s, BEST ALL-AROUND):
//   - 🎯 Scam detection (superior context understanding)
//   - 🧠 Cognitive reasoning (threat analysis, decisions)
//   - 💬 Dialogue & conversation (smart + context-aware)
//   - 🔍 Toxicity analysis (nuance + cultural understanding)
//   - 🔧 Typo correction (Turkish + English)
//   - ⚖️ All moderation decisions
//
// DEEPSEEK-R1 (SPECIALIZED - 20-30s, ANALYTICS ONLY):
//   - 📊 Data analysis & insights (complex statistical reasoning)
//   - 📈 Trend analysis (pattern detection in large datasets)
//   - 🎓 Learning from corrections (deep reasoning about mistakes)
//   - ONLY used for analytics/insights, not real-time decisions
//
// Why Qwen3-first?
// - Faster than DeepSeek (8-12s vs 20-30s)
// - Smarter than Llama (better context + reasoning)
// - Balanced performance/quality (best ROI)
// - One model = simpler system

// Use single model for everything
const SINGLE_MODEL = 'qwen3:8b';

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
    maxTokens: 400,
    contextWindow: 4096,
  },

  reflection: {
    baseUrl: ENV.OLLAMA_BASE_URL,
    model: SINGLE_MODEL,
    temperature: 0.6,
    maxTokens: 800,
    contextWindow: 4096,
  },

  governance: {
    baseUrl: ENV.OLLAMA_BASE_URL,
    model: SINGLE_MODEL,
    temperature: 0.4,
    maxTokens: 400,
    contextWindow: 4096,
  },

  vision: {
    baseUrl: ENV.OLLAMA_BASE_URL,
    model: SINGLE_MODEL,
    temperature: 0.2,
    maxTokens: 500,
    contextWindow: 2048,
  },

  reflex: {
    baseUrl: ENV.OLLAMA_BASE_URL,
    model: SINGLE_MODEL,
    temperature: 0.1,
    maxTokens: 100,
    contextWindow: 512,
  },

  strategic: {
    baseUrl: ENV.OLLAMA_BASE_URL,
    model: SINGLE_MODEL,
    temperature: 0.5,
    maxTokens: 1000,
    contextWindow: 4096,
  },

  cognitive: {
    baseUrl: ENV.OLLAMA_BASE_URL,
    model: SINGLE_MODEL,
    temperature: 0.4,
    maxTokens: 600,
    contextWindow: 4096,
  },
};