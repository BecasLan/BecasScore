// Memory.types.ts

import { AnalyzedMessage, SentimentScore } from './Message.types';

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
  oldRule?: any;
  newRule: any;
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