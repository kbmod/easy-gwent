import type { Row, PlayableFaction } from '@gwent/data';

export type PlayerId = 0 | 1;

export type Phase = 'redraw' | 'play' | 'finished';

export type WeatherKind = 'frost' | 'fog' | 'rain';

/** A card on the board. instanceId distinguishes copies of the same CardDef. */
export interface PlacedCard {
  instanceId: string;
  cardId: string;
  /** Transient: marked by the Monsters passive to survive round cleanup. */
  kept?: boolean;
}

export interface RowState {
  units: PlacedCard[];
  /** Zero-strength Decoys occupying positions until the round ends. */
  decoys: PlacedCard[];
  hornActive: boolean;
  /** Horn and Mardroeme specials share this row slot. */
  specialCardId?: string;
}

export interface PendingChoice {
  player: PlayerId;
  kind:
    | 'medic'
    | 'first_player'
    | 'leader_opponent_graveyard'
    | 'leader_own_graveyard'
    | 'leader_discard'
    | 'leader_draw'
    | 'leader_weather'
    | 'leader_peek';
  /** Card ids, except first_player which uses the strings "0" and "1". */
  options: string[];
  remaining: number;
}

export interface PlayerState {
  faction: PlayableFaction;
  leaderId: string;
  leaderUsed: boolean;
  deck: string[]; // card ids, top = end
  hand: string[];
  redrawPile: string[]; // mulliganed cards held aside until this player finishes redraws
  graveyard: string[];
  summonQueue: string[]; // summon-avenger cards waiting for the next round
  rows: Record<Row, RowState>;
  passed: boolean;
  gems: number; // life tokens, start at 2
  redrawsLeft: number;
}

export interface LogEntry {
  turn: number;
  text: string;
}

/** Public presentation metadata for the most recent card played from hand. */
export interface PlayedCardEvent {
  actionId: number;
  player: PlayerId;
  cardId: string;
  row: Row | null;
}

export interface GameState {
  phase: Phase;
  round: number; // 1-based
  turn: PlayerId; // whose action is expected (also target of pendingChoice if set)
  players: [PlayerState, PlayerState];
  weather: Record<WeatherKind, boolean>;
  /** Weather specials remain in play until cleared or the round ends. */
  activeWeather: Array<{ player: PlayerId; cardId: string }>;
  pendingChoice: PendingChoice | null;
  roundHistory: Array<{ scores: [number, number]; winner: PlayerId | null }>;
  winner: PlayerId | null; // null while playing; also null on draw when phase==='finished' && drawn
  drawn: boolean;
  rngState: number;
  nextInstance: number; // instanceId counter
  lastPlayedCard: PlayedCardEvent | null;
  log: LogEntry[];
  turnCount: number;
}

export const otherPlayer = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);

export const emptyRows = (): Record<Row, RowState> => ({
  melee: { units: [], decoys: [], hornActive: false },
  ranged: { units: [], decoys: [], hornActive: false },
  siege: { units: [], decoys: [], hornActive: false },
});

export class IllegalActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IllegalActionError';
  }
}

/** Deep-clone a GameState (plain JSON data by construction). */
export function cloneState(s: GameState): GameState {
  return structuredClone(s);
}
