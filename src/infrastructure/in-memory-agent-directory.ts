import type { ActorRecord } from '../domain/types.js';
import type { AgentDirectory } from './contracts.js';

export const DEFAULT_AGENT_RECORDS: readonly ActorRecord[] = [
  { id: 'agent-1', role: 'AGENT', active: true },
  { id: 'agent-2', role: 'AGENT', active: true },
  { id: 'agent-inactive', role: 'AGENT', active: false },
  { id: 'supervisor-1', role: 'SUPERVISOR', active: true },
];

export interface InMemoryAgentDirectoryOptions {
  readonly actors?: readonly ActorRecord[];
}

function copyActor(record: ActorRecord): ActorRecord {
  return { ...record };
}

function resolveRecords(
  recordsOrOptions:
    | readonly ActorRecord[]
    | InMemoryAgentDirectoryOptions
    | undefined,
): readonly ActorRecord[] {
  if (recordsOrOptions === undefined) {
    return DEFAULT_AGENT_RECORDS;
  }

  if (Array.isArray(recordsOrOptions)) {
    return recordsOrOptions as readonly ActorRecord[];
  }

  return (recordsOrOptions as InMemoryAgentDirectoryOptions).actors ?? [];
}

/** Isolated in-memory actor directory with replaceable test fixtures. */
export class InMemoryAgentDirectory implements AgentDirectory {
  private readonly actors: Map<string, ActorRecord>;

  constructor(
    recordsOrOptions?:
      | readonly ActorRecord[]
      | InMemoryAgentDirectoryOptions,
  ) {
    this.actors = new Map(
      resolveRecords(recordsOrOptions).map((record) => [
        record.id,
        copyActor(record),
      ]),
    );
  }

  find(actorId: string): ActorRecord | undefined {
    const actor = this.actors.get(actorId);
    return actor ? copyActor(actor) : undefined;
  }

  isActiveAgent(agentId: string): boolean {
    const actor = this.actors.get(agentId);
    return actor?.role === 'AGENT' && actor.active;
  }
}
