import { GenerativeRule, RuleTrigger, RuleAction } from '../types/Rule.types';
import { AnalyzedMessage } from '../types/Message.types';
import { StorageService } from '../services/StorageService';
import { OllamaService } from '../services/OllamaService';
import { ENV } from '../config/environment';

export class GenerativeRuleEngine {
  private storage: StorageService;
  private llm: OllamaService;
  private rules: Map<string, GenerativeRule> = new Map();
  private ruleCounter: number = 0;

  constructor(storage: StorageService) {
    this.storage = storage;
    this.llm = new OllamaService('governance');
  }

  /**
   * Initialize async components (call after construction)
   */
  async initialize(): Promise<void> {
    await this.loadRules();
  }

  /**
   * Load rules from storage
   */
  private async loadRules(): Promise<void> {
    const data = await this.storage.read<{ rules: GenerativeRule[] }>(
      'rules',
      'active_rules.json'
    );

    if (data?.rules) {
      data.rules.forEach(rule => {
        this.rules.set(rule.id, rule);
        const idNum = parseInt(rule.id.split('-')[1]);
        if (idNum > this.ruleCounter) {
          this.ruleCounter = idNum;
        }
      });
    }

    console.log(`Loaded ${this.rules.size} rules`);
  }

  /**
   * Check if message triggers any rules
   */
  async checkRules(message: AnalyzedMessage, context: string): Promise<{
    triggered: GenerativeRule[];
    actions: RuleAction[];
  }> {
    const triggered: GenerativeRule[] = [];
    const actions: RuleAction[] = [];

    for (const rule of this.rules.values()) {
      if (rule.metadata.guildId !== message.guildId) continue;

      const isTriggered = await this.evaluateTrigger(rule.trigger, message, context);

      if (isTriggered && rule.confidence > 0.6) {
        triggered.push(rule);
        actions.push(rule.action);

        // Update rule statistics
        rule.lastApplied = new Date();
        rule.applicationCount++;
      }
    }

    if (triggered.length > 0) {
      await this.saveRules();
    }

    return { triggered, actions };
  }

  /**
   * Evaluate if a trigger condition is met
   */
  private async evaluateTrigger(
    trigger: RuleTrigger,
    message: AnalyzedMessage,
    context: string
  ): Promise<boolean> {
    try {
      switch (trigger.type) {
        case 'pattern':
          return this.evaluatePattern(trigger, message);
        
        case 'threshold':
          return this.evaluateThreshold(trigger, message);
        
        case 'sequence':
          return this.evaluateSequence(trigger, message, context);
        
        case 'context':
          return await this.evaluateContextual(trigger, message, context);
        
        default:
          return false;
      }
    } catch (error) {
      console.error('Error evaluating trigger:', error);
      return false;
    }
  }

  /**
   * Evaluate pattern-based trigger
   */
  private evaluatePattern(trigger: RuleTrigger, message: AnalyzedMessage): boolean {
    const { pattern, caseSensitive } = trigger.parameters;
    const content = caseSensitive ? message.content : message.content.toLowerCase();
    const patternStr = caseSensitive ? pattern : pattern.toLowerCase();

    if (pattern.startsWith('/') && pattern.endsWith('/')) {
      // Regex pattern
      const regex = new RegExp(pattern.slice(1, -1));
      return regex.test(content);
    }

    // Simple string match
    return content.includes(patternStr);
  }

  /**
   * Evaluate threshold-based trigger
   */
  private evaluateThreshold(trigger: RuleTrigger, message: AnalyzedMessage): boolean {
    const { metric, operator, value } = trigger.parameters;

    let actualValue: number;

    switch (metric) {
      case 'toxicity':
        actualValue = message.toxicity;
        break;
      case 'manipulation':
        actualValue = message.manipulation;
        break;
      case 'sentiment_negative':
        actualValue = message.sentiment.negative;
        break;
      default:
        return false;
    }

    switch (operator) {
      case '>':
        return actualValue > value;
      case '<':
        return actualValue < value;
      case '>=':
        return actualValue >= value;
      case '<=':
        return actualValue <= value;
      case '==':
        return actualValue === value;
      default:
        return false;
    }
  }

