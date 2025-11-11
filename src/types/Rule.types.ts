// Rule.types.ts

export interface GenerativeRule {
  id: string;
  trigger: RuleTrigger;
  action: RuleAction;
  confidence: number; // 0-1
  effectiveness: number; // measured over time
  reason: string;
  createdAt: Date;
  lastApplied?: Date;
  applicationCount: number;
  successRate: number;
  metadata: RuleMetadata;
}

export interface RuleTrigger {
  type: 'pattern' | 'threshold' | 'sequence' | 'context';
  condition: string; // natural language or code
  parameters: Record<string, any>;
}

export interface RuleAction {
  type: 'warn' | 'timeout' | 'ban' | 'role_change' | 'custom';
  severity: number; // 1-10
  duration?: number; // in milliseconds
  message?: string; // what Becas says
  reversible: boolean;
}

export interface RuleMetadata {
  creator: 'becas' | 'admin' | 'community';
  guildId: string;
  tags: string[];
  parentRules?: string[]; // rules this evolved from
  mutations: number; // how many times modified
}