// types/Message.types.ts
export interface MessageContext {
  id: string;
  content: string;
  authorId: string;
  authorName: string;
  guildId: string;
  channelId: string;
  timestamp: Date;
  mentions: string[];
  attachments: string[];
}

export interface AnalyzedMessage extends MessageContext {
  sentiment: SentimentScore;
  intent: Intent;
  hierarchy: HierarchyLevel;
  toxicity: number; // 0-1
  manipulation: number; // 0-1
}

export interface SentimentScore {
  positive: number;
  negative: number;
  neutral: number;
  dominant: 'positive' | 'negative' | 'neutral';
  emotions: string[]; // ['joy', 'anger', 'fear', etc.]
}

export interface Intent {
  type: 'question' | 'command' | 'statement' | 'governance' | 'social';
  confidence: number;
  target?: string; // who/what is the intent directed at
  action?: string; // what action is requested
}

export type HierarchyLevel = 'admin' | 'moderator' | 'trusted' | 'member' | 'new' | 'suspicious';

// types/Trust.types.ts
export interface TrustScore {
  userId: string;
  userName: string;
  guildId: string;
  score: number; // 0-100
  level: TrustLevel;
  history: TrustEvent[];
  lastUpdated: Date;
  joinedAt: Date;
}

export type TrustLevel = 'exemplary' | 'trusted' | 'neutral' | 'cautious' | 'dangerous';

export interface TrustEvent {
  timestamp: Date;
  action: string;
  delta: number; // change in trust
  reason: string;
  context?: string;
}

export interface TrustModifier {
  pattern: string;
  delta: number;
  reason: string;
}

// types/Rule.types.ts
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

// types/Memory.types.ts
export interface ShortTermMemory {
  conversationId: string;
  messages: AnalyzedMessage[];
  participants: Set<string>;
  context: string; // summarized context
  startTime: Date;
  lastActivity: Date;
  emotionalTone: SentimentScore;
}

export interface LongTermMemory {
  userId: string;
  userName: string;
  guildId: string;
  profile: UserProfile;
  interactions: Interaction[];
  patterns: BehaviorPattern[];
  summary: string; // LLM-generated summary
  lastSeen: Date;
}

export interface UserProfile {
  trustScore: number;
  preferredTopics: string[];
  communicationStyle: string;
  helpfulness: number; // 0-1
  conflictTendency: number; // 0-1
  emotionalStability: number; // 0-1
  authorityResponse: 'respectful' | 'neutral' | 'resistant';
}

export interface Interaction {
  timestamp: Date;
  type: 'positive' | 'negative' | 'neutral' | 'governance';
  description: string;
  trustImpact: number;
  context?: string;
}

export interface BehaviorPattern {
  pattern: string;
  frequency: number;
  lastObserved: Date;
  significance: number; // 0-1
}

export interface MetaMemory {
  selfReflections: Reflection[];
  ruleEvolutionLog: RuleEvolution[];
  learnings: Learning[];
  emotionalState: EmotionalState;
  goals: Goal[];
}

export interface Reflection {
  timestamp: Date;
  content: string;
  mood: string;
  insights: string[];
  actionItems: string[];
}

export interface RuleEvolution {
  timestamp: Date;
  oldRule?: GenerativeRule;
  newRule: GenerativeRule;
  reason: string;
  impact: string;
}

export interface Learning {
  timestamp: Date;
  lesson: string;
  context: string;
  confidence: number;
  applied: boolean;
}

export interface EmotionalState {
  currentMood: string;
  confidence: number; // in own abilities
  satisfaction: number; // with community state
  stress: number; // from conflicts/workload
  lastUpdated: Date;
}

export interface Goal {
  id: string;
  description: string;
  priority: number; // 1-10
  progress: number; // 0-1
  deadline?: Date;
  status: 'active' | 'paused' | 'completed' | 'abandoned';
}

// types/Response.types.ts
export interface BecasResponse {
  content: string;
  tone: 'calm' | 'firm' | 'warm' | 'stern' | 'playful' | 'concerned';
  action?: ModerationAction;
  reasoning: string;
  confidence: number;
}

export interface ModerationAction {
  type: 'warn' | 'timeout' | 'ban' | 'role_change';
  target: string; // userId
  duration?: number;
  reason: string;
  reversible: boolean;
}