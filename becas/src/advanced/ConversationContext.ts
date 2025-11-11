// ConversationContext.ts

export interface Context {
  userId: string;
  guildId: string;
  conversationId: string;
  history: ContextMessage[];
  references: Map<string, any>; // "he", "that user", "it" etc.
  currentIntent?: any;
  lastAction?: any;
  startedAt: Date;
  lastActivity: Date;
}

export interface ContextMessage {
  content: string;
  role: 'user' | 'assistant';
  timestamp: Date;
  intent?: string;
}

export class ConversationContext {
  private contexts: Map<string, Context> = new Map();
  private maxContextAge = 600000; // 10 minutes

  /**
   * Get or create context for user
   */
  getContext(userId: string, guildId: string): Context {
    const key = `${guildId}:${userId}`;
    
    if (!this.contexts.has(key)) {
      this.contexts.set(key, {
        userId,
        guildId,
        conversationId: `conv-${Date.now()}`,
        history: [],
        references: new Map(),
        startedAt: new Date(),
        lastActivity: new Date(),
      });
    }

    return this.contexts.get(key)!;
  }

  /**
   * Add message to context
   */
  addMessage(
    userId: string,
    guildId: string,
    content: string,
    role: 'user' | 'assistant',
    intent?: string
  ): void {
    const context = this.getContext(userId, guildId);
    
    context.history.push({
      content,
      role,
      timestamp: new Date(),
      intent,
    });

    // Keep only last 20 messages
    if (context.history.length > 20) {
      context.history = context.history.slice(-20);
    }

    context.lastActivity = new Date();
    this.updateReferences(context, content);
  }

  /**
   * Update reference tracking (he, she, that user, it)
   */
  private updateReferences(context: Context, content: string): void {
    const lower = content.toLowerCase();
    
    // Extract user mentions
    const userMentionMatch = content.match(/@(\w+)/g);
    if (userMentionMatch) {
      const lastMentioned = userMentionMatch[userMentionMatch.length - 1];
      context.references.set('lastUser', lastMentioned);
      context.references.set('he', lastMentioned);
      context.references.set('she', lastMentioned);
      context.references.set('them', lastMentioned);
    }

    // Track actions
    if (lower.includes('timeout') || lower.includes('ban') || lower.includes('kick')) {
      const action = lower.includes('timeout') ? 'timeout' :
                     lower.includes('ban') ? 'ban' : 'kick';
      context.references.set('lastAction', action);
      context.references.set('that', action);
      context.references.set('it', action);
    }
  }

  /**
   * Resolve pronouns and references
   */
  resolveReferences(userId: string, guildId: string, text: string): string {
    const context = this.getContext(userId, guildId);
    let resolved = text;

    // Resolve user references
    const userPronouns = ['he', 'she', 'they', 'them', 'him', 'her'];
    for (const pronoun of userPronouns) {
      const pattern = new RegExp(`\\b${pronoun}\\b`, 'gi');
      if (resolved.match(pattern) && context.references.has('lastUser')) {
        resolved = resolved.replace(pattern, context.references.get('lastUser'));
      }
    }

    // Resolve action references
    const actionPronouns = ['that', 'it'];
    for (const pronoun of actionPronouns) {
      const pattern = new RegExp(`\\b${pronoun}\\b`, 'gi');
      if (resolved.match(pattern) && context.references.has('lastAction')) {
        resolved = resolved.replace(pattern, context.references.get('lastAction'));
      }
    }

    return resolved;
  }

  /**
   * Track current intent
   */
  trackIntent(userId: string, guildId: string, intent: any): void {
    const context = this.getContext(userId, guildId);
    context.currentIntent = intent;
  }

  /**
   * Track last action
   */
  trackAction(userId: string, guildId: string, action: any): void {
    const context = this.getContext(userId, guildId);
    context.lastAction = action;
  }

  /**
   * Get conversation summary
   */
  getSummary(userId: string, guildId: string): string {
    const context = this.getContext(userId, guildId);
    
    if (context.history.length === 0) {
      return 'No conversation history';
    }

    const recent = context.history.slice(-5);
    return recent.map(m => `${m.role}: ${m.content}`).join('\n');
  }

  /**
   * Clear old contexts
   */
  cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, context] of this.contexts.entries()) {
      if (now - context.lastActivity.getTime() > this.maxContextAge) {
        this.contexts.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`🧹 Cleaned up ${cleaned} old conversation contexts`);
    }
  }

  /**
   * Check if user has active context
   */
  hasActiveContext(userId: string, guildId: string): boolean {
    const key = `${guildId}:${userId}`;
    const context = this.contexts.get(key);
    
    if (!context) return false;
    
    const age = Date.now() - context.lastActivity.getTime();
    return age < this.maxContextAge;
  }
}