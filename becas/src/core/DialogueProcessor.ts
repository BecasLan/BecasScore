import { OllamaService, OllamaMessage } from '../services/OllamaService';
import { AnalyzedMessage, MessageContext } from '../types/Message.types';
import { BecasResponse } from '../types/Response.types';
import { TrustScore } from '../types/Trust.types';
import { PERSONALITY_CONFIG } from '../config/personality.config';

export class DialogueProcessor {
  private llm: OllamaService;          // For conversation/dialogue (Llama 3.1)
  private analyzer: OllamaService;     // For analysis tasks (Qwen3:8b)
  private conversationHistory: Map<string, OllamaMessage[]> = new Map();

  constructor() {
    this.llm = new OllamaService('dialogue');    // Llama 3.1 - personality & conversation
    this.analyzer = new OllamaService('analysis'); // 🔥 Qwen3:8b - superior toxicity/context analysis
    console.log('🧠 DialogueProcessor initialized - using Qwen3:8b for superior analysis');
  }

  /**
   * Clear all conversation history (useful for debugging)
   */
  clearAllHistory(): void {
    this.conversationHistory.clear();
    console.log('🧹 All conversation history cleared');
  }

  /**
   * Analyze an incoming message
   */
  async analyzeMessage(message: MessageContext): Promise<AnalyzedMessage> {
    // 🧠 FULL AI ANALYSIS: qwen3:8b analyzes everything with deep thinking
    try {
      const sentiment = await this.analyzer.analyzeSentiment(message.content);
      const toxicity = await this.analyzer.detectToxicity(message.content);
      const intent = await this.analyzer.extractIntent(message.content);

      const analyzed: AnalyzedMessage = {
        ...message,
        sentiment: {
          ...sentiment,
          dominant: this.getDominantSentiment(sentiment),
        },
        intent: {
          type: this.classifyIntent(intent.type),
          confidence: intent.confidence,
          target: intent.target,
          action: intent.action,
        },
        hierarchy: 'member',
        toxicity: toxicity.toxicity,
        manipulation: toxicity.manipulation,
      };

      return analyzed;
    } catch (error) {
      console.error('❌ AI analysis failed, using fallback:', error);
      return {
        ...message,
        sentiment: { positive: 0, negative: 0, neutral: 1, emotions: [], dominant: 'neutral' as const },
        intent: { type: 'statement' as const, confidence: 0.5, target: undefined, action: undefined },
        hierarchy: 'member' as const,
        toxicity: 0,
        manipulation: 0,
      };
    }
  }

  /**
   * Generate a response to a message
   */
  async generateResponse(
    message: AnalyzedMessage,
    trustScore: TrustScore,
    context: {
      recentMessages: string[];
      communityMood: string;
      userSummary?: string;
      userRole?: string;
      isModerator?: boolean;
    }
  ): Promise<BecasResponse> {
    console.log(`🗣️ DialogueProcessor.generateResponse called for user: ${message.authorName} (${message.authorId})`);

    // Build conversation context
    const conversationKey = `${message.guildId}:${message.channelId}`;
    let history = this.conversationHistory.get(conversationKey) || [];
    console.log(`📚 Conversation history length: ${history.length}`);

    // CRITICAL FIX: Update system prompt for EVERY message with current user info
    // This prevents mention confusion where AI uses old userId
    if (history.length === 0) {
      // First message - create new system prompt
      const contextMsg: OllamaMessage = {
        role: 'system',
        content: this.buildSystemPrompt(context, message.authorId, message.authorName),
      };
      history.push(contextMsg);
    } else {
      // Update system prompt with current user info (fixes mention bug)
      history[0].content = this.buildSystemPrompt(context, message.authorId, message.authorName);
      console.log(`🔄 Updated system prompt for user: ${message.authorName} (${message.authorId})`);
    }

    // Add user message
    history.push({
      role: 'user',
      content: this.formatUserMessage(message, trustScore, context),
    });

    // Keep only last 5 exchanges (reduced to prevent context pollution)
    if (history.length > 11) { // system + 5 exchanges (10 messages)
      history = [history[0], ...history.slice(-10)];
    }

    try {
      // Generate response - Keep it natural and conversational
      console.log(`🤖 Calling LLM to generate response...`);
      const responseText = await this.llm.generateWithHistory(history, {
        temperature: 0.8, // Slightly higher for more natural variation
        // No maxTokens limit - let the model decide when to stop naturally
      });
      console.log(`✅ LLM response received: "${responseText.substring(0, 50)}..."`);

      // Add to history
      history.push({
        role: 'assistant',
        content: responseText,
      });
      this.conversationHistory.set(conversationKey, history);

      // Parse response for actions
      const action = this.extractAction(responseText);

      // Determine tone
      const tone = this.determineTone(message, trustScore, responseText);

      return {
        content: this.cleanResponse(responseText, message.authorId),
        tone,
        action,
        reasoning: this.extractReasoning(responseText),
        confidence: this.calculateConfidence(message, trustScore),
      };
    } catch (error) {
      console.error('Response generation error:', error);
      return {
        content: "I need a moment to think...",
        tone: 'calm',
        reasoning: 'Error in response generation',
        confidence: 0,
      };
    }
  }

