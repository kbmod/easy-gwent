import { byId, type Row } from '@gwent/data';
import { effectiveStrength, rowScore, type GameState, type PlayerId } from '@gwent/engine';
import { Card } from './Card.tsx';

const ROW_ORDER_TOP: Row[] = ['siege', 'ranged', 'melee'];
const ROW_ORDER_BOTTOM: Row[] = ['melee', 'ranged', 'siege'];
const WEATHER_FOR_ROW = {
  melee: { kind: 'frost', label: 'Biting Frost', mark: '❄' },
  ranged: { kind: 'fog', label: 'Impenetrable Fog', mark: '≋' },
  siege: { kind: 'rain', label: 'Torrential Rain', mark: '╱' },
} as const;

export interface BoardProps {
  state: GameState;
  human: PlayerId;
  /** Rows the human may currently target (row-select mode). */
  targetRows?: Row[];
  onRowClick?: (row: Row) => void;
  /** Own-unit targeting (decoy). */
  targetInstanceIds?: string[];
  onUnitClick?: (instanceId: string) => void;
  onHover?: (cardId: string | null) => void;
}

function BoardRow({
  state,
  player,
  row,
  mine,
  targetable,
  onRowClick,
  targetInstanceIds,
  onUnitClick,
  onHover,
}: {
  state: GameState;
  player: PlayerId;
  row: Row;
  mine: boolean;
  targetable: boolean;
  onRowClick?: (row: Row) => void;
  targetInstanceIds?: string[];
  onUnitClick?: (instanceId: string) => void;
  onHover?: (cardId: string | null) => void;
}) {
  const rs = state.players[player].rows[row];
  const rowSpecial = rs.specialCardId ? byId(rs.specialCardId) : null;
  const slotTitle = rowSpecial?.name ?? (rs.hornActive ? "Commander's Horn active" : 'Row special slot');
  const rowWeather = WEATHER_FOR_ROW[row];
  const weatherActive = state.weather[rowWeather.kind];
  return (
    <div
      className={`board-row row-${row} ${mine ? 'row-mine' : 'row-theirs'} ${targetable ? 'row-targetable' : ''} ${weatherActive ? `row-weather row-weather-${rowWeather.kind}` : ''}`}
      onClick={targetable ? () => onRowClick?.(row) : undefined}
    >
      <div className={`row-badge ${rs.hornActive ? 'horn' : ''}`}>{rowScore(state, player, row)}</div>
      <div className={`row-horn ${rs.hornActive || rowSpecial ? 'horn-active' : ''}`} title={slotTitle}>
        {rowSpecial?.special === 'mardroeme' ? 'M' : 'H'}
      </div>
      {weatherActive && (
        <div className="row-weather-label" title={rowWeather.label} aria-label={rowWeather.label}>
          <span aria-hidden="true">{rowWeather.mark}</span>
          <span>{rowWeather.label}</span>
        </div>
      )}
      <div className="row-units">
        {(rs.decoys ?? []).map((decoy) => (
          <Card key={decoy.instanceId} cardId={decoy.cardId} onHover={onHover} />
        ))}
        {rs.units.map((u) => {
          const canTarget = mine && targetInstanceIds?.includes(u.instanceId);
          return (
            <Card
              key={u.instanceId}
              cardId={u.cardId}
              strength={byId(u.cardId).type === 'unit' ? effectiveStrength(state, player, row, u) : undefined}
              selected={canTarget}
              onClick={canTarget ? () => onUnitClick?.(u.instanceId) : undefined}
              onHover={onHover}
            />
          );
        })}
      </div>
    </div>
  );
}

export function Board({ state, human, targetRows, onRowClick, targetInstanceIds, onUnitClick, onHover }: BoardProps) {
  const opp: PlayerId = human === 0 ? 1 : 0;

  return (
    <div className="board">
      <div className="board-half board-opponent">
        {ROW_ORDER_TOP.map((row) => (
          <BoardRow key={row} state={state} player={opp} row={row} mine={false} targetable={false} onHover={onHover} />
        ))}
      </div>
      <div className="board-divider" />
      <div className="board-half board-mine">
        {ROW_ORDER_BOTTOM.map((row) => (
          <BoardRow
            key={row}
            state={state}
            player={human}
            row={row}
            mine
            targetable={!!targetRows?.includes(row)}
            onRowClick={onRowClick}
            targetInstanceIds={targetInstanceIds}
            onUnitClick={onUnitClick}
            onHover={onHover}
          />
        ))}
      </div>
    </div>
  );
}
