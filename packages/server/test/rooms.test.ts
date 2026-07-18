import { describe, expect, it } from 'vitest';
import { testDeck } from '../../engine/test/helpers.ts';
import { currentActor, Rooms } from '../src/rooms.ts';

describe('Rooms', () => {
  it('creates a room with a short id and validates decks', () => {
    const rooms = new Rooms(() => 1);
    const bad = rooms.create({ faction: 'northern_realms', leaderId: 'nope', cards: [] });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.code).toBe('invalid_deck');

    const ok = rooms.create(testDeck('northern_realms'));
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.value.id.length).toBeGreaterThanOrEqual(3);
      expect(ok.value.state).toBeNull();
      expect(ok.value.decks[1]).toBeNull();
    }
  });

  it('starts the game when the second player joins', () => {
    const rooms = new Rooms(() => 42);
    const a = rooms.create(testDeck('northern_realms'));
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const join = rooms.join(a.value.id, testDeck('nilfgaard'));
    expect(join.ok).toBe(true);
    if (!join.ok) return;
    expect(join.value.state).not.toBeNull();
    expect(join.value.state!.phase).toBe('redraw');
  });

  it('rejects join when room is full or missing', () => {
    const rooms = new Rooms(() => 1);
    const a = rooms.create(testDeck('northern_realms'));
    if (!a.ok) throw new Error('create failed');
    expect(rooms.join(a.value.id, testDeck('nilfgaard')).ok).toBe(true);
    const full = rooms.join(a.value.id, testDeck('monsters'));
    expect(full.ok).toBe(false);
    if (!full.ok) expect(full.code).toBe('room_full');
    const missing = rooms.join('zzzzz', testDeck('monsters'));
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.code).toBe('room_not_found');
  });

  it('enforces turn order on act', () => {
    const rooms = new Rooms(() => 7);
    const a = rooms.create(testDeck('northern_realms'));
    if (!a.ok) throw new Error('create failed');
    const j = rooms.join(a.value.id, testDeck('nilfgaard'));
    if (!j.ok || !j.value.state) throw new Error('join failed');

    const actor = currentActor(j.value.state);
    const other = (1 - actor) as 0 | 1;
    const bad = rooms.act(a.value.id, other, { type: 'PASS', player: other });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.code).toBe('not_your_turn');

    // Finish redraws for both if needed, then pass on turn.
    let state = j.value.state;
    while (state.phase === 'redraw') {
      const p = currentActor(state);
      const r = rooms.act(a.value.id, p, { type: 'REDRAW', player: p, handIndex: null });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      state = r.value;
    }
    if (state.phase === 'play') {
      const p = currentActor(state);
      const r = rooms.act(a.value.id, p, { type: 'PASS', player: p });
      expect(r.ok).toBe(true);
    }
  });
});
