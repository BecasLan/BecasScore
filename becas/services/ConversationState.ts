/**
 * CONVERSATION STATE MANAGER - Multi-Turn Command Conversations
 *
 * Tracks ongoing command conversations with moderators.
 * Supports parameter updates, confirmations, and conversation flow.
 *
 * Example flow:
 * 1. Mod: "Şu adamı sustur"
 * 2. AI: "UserX'i mi kastettin?" [Yes/No]
 * 3. Mod: "Evet" → State updated with target=UserX
 * 4. AI: "Süre?"
 * 5. Mod: "10 dakika" → State updated with duration=10m
 * 6. Execute command
 */

import { createLogger } from './Logger';

const logger = createLogger('ConversationState');

export type ConversationStateStatus =
  | 'parsing'           // Extracting intent from initial message
  | 'resolving'         // Resolving missing parameters via context
  | 'awaiting_input'    // Waiting for moderator to provide missing param
  | 'awaiting_confirmation' // Waiting for moderator to confirm action
  | 'executing'         // Executing the command
  | 'completed'         // Command executed successfully
  | 'cancelled';        // Conversation cancelled

export interface ConversationState {
  // Identity
  conversationId: string;
  moderatorId: string;
  channelId: string;
  guildId: string;

  // Status
  status: ConversationStateStatus;
  lastUpdate: number; // Timestamp

  // Command details
  intent: string; // e.g., 'timeout', 'ban'
  confidence: number; // AI confidence in intent
  parameters: {
    [key: string]: any; // Filled parameters
  };
  missingParams: string[]; // Still need these

  // Conversation history
  messages: {
    role: 'moderator' | 'ai';
    content: string;
    timestamp: number;
  }[];

  // UI state
  confirmationMessageId?: string; // Discord message ID with buttons
  questionMessageId?: string; // Discord message ID asking for parameter

  // Metadata
  createdAt: number;
  expiresAt: number; // Auto-cancel if no activity
}

export class ConversationStateManager {
  private conversations: Map<string, ConversationState> = new Map();
  private TTL = 300000; // 5 minutes

  constructor() {
    // Clean expired conversations every minute
    setInterval(() => this.cleanExpired(), 60000);
  }

  /**
   * Create a new conversation
   */
  create(
    moderatorId: string,
    channelId: string,
    guildId: string,
    intent: string,
    confidence: number,
    parameters: { [key: string]: any },
    missingParams: string[]
  ): ConversationState {
    const conversationId = `${moderatorId}-${Date.now()}`;
    const now = Date.now();

    const state: ConversationState = {
      conversationId,
      moderatorId,
      channelId,
      guildId,
      status: 'parsing',
      lastUpdate: now,
      intent,
      confidence,
      parameters,
      missingParams,
      messages: [],
      createdAt: now,
      expiresAt: now + this.TTL
    };

    this.conversations.set(this.getKey(moderatorId, channelId), state);
    logger.info(`Created conversation ${conversationId} for intent: ${intent}`);

    return state;
  }

  /**
   * Get active conversation for a moderator in a channel
   */
  get(moderatorId: string, channelId: string): ConversationState | null {
    const key = this.getKey(moderatorId, channelId);
    const state = this.conversations.get(key);

    if (!state) return null;

    // Check if expired
    if (Date.now() > state.expiresAt) {
      this.conversations.delete(key);
      logger.info(`Conversation ${state.conversationId} expired`);
      return null;
    }

    return state;
  }

  /**
   * Update conversation state
   */
  update(
    moderatorId: string,
    channelId: string,
    updates: Partial<ConversationState>
  ): ConversationState | null {
    const state = this.get(moderatorId, channelId);
    if (!state) return null;

    // Apply updates
    Object.assign(state, updates);
    state.lastUpdate = Date.now();
    state.expiresAt = Date.now() + this.TTL; // Reset expiration

    logger.debug(`Updated conversation ${state.conversationId}`, updates);
    return state;
  }

  /**
   * Update a specific parameter
   */
  updateParameter(
    moderatorId: string,
    channelId: string,
    paramName: string,
    value: any
  ): ConversationState | null {
    const state = this.get(moderatorId, channelId);
    if (!state) return null;

    // Set parameter value
    state.parameters[paramName] = value;

    // Remove from missing params if present
    state.missingParams = state.missingParams.filter(p => p !== paramName);

    state.lastUpdate = Date.now();
    state.expiresAt = Date.now() + this.TTL;

    logger.info(`Updated parameter ${paramName} in conversation ${state.conversationId}`);
    return state;
  }

