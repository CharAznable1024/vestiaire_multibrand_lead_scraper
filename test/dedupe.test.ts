import { describe, expect, it } from 'vitest';

import { applyCrossRunDedupe, emptyPersistentState } from '../src/dedupe.js';
import { merchantLead } from './fixtures.js';

describe('cross-run merchant deduplication', () => {
    it('emits new and changed seller statistics and suppresses unchanged sellers', () => {
        const first = applyCrossRunDedupe([merchantLead()], emptyPersistentState(), 'new_and_updated', 30, '2026-10-12T00:00:00.000Z');
        expect(first.emitted[0].dedupe_status).toBe('new');

        const unchanged = applyCrossRunDedupe([merchantLead()], first.state, 'new_and_updated', 30, '2026-10-13T00:00:00.000Z');
        expect(unchanged.emitted).toEqual([]);

        const changed = { ...merchantLead(), items_sold: 35 };
        const updated = applyCrossRunDedupe([changed], unchanged.state, 'new_and_updated', 30, '2026-10-14T00:00:00.000Z');
        expect(updated.emitted[0].dedupe_status).toBe('updated');
        expect(updated.emitted[0].items_sold).toBe(35);
    });

    it('re-emits unchanged sellers based on last emission time', () => {
        const first = applyCrossRunDedupe([merchantLead()], emptyPersistentState(), 'new_and_updated', 30, '2026-10-01T00:00:00.000Z');
        const seen = applyCrossRunDedupe([merchantLead()], first.state, 'new_and_updated', 30, '2026-10-20T00:00:00.000Z');
        expect(seen.emitted).toEqual([]);
        const reemitted = applyCrossRunDedupe([merchantLead()], seen.state, 'new_and_updated', 30, '2026-11-01T00:00:00.000Z');
        expect(reemitted.emitted).toHaveLength(1);
    });
});