  /**
   * Evaluate sequence-based trigger
   */
  private evaluateSequence(
    trigger: RuleTrigger,
    message: AnalyzedMessage,
    context: string
  ): boolean {
    // This would check for patterns like "3 insults in 5 minutes"
    // Requires access to recent message history (from context)
    const { count, timeWindow, pattern } = trigger.parameters;
    
    // Simplified: check if pattern appears in recent context
    const contextLower = context.toLowerCase();
    const patternLower = pattern.toLowerCase();
    const occurrences = (contextLower.match(new RegExp(patternLower, 'g')) || []).length;
    
    return occurrences >= count;
  }

  /**
   * Evaluate contextual trigger using LLM
   */
  private async evaluateContextual(
    trigger: RuleTrigger,
    message: AnalyzedMessage,
    context: string
  ): Promise<boolean> {
    const prompt = `Context: ${context}

Current message: "${message.content}"

Rule condition: ${trigger.condition}

Does this message meet the rule condition? Respond with only "true" or "false" and a brief reason.`;

    const systemPrompt = `You are a rule evaluator. Be precise and fair.`;

    try {
      const response = await this.llm.generate(prompt, systemPrompt);
      return response.toLowerCase().includes('true');
    } catch (error) {
      console.error('Contextual evaluation error:', error);
      return false;
    }
  }

  /**
   * Create a new rule from natural language
   */
  async createRuleFromNL(instruction: string, guildId: string, creator: string): Promise<GenerativeRule> {
    const prompt = `A community moderator said: "${instruction}"

Generate a governance rule based on this instruction.

Provide:
1. trigger: {type, condition, parameters}
2. action: {type, severity, duration?, message?}
3. reason: why this rule helps the community
4. confidence: how confident you are this interpretation is correct (0-1)

Types available:
- Trigger types: pattern, threshold, sequence, context
- Action types: warn, timeout, ban, role_change`;

    const systemPrompt = `You are Becas's rule generation system. Create fair, enforceable rules.`;

    try {
      const ruleData = await this.llm.generateJSON<{
        trigger: RuleTrigger;
        action: RuleAction;
        reason: string;
        confidence: number;
      }>(prompt, systemPrompt);

      this.ruleCounter++;
      const rule: GenerativeRule = {
        id: `R-${String(this.ruleCounter).padStart(3, '0')}`,
        trigger: ruleData.trigger,
        action: ruleData.action,
        confidence: ruleData.confidence,
        effectiveness: 0,
        reason: ruleData.reason,
        createdAt: new Date(),
        applicationCount: 0,
        successRate: 0,
        metadata: {
          creator: creator === 'admin' ? 'admin' : 'becas',
          guildId,
          tags: this.extractTags(instruction),
          mutations: 0,
        },
      };

      this.rules.set(rule.id, rule);
      await this.saveRules();

      console.log(`Created rule ${rule.id}: ${rule.reason}`);
      return rule;
    } catch (error) {
      console.error('Rule creation error:', error);
      throw error;
    }
  }

  /**
   * Evolve a rule based on performance
   */
  async evolveRule(ruleId: string): Promise<GenerativeRule | null> {
    const rule = this.rules.get(ruleId);
    if (!rule) return null;

    // Check if rule should evolve
    if (rule.applicationCount < 10) return null; // Need more data
    if (rule.effectiveness > ENV.RULE_EVOLUTION_THRESHOLD) return null; // Already effective

    const prompt = `This governance rule has been applied ${rule.applicationCount} times with ${(rule.successRate * 100).toFixed(1)}% success rate:

Trigger: ${JSON.stringify(rule.trigger)}
Action: ${JSON.stringify(rule.action)}
Reason: ${rule.reason}

The rule isn't performing well. Suggest an improved version that:
1. Keeps the core intent
2. Adjusts parameters for better accuracy
3. Modifies action severity if needed

Provide the evolved rule.`;

    const systemPrompt = `You are Becas's rule evolution system. Improve rules while maintaining fairness.`;

    try {
      const evolved = await this.llm.generateJSON<{
        trigger: RuleTrigger;
        action: RuleAction;
        reason: string;
        confidence: number;
      }>(prompt, systemPrompt);

      // Create evolved rule
      this.ruleCounter++;
      const newRule: GenerativeRule = {
        id: `R-${String(this.ruleCounter).padStart(3, '0')}`,
        trigger: evolved.trigger,
        action: evolved.action,
        confidence: evolved.confidence,
        effectiveness: 0,
        reason: evolved.reason,
        createdAt: new Date(),
        applicationCount: 0,
        successRate: 0,
        metadata: {
          ...rule.metadata,
          parentRules: [rule.id],
          mutations: rule.metadata.mutations + 1,
        },
      };

      // Deactivate old rule
      this.rules.delete(ruleId);
      this.rules.set(newRule.id, newRule);

      await this.saveRules();

      console.log(`Evolved rule ${ruleId} → ${newRule.id}`);
      return newRule;
    } catch (error) {
      console.error('Rule evolution error:', error);
      return null;
    }
  }

