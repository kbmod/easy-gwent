import { describe, expect, it } from 'vitest';
import { applyAction, createGame, createRng, type GameState } from '@gwent/engine';
import { testDeck } from '../../engine/test/helpers.ts';
import { chooseEasy } from '../src/easy.ts';

function selfPlay(seed: number): GameState {
  let s = createGame(seed, [testDeck('northern_realms'), testDeck('nilfgaard')]);
  const rng = createRng(seed ^ 0x9e3779b9);
  let steps = 0;
  while (s.phase !== 'finished') {
    if (++steps > 500) throw new Error('self-play did not terminate');
    const actor =
      s.phase === 'redraw'
        ? s.players[0].redrawsLeft > 0 ? 0 : 1
        : s.pendingChoice ? s.pendingChoice.player : s.turn;
    s = applyAction(s, chooseEasy(s, actor, rng));
  }
  return s;
}

describe('easy AI', () => {
  it('plays full games to completion without illegal actions', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const end = selfPlay(seed);
      expect(end.phase).toBe('finished');
      expect(end.roundHistory.length).toBeGreaterThanOrEqual(2);
      expect(end.roundHistory.length).toBeLessThanOrEqual(3);
    }
  });
});
