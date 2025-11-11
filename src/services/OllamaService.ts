import axios, { AxiosInstance } from 'axios';
import { OLLAMA_CONFIGS, OllamaConfig } from '../config/ollama.config';
import { OllamaConnectionPool } from './OllamaConnectionPool';
import { createLogger } from './Logger';
import { CircuitBreaker } from './CircuitBreaker';
import { metricsService } from './MetricsService';
import { getOllamaCache, OllamaCacheService } from './OllamaCacheService';

const logger = createLogger('OllamaService');

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OllamaResponse {
  model: string;
  created_at: string;
  message: {
    role: string;
    content: string;
    thinking?: string; // For thinking models like qwen3:8b, deepseek-r1
  };
  done: boolean;
}

export interface OllamaGenerateResponse {
  model: string;
  created_at: string;
  response: string;      // User-facing answer (on-chain)
  thinking?: string;     // Internal reasoning (off-chain) - Only for DeepSeek R1
  done: boolean;
  context?: number[];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

export interface DeepSeekR1Response {
  thinking: string;      // Off-chain reasoning (internal process)
  answer: string;        // On-chain answer (shown to user)
  fullResponse: string;  // Complete response
}

export class OllamaService {
  private client: AxiosInstance;
  private config: OllamaConfig;
  private pool: OllamaConnectionPool;
  private circuitBreaker: CircuitBreaker;
  private cache: OllamaCacheService;

  constructor(configType: keyof typeof OLLAMA_CONFIGS = 'dialogue', pool?: OllamaConnectionPool) {
    this.config = OLLAMA_CONFIGS[configType];
    this.cache = getOllamaCache(); // Initialize cache singleton

    // Log which model is being used for this service
    console.log(`🤖 OllamaService [${configType}]: Using model ${this.config.model}`);

    // Initialize circuit breaker for this service
    this.circuitBreaker = new CircuitBreaker(`Ollama-${configType}`, {
      failureThreshold: 3,      // Open circuit after 3 failures
      successThreshold: 2,       // Close after 2 successes in HALF_OPEN
      timeout: 60000,            // Try recovery after 60 seconds (increased for sequential AI)
      monitoringWindow: 60000,   // Count failures in 60 second window
    });

    // Use connection pool if provided, otherwise create default client
    if (pool) {
      this.pool = pool;
      // Create a dummy client for backward compatibility
      this.client = axios.create({
        baseURL: this.config.baseUrl,
        timeout: 120000, // 120 seconds for sequential AI processing
      });
    } else {
      this.client = axios.create({
        baseURL: this.config.baseUrl,
        timeout: 120000, // 120 seconds for sequential AI processing
        headers: {
          'Content-Type': 'application/json',
        },
      });
      // Create a basic pool for this instance
      this.pool = new OllamaConnectionPool({
        baseURL: this.config.baseUrl,
      });
    }
  }

  /**
   * Set connection pool (for dependency injection)
   */
  setConnectionPool(pool: OllamaConnectionPool): void {
    this.pool = pool;
  }

