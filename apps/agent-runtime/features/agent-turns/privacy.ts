import { ToolPermissionError } from './tool-failures';
import type { Command } from '../../../../packages/contracts/src/index';

export type TurnPrivacy = { privateWork: boolean; history: string[] };

export type PendingScope = 'private' | 'public';

const privateCommands = new Set<Command['type']>(['task.claim', 'task.submit', 'task.fail', 'confirmation.request']);

const privateExecution = new Set(['repo.read', 'data.get']);

/** World-derived session state only. Persistent memory is never input to a new model session. */
export function createTurnPrivacy(sharedWorkPending: boolean): TurnPrivacy { return { privateWork: sharedWorkPending, history: [] }; }

export function requireCommandPrivacy(privateWork: boolean, command: Command): void {
  if (privateWork && !privateCommands.has(command.type)) throw new ToolPermissionError('Public actions require a separate public-safe authoring session');
}

export function requireExecutionPrivacy(privateWork: boolean, tool: string): void {
  if (privateWork && !privateExecution.has(tool)) throw new ToolPermissionError('External actions require a separate public-safe authoring session');
}

export function sessionToolAvailable(privateWork: boolean, tool: string): boolean {
  return !privateWork || tool === 'world.inspect' || tool === 'world.command' || privateExecution.has(tool);
}

/** Legacy pending public commands have no trustworthy origin, so they cannot be replayed. */
export function mayReplayCommand(privateWork: boolean, command: Command, origin: PendingScope | undefined): boolean {
  return privateCommands.has(command.type) || (!privateWork && origin === 'public');
}

/** Retained solely for authenticated operator inspection/backup, never model-history reuse. */
export function retainPrivateTurnLog(previous: string[], session: string[]): string[] {
  return [...previous, ...session].slice(-50).map(entry => entry.slice(0, 10000));
}
