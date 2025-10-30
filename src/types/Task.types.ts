// Task.types.ts

export interface Task {
  id: string;
  type: 'immediate' | 'scheduled' | 'conditional';
  action: TaskAction;
  target: {
    userId: string;
    userName: string;
  };
  condition?: TaskCondition;
  executeAt?: Date;
  cancelCondition?: CancelCondition;
  monitoring?: MonitoringConfig;
  status: 'pending' | 'monitoring' | 'executing' | 'completed' | 'cancelled' | 'failed';
  createdBy: {
    userId: string;
    userName: string;
  };
  guildId: string;
  createdAt: Date;
  updatedAt: Date;
  executedAt?: Date;
  result?: string;
  error?: string;
}

export interface TaskAction {
  type: 'timeout' | 'ban' | 'kick' | 'warn' | 'role_change';
  duration?: number; // for timeout
  reason: string;
  severity: number;
}

export interface TaskCondition {
  type: 'time' | 'message_pattern' | 'user_action' | 'trust_threshold';
  value: any;
  operator?: '>' | '<' | '=' | '>=' | '<=' | 'contains' | 'matches';
  checkInterval?: number; // milliseconds
}

export interface CancelCondition {
  type: 'message_pattern' | 'user_action' | 'timeout' | 'trust_increase';
  value: any;
  timeout?: number; // max time to wait before giving up
}

export interface MonitoringConfig {
  watchFor: string; // what to watch for
  duration: number; // how long to monitor
  checkInterval: number; // how often to check
  onMatch: 'cancel' | 'execute' | 'modify';
}

export interface TaskUpdate {
  status?: Task['status'];
  result?: string;
  error?: string;
  executedAt?: Date;
}