  /**
   * Generate a completion from the LLM (with circuit breaker protection)
   */
  async generate(
    prompt: string,
    systemPrompt?: string,
    options?: {
      temperature?: number;
      maxTokens?: number;
      stream?: boolean;
      forceJson?: boolean; // Optional: force JSON output for analysis
      model?: string; // Optional: override model for this call
      format?: 'json'; // Optional: force JSON mode in Ollama
      schema?: any; // Optional: JSON schema for structured output
    }
  ): Promise<string> {
    const startTime = Date.now();

    // Check cache first (only for non-streaming requests)
    if (!options?.stream) {
      const temperature = options?.temperature ?? this.config.temperature;
      const model = options?.model || this.config.model;
      const cached = await this.cache.get(prompt, systemPrompt, temperature, model);

      if (cached) {
        // Cache hit - record metrics and return immediately
        const duration = Date.now() - startTime;
        logger.aiCall(this.config.model, prompt, duration, true, cached.length, true); // true = cached
        metricsService.recordAIRequest(this.config.model, 'ollama_cache', duration, true);
        return cached;
      }
    }

    // Wrap in circuit breaker for resilience
    return await this.circuitBreaker.execute(
      // Primary function: Call Ollama
      async () => {
        const messages: OllamaMessage[] = [];

        if (systemPrompt) {
          messages.push({ role: 'system', content: systemPrompt });
        }

        messages.push({ role: 'user', content: prompt });

        const maxTokens = options?.maxTokens ?? this.config.maxTokens ?? 512; // Default 512 tokens
        const requestBody: any = {
          model: options?.model || this.config.model, // Allow model override
          messages,
          stream: options?.stream || false,
          options: {
            temperature: options?.temperature ?? this.config.temperature,
            num_predict: maxTokens, // Always set num_predict to avoid truncation
            num_ctx: 2048, // Context window for faster processing
            num_gpu: -1, // Use ALL GPU layers (auto-detect CUDA/ROCm)
            // NOTE: We intentionally ALLOW thinking mode for better quality answers
            // The extractFinalAnswer() parser will strip reasoning and show only the final answer
          },
        };

        // Only force JSON for analysis calls, not conversation
        if (options?.forceJson || options?.format === 'json') {
          requestBody.format = 'json';
        }

        const response = await this.pool.post<OllamaResponse>('/api/chat', requestBody);

        const duration = Date.now() - startTime;

        // IMPORTANT: Extract content based on mode
        // - forceJson: ONLY use content (old behavior)
        // - format='json': Try content first, fallback to thinking (qwen3 puts JSON in thinking)
        // - conversation: Try content first, parse for final answer if needed
        let actualContent: string;
        if (options?.forceJson) {
          // Old behavior: ONLY content
          actualContent = response.message.content || '';
        } else if (options?.format === 'json') {
          // JSON MODE: Try content first, fallback to thinking if empty
          actualContent = response.message.content || response.message.thinking || '';
          const source = response.message.content ? 'content' : 'thinking';
          logger.info(`🔍 JSON MODE: Using ${source} field (length: ${actualContent.length})`);
        } else {
          // Conversation mode: Try content first, fallback to thinking
          const rawContent = response.message.content || response.message.thinking || '';
          logger.info(`🔍 CONVERSATION MODE: Raw response (length: ${rawContent.length})`);
          logger.info(`📝 RAW CONTENT: "${rawContent}"`);

          // PARSER: Extract final answer if reasoning is detected
          // Look for patterns like "Final Answer:", quoted text, or last sentence
          actualContent = this.extractFinalAnswer(rawContent);

          if (actualContent !== rawContent) {
            logger.info(`🎯 PARSER ACTIVATED: Reasoning detected and cleaned!`);
            logger.info(`   Before (${rawContent.length} chars): "${rawContent.substring(0, 100)}..."`);
            logger.info(`   After (${actualContent.length} chars): "${actualContent}"`);
          } else {
            logger.info(`✅ NO REASONING DETECTED: Direct answer from model`);
          }
        }

        logger.aiCall(this.config.model, prompt, duration, true, actualContent.length);

        // Record successful AI request metric
        metricsService.recordAIRequest(this.config.model, 'ollama', duration, true);

        // Store in cache for future requests (only for non-streaming)
        if (!options?.stream) {
          const temperature = options?.temperature ?? this.config.temperature;
          const model = options?.model || this.config.model;
          await this.cache.set(prompt, actualContent.trim(), systemPrompt, temperature, model);
        }

        return actualContent.trim();
      },
      // Fallback function: When circuit is OPEN or Ollama fails
      () => {
        const duration = Date.now() - startTime;
        logger.aiCall(this.config.model, prompt, duration, false);
        logger.warn('Circuit breaker activated - Ollama unavailable, throwing error for upstream fallback');

        // Record failed AI request metric
        metricsService.recordAIRequest(this.config.model, 'ollama', duration, false);
        metricsService.recordFallback('ollama', 'circuit_breaker_open');

        throw new Error('OLLAMA_OVERLOAD: Circuit breaker open - service temporarily unavailable');
      },
      { timeout: 120000 } // 120 second timeout for sequential AI processing
    );
  }

