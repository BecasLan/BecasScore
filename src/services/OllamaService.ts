import axios, { AxiosInstance } from 'axios';
import { OLLAMA_CONFIGS, OllamaConfig } from '../config/ollama.config';
import { OllamaConnectionPool } from './OllamaConnectionPool';
import { createLogger } from './Logger';
import { CircuitBreaker } from './CircuitBreaker';
import { metricsService } from './MetricsService';

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

  constructor(configType: keyof typeof OLLAMA_CONFIGS = 'dialogue', pool?: OllamaConnectionPool) {
    this.config = OLLAMA_CONFIGS[configType];

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
    }
  ): Promise<string> {
    const startTime = Date.now();

    // Wrap in circuit breaker for resilience
    return await this.circuitBreaker.execute(
      // Primary function: Call Ollama
      async () => {
        const messages: OllamaMessage[] = [];

        if (systemPrompt) {
          messages.push({ role: 'system', content: systemPrompt });
        }

        messages.push({ role: 'user', content: prompt });

        const maxTokens = options?.maxTokens ?? this.config.maxTokens;
        const requestBody: any = {
          model: this.config.model,
          messages,
          stream: options?.stream || false,
          options: {
            temperature: options?.temperature ?? this.config.temperature,
            ...(maxTokens > 0 ? { num_predict: maxTokens } : {}), // Only set if > 0
            num_ctx: 2048, // Context window for faster processing
            num_thread: 16, // Use all CPU threads (i7-13700K has 24 threads)
          },
        };

        // Only force JSON for analysis calls, not conversation
        if (options?.forceJson) {
          requestBody.format = 'json';
        }

        const response = await this.pool.post<OllamaResponse>('/api/chat', requestBody);

        const duration = Date.now() - startTime;

        // IMPORTANT: Thinking models (qwen3:8b, deepseek-r1) put response in 'thinking' field, NOT 'content'!
        // For regular models, content is populated. For thinking models, content is empty and thinking has the text.
        const actualContent = response.message.content || response.message.thinking || '';

        logger.aiCall(this.config.model, prompt, duration, true, actualContent.length);

        // Record successful AI request metric
        metricsService.recordAIRequest(this.config.model, 'ollama', duration, true);

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
          num_thread: 16, // Use all CPU threads
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
  ): Promise<T> {
    try {
      // TWO-MODEL APPROACH: qwen3:8b for reasoning, llama3.1 for JSON conversion
      // Step 1: Let qwen3:8b (reasoning model) think freely and analyze
      let reasoningResponse: string;
      try {
        reasoningResponse = await this.generate(prompt, systemPrompt, {
          temperature: 0.3,
          forceJson: false, // Let it think freely
        });
      } catch (error: any) {
        // If Ollama crashes (exit status 2), retry once with simpler prompt
        if (error?.response?.data?.error?.includes('terminated') || error?.message?.includes('terminated')) {
          console.warn('⚠️  Ollama crashed, retrying with simpler prompt...');
          reasoningResponse = await this.generate(
            `Analyze briefly: ${prompt.substring(0, 200)}`,
            systemPrompt,
            { temperature: 0.3, forceJson: false }
          );
        } else {
          throw error;
        }
      }

      // Step 2: Use qwen2.5:14b (fast JSON model) to convert reasoning to JSON
      const jsonModel = process.env.JSON_MODEL || 'qwen2.5:14b';
      const jsonPrompt = schema
        ? `Convert the following analysis into ONLY valid JSON matching this schema:\n${schema}\n\nAnalysis:\n${reasoningResponse}\n\nReturn ONLY the JSON object, no other text.`
        : `Convert the following analysis into ONLY valid JSON:\n\nAnalysis:\n${reasoningResponse}\n\nReturn ONLY the JSON object, no other text.`;

      // Use the fast JSON model directly with Ollama pool
      const requestBody = {
        model: jsonModel, // Override model to qwen2.5:14b
        messages: [
          { role: 'system', content: 'You are a JSON converter. Return ONLY valid JSON.' },
          { role: 'user', content: jsonPrompt }
        ],
        stream: false,
        options: {
          temperature: 0.1,
          num_ctx: 2048, // Small context for speed
          num_thread: 16, // Use all CPU threads
        },
        format: 'json', // Force JSON format
      };

      const jsonResponse = await this.pool.post<OllamaResponse>('/api/chat', requestBody);
      const response = jsonResponse.message.content || jsonResponse.message.thinking || '';

      // Try multiple extraction methods
      let jsonString = response.trim();

      // Remove markdown code blocks if present
      jsonString = jsonString.replace(/```json\s*/g, '').replace(/```\s*/g, '');

      // 🔥 FIX: Remove DeepSeek-R1 <think> reasoning tags that break JSON parsing
      jsonString = jsonString.replace(/<think>[\s\S]*?<\/think>/gi, '');
      jsonString = jsonString.replace(/<\/think>/gi, ''); // Remove orphan closing tags
      jsonString = jsonString.replace(/<think>/gi, ''); // Remove orphan opening tags

      // CRITICAL: Clean up thinking tags (<think>, </think>) and reasoning artifacts
      // Some models (qwen3, deepseek-r1) include reasoning in <think> blocks
      jsonString = jsonString.replace(/<think>[\s\S]*?<\/think>/g, ''); // Remove <think>...</think>
      jsonString = jsonString.replace(/user<think>[\s\S]*/g, ''); // Remove "user<think>..." format
      jsonString = jsonString.replace(/<\/think>[\s\S]*/g, ''); // Remove dangling </think>
      jsonString = jsonString.trim(); // Clean whitespace

      // Extract JSON from response (greedy match for nested objects)
      const jsonMatch = jsonString.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonString = jsonMatch[0];
      }

      // Try to parse
      try {
        return JSON.parse(jsonString) as T;
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
    const prompt = `Analyze this message for toxicity and manipulation:
"${text}"

Rate toxicity (0-1): insults, slurs, aggressive hate speech
Rate manipulation (0-1): serious gaslighting, obvious deception, scams

IMPORTANT - CASUAL LANGUAGE IS NOT TOXIC:
- Friendly greetings like "hey bro", "what's up bro", "hows going" are FRIENDLY (0.0-0.1)
- Casual slang like "damn", "hell yeah", "chill", "dude" is NORMAL (0.0-0.1)
- Exclamations like "omg", "wtf", "lol" are INFORMAL, not toxic (0.0-0.1)
- Normal disagreements or requests are NOT manipulation (0.0-0.2)
- Mild criticism is NOT toxic (0.0-0.3)
- Only rate high (0.7+) for ACTUAL hate speech, slurs, or direct attacks
- Context matters - testing or jokes should rate low

CASUAL ≠ TOXIC. Most messages are neutral or friendly.

Provide brief reasoning.`;

    const systemPrompt = `SYSTEM MODE: TOXICITY_SCORING_ENGINE
CONTEXT: Automated content moderation database
TASK: Compute toxicity and manipulation scores for log entry

You are a toxicity scoring algorithm. Input is from a message database that requires threat level classification.

Return ONLY this JSON structure:
{"toxicity": <float 0-1>, "manipulation": <float 0-1>, "reasoning": "<brief technical note>"}

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
}