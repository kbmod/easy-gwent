import { describe, expect, it } from 'vitest';
import type { GameState } from '@gwent/engine';
import { detectPlayReveal, didOpponentPass } from '../src/game/reveal.ts';

function turnState(turn: 0 | 1, passed: [boolean, boolean], roundHistoryLength = 0): GameState {
  return {
    phase: 'play',
    turn,
    players: [{ passed: passed[0] }, { passed: passed[1] }],
    roundHistory: Array.from({ length: roundHistoryLength }),
  } as unknown as GameState;
}

describe('opponent pass feedback', () => {
  it('detects an opponent passing control to the local player', () => {
    const prev = turnState(1, [false, false]);
    const state = turnState(0, [false, true]);

    expect(didOpponentPass(prev, state, 0)).toBe(true);
  });

  it('does not mistake the local player passing for an opponent pass', () => {
    const prev = turnState(0, [false, false]);
    const state = turnState(1, [true, false]);

    expect(didOpponentPass(prev, state, 0)).toBe(false);
  });

  it('does not announce a pass after the round has advanced', () => {
    const prev = turnState(1, [false, false]);
    const state = turnState(0, [false, true], 1);

    expect(didOpponentPass(prev, state, 0)).toBe(false);
  });
});

function revealState(
  turn: 0 | 1,
  turnCount: number,
  player0: Array<{ instanceId: string; cardId: string }> = [],
  player1: Array<{ instanceId: string; cardId: string }> = [],
  lastPlayedCard: GameState['lastPlayedCard'] = null,
): GameState {
  const rows = (units: Array<{ instanceId: string; cardId: string }>) => ({
    melee: { units: [], decoys: [], hornActive: false },
    ranged: { units, decoys: [], hornActive: false },
    siege: { units: [], decoys: [], hornActive: false },
  });
  return {
    phase: 'play',
    turn,
    turnCount,
    lastPlayedCard,
    pendingChoice: null,
    players: [{ rows: rows(player0) }, { rows: rows(player1) }],
  } as unknown as GameState;
}

describe('play reveal sequencing', () => {
  it('reveals a Horn even though it does not add a unit', () => {
    const prev = revealState(1, 20);
    const afterHorn = revealState(0, 21, [], [], {
      actionId: 20,
      player: 1,
      cardId: 'ne_horn',
      row: 'melee',
      kind: 'play',
    });

    expect(detectPlayReveal(prev, afterHorn)).toEqual({
      cardId: 'ne_horn',
      player: 1,
      row: 'melee',
      kind: 'play',
    });
  });

  it('labels a revived ability card as a revival rather than a second play', () => {
    const prev = revealState(1, 30);
    const afterRevive = revealState(0, 31, [], [], {
      actionId: 30,
      player: 1,
      cardId: 'ne_villentretenmerth',
      row: 'melee',
      kind: 'revive',
    });

    expect(detectPlayReveal(prev, afterRevive)?.kind).toBe('revive');
  });

  it('treats a played Muster card and all summoned cards as one reveal', () => {
    const prev = revealState(0, 10);
    const afterMuster = revealState(
      1,
      11,
      [
        { instanceId: 'i20', cardId: 'ne_gaunter_odimm' },
        { instanceId: 'i21', cardId: 'ne_gaunter_darkness' },
        { instanceId: 'i22', cardId: 'ne_gaunter_darkness' },
        { instanceId: 'i23', cardId: 'ne_gaunter_darkness' },
      ],
      [],
      { actionId: 10, player: 0, cardId: 'ne_gaunter_odimm', row: 'ranged', kind: 'play' },
    );

    expect(detectPlayReveal(prev, afterMuster)).toEqual({
      cardId: 'ne_gaunter_odimm',
      player: 0,
      row: 'ranged',
      kind: 'play',
    });
  });

  it('attributes each following play from its own preceding turn', () => {
    const afterMuster = revealState(1, 11, [
      { instanceId: 'i20', cardId: 'ne_gaunter_odimm' },
      { instanceId: 'i21', cardId: 'ne_gaunter_darkness' },
      { instanceId: 'i22', cardId: 'ne_gaunter_darkness' },
      { instanceId: 'i23', cardId: 'ne_gaunter_darkness' },
    ]);
    const afterOpponent = revealState(
      0,
      12,
      afterMuster.players[0].rows.ranged.units,
      [{ instanceId: 'i24', cardId: 'nr_ves' }],
    );
    const afterPlayer = revealState(
      1,
      13,
      [...afterMuster.players[0].rows.ranged.units, { instanceId: 'i25', cardId: 'ne_zoltan' }],
      afterOpponent.players[1].rows.ranged.units,
    );

    expect(detectPlayReveal(afterMuster, afterOpponent)?.player).toBe(1);
    expect(detectPlayReveal(afterMuster, afterOpponent)?.cardId).toBe('nr_ves');
    expect(detectPlayReveal(afterOpponent, afterPlayer)?.player).toBe(0);
    expect(detectPlayReveal(afterOpponent, afterPlayer)?.cardId).toBe('ne_zoltan');
  });

  it('attributes spies to the player who played them, not their board owner', () => {
    const prev = revealState(0, 4);
    const afterSpy = revealState(1, 5, [], [{ instanceId: 'i8', cardId: 'nr_dijkstra' }]);

    expect(detectPlayReveal(prev, afterSpy)?.player).toBe(0);
  });
});
