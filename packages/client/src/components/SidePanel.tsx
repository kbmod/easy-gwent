import { useState } from 'react';
import { byId, getCardText } from '@gwent/data';
import { scores, type GameState, type PlayerId } from '@gwent/engine';
import { Card } from './Card.tsx';

export function weatherCardsInPlay(activeWeather: GameState['activeWeather']) {
  const cards = new Map<string, { cardId: string; count: number }>();
  for (const { cardId } of activeWeather) {
    const current = cards.get(cardId);
    if (current) current.count += 1;
    else cards.set(cardId, { cardId, count: 1 });
  }
  return [...cards.values()];
}

export function StatusColumn({
  state,
  human,
  canPlayLeader,
  onLeader,
  opponentName,
  roomId,
}: {
  state: GameState;
  human: PlayerId;
  canPlayLeader: boolean;
  onLeader: () => void;
  opponentName?: string;
  roomId?: string;
}) {
  const opp: PlayerId = human === 0 ? 1 : 0;
  const [copied, setCopied] = useState(false);
  const copyRoomId = () => {
    if (!roomId) return;
    navigator.clipboard?.writeText(roomId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  const weatherCards = weatherCardsInPlay(state.activeWeather);
  const totals = scores(state);

  const seat = (p: PlayerId, mine: boolean) => {
    const ps = state.players[p];
    const other: PlayerId = p === 0 ? 1 : 0;
    const leading = totals[p] > totals[other];
    const recentDiscards = ps.graveyard.slice(-4).reverse();
    return (
      <div className={`seat ${mine ? 'seat-mine' : ''} ${state.turn === p && state.phase === 'play' ? 'seat-active' : ''}`}>
        <div className="seat-main">
          <div className="seat-name">{mine ? 'You' : opponentName ?? 'Opponent'}</div>
          <div className="seat-gems">{'◆'.repeat(ps.gems)}{'◇'.repeat(Math.max(0, 2 - ps.gems))}</div>
          <div className="seat-info">
            Hand {ps.hand.length} · Deck {ps.deck.length} · Discard {ps.graveyard.length}
            {ps.passed && <span className="passed"> · PASSED</span>}
          </div>
          <div className="discard-pile">
            <div className="discard-heading">Discard {ps.graveyard.length}</div>
            {recentDiscards.length > 0 ? (
              <div className="discard-cards">
                {recentDiscards.map((id, i) => (
                  <span key={`${id}-${i}`} title={byId(id).name}>
                    {byId(id).name}
                  </span>
                ))}
              </div>
            ) : (
              <div className="discard-empty">Empty</div>
            )}
          </div>
          <div className="seat-leader">
            <div className="seat-leader-row">
              {byId(ps.leaderId).name}
              {ps.leaderUsed ? ' (used)' : mine && canPlayLeader ? (
                <button className="btn btn-small" onClick={onLeader}>
                  Use
                </button>
              ) : null}
            </div>
            <div className="seat-leader-ability">{getCardText(byId(ps.leaderId)).ability}</div>
          </div>
        </div>
        <div className={`seat-score ${leading ? 'seat-score-lead' : ''}`}>{totals[p]}</div>
      </div>
    );
  };

  return (
    <div className="status-col">
      <div className="opp-block">
        {roomId && (
          <div className="seat-room">
            room <span className="room-code">{roomId}</span>
            <button className="room-copy" onClick={copyRoomId} title="Copy room code">
              {copied ? '✓' : '⧉'}
            </button>
          </div>
        )}
        {seat(opp, false)}
      </div>
      <div className="weather-box">
        {weatherCards.length === 0 ? (
          <span className="weather-clear"><span aria-hidden="true">☀</span> Clear skies</span>
        ) : (
          weatherCards.map(({ cardId, count }) => {
            const card = byId(cardId);
            return (
              <span className={`weather-active weather-active-${card.special}`} key={cardId}>
                {card.name}{count > 1 ? ` ×${count}` : ''}
              </span>
            );
          })
        )}
      </div>
      <div className="round-info">Round {state.round}</div>
      {seat(human, true)}
    </div>
  );
}

export function LogPanel({
  state,
  previewCardId,
  selected,
  canPlaySelected,
  playHint,
  onConfirmPlay,
}: {
  state: GameState;
  previewCardId: string | null;
  /** True when a hand card is actively selected (not just hovered). */
  selected?: boolean;
  /** Selected card has a legal play and can be confirmed. */
  canPlaySelected?: boolean;
  /** e.g. "Click a highlighted row" */
  playHint?: string | null;
  /** Click the big card art to confirm play when possible. */
  onConfirmPlay?: () => void;
}) {
  const def = previewCardId
    ? (() => {
        try {
          return byId(previewCardId);
        } catch {
          return null;
        }
      })()
    : null;
  const text = def ? getCardText(def) : null;
  const confirmable = !!(selected && canPlaySelected && onConfirmPlay);

  return (
    <div className="side-panel">
      <div className={`preview-slot ${confirmable ? 'preview-confirmable' : ''} ${selected ? 'preview-selected' : ''}`}>
        {previewCardId && (
          <Card
            cardId={previewCardId}
            size="big"
            onClick={confirmable ? onConfirmPlay : undefined}
          />
        )}
        {!previewCardId && <div className="preview-empty">Hover or select a card</div>}
      </div>

      {def && text && (
        <div className="card-info">
          <div className="card-info-name">{def.name}</div>
          {text.flavor && <div className="card-info-flavor">“{text.flavor}”</div>}
          <div className="card-info-ability">{text.ability}</div>
          {selected && (
            <div className="card-info-hint">
              {canPlaySelected
                ? playHint ?? 'Click the card art above to play'
                : playHint ?? 'Cannot play this card right now'}
            </div>
          )}
          {confirmable && (
            <button className="btn btn-primary btn-play-confirm" onClick={onConfirmPlay}>
              Play card
            </button>
          )}
        </div>
      )}

      <div className="log">
        {state.log.slice(-30).map((e, i) => (
          <div key={i} className="log-entry">
            {e.text}
          </div>
        ))}
      </div>
    </div>
  );
}
