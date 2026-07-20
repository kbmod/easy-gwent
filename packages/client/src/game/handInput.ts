import type { Action, PlayCardAction } from '@gwent/engine';

/**
 * Resolve a second click on an already-selected hand card. Row/target choices
 * remain interactive; only a single non-targeted legal action can play.
 */
export function selectedHandPlay(actions: Action[], handIndex: number): PlayCardAction | null {
  const plays = actions.filter(
    (action): action is PlayCardAction => action.type === 'PLAY_CARD' && action.handIndex === handIndex,
  );
  if (plays.length !== 1 || plays[0]!.targetInstanceId) return null;
  return plays[0]!;
}