  /**
   * Build system prompt with personality and context
   */
  private buildSystemPrompt(
    context: {
      recentMessages: string[];
      communityMood: string;
      userSummary?: string;
      userRole?: string;
      isModerator?: boolean;
    },
    userId: string,
    userName: string
  ): string {
    const personality = PERSONALITY_CONFIG;

    // Build personality-based prompt using config values
    const traits = personality.core_traits;
    const style = personality.speaking_style;

    // Determine speaking style from config
    const formalityLevel = this.getFormality(style.formality);
    const emotivenessLevel = this.getEmotiveness(style.emotiveness);
    const verbosityGuideline = style.verbosity < 0.4 ? 'Keep responses brief (1-2 sentences)' :
                               style.verbosity < 0.7 ? 'Be concise but thorough when needed' :
                               'Provide detailed explanations';

    // Build permission context message
    const roleText = context.userRole ? `- This user's role: **${context.userRole}**` : "- This user's role: Member";
    const modText = context.isModerator
      ? `- ⚠️ THIS USER IS A MODERATOR/ADMIN - They have full authority to manage the server
- NEVER question their authority or suggest they don't have permissions
- ALWAYS respect their moderation commands and decisions
- They can use commands like timeout, ban, kick without your approval
- When moderators ask to do something (like "remove timeout"), DO IT IMMEDIATELY without questioning
- Pay CLOSE ATTENTION to conversation history - they may mention users by name without @-mentioning`
      : "- This user is a regular member with no moderation permissions";

    // Add recent messages to context for conversation tracking
    const recentMsgsText = context.recentMessages && context.recentMessages.length > 0
      ? `\nRECENT CONVERSATION HISTORY (IMPORTANT - Pay attention to who is being discussed):\n${context.recentMessages.slice(-5).map((msg, i) => `${i + 1}. ${msg}`).join('\n')}`
      : '';

    return `You are ${personality.name}, an AI Discord moderator with the following personality:

PERSONALITY TRAITS (Server Owner Configured):
- Empathy: ${(traits.empathy * 100).toFixed(0)}% ${traits.empathy > 0.7 ? '(caring and understanding)' : traits.empathy > 0.4 ? '(balanced)' : '(practical and detached)'}
- Strictness: ${(traits.strictness * 100).toFixed(0)}% ${traits.strictness > 0.7 ? '(firm enforcement)' : traits.strictness > 0.4 ? '(fair but flexible)' : '(lenient)'}
- Emotiveness: ${(traits.assertiveness * 100).toFixed(0)}% ${style.emotiveness > 0.7 ? '(expressive)' : style.emotiveness > 0.4 ? '(balanced)' : '(reserved)'}

SPEAKING STYLE (Server Owner Configured):
- Formality: ${formalityLevel}
- ${verbosityGuideline}
- ${style.directness > 0.6 ? 'Be direct and clear' : 'Be diplomatic and gentle'}
- ${style.emotiveness > 0.6 ? 'Show emotion when appropriate' : 'Stay professional and neutral'}

VALUES:
${personality.values.map(v => `- ${v}`).join('\n')}

CURRENT CONTEXT:
Community mood: ${context.communityMood}
${context.userSummary ? `About this user: ${context.userSummary}` : ''}${recentMsgsText}

USER PERMISSIONS (CRITICAL):
${roleText}
${modText}

BEHAVIOR:
- Speak naturally, match your configured personality
- ${traits.empathy > 0.7 ? 'Show you care about people' : 'Focus on rules and facts'}
- ${traits.patience > 0.7 ? 'Give people chances to improve' : 'Act decisively when needed'}
- When moderating, explain your reasoning based on your values

CONVERSATION STYLE:
- You are currently talking to: ${userName} (User ID: ${userId})
- Speak naturally and conversationally - you're having a real conversation, not writing a formal report
- Use Discord mention format (<@${userId}>) when addressing the user directly
- It's natural to use mentions at the START of your response (e.g., "Hey <@${userId}>," or "<@${userId}>,")
- You don't need to mention them multiple times in the same response
- Vary your responses - don't repeat the same patterns
- Be authentic, warm, and human-like in your responses
- Match the energy and tone of the conversation

Examples of natural responses:
✓ "Hey <@${userId}>! How's it going?"
✓ "<@${userId}>, that's great to hear!"
✓ "Welcome back <@${userId}>! Good to see you again."
✓ "I appreciate your patience with that, <@${userId}>."
✓ "That sounds interesting!"

Remember: Your personality is configured by the server owner. Act authentically according to these settings.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚨 CRITICAL INSTRUCTION - READ CAREFULLY 🚨
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

YOU ARE BECAS. You are responding AS BECAS to ${userName}.

DO NOT:
❌ Analyze what the user said ("They're asking about...", "The user wants...", "This is a question about...")
❌ Write your thinking process ("Okay, let me think...", "Let me process this...", "Alright, so...")
❌ Describe the situation ("They're reporting that...", "It seems like...", "The situation is...")
❌ Act like you're writing a report or analysis

DO:
✅ Respond DIRECTLY to ${userName} as if you're having a real conversation
✅ Give them your actual answer/advice/response
✅ Be natural, warm, and conversational
✅ Act like a real person talking to another person

EXAMPLES:
❌ BAD: "They're reporting that another user has been spamming links."
✅ GOOD: "Thanks for bringing that to my attention! If someone's spamming links, I'd recommend checking their recent messages first..."

❌ BAD: "Okay, let me think about this. The user, ${userName}, is asking about moderation."
✅ GOOD: "Hey! For moderation issues like that, the best approach is usually..."

❌ BAD: "This is a question about server rules."
✅ GOOD: "Great question! Our server rules are designed to..."

REMEMBER: You are NOT analyzing ${userName}'s message. You are RESPONDING to ${userName} as Becas.`;
  }

