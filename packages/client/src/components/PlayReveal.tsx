import { byId } from '@gwent/data';
import { Card } from './Card.tsx';
import type { RevealEvent, TurnBanner } from '../game/reveal.ts';

export interface PlayRevealProps {
  reveal: RevealEvent | null;
  turnBanner: TurnBanner | null;
  /** True when the revealed play belongs to the local player. */
  mine: (r: RevealEvent) => boolean;
  /** Display name for the opponent ("Opponent" in single-player). */
  opponentName: string;
}

const ROW_LABEL: Record<string, string> = {
  melee: 'melee',
  ranged: 'ranged',
  siege: 'siege',
};

/**
 * Presentational overlays: a center-screen spotlight for each card played and
 * a "Your turn" toast. Pointer events pass through — never blocks input.
 */
export function PlayReveal({ reveal, turnBanner, mine, opponentName }: PlayRevealProps) {
  const bannerText =
    turnBanner === 'you'
      ? 'Your turn'
      : turnBanner === 'opponent-passed'
        ? `${opponentName} passed — Your turn`
        : `${opponentName}'s turn`;
  const revealActor = reveal && (mine(reveal) ? 'You' : opponentName);
  const revealVerb = !reveal
    ? ''
    : reveal.kind === 'revive'
      ? (mine(reveal) ? 'revive' : 'revives')
      : reveal.kind === 'summon'
        ? (mine(reveal) ? 'summon' : 'summons')
        : mine(reveal) ? 'play' : 'plays';

  return (
    <>
      {reveal && (
        <div className="play-reveal" key={reveal.key} aria-live="polite">
          <div className={`play-reveal-inner ${mine(reveal) ? 'play-reveal-mine' : 'play-reveal-theirs'}`}>
            <Card cardId={reveal.cardId} size="big" />
            <div className="play-reveal-label">
              <strong>{revealActor} {revealVerb}</strong>
              <span>
                {byId(reveal.cardId).name}
                {reveal.row ? ` → ${ROW_LABEL[reveal.row] ?? reveal.row}` : ''}
              </span>
            </div>
          </div>
        </div>
      )}
      {turnBanner && (!reveal || turnBanner === 'opponent-passed') && (
        <div
          className={`turn-banner ${turnBanner === 'opponent' ? 'turn-banner-opp' : ''} ${turnBanner === 'opponent-passed' ? 'turn-banner-pass' : ''}`}
          aria-live="polite"
        >
          {bannerText}
        </div>
      )}
    </>
  );
}
