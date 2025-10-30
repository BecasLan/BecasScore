// TemporalParser.ts

export interface TimeExpression {
  delay?: number; // milliseconds
  duration?: number; // milliseconds
  executeAt?: Date;
  raw: string;
}

export class TemporalParser {
  /**
   * Parse time expressions from text
   */
  parse(text: string): TimeExpression {
    const lower = text.toLowerCase();
    const result: TimeExpression = { raw: text };

    // Parse delay expressions: "after 5 minutes", "in 2 hours"
    const delayMatch = this.parseDelay(lower);
    if (delayMatch) {
      result.delay = delayMatch;
      result.executeAt = new Date(Date.now() + delayMatch);
    }

    // Parse duration expressions: "for 10 minutes", "watch for 5 min"
    const durationMatch = this.parseDuration(lower);
    if (durationMatch) {
      result.duration = durationMatch;
    }

    return result;
  }

  /**
   * Parse delay (when to start): "after X", "in X"
   */
  private parseDelay(text: string): number | null {
    // Patterns: "after 5 minutes", "in 2 hours", "wait 30 seconds"
    const patterns = [
      /(?:after|in|wait)\s+(\d+)\s*(second|seconds|sec|secs|s)/i,
      /(?:after|in|wait)\s+(\d+)\s*(minute|minutes|min|mins|m)/i,
      /(?:after|in|wait)\s+(\d+)\s*(hour|hours|hr|hrs|h)/i,
      /(?:after|in|wait)\s+(\d+)\s*(day|days|d)/i,
    ];

    const multipliers = {
      second: 1000,
      minute: 60000,
      hour: 3600000,
      day: 86400000,
    };

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const amount = parseInt(match[1]);
        const unit = match[2].toLowerCase();
        
        // Normalize unit
        let normalizedUnit: keyof typeof multipliers;
        if (unit.startsWith('s')) normalizedUnit = 'second';
        else if (unit.startsWith('m')) normalizedUnit = 'minute';
        else if (unit.startsWith('h')) normalizedUnit = 'hour';
        else if (unit.startsWith('d')) normalizedUnit = 'day';
        else continue;

        const delay = amount * multipliers[normalizedUnit];
        console.log(`⏱️ Parsed delay: ${amount} ${normalizedUnit}(s) = ${delay}ms`);
        return delay;
      }
    }

    return null;
  }

  /**
   * Parse duration (how long): "for X minutes", "watch for X"
   */
  private parseDuration(text: string): number | null {
    // Patterns: "for 5 minutes", "watch for 10 min", "monitor 2 hours"
    const patterns = [
      /(?:for|watch for|monitor|observe|check)\s+(\d+)\s*(second|seconds|sec|secs|s)/i,
      /(?:for|watch for|monitor|observe|check)\s+(\d+)\s*(minute|minutes|min|mins|m)/i,
      /(?:for|watch for|monitor|observe|check)\s+(\d+)\s*(hour|hours|hr|hrs|h)/i,
      /(?:for|watch for|monitor|observe|check)\s+(\d+)\s*(day|days|d)/i,
    ];

    const multipliers = {
      second: 1000,
      minute: 60000,
      hour: 3600000,
      day: 86400000,
    };

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const amount = parseInt(match[1]);
        const unit = match[2].toLowerCase();
        
        // Normalize unit
        let normalizedUnit: keyof typeof multipliers;
        if (unit.startsWith('s')) normalizedUnit = 'second';
        else if (unit.startsWith('m')) normalizedUnit = 'minute';
        else if (unit.startsWith('h')) normalizedUnit = 'hour';
        else if (unit.startsWith('d')) normalizedUnit = 'day';
        else continue;

        const duration = amount * multipliers[normalizedUnit];
        console.log(`⏱️ Parsed duration: ${amount} ${normalizedUnit}(s) = ${duration}ms`);
        return duration;
      }
    }

    return null;
  }

  /**
   * Format duration for human reading
   */
  formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days} day${days > 1 ? 's' : ''}`;
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''}`;
    if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''}`;
    return `${seconds} second${seconds > 1 ? 's' : ''}`;
  }

  /**
   * Check if text contains time expression
   */
  hasTimeExpression(text: string): boolean {
    const lower = text.toLowerCase();
    const timeWords = ['after', 'in', 'for', 'wait', 'watch', 'monitor', 'minute', 'hour', 'second', 'day'];
    return timeWords.some(word => lower.includes(word));
  }
}