  /**
   * Add message to conversation history
   */
  addMessage(
    moderatorId: string,
    channelId: string,
    role: 'moderator' | 'ai',
    content: string
  ): void {
    const state = this.get(moderatorId, channelId);
    if (!state) return;

    state.messages.push({
      role,
      content,
      timestamp: Date.now()
    });

    state.lastUpdate = Date.now();
    state.expiresAt = Date.now() + this.TTL;
  }

  /**
   * Set confirmation message ID (for button interactions)
   */
  setConfirmationMessage(
    moderatorId: string,
    channelId: string,
    messageId: string
  ): void {
    const state = this.get(moderatorId, channelId);
    if (!state) return;

    state.confirmationMessageId = messageId;
    state.status = 'awaiting_confirmation';
    state.lastUpdate = Date.now();
  }

  /**
   * Set question message ID (waiting for parameter input)
   */
  setQuestionMessage(
    moderatorId: string,
    channelId: string,
    messageId: string
  ): void {
    const state = this.get(moderatorId, channelId);
    if (!state) return;

    state.questionMessageId = messageId;
    state.status = 'awaiting_input';
    state.lastUpdate = Date.now();
  }

  /**
   * Complete conversation (success)
   */
  complete(moderatorId: string, channelId: string): void {
    const state = this.get(moderatorId, channelId);
    if (!state) return;

    state.status = 'completed';
    state.lastUpdate = Date.now();

    // Remove from active conversations after 30 seconds
    setTimeout(() => {
      this.conversations.delete(this.getKey(moderatorId, channelId));
      logger.info(`Cleaned up completed conversation ${state.conversationId}`);
    }, 30000);
  }

  /**
   * Cancel conversation
   */
  cancel(moderatorId: string, channelId: string, reason?: string): void {
    const state = this.get(moderatorId, channelId);
    if (!state) return;

    state.status = 'cancelled';
    state.lastUpdate = Date.now();

    logger.info(`Cancelled conversation ${state.conversationId}${reason ? `: ${reason}` : ''}`);

    // Remove immediately
    this.conversations.delete(this.getKey(moderatorId, channelId));
  }

  /**
   * Check if moderator has an active conversation in this channel
   */
  hasActive(moderatorId: string, channelId: string): boolean {
    return this.get(moderatorId, channelId) !== null;
  }

  /**
   * Get all parameters that are filled
   */
  getFilledParams(moderatorId: string, channelId: string): string[] {
    const state = this.get(moderatorId, channelId);
    if (!state) return [];

    return Object.keys(state.parameters).filter(
      key => state.parameters[key] !== null && state.parameters[key] !== undefined
    );
  }

  /**
   * Check if all required parameters are filled
   */
  isReady(moderatorId: string, channelId: string): boolean {
    const state = this.get(moderatorId, channelId);
    if (!state) return false;

    return state.missingParams.length === 0;
  }

  /**
   * Get conversation summary (for debugging)
   */
  getSummary(moderatorId: string, channelId: string): string {
    const state = this.get(moderatorId, channelId);
    if (!state) return 'No active conversation';

    const age = Math.floor((Date.now() - state.createdAt) / 1000);

    return `Conversation: ${state.intent}
Status: ${state.status}
Age: ${age}s
Confidence: ${(state.confidence * 100).toFixed(0)}%
Parameters: ${Object.keys(state.parameters).length} filled, ${state.missingParams.length} missing
Messages: ${state.messages.length}`;
  }

  /**
   * Generate unique key for conversation lookup
   */
  private getKey(moderatorId: string, channelId: string): string {
    return `${moderatorId}:${channelId}`;
  }

  /**
   * Clean up expired conversations
   */
  private cleanExpired(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, state] of this.conversations) {
      if (now > state.expiresAt) {
        this.conversations.delete(key);
        cleaned++;
        logger.debug(`Cleaned expired conversation ${state.conversationId}`);
      }
    }

    if (cleaned > 0) {
      logger.info(`Cleaned ${cleaned} expired conversations`);
    }
  }

  /**
   * Get all active conversations (for admin debugging)
   */
  getAllActive(): ConversationState[] {
    return Array.from(this.conversations.values());
  }

  /**
   * Get active conversation count
   */
  getActiveCount(): number {
    return this.conversations.size;
  }
}
