// environment.ts

import dotenv from 'dotenv';
dotenv.config();

export const ENV = {
  // Discord
  DISCORD_TOKEN: process.env.DISCORD_TOKEN || '',
  DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID || '',
  DISCORD_CLIENT_SECRET: process.env.DISCORD_CLIENT_SECRET || '',
  DISCORD_REDIRECT_URI: process.env.DISCORD_REDIRECT_URI || 'http://localhost:3002/auth/callback',

  // Session
  SESSION_SECRET: process.env.SESSION_SECRET || 'change_this_secret',

  // Ollama
  OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
  OLLAMA_MODEL: process.env.OLLAMA_MODEL || 'qwen3:8b', // 🔥 PRIMARY MODEL - everything except analytics
  
  // Database (PostgreSQL)
  DB_HOST: process.env.DB_HOST || 'localhost',
  DB_PORT: parseInt(process.env.DB_PORT || '5432'),
  DB_NAME: process.env.DB_NAME || 'becas_db',
  DB_USER: process.env.DB_USER || 'becas',
  DB_PASSWORD: process.env.DB_PASSWORD || 'becas_secure_password_2025',

  // Redis
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',

  // ChromaDB (Vector Database)
  CHROMA_URL: process.env.CHROMA_URL || 'http://localhost:8000',
  CHROMA_TOKEN: process.env.CHROMA_TOKEN || 'becas_chroma_token_2025',

  // Storage
  STORAGE_TYPE: process.env.STORAGE_TYPE || 'database', // 'local', 'database', or 'supabase'
  SUPABASE_URL: process.env.SUPABASE_URL || '',
  SUPABASE_KEY: process.env.SUPABASE_KEY || '',

  // Data paths
  DATA_DIR: process.env.DATA_DIR || './data',
  
  // Becas behavior
  TRUST_DECAY_RATE: parseFloat(process.env.TRUST_DECAY_RATE || '0.01'),
  REFLECTION_INTERVAL: parseInt(process.env.REFLECTION_INTERVAL || '3600000'), // 1 hour
  RULE_EVOLUTION_THRESHOLD: parseFloat(process.env.RULE_EVOLUTION_THRESHOLD || '0.7'),
  
  // Development
  NODE_ENV: process.env.NODE_ENV || 'development',
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',

  // Admin API
  ADMIN_PORT: parseInt(process.env.ADMIN_PORT || '3000'),
};