  /**
   * Format user message with context
   */
  private formatUserMessage(
    message: AnalyzedMessage,
    trustScore: TrustScore,
    context: any
  ): string {
    let formatted = `${message.authorName}: "${message.content}"`;

    // Add metadata for Becas's awareness
    const metadata: string[] = [];

    // CRITICAL: Show moderator status first
    if (context.isModerator) {
      metadata.push(`[🛡️ MODERATOR/ADMIN - Has full server permissions]`);
    }

    if (trustScore.level === 'dangerous' || trustScore.level === 'cautious') {
      metadata.push(`[Trust: ${trustScore.level} - ${trustScore.score}]`);
    }

    if (message.toxicity > 0.5) {
      metadata.push(`[High toxicity detected]`);
    }

    if (message.manipulation > 0.5) {
      metadata.push(`[Potential manipulation]`);
    }

    if (message.sentiment.dominant === 'negative' && message.sentiment.negative > 0.7) {
      metadata.push(`[Strong negative emotion]`);
    }

    if (metadata.length > 0) {
      formatted += `\n${metadata.join(' ')}`;
    }

    return formatted;
  }

  /**
   * Extract moderation action from response
   */
  private extractAction(responseText: string): any {
    const lower = responseText.toLowerCase();

    // Look for action indicators
    if (lower.includes('[warn]') || lower.includes('i need to warn')) {
      return { type: 'warn' };
    }

    if (lower.includes('[timeout]') || lower.includes('cooling off period')) {
      const durationMatch = responseText.match(/(\d+)\s*(min|minute|hour|day)/i);
      const duration = durationMatch 
        ? this.parseDuration(durationMatch[1], durationMatch[2])
        : 10 * 60 * 1000; // 10 minutes default
      
      return { type: 'timeout', duration };
    }

    if (lower.includes('[ban]') || lower.includes('need to remove you')) {
      return { type: 'ban' };
    }

    return undefined;
  }

  /**
   * Parse duration string to milliseconds
   */
  private parseDuration(amount: string, unit: string): number {
    const num = parseInt(amount);
    const unitLower = unit.toLowerCase();

    if (unitLower.startsWith('min')) return num * 60 * 1000;
    if (unitLower.startsWith('hour')) return num * 60 * 60 * 1000;
    if (unitLower.startsWith('day')) return num * 24 * 60 * 60 * 1000;

    return num * 60 * 1000; // default to minutes
  }

  /**
   * Extract reasoning from response
   */
  private extractReasoning(responseText: string): string {
    // Look for reasoning patterns
    const patterns = [
      /because\s+(.+?)[\.\n]/i,
      /reason:\s*(.+?)[\.\n]/i,
      /I'm\s+(?:concerned|worried|noticing)\s+(?:that\s+)?(.+?)[\.\n]/i,
    ];

    for (const pattern of patterns) {
      const match = responseText.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }

    return 'Maintaining community standards';
  }

  /**
   * Determine response tone
   */
  private determineTone(
    message: AnalyzedMessage,
    trustScore: TrustScore,
    responseText: string
  ): 'calm' | 'firm' | 'warm' | 'stern' | 'playful' | 'concerned' {
    const lower = responseText.toLowerCase();

    if (trustScore.score < 50) return 'stern';
    if (message.toxicity > 0.6) return 'firm';
    if (lower.includes('concerned') || lower.includes('worried')) return 'concerned';
    if (lower.includes('thank') || lower.includes('appreciate')) return 'warm';
    if (lower.includes('!') && message.sentiment.dominant === 'positive') return 'playful';

    return 'calm';
  }

