import { describe, expect, it } from 'vitest';
import { findRuleConflicts } from './conflicts';

describe('rule conflict analysis', () => {
  it('detects two enabled header rules targeting the same scope', () => {
    const conflicts = findRuleConflicts([
      {
        id: 'a',
        enabled: true,
        kind: 'headers',
        target: 'request',
        operation: 'set',
        header: 'X-Test',
        value: 'one',
        domains: ['localhost'],
      },
      {
        id: 'b',
        enabled: true,
        kind: 'headers',
        target: 'request',
        operation: 'set',
        header: 'x-test',
        value: 'two',
        domains: ['localhost'],
      },
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].ruleIds).toEqual(['a', 'b']);
  });
});
