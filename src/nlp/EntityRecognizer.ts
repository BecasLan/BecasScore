// EntityRecognizer.ts

export interface RecognizedEntity {
  type: 'user' | 'time' | 'duration' | 'action' | 'condition' | 'reason';
  value: any;
  raw: string;
  confidence: number;
  start: number;
  end: number;
}

export class EntityRecognizer {
  /**
   * Recognize all entities in text
   */
  recognize(text: string): RecognizedEntity[] {
    const entities: RecognizedEntity[] = [];

    // Recognize users
    entities.push(...this.recognizeUsers(text));

    // Recognize time expressions
    entities.push(...this.recognizeTimeExpressions(text));

    // Recognize durations
    entities.push(...this.recognizeDurations(text));

    // Recognize actions
    entities.push(...this.recognizeActions(text));

    // Recognize conditions
    entities.push(...this.recognizeConditions(text));

    return entities;
  }

  /**
   * Recognize user mentions
   */
  private recognizeUsers(text: string): RecognizedEntity[] {
    const entities: RecognizedEntity[] = [];
    const userPattern = /@(\w+)/g;
    let match;

    while ((match = userPattern.exec(text)) !== null) {
      entities.push({
        type: 'user',
        value: match[1],
        raw: match[0],
        confidence: 1.0,
        start: match.index,
        end: match.index + match[0].length,
      });
    }

    return entities;
  }

  /**
   * Recognize time expressions
   */
  private recognizeTimeExpressions(text: string): RecognizedEntity[] {
    const entities: RecognizedEntity[] = [];
    const patterns = [
      { regex: /after\s+(\d+)\s*(second|minute|hour|day)s?/gi, type: 'delay' },
      { regex: /in\s+(\d+)\s*(second|minute|hour|day)s?/gi, type: 'delay' },
      { regex: /(\d+)\s*(second|minute|hour|day)s?\s+later/gi, type: 'delay' },
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.regex.exec(text)) !== null) {
        const amount = parseInt(match[1]);
        const unit = match[2].toLowerCase();
        
        entities.push({
          type: 'time',
          value: { amount, unit, type: pattern.type },
          raw: match[0],
          confidence: 0.9,
          start: match.index,
          end: match.index + match[0].length,
        });
      }
    }

    return entities;
  }

  /**
   * Recognize durations
   */
  private recognizeDurations(text: string): RecognizedEntity[] {
    const entities: RecognizedEntity[] = [];
    const patterns = [
      /for\s+(\d+)\s*(second|minute|hour|day)s?/gi,
      /(\d+)\s*(second|minute|hour|day)s?\s+timeout/gi,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const amount = parseInt(match[1]);
        const unit = match[2].toLowerCase();
        
        entities.push({
          type: 'duration',
          value: { amount, unit },
          raw: match[0],
          confidence: 0.9,
          start: match.index,
          end: match.index + match[0].length,
        });
      }
    }

    return entities;
  }

  /**
   * Recognize action keywords
   */
  private recognizeActions(text: string): RecognizedEntity[] {
    const entities: RecognizedEntity[] = [];
    const actions = ['timeout', 'ban', 'kick', 'warn', 'mute', 'silence'];

    const lower = text.toLowerCase();
    for (const action of actions) {
      const index = lower.indexOf(action);
      if (index !== -1) {
        entities.push({
          type: 'action',
          value: action,
          raw: action,
          confidence: 1.0,
          start: index,
          end: index + action.length,
        });
      }
    }

    return entities;
  }

  /**
   * Recognize conditions (if/then/unless)
   */
  private recognizeConditions(text: string): RecognizedEntity[] {
    const entities: RecognizedEntity[] = [];
    const conditionWords = ['if', 'unless', 'when', 'after'];

    const lower = text.toLowerCase();
    for (const word of conditionWords) {
      let index = lower.indexOf(word);
      while (index !== -1) {
        entities.push({
          type: 'condition',
          value: word,
          raw: word,
          confidence: 0.8,
          start: index,
          end: index + word.length,
        });
        index = lower.indexOf(word, index + 1);
      }
    }

    return entities;
  }

  /**
   * Get entities by type
   */
  getByType(entities: RecognizedEntity[], type: RecognizedEntity['type']): RecognizedEntity[] {
    return entities.filter(e => e.type === type);
  }

  /**
   * Check if text contains entity type
   */
  hasEntityType(text: string, type: RecognizedEntity['type']): boolean {
    const entities = this.recognize(text);
    return entities.some(e => e.type === type);
  }

  /**
   * Get most confident entity
   */
  getMostConfident(entities: RecognizedEntity[]): RecognizedEntity | null {
    if (entities.length === 0) return null;
    return entities.reduce((best, current) => 
      current.confidence > best.confidence ? current : best
    );
  }
}