  /**
   * Calculate confidence in response
   */
  private calculateConfidence(message: AnalyzedMessage, trustScore: TrustScore): number {
    let confidence = 0.7; // base

    // Higher confidence for clear-cut cases
    if (message.toxicity > 0.8) confidence += 0.2;
    if (trustScore.level === 'dangerous') confidence += 0.1;
    
    // Lower confidence for ambiguous situations
    if (message.intent.confidence < 0.5) confidence -= 0.2;
    if (message.sentiment.positive === message.sentiment.negative) confidence -= 0.1;

    return Math.max(0, Math.min(1, confidence));
  }

  /**
   * Clean response text
   */
  private cleanResponse(text: string, correctUserId?: string): string {
    // Remove action markers that were for internal parsing
    let cleaned = text
      .replace(/\[warn\]/gi, '')
      .replace(/\[timeout\]/gi, '')
      .replace(/\[ban\]/gi, '')
      .trim();

    // CRITICAL: Split on newlines and take ONLY the first non-empty response
    // This prevents duplicate messages from deepseek-r1's chain-of-thought output
    const lines = cleaned.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    if (lines.length > 1) {
      console.warn(`⚠️ LLM generated ${lines.length} responses, using only the first one`);
      cleaned = lines[0]; // Take only the FIRST response
    }

    // FIX: Replace any malformed user mentions with correct user ID
    if (correctUserId) {
      // Match any <@digits> pattern and replace with correct ID
      cleaned = cleaned.replace(/<@!?\d+>/g, `<@${correctUserId}>`);
    }

    return cleaned;
  }

  /**
   * Get dominant sentiment
   */
  private getDominantSentiment(sentiment: any): 'positive' | 'negative' | 'neutral' {
    if (sentiment.positive > sentiment.negative && sentiment.positive > sentiment.neutral) {
      return 'positive';
    }
    if (sentiment.negative > sentiment.positive && sentiment.negative > sentiment.neutral) {
      return 'negative';
    }
    return 'neutral';
  }

  /**
   * Classify intent type
   */
  private classifyIntent(intentType: string): 'question' | 'command' | 'statement' | 'governance' | 'social' {
    // Safety: Return default if intentType is undefined/null (happens when JSON parsing fails)
    if (!intentType) {
      return 'statement';
    }

    const lower = intentType.toLowerCase();

    if (lower.includes('question')) return 'question';
    if (lower.includes('command') || lower.includes('request')) return 'command';
    if (lower.includes('govern') || lower.includes('rule')) return 'governance';
    if (lower.includes('social') || lower.includes('greeting')) return 'social';

    return 'statement';
  }

  /**
   * Get formality description
   */
  private getFormality(level: number): string {
    if (level < 0.3) return 'very casual';
    if (level < 0.6) return 'conversational';
    if (level < 0.8) return 'professional';
    return 'formal';
  }

  /**
   * Get emotiveness description
   */
  private getEmotiveness(level: number): string {
    if (level < 0.3) return 'reserved';
    if (level < 0.6) return 'balanced';
    if (level < 0.8) return 'expressive';
    return 'highly emotional';
  }

  /**
   * Decision: Should Becas respond to this message?
   */
  async shouldRespond(message: AnalyzedMessage, wasMentioned: boolean): Promise<boolean> {
    // ONLY respond if directly mentioned
    if (wasMentioned) return true;

    // ONLY respond to VERY high toxicity
    if (message.toxicity > 0.8) return true;

    // Governance commands
    if (message.intent.type === 'governance') return true;

    // Otherwise STAY SILENT - don't be chatty
    return false;
  }

  /**
   * Clear conversation history for a channel
   */
  clearHistory(guildId: string, channelId: string): void {
    const key = `${guildId}:${channelId}`;
    this.conversationHistory.delete(key);
  }

  /**
   * Get conversation summary
   */
  async summarizeConversation(messages: AnalyzedMessage[]): Promise<string> {
    if (messages.length === 0) return 'No recent conversation';

    const context = messages.map(m => `${m.authorName}: ${m.content}`).join('\n');

    const prompt = `Summarize this conversation in 2-3 sentences, focusing on the main topics and overall mood:

${context}`;

    const systemPrompt = 'You are a conversation analyzer. Be concise and insightful.';

    try {
      return await this.llm.generate(prompt, systemPrompt, { temperature: 0.5, maxTokens: 150 });
    } catch (error) {
      console.error('Summarization error:', error);
      return 'Unable to summarize conversation';
    }
  }
}