  /**
   * Merge similar rules
   */
  async mergeRules(ruleIds: string[]): Promise<GenerativeRule | null> {
    const rulesToMerge = ruleIds.map(id => this.rules.get(id)).filter(Boolean) as GenerativeRule[];
    
    if (rulesToMerge.length < 2) return null;

    const prompt = `These ${rulesToMerge.length} rules serve similar purposes:

${rulesToMerge.map((r, i) => `${i + 1}. ${r.reason}\n   Trigger: ${r.trigger.condition}\n   Action: ${r.action.type}`).join('\n\n')}

Create a single, comprehensive rule that replaces all of them.`;

    const systemPrompt = `You are Becas's rule optimization system. Create elegant, unified rules.`;

    try {
      const merged = await this.llm.generateJSON<{
        trigger: RuleTrigger;
        action: RuleAction;
        reason: string;
        confidence: number;
      }>(prompt, systemPrompt);

      this.ruleCounter++;
      const newRule: GenerativeRule = {
        id: `R-${String(this.ruleCounter).padStart(3, '0')}`,
        trigger: merged.trigger,
        action: merged.action,
        confidence: merged.confidence,
        effectiveness: 0,
        reason: merged.reason,
        createdAt: new Date(),
        applicationCount: 0,
        successRate: 0,
        metadata: {
          creator: 'becas',
          guildId: rulesToMerge[0].metadata.guildId,
          tags: Array.from(new Set(rulesToMerge.flatMap(r => r.metadata.tags))),
          parentRules: ruleIds,
          mutations: 0,
        },
      };

      // Remove old rules
      ruleIds.forEach(id => this.rules.delete(id));
      this.rules.set(newRule.id, newRule);

      await this.saveRules();

      console.log(`Merged ${ruleIds.length} rules → ${newRule.id}`);
      return newRule;
    } catch (error) {
      console.error('Rule merge error:', error);
      return null;
    }
  }

  /**
   * Extract tags from instruction text
   */
  private extractTags(instruction: string): string[] {
    const tags: string[] = [];
    const lower = instruction.toLowerCase();

    if (lower.includes('spam') || lower.includes('flood')) tags.push('spam');
    if (lower.includes('toxic') || lower.includes('insult')) tags.push('toxicity');
    if (lower.includes('link') || lower.includes('url')) tags.push('links');
    if (lower.includes('caps') || lower.includes('yelling')) tags.push('caps');
    if (lower.includes('mention') || lower.includes('@')) tags.push('mentions');

    return tags;
  }

  /**
   * Get all active rules for a guild
   */
  getGuildRules(guildId: string): GenerativeRule[] {
    return Array.from(this.rules.values())
      .filter(rule => rule.metadata.guildId === guildId)
      .sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Get rule by ID
   */
  getRule(ruleId: string): GenerativeRule | undefined {
    return this.rules.get(ruleId);
  }

  /**
   * Delete a rule
   */
  async deleteRule(ruleId: string): Promise<boolean> {
    const deleted = this.rules.delete(ruleId);
    if (deleted) {
      await this.saveRules();
      console.log(`Deleted rule ${ruleId}`);
    }
    return deleted;
  }

  /**
   * Save rules to storage
   */
  private async saveRules(): Promise<void> {
    const rulesArray = Array.from(this.rules.values());
    await this.storage.write('rules', 'active_rules.json', { rules: rulesArray });
  }

  /**
   * Generate human-readable rule description
   */
  describeRule(rule: GenerativeRule): string {
    return `[${rule.id}] ${rule.reason}\nTrigger: ${rule.trigger.condition}\nAction: ${rule.action.type} (severity ${rule.action.severity})\nConfidence: ${(rule.confidence * 100).toFixed(0)}%`;
  }
}