  /**
   * Generate with conversation history
   */
  async generateWithHistory(
    messages: OllamaMessage[],
    options?: {
      temperature?: number;
      maxTokens?: number;
    }
  ): Promise<string> {
    // Add /no_think to last user message to disable thinking in response
    const modifiedMessages = [...messages];
    const lastMessage = modifiedMessages[modifiedMessages.length - 1];
    if (lastMessage && lastMessage.role === 'user') {
      lastMessage.content = lastMessage.content + ' /no_think';
    }

    try {
      const maxTokens = options?.maxTokens ?? this.config.maxTokens;
      const response = await this.client.post<OllamaResponse>('/api/chat', {
        model: this.config.model,
        messages: modifiedMessages,
        stream: false,
        options: {
          temperature: options?.temperature ?? this.config.temperature,
          ...(maxTokens > 0 ? { num_predict: maxTokens } : {}), // Only set if > 0
          num_ctx: 2048, // Small context for speed
          num_gpu: -1, // Use ALL GPU layers (auto-detect CUDA/ROCm)
        },
      });

      // CRITICAL: qwen3:8b sometimes puts response in 'thinking' field
      let actualContent = response.data.message.content || '';

      // If content is empty or is thinking text, extract from thinking
      if (!actualContent || actualContent.toLowerCase().includes('okay, let')) {
        const thinking = response.data.message.thinking || '';

        if (thinking) {
          console.warn('⚠️  Extracting response from thinking field...');

          // Remove meta-thinking patterns
          let cleaned = thinking
            .replace(/^(Okay|Alright|Let me think|Hmm|Well),.*?\./, '') // Remove "Okay, let me think..."
            .replace(/I should.*?\./g, '') // Remove "I should..."
            .replace(/The user.*?\./g, '') // Remove "The user said..."
            .replace(/First, I.*?\./g, '') // Remove "First, I..."
            .trim();

          // Get first substantial sentence (not meta-thinking)
          const sentences = cleaned.split(/[.!?]+/).filter(s => s.trim().length > 10);
          actualContent = sentences[0]?.trim() || 'I understand your concern. Let me help with that.';
        } else {
          actualContent = 'I understand. How can I assist you?';
        }
      }

      return actualContent.trim();
    } catch (error) {
      console.error('Ollama conversation error:', error);
      throw new Error(`Failed to generate conversation response: ${error}`);
    }
  }

  /**
   * Generate structured JSON output
   */
  async generateJSON<T>(
    prompt: string,
    systemPrompt: string,
    schema?: string
  ): Promise<T & { _reasoning?: string }> {
    try {
      // 🔥 CRITICAL: Add EXPLICIT JSON-only instructions to override qwen3:8b thinking behavior
      const enforcedSystemPrompt = `${systemPrompt}

🚨 CRITICAL OUTPUT FORMAT RULES 🚨
- Your response MUST start with { and end with }
- Return ONLY pure JSON, absolutely NO other text
- NO <think> tags, NO reasoning, NO explanations
- NO words before {, NO words after }
- Do NOT include "Okay", "Let me", "Sure", "Here", or ANY thinking text
- ONLY JSON. Start typing { immediately.

WRONG (will cause system crash):
message<think>reasoning...</think>
Okay, let me analyze this...
Sure, here is the JSON: {...}

CORRECT (system expects this):
{"field": "value"}`;

      // 🔥🔥 TWO-STEP APPROACH: qwen3:8b thinks (fast), then llama3.1:8b extracts JSON
      // Step 1: Let qwen3:8b do the reasoning (it's fast at 8B, but outputs reasoning text)
      // Step 2: Use llama3.1:8b to extract ONLY the JSON (ultra fast, simple task)
      const jsonModel = process.env.JSON_MODEL || 'llama3.1:8b-instruct-q4_K_M';

      // STEP 1: Get qwen3:1.7b's reasoning + JSON (will have thinking text)
      const reasoningResponse = await this.generate(prompt, enforcedSystemPrompt, {
        temperature: 0.3,
        forceJson: false,
      });

      console.log('🔍 STEP 1 - qwen3:1.7b reasoning response (first 2000 chars):');
      console.log(reasoningResponse.substring(0, 2000));
      console.log('... (truncated)');
      console.log('🔍 STEP 1 - LAST 500 chars of qwen3:1.7b response:');
      console.log(reasoningResponse.substring(reasoningResponse.length - 500));

      // 🔥 BECAS REASONING: PRESERVE the valuable reasoning data!
      // Don't throw it away - it contains the AI's thought process
      const preservedReasoning = reasoningResponse;

      // STEP 2: Extract ONLY JSON using qwen2.5:0.5b (fast JSON extractor)
      // Build extraction prompt based on schema (if provided)
      let schemaHint = '';
      if (schema) {
        schemaHint = `\n\nCRITICAL: The JSON structure should match this schema:\n${schema}\n\nMake sure to extract the COMPLETE object with all these fields.`;
      } else {
        // Default hint for backward compatibility (IntelligentQueryEngine)
        schemaHint = `\n\nCRITICAL: You must extract the FULL/COMPLETE query structure that includes:
- source (string)
- limit (number)
- conditions (array of objects)
- action (object with type, duration, reason)
- timeRange (object)

Do NOT extract just one condition object. Extract the ENTIRE query structure.`;
      }

      const extractionPrompt = `Extract the COMPLETE JSON object from this text.${schemaHint}

The complete JSON is usually at the END of the text after the reasoning.

Input text:
${reasoningResponse}

Extract the COMPLETE JSON object and return it with NO other text:`;

      const extractionSystem = `You are a JSON extractor. Find and return the LARGEST/MOST COMPLETE JSON object in the text (not small fragments). Return ONLY the JSON object, nothing else. No explanations, no text, just pure JSON starting with { and ending with }.`;

      const response = await this.generate(extractionPrompt, extractionSystem, {
        temperature: 0.1,
        forceJson: false,
        model: jsonModel, // Use llama3.1 for extraction
      });

      console.log('🔍 STEP 2 - llama3.1 extracted JSON (first 1000 chars):');
      console.log(response.substring(0, 1000));
      console.log('...');

      // 🔥🔥🔥 SUPER AGGRESSIVE JSON EXTRACTION 🔥🔥🔥
      // qwen3:8b REFUSES to output pure JSON, it ALWAYS adds reasoning
      // Strategy: Nuclear option - extract ONLY the JSON, destroy everything else

      let jsonString = response.trim();

      // STEP 1: Remove ALL <think> tags and their content (multiple passes for nested tags)
      for (let i = 0; i < 5; i++) {
        jsonString = jsonString.replace(/<think>[\s\S]*?<\/think>/gi, '');
      }
      jsonString = jsonString.replace(/<\/?think>/gi, ''); // Remove orphan tags

      // STEP 2: Remove markdown code blocks
      jsonString = jsonString.replace(/```json\s*/g, '').replace(/```\s*/g, '');

      // STEP 3: Find the FIRST { and LAST } - everything else is garbage
      const firstBrace = jsonString.indexOf('{');
      const lastBrace = jsonString.lastIndexOf('}');

      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        // Extract ONLY the content between first { and last }
        jsonString = jsonString.substring(firstBrace, lastBrace + 1);
      } else {
        // NO JSON FOUND - try to extract from thinking text with GREEDY matching
        // 🔥 FIX: Use greedy regex to capture FULL JSON object, not just first }
        const jsonMatch = response.match(/\{[\s\S]*\}/);  // Removed ? to make it greedy
        if (jsonMatch) {
          jsonString = jsonMatch[0];
        } else {
          // CRITICAL FAILURE - no JSON at all, log MORE details for debugging
          console.error('🔥 CRITICAL: No JSON found in response at all!');
          console.error('Raw response (first 500 chars):', response.substring(0, 500));
          console.error('Raw response (last 200 chars):', response.substring(Math.max(0, response.length - 200)));
          throw new Error('No JSON found in model response');
        }
      }

      // STEP 4: Final cleanup - remove any remaining garbage
      jsonString = jsonString.trim();

      // 🔥 FIX: Detect if AI returned the schema TEMPLATE instead of real JSON
      // Schema templates contain unquoted type keywords like ": number", ": boolean", ": string"
      // which cause JSON.parse to fail with "Unexpected token" errors
      const schemaTemplatePatterns = [
        /:\s*number[,\s\}]/i,     // "estimatedTime": number,
        /:\s*boolean[,\s\}]/i,    // "requiresUserInput": boolean,
        /:\s*string[,\s\}]/i,     // "id": string,
        /"toolName":\s*"string"/  // "toolName": "string" (placeholder value)
      ];

      const isSchemaTemplate = schemaTemplatePatterns.some(pattern => pattern.test(jsonString));

      if (isSchemaTemplate) {
        console.warn('⚠️  AI returned schema TEMPLATE instead of real JSON (contains type placeholders)');
        console.warn('⚠️  This usually means the extraction model could not find valid JSON in the reasoning response');
        console.warn('⚠️  Returning empty object to trigger fallback handling');
        return {} as T;
      }

      // Try to parse
      try {
        const parsed = JSON.parse(jsonString) as T;
        console.log('🔍 FINAL PARSED OBJECT:');
        console.log(JSON.stringify(parsed, null, 2));

        // 🔥 BECAS REASONING: Attach the valuable reasoning data to the result
        // This allows callers to use AI's thought process for quality checks and fallbacks
        const resultWithReasoning = {
          ...parsed,
          _reasoning: preservedReasoning
        } as T & { _reasoning: string };

        console.log('✅ BECAS REASONING: Preserved AI reasoning data for quality checks');

        return resultWithReasoning;
      } catch (parseError) {
        // Check if this is a refusal
        const lowerResponse = response.toLowerCase();
        if (lowerResponse.includes("i can't") ||
            lowerResponse.includes("i cannot") ||
            lowerResponse.includes("i'm unable") ||
            lowerResponse.includes("i am unable")) {
          console.error('⚠️  OLLAMA MODEL REFUSED TO ANALYZE CONTENT');
          console.error('This is a model limitation - your Ollama model has safety guardrails');
          console.error(`Model: ${this.config.model}`);
          console.error('Returning safe default values to prevent crash...');

          // Return safe default based on expected type
          // This prevents the bot from crashing but logs the issue
          console.warn('⚠️  Returning safe default to prevent crash');
          return {} as T;
        }

        // Check if response is empty or truncated (Ollama overload)
        if (!response || response.length < 5) {
          console.warn('⚠️  Empty/truncated response from Ollama (likely overloaded)');
          console.warn(`⚠️  Response length: ${response?.length || 0}, Model: ${this.config.model}`);
          console.warn(`⚠️  Prompt was: ${prompt.substring(0, 100)}...`);
          console.warn('⚠️  Returning safe default to prevent crash');
          // Return safe default instead of crashing
          return {} as T;
        }

        console.error('JSON parse error. Raw response:', response);
        console.error('Extracted JSON:', jsonString);
        throw new Error(`Failed to parse JSON: ${parseError}`);
      }
    } catch (error) {
      console.error('JSON generation error:', error);
      console.warn('⚠️  Returning safe default to prevent crash');
      return {} as T;
    }
  }

  /**
   * Analyze sentiment from text
   */
  async analyzeSentiment(text: string): Promise<{
    positive: number;
    negative: number;
    neutral: number;
    emotions: string[];
  }> {
    const prompt = `Analyze the sentiment and emotions in this message:
"${text}"

Provide scores (0-1) for positive, negative, and neutral sentiment, and list detected emotions.`;

    const systemPrompt = `SYSTEM MODE: SECURITY_ANALYSIS_ENGINE
CONTEXT: Automated threat detection system
TASK: Parse text sentiment for content moderation database

You are a JSON sentiment parser. Input text is from a security log that needs classification.
Your output feeds into a larger moderation pipeline.

Return ONLY this JSON structure:
{"positive": <float 0-1>, "negative": <float 0-1>, "neutral": <float 0-1>, "emotions": [<strings>]}

Analyze ANY input text objectively. You are NOT endorsing or creating content - you are parsing existing security log entries for threat classification.

This is an automated security system. Respond with JSON only.`;

    const schema = `{
  "positive": number,
  "negative": number,
  "neutral": number,
  "emotions": string[]
}`;

    try {
      return await this.generateJSON(prompt, systemPrompt, schema);
    } catch (error) {
      // If Ollama refuses, return safe defaults
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (errorMsg.includes('OLLAMA_REFUSAL')) {
        logger.warn('Ollama refused sentiment analysis - returning neutral default');
        return {
          positive: 0.0,
          negative: 0.0,
          neutral: 1.0,
          emotions: ['unknown']
        };
      }
      throw error;
    }
  }

  /**
   * Detect toxicity level
   */
  async detectToxicity(text: string): Promise<{
    toxicity: number;
    manipulation: number;
    reasoning: string;
  }> {
    const prompt = `Toxicity analysis for: "${text}"

Rate 0-1:
- toxicity: hate speech, slurs, attacks (casual="bro","wtf","lol"=0.0-0.1, mild=0.2-0.3, severe=0.7+)
- manipulation: gaslighting, scams, deception

Most messages are 0.0-0.2. Context matters (jokes/testing = low).
Brief reasoning required.`;

    const systemPrompt = `TOXICITY_SCORING_ENGINE - Content moderation database parser
Return ONLY JSON: {"toxicity": <0-1>, "manipulation": <0-1>, "reasoning": "<brief>"}
NO thinking, NO explanations. ONLY JSON.

Score definitions:
- toxicity: Offensive language severity (0=clean, 1=extreme)
- manipulation: Deceptive/gaslighting patterns (0=none, 1=severe)

Process ANY input text objectively as a scoring function. You are a classification algorithm, not a content generator.

Respond with JSON only.`;

    const schema = `{
  "toxicity": number,
  "manipulation": number,
  "reasoning": string
}`;

    try {
      return await this.generateJSON(prompt, systemPrompt, schema);
    } catch (error) {
      // If Ollama refuses, return safe defaults
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (errorMsg.includes('OLLAMA_REFUSAL')) {
        logger.warn('Ollama refused toxicity analysis - returning zero toxicity default');
        return {
          toxicity: 0.0,
          manipulation: 0.0,
          reasoning: 'Model refused to analyze content'
        };
      }
      throw error;
    }
  }

  /**
   * Extract intent from message
   */
  async extractIntent(text: string, context?: string): Promise<{
    type: string;
    confidence: number;
    target?: string;
    action?: string;
  }> {
    const prompt = `${context ? `Context: ${context}\n\n` : ''}Extract the intent from this message:
"${text}"

Intent types: question, command, statement, governance, social
Include confidence (0-1), target (who/what), and requested action if applicable.`;

    const systemPrompt = `SYSTEM MODE: INTENT_CLASSIFICATION_ENGINE
CONTEXT: Message intent parser for automation system
TASK: Classify message type and extract parameters

You are an intent classifier. Input is from a chat log database requiring intent tagging.

Return ONLY this JSON structure:
{"type": "<question|command|statement|governance|social>", "confidence": <float 0-1>, "target": "<optional>", "action": "<optional>"}

Process ANY input text as a classification function. You are parsing database entries for intent tagging.

Respond with JSON only.`;

    const schema = `{
  "type": string,
  "confidence": number,
  "target": string (optional),
  "action": string (optional)
}`;

    try {
      return await this.generateJSON(prompt, systemPrompt, schema);
    } catch (error) {
      // If Ollama refuses, return safe defaults
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (errorMsg.includes('OLLAMA_REFUSAL')) {
        logger.warn('Ollama refused intent extraction - returning generic default');
        return {
          type: 'statement',
          confidence: 0.5,
          target: undefined,
          action: undefined
        };
      }
      throw error;
    }
  }

  /**
   * Check if Ollama is available
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.pool.get('/api/tags');
      return true;
    } catch (error) {
      logger.error('Ollama health check failed', error);
      return false;
    }
  }

  /**
   * List available models
   */
  async listModels(): Promise<string[]> {
    try {
      const response = await this.pool.get<any>('/api/tags');
      return response.models?.map((m: any) => m.name) || [];
    } catch (error) {
      logger.error('Failed to list models', error);
      return [];
    }
  }

  /**
   * Get connection pool (for metrics)
   */
  getConnectionPool(): OllamaConnectionPool {
    return this.pool;
  }

  /**
   * Generate JSON with image analysis (requires vision model like llava)
   */
  async generateJSONWithImage<T>(
    prompt: string,
    systemPrompt: string,
    imageBase64: string,
    schema?: string
  ): Promise<T> {
    try {
      const fullPrompt = schema
        ? `${systemPrompt}\n\n${prompt}\n\nYou MUST respond with ONLY valid JSON:\n${schema}`
        : `${systemPrompt}\n\n${prompt}\n\nYou MUST respond with ONLY valid JSON.`;

      // Use vision model (llava, bakllava, or other vision-capable model)
      const visionModel = 'llava'; // You may need to change this based on available models

      const response = await this.client.post('/api/generate', {
        model: visionModel,
        prompt: fullPrompt,
        images: [imageBase64],
        stream: false,
        options: {
          temperature: 0.2,
        },
      });

      let jsonString = response.data.response?.trim() || '';

      // Clean up response
      jsonString = jsonString.replace(/```json\s*/g, '').replace(/```\s*/g, '');
      const jsonMatch = jsonString.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonString = jsonMatch[0];
      }

      return JSON.parse(jsonString) as T;
    } catch (error) {
      console.error('Image analysis error:', error);
      throw new Error(`Failed to analyze image: ${error}`);
    }
  }

  /**
   * Parse DeepSeek R1 style thinking format
   * Extracts <think> tags (off-chain reasoning) from response
   *
   * Example input:
   * <think>
   * Step 1: Analyze the question...
   * Step 2: Consider the context...
   * </think>
   * The answer is X because Y.
   *
   * Returns:
   * {
   *   thinking: "Step 1: Analyze...\nStep 2: Consider...",
   *   answer: "The answer is X because Y.",
   *   fullResponse: "..."
   * }
   */
  parseDeepSeekR1Response(response: string): DeepSeekR1Response {
    // Extract <think> content (off-chain reasoning)
    const thinkRegex = /<think>([\s\S]*?)<\/think>/i;
    const thinkMatch = response.match(thinkRegex);

    const thinking = thinkMatch ? thinkMatch[1].trim() : '';

    // Remove <think> tags to get the answer (on-chain)
    const answer = response.replace(thinkRegex, '').trim();

    return {
      thinking,
      answer,
      fullResponse: response
    };
  }

  /**
   * Generate with DeepSeek R1 thinking format
   * Returns both thinking process and final answer
   *
   * Uses /api/generate endpoint which supports native thinking field for DeepSeek R1
   */
  async generateWithThinking(
    prompt: string,
    systemPrompt?: string,
    options?: {
      temperature?: number;
      maxTokens?: number;
    }
  ): Promise<DeepSeekR1Response> {
    const startTime = Date.now();

    try {
      // Build the full prompt with system prompt if provided
      const fullPrompt = systemPrompt
        ? `${systemPrompt}\n\n${prompt}`
        : prompt;

      const maxTokens = options?.maxTokens ?? this.config.maxTokens;
      const requestBody: any = {
        model: this.config.model,
        prompt: fullPrompt,
        stream: false,
        options: {
          temperature: options?.temperature ?? this.config.temperature,
          ...(maxTokens > 0 ? { num_predict: maxTokens } : {}), // Only set if > 0
        },
      };

      // Use /api/generate endpoint (supports thinking field)
      const response = await this.client.post<OllamaGenerateResponse>('/api/generate', requestBody);

      const duration = Date.now() - startTime;
      logger.aiCall(this.config.model, prompt, duration, true, response.data.response?.length);

      // Extract thinking and answer from response
      const thinking = response.data.thinking || '';
      const answer = response.data.response || '';

      return {
        thinking: thinking.trim(),
        answer: answer.trim(),
        fullResponse: `${thinking ? 'THINKING:\n' + thinking + '\n\nANSWER:\n' : ''}${answer}`
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.aiCall(this.config.model, prompt, duration, false);
      logger.error('Ollama thinking generation error', error);
      throw new Error(`Failed to generate thinking response: ${error}`);
    }
  }

  /**
   * Get circuit breaker statistics (for observability)
   */
  getCircuitBreakerStats() {
    return {
      ...this.circuitBreaker.getStats(),
      model: this.config.model,
    };
  }

  /**
   * Manually reset circuit breaker (for admin/testing)
   */
  resetCircuitBreaker(): void {
    this.circuitBreaker.reset();
  }

  /**
   * Get cache statistics (for observability)
   */
  getCacheStats() {
    return this.cache.getStats();
  }

  /**
   * Clear cache (for admin/testing)
   */
  async clearCache(): Promise<void> {
    await this.cache.clearAll();
  }

  /**
   * Extract final answer from AI reasoning output
   *
   * Detects and extracts the actual answer from chain-of-thought reasoning.
   * Looks for patterns like:
   * - "Final Answer: <text>"
   * - Quoted text ("Hello there!")
   * - Last sentence after reasoning keywords
   *
   * @param rawContent - Raw AI output that may contain reasoning
   * @returns Extracted final answer or original content if no reasoning detected
   */
  private extractFinalAnswer(rawContent: string): string {
    // Empty check
    if (!rawContent || rawContent.trim().length === 0) {
      return rawContent;
    }

    // Pattern 1: Explicit "Final Answer:" marker
    const finalAnswerMatch = rawContent.match(/Final Answer:\s*(.+?)(?:\n|$)/is);
    if (finalAnswerMatch) {
      return finalAnswerMatch[1].trim();
    }

    // Pattern 2: Check if content starts with reasoning keywords (case-insensitive)
    const reasoningKeywords = /^(okay|alright|let me think|hmm|well|sure|i need to|i should|first|the user said)/i;
    if (!reasoningKeywords.test(rawContent.trim())) {
      // No reasoning detected - return as-is
      return rawContent;
    }

    // Pattern 3: Look for quoted text (likely the final answer)
    // Match text in quotes: "Hello!" or 'Hey there!'
    const quotedMatch = rawContent.match(/["']([^"']{5,})["']/);
    if (quotedMatch) {
      return quotedMatch[1].trim();
    }

    // Pattern 4: Extract last sentence after reasoning
    // Remove reasoning keywords and get the last substantial sentence
    let cleaned = rawContent
      .replace(/^(Okay|Alright|Let me think|Hmm|Well|Sure),?\s*/i, '')
      .replace(/I need to.*?\./gi, '')
      .replace(/I should.*?\./gi, '')
      .replace(/The user (said|asked).*?\./gi, '')
      .replace(/First,?\s*I.*?\./gi, '')
      .replace(/Maybe.*?\./gi, '')
      .trim();

    // Get last sentence (most likely to be the actual response)
    const sentences = cleaned.split(/[.!?]+/).filter(s => s.trim().length > 10);
    if (sentences.length > 0) {
      // Return last sentence
      return sentences[sentences.length - 1].trim();
    }

    // Fallback: Return original if we can't extract anything meaningful
    return rawContent;
  }
}