// LogicParser.ts

export interface LogicStatement {
  type: 'if-then' | 'if-then-else' | 'unless' | 'when';
  condition: string;
  thenAction: string;
  elseAction?: string;
  confidence: number;
}

export class LogicParser {
  /**
   * Parse if/then/else logic from text
   */
  parse(text: string): LogicStatement[] {
    const statements: LogicStatement[] = [];

    // Parse if-then statements
    statements.push(...this.parseIfThen(text));

    // Parse unless statements
    statements.push(...this.parseUnless(text));

    // Parse when statements
    statements.push(...this.parseWhen(text));

    return statements;
  }

  /**
   * Parse if-then(-else) statements
   */
  private parseIfThen(text: string): LogicStatement[] {
    const statements: LogicStatement[] = [];
    const lower = text.toLowerCase();

    // Pattern: "if X then Y"
    const ifThenPattern = /if\s+([^,]+?)(?:\s+then\s+([^,]+?))?(?:\s+else\s+([^,]+?))?(?:\s*,|\s*$)/gi;
    let match;

    while ((match = ifThenPattern.exec(lower)) !== null) {
      const condition = match[1].trim();
      const thenAction = match[2]?.trim() || 'execute';
      const elseAction = match[3]?.trim();

      statements.push({
        type: elseAction ? 'if-then-else' : 'if-then',
        condition,
        thenAction,
        elseAction,
        confidence: 0.85,
      });

      console.log(`📋 Parsed if-then: IF "${condition}" THEN "${thenAction}"${elseAction ? ` ELSE "${elseAction}"` : ''}`);
    }

    // Pattern: "X if Y" (implicit then)
    const implicitPattern = /([^,]+?)\s+if\s+([^,]+?)(?:\s*,|\s*$)/gi;
    
    while ((match = implicitPattern.exec(lower)) !== null) {
      const thenAction = match[1].trim();
      const condition = match[2].trim();

      // Avoid duplicates
      if (!statements.some(s => s.condition === condition && s.thenAction === thenAction)) {
        statements.push({
          type: 'if-then',
          condition,
          thenAction,
          confidence: 0.8,
        });

        console.log(`📋 Parsed implicit if: "${thenAction}" IF "${condition}"`);
      }
    }

    return statements;
  }

  /**
   * Parse unless statements
   */
  private parseUnless(text: string): LogicStatement[] {
    const statements: LogicStatement[] = [];
    const lower = text.toLowerCase();

    const unlessPattern = /unless\s+([^,]+?)(?:\s+then\s+)?([^,]+?)(?:\s*,|\s*$)/gi;
    let match;

    while ((match = unlessPattern.exec(lower)) !== null) {
      const condition = `NOT ${match[1].trim()}`;
      const thenAction = match[2]?.trim() || 'execute';

      statements.push({
        type: 'unless',
        condition,
        thenAction,
        confidence: 0.8,
      });

      console.log(`📋 Parsed unless: UNLESS "${match[1].trim()}" THEN "${thenAction}"`);
    }

    return statements;
  }

  /**
   * Parse when statements
   */
  private parseWhen(text: string): LogicStatement[] {
    const statements: LogicStatement[] = [];
    const lower = text.toLowerCase();

    const whenPattern = /when\s+([^,]+?)(?:\s+then\s+)?([^,]+?)(?:\s*,|\s*$)/gi;
    let match;

    while ((match = whenPattern.exec(lower)) !== null) {
      const condition = match[1].trim();
      const thenAction = match[2]?.trim() || 'execute';

      statements.push({
        type: 'when',
        condition,
        thenAction,
        confidence: 0.75,
      });

      console.log(`📋 Parsed when: WHEN "${condition}" THEN "${thenAction}"`);
    }

    return statements;
  }

  /**
   * Check if text contains logical statements
   */
  hasLogic(text: string): boolean {
    const lower = text.toLowerCase();
    const logicKeywords = ['if', 'then', 'else', 'unless', 'when', 'otherwise'];
    return logicKeywords.some(keyword => lower.includes(keyword));
  }

  /**
   * Simplify logic statement to plain English
   */
  simplify(statement: LogicStatement): string {
    switch (statement.type) {
      case 'if-then':
        return `If ${statement.condition}, then ${statement.thenAction}`;
      
      case 'if-then-else':
        return `If ${statement.condition}, then ${statement.thenAction}, otherwise ${statement.elseAction}`;
      
      case 'unless':
        return `Unless ${statement.condition.replace('NOT ', '')}, then ${statement.thenAction}`;
      
      case 'when':
        return `When ${statement.condition}, then ${statement.thenAction}`;
      
      default:
        return 'Unknown logic';
    }
  }

  /**
   * Validate logic statement
   */
  validate(statement: LogicStatement): boolean {
    return statement.condition.length > 0 && 
           statement.thenAction.length > 0 &&
           statement.confidence > 0.5;
  }

  /**
   * Get most confident statement
   */
  getMostConfident(statements: LogicStatement[]): LogicStatement | null {
    if (statements.length === 0) return null;
    return statements.reduce((best, current) =>
      current.confidence > best.confidence ? current : best
    );
  }
}