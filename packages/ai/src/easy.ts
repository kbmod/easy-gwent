import {
  legalActions,
  scores,
  type Action,
  type GameState,
  type PlayerId,
  type Rng,
} from '@gwent/engine';
import { pick } from '@gwent/engine';

/**
 * Easy AI: mostly random legal play with just enough sense not to be a pushover:
 * - During redraw: finishes immediately (keeps dealt hand).
 * - Never passes while it still has cards and is losing the round, unless hand is empty.
 * - Otherwise picks a uniformly random legal action (excluding PASS while hand is non-empty
 *   in round 1, so it actually plays cards).
 */
export function chooseEasy(s: GameState, player: PlayerId, rng: Rng): Action {
  const actions = legalActions(s, player);
  if (actions.length === 0) throw new Error('easy AI asked to act with no legal actions');
  if (actions.length === 1) return actions[0]!;

  // Redraw phase: just finish (easy AI keeps its hand).
  if (s.phase === 'redraw') {
    const done = actions.find((a) => a.type === 'REDRAW' && a.handIndex === null);
    if (done) return done;
  }

  // Pending choice (e.g. medic): pick a random concrete option, else decline.
  if (s.pendingChoice) {
    const concrete = actions.filter((a) => a.type === 'RESOLVE_CHOICE' && a.cardId !== null);
    return concrete.length > 0 ? pick(rng, concrete) : actions[0]!;
  }

  const p = s.players[player];
  const [s0, s1] = scores(s);
  const mine = player === 0 ? s0 : s1;
  const theirs = player === 0 ? s1 : s0;
  const opponent = s.players[player === 1 ? 0 : 1];

  const nonPass = actions.filter((a) => a.type !== 'PASS');

  // If opponent passed and we are already winning, pass to take the round.
  const passAction = actions.find((a) => a.type === 'PASS');
  if (passAction && opponent.passed && mine > theirs) return passAction;

  // Don't pass while we have cards and are behind (would forfeit the round for free).
  if (nonPass.length > 0 && (p.hand.length > 0 || !passAction)) {
    // Small chance to pass anyway when ahead, so rounds actually end.
    if (passAction && mine > theirs && p.hand.length <= 4) {
      const roll = pick(rng, [0, 1, 2, 3] as const);
      if (roll === 0) return passAction;
    }
    return pick(rng, nonPass);
  }

  return pick(rng, actions);
}
