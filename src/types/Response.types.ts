// Response.types.ts

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
  severity?: number;
}