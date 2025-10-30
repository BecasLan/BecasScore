// PatternDetector.ts

import { AnalyzedMessage } from '../types/Message.types';

export interface DetectedPattern {
  type: 'spam' | 'link_spam' | 'caps' | 'mention_spam' | 'repeated_message' | 'rapid_posting';
  severity: number; // 0-1
  evidence: string[];
  confidence: number;
  userId: string;
}

export class PatternDetector {
  private messageHistory: Map<string, AnalyzedMessage[]> = new Map();
  private maxHistorySize = 50;

  /**
   * Detect patterns in user messages
   */
  detect(message: AnalyzedMessage): DetectedPattern[] {
    const patterns: DetectedPattern[] = [];

    // Add to history
    this.addToHistory(message);

    // Get user's recent messages
    const history = this.getUserHistory(message.authorId, message.guildId);

    // Detect various patterns
    patterns.push(...this.detectSpam(message, history));
    patterns.push(...this.detectLinkSpam(message, history));
    patterns.push(...this.detectCapsAbuse(message));
    patterns.push(...this.detectMentionSpam(message));
    patterns.push(...this.detectRapidPosting(history));
    patterns.push(...this.detectRepeatedMessages(history));

    return patterns.filter(p => p.confidence > 0.6);
  }

  /**
   * Add message to history
   */
  private addToHistory(message: AnalyzedMessage): void {
    const key = `${message.guildId}:${message.authorId}`;
    
    if (!this.messageHistory.has(key)) {
      this.messageHistory.set(key, []);
    }

    const history = this.messageHistory.get(key)!;
    history.push(message);

    // Keep only recent messages
    if (history.length > this.maxHistorySize) {
      history.shift();
    }
  }

  /**
   * Get user message history
   */
  private getUserHistory(userId: string, guildId: string): AnalyzedMessage[] {
    const key = `${guildId}:${userId}`;
    return this.messageHistory.get(key) || [];
  }

  /**
   * Detect spam patterns
   */
  private detectSpam(message: AnalyzedMessage, history: AnalyzedMessage[]): DetectedPattern[] {
    const patterns: DetectedPattern[] = [];

    // Check message length (very short repeated)
    if (message.content.length < 5 && history.length > 3) {
      const recent = history.slice(-5);
      const shortMessages = recent.filter(m => m.content.length < 5).length;

      if (shortMessages >= 4) {
        patterns.push({
          type: 'spam',
          severity: 0.6,
          evidence: [`${shortMessages} very short messages in sequence`],
          confidence: 0.75,
          userId: message.authorId,
        });
      }
    }

    return patterns;
  }

  /**
   * Detect link spam
   */
  private detectLinkSpam(message: AnalyzedMessage, history: AnalyzedMessage[]): DetectedPattern[] {
    const patterns: DetectedPattern[] = [];
    const urlPattern = /https?:\/\/\S+/gi;

    // Count links in recent messages
    const recent = history.slice(-10);
    const linksInRecent = recent.reduce((count, m) => {
      const links = m.content.match(urlPattern) || [];
      return count + links.length;
    }, 0);

    if (linksInRecent >= 3) {
      patterns.push({
        type: 'link_spam',
        severity: 0.7,
        evidence: [`${linksInRecent} links in last 10 messages`],
        confidence: 0.85,
        userId: message.authorId,
      });
    }

    return patterns;
  }

  /**
   * Detect caps abuse
   */
  private detectCapsAbuse(message: AnalyzedMessage): DetectedPattern[] {
    const patterns: DetectedPattern[] = [];
    const content = message.content;

    if (content.length < 10) return patterns;

    const upperCount = (content.match(/[A-Z]/g) || []).length;
    const totalLetters = (content.match(/[A-Za-z]/g) || []).length;

    if (totalLetters > 0) {
      const capsRatio = upperCount / totalLetters;

      if (capsRatio > 0.7 && content.length > 15) {
        patterns.push({
          type: 'caps',
          severity: 0.5,
          evidence: [`${(capsRatio * 100).toFixed(0)}% caps`],
          confidence: 0.8,
          userId: message.authorId,
        });
      }
    }

    return patterns;
  }

  /**
   * Detect mention spam
   */
  private detectMentionSpam(message: AnalyzedMessage): DetectedPattern[] {
    const patterns: DetectedPattern[] = [];

    if (message.mentions.length >= 5) {
      patterns.push({
        type: 'mention_spam',
        severity: 0.8,
        evidence: [`${message.mentions.length} mentions in one message`],
        confidence: 0.9,
        userId: message.authorId,
      });
    }

    return patterns;
  }

  /**
   * Detect rapid posting
   */
  private detectRapidPosting(history: AnalyzedMessage[]): DetectedPattern[] {
    const patterns: DetectedPattern[] = [];

    if (history.length < 5) return patterns;

    const recent = history.slice(-5);
    const timeSpan = recent[recent.length - 1].timestamp.getTime() - recent[0].timestamp.getTime();
    const seconds = timeSpan / 1000;

    if (seconds < 10) {
      patterns.push({
        type: 'rapid_posting',
        severity: 0.7,
        evidence: [`5 messages in ${seconds.toFixed(1)}s`],
        confidence: 0.85,
        userId: recent[0].authorId,
      });
    }

    return patterns;
  }

  /**
   * Detect repeated messages
   */
  private detectRepeatedMessages(history: AnalyzedMessage[]): DetectedPattern[] {
    const patterns: DetectedPattern[] = [];

    if (history.length < 3) return patterns;

    const recent = history.slice(-5);
    const contents = recent.map(m => m.content.toLowerCase().trim());

    // Count duplicates
    const counts = new Map<string, number>();
    for (const content of contents) {
      counts.set(content, (counts.get(content) || 0) + 1);
    }

    for (const [content, count] of counts.entries()) {
      if (count >= 3 && content.length > 5) {
        patterns.push({
          type: 'repeated_message',
          severity: 0.6,
          evidence: [`Same message repeated ${count} times`],
          confidence: 0.8,
          userId: recent[0].authorId,
        });
      }
    }

    return patterns;
  }

  /**
   * Clean up old history
   */
  cleanup(maxAgeMs: number = 3600000): void {
    const cutoff = Date.now() - maxAgeMs;
    let cleaned = 0;

    for (const [key, history] of this.messageHistory.entries()) {
      const filtered = history.filter(m => m.timestamp.getTime() > cutoff);
      
      if (filtered.length === 0) {
        this.messageHistory.delete(key);
        cleaned++;
      } else if (filtered.length < history.length) {
        this.messageHistory.set(key, filtered);
      }
    }

    if (cleaned > 0) {
      console.log(`🧹 Cleaned up ${cleaned} user histories`);
    }
  }

  /**
   * Get pattern statistics
   */
  getStats(): {
    usersTracked: number;
    totalMessages: number;
  } {
    const usersTracked = this.messageHistory.size;
    const totalMessages = Array.from(this.messageHistory.values())
      .reduce((sum, history) => sum + history.length, 0);

    return { usersTracked, totalMessages };
  }
}