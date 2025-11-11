// actions/index.ts - Central export for all Discord action definitions
// Each action is a tool Becas can use intelligently

import { ActionRegistry } from '../ActionRegistry';
import { messageActions } from './messageActions';
import { userActions } from './userActions';
import { roleActions } from './roleActions';
import { channelActions } from './channelActions';

export * from './messageActions';
export * from './userActions';
export * from './roleActions';
export * from './channelActions';

/**
 * Initialize and populate the action registry with all available actions
 */
export function initializeActionRegistry(): ActionRegistry {
  const registry = new ActionRegistry();

  // Register all message actions
  for (const action of messageActions) {
    registry.register(action);
  }

  // Register all user actions
  for (const action of userActions) {
    registry.register(action);
  }

  // Register all role actions
  for (const action of roleActions) {
    registry.register(action);
  }

  // Register all channel actions
  for (const action of channelActions) {
    registry.register(action);
  }

  return registry;
}
