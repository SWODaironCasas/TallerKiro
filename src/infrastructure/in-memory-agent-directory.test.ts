import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AGENT_RECORDS,
  InMemoryAgentDirectory,
} from './in-memory-agent-directory.js';

describe('InMemoryAgentDirectory', () => {
  it('provides active agents, an inactive agent, and a supervisor by default', () => {
    const directory = new InMemoryAgentDirectory();

    expect(directory.isActiveAgent('agent-1')).toBe(true);
    expect(directory.isActiveAgent('agent-2')).toBe(true);
    expect(directory.isActiveAgent('agent-inactive')).toBe(false);
    expect(directory.find('supervisor-1')).toEqual({
      id: 'supervisor-1',
      role: 'SUPERVISOR',
      active: true,
    });
    expect(directory.isActiveAgent('supervisor-1')).toBe(false);
    expect(directory.find('unknown')).toBeUndefined();
  });

  it('accepts replacement actor records for tests', () => {
    const directory = new InMemoryAgentDirectory({
      actors: [
        { id: 'replacement-agent', role: 'AGENT', active: true },
        { id: 'replacement-supervisor', role: 'SUPERVISOR', active: true },
      ],
    });

    expect(directory.find('agent-1')).toBeUndefined();
    expect(directory.isActiveAgent('replacement-agent')).toBe(true);
    expect(directory.find('replacement-supervisor')).toEqual({
      id: 'replacement-supervisor',
      role: 'SUPERVISOR',
      active: true,
    });
  });

  it('does not expose mutable default fixture records', () => {
    const directory = new InMemoryAgentDirectory();
    const actor = directory.find(DEFAULT_AGENT_RECORDS[0].id);

    expect(actor).toBeDefined();
    if (actor) {
      actor.active = false;
    }

    expect(directory.isActiveAgent('agent-1')).toBe(true);
  });
});
