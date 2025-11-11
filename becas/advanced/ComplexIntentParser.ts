// ComplexIntentParser.ts

import { TemporalParser, TimeExpression } from '../nlp/TemporalParser';
import { OllamaService } from '../services/OllamaService';

export interface ComplexIntent {
  primaryAction: string; // 'timeout', 'ban', 'kick', 'warn'
  target?: {
    userId: string;
    userName: string;
  };
  timeExpression?: TimeExpression;
  monitoring?: {
    watchFor: string;
    duration: number;
  };
  conditions: Condition[];
  cancellationTriggers: CancelTrigger[];
  confidence: number;
  raw: string;
}

export interface Condition {
  type: 'if' | 'unless' | 'when' | 'after';
  check: string;
  action: 'execute' | 'cancel' | 'wait';
}

export interface CancelTrigger {
  pattern: string;
  type: 'message' | 'action' | 'time';
}

export class ComplexIntentParser {
  private temporalParser: TemporalParser;
  private llm: OllamaService;

  constructor() {
    this.temporalParser = new TemporalParser();
    this.llm = new OllamaService('analysis');
  }

  /**
   * Parse complex intent from natural language
   */
  async parse(text: string, mentionedUsers: Array<{id: string, name: string}>): Promise<ComplexIntent | null> {
    console.log(`🧠 Parsing complex intent: "${text}"`);

    const lower = text.toLowerCase();

    // Extract primary action
    const primaryAction = this.extractPrimaryAction(lower);
    if (!primaryAction) {
      console.log(`✗ No primary action found`);
      return null;
    }

    console.log(`✓ Primary action: ${primaryAction}`);

    // Extract target user
    const target = mentionedUsers.length > 0 ? {
      userId: mentionedUsers[0].id,
      userName: mentionedUsers[0].name,
    } : undefined;
    if (!target) {
      console.log(`⚠️ No target user mentioned`);
    }

    // Parse time expressions
    const timeExpression = this.temporalParser.parse(text);
    console.log(`⏱️ Time expression:`, timeExpression);

    // Extract monitoring requirements
    const monitoring = this.extractMonitoring(lower, timeExpression);
    
    // Extract conditions
    const conditions = this.extractConditions(lower);

    // Extract cancellation triggers
    const cancellationTriggers = this.extractCancellationTriggers(lower);

    // Calculate confidence
    const confidence = this.calculateConfidence({
      hasAction: !!primaryAction,
      hasTarget: !!target,
      hasTimeExpression: !!(timeExpression.delay || timeExpression.duration),
      hasMonitoring: !!monitoring,
      hasConditions: conditions.length > 0,
    });

    const intent: ComplexIntent = {
      primaryAction,
      target,
      timeExpression,
      monitoring,
      conditions,
      cancellationTriggers,
      confidence,
      raw: text,
    };

    console.log(`✓ Parsed intent with ${confidence.toFixed(0)}% confidence`);
    console.log(`   Action: ${primaryAction}${target ? ` on ${target.userName}` : ''}`);
    if (timeExpression.delay) console.log(`   Delay: ${this.temporalParser.formatDuration(timeExpression.delay)}`);
    if (monitoring) console.log(`   Monitoring: "${monitoring.watchFor}" for ${this.temporalParser.formatDuration(monitoring.duration)}`);
    if (cancellationTriggers.length > 0) console.log(`   Cancel triggers: ${cancellationTriggers.length}`);

    return intent;
  }

  /**
   * Extract primary action
   */
  private extractPrimaryAction(text: string): string | null {
    const actionPatterns: Record<string, string[]> = {
      timeout: ['timeout', 'mute', 'silence', 'time out'],
      ban: ['ban', 'remove permanently'],
      kick: ['kick', 'remove'],
      warn: ['warn', 'warning', 'caution'],
    };

    for (const [action, patterns] of Object.entries(actionPatterns)) {
      if (patterns.some(p => text.includes(p))) {
        return action;
      }
    }

    return null;
  }

  /**
   * Extract monitoring configuration
   */
  private extractMonitoring(text: string, timeExpression: TimeExpression): {
    watchFor: string;
    duration: number;
  } | undefined {
    // Look for monitoring keywords
    const monitoringKeywords = ['watch', 'monitor', 'observe', 'check if', 'see if'];
    const hasMonitoring = monitoringKeywords.some(k => text.includes(k));

    if (!hasMonitoring) return undefined;

    // Extract what to watch for
    const watchPattern = /(?:watch|monitor|observe|check if|see if)\s+(?:him|her|them|user)?\s*(?:for)?\s+(?:if)?\s*(?:he|she|they)?\s*(?:say|says|post|posts|write|writes)?\s*['"]?([^'"]+?)['"]?(?:\s+|$|,)/i;
    const match = text.match(watchPattern);
    
    const watchFor = match ? match[1].trim() : 'any violation';

    // Use duration from time expression, default to 5 minutes
    const duration = timeExpression.duration || timeExpression.delay || 300000;

    console.log(`👁️ Monitoring config: watch for "${watchFor}" for ${duration}ms`);

    return {
      watchFor,
      duration,
    };
  }

  /**
   * Extract conditions (if/unless/when)
   */
  private extractConditions(text: string): Condition[] {
    const conditions: Condition[] = [];

    // "if X then Y" pattern
    if (text.includes('if')) {
      const ifMatch = text.match(/if\s+(?:he|she|they|user)?\s*([^,]+?)(?:\s+then|\s+do|\s*,|$)/i);
      if (ifMatch) {
        conditions.push({
          type: 'if',
          check: ifMatch[1].trim(),
          action: 'execute',
        });
      }
    }

    // "unless X" pattern
    if (text.includes('unless')) {
      const unlessMatch = text.match(/unless\s+([^,]+?)(?:\s*,|$)/i);
      if (unlessMatch) {
        conditions.push({
          type: 'unless',
          check: unlessMatch[1].trim(),
          action: 'cancel',
        });
      }
    }

    return conditions;
  }

  /**
   * Extract cancellation triggers
   */
  private extractCancellationTriggers(text: string): CancelTrigger[] {
    const triggers: CancelTrigger[] = [];

    // "if X cancel" pattern
    const cancelPatterns = [
      /if\s+(?:he|she|they|user)?\s*(?:say|says|post|posts)?\s*['"]?([^'"]+?)['"]?\s*(?:cancel|stop|don't|dont)/i,
      /(?:cancel|stop|don't|dont)\s+if\s+(?:he|she|they)?\s*(?:say|says)?\s*['"]?([^'"]+?)['"]?/i,
    ];

    for (const pattern of cancelPatterns) {
      const match = text.match(pattern);
      if (match) {
        triggers.push({
          pattern: match[1].trim(),
          type: 'message',
        });
        console.log(`🚫 Cancel trigger: if user says "${match[1].trim()}"`);
      }
    }

    return triggers;
  }

  /**
   * Calculate confidence in the parsed intent
   */
  private calculateConfidence(factors: {
    hasAction: boolean;
    hasTarget: boolean;
    hasTimeExpression: boolean;
    hasMonitoring: boolean;
    hasConditions: boolean;
  }): number {
    let confidence = 0;

    if (factors.hasAction) confidence += 30;
    if (factors.hasTarget) confidence += 25;
    if (factors.hasTimeExpression) confidence += 20;
    if (factors.hasMonitoring) confidence += 15;
    if (factors.hasConditions) confidence += 10;

    return Math.min(confidence, 100);
  }

  /**
   * Check if text contains complex intent
   */
  isComplexIntent(text: string): boolean {
    const lower = text.toLowerCase();
    
    const complexityIndicators = [
      'if', 'unless', 'when', 'after', 'before',
      'watch', 'monitor', 'check',
      'then', 'otherwise', 'or else',
      'cancel if', 'stop if',
    ];

    return complexityIndicators.some(indicator => lower.includes(indicator));
  }

  /**
   * Generate human-friendly description of intent
   */
  describeIntent(intent: ComplexIntent): string {
    const parts: string[] = [];

    parts.push(`I'll ${intent.primaryAction}`);
    
    if (intent.target) {
      parts.push(`${intent.target.userName}`);
    }

    if (intent.timeExpression?.delay) {
      parts.push(`after ${this.temporalParser.formatDuration(intent.timeExpression.delay)}`);
    }

    if (intent.monitoring) {
      parts.push(`but first I'll watch them for ${this.temporalParser.formatDuration(intent.monitoring.duration)}`);
      
      if (intent.cancellationTriggers.length > 0) {
        const trigger = intent.cancellationTriggers[0];
        parts.push(`- if they say "${trigger.pattern}", I'll cancel the ${intent.primaryAction}`);
      } else {
        parts.push(`to see if they improve`);
      }
    }

    if (intent.conditions.length > 0) {
      intent.conditions.forEach(cond => {
        if (cond.type === 'if' && cond.action === 'execute') {
          parts.push(`if ${cond.check}`);
        }
      });
    }

    return parts.join(' ');
  }
}