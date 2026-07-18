import type { PlayableFaction } from '@gwent/data';
import type { Action } from './actions.ts';
import type { DeckList } from './setup.ts';
import type { GameState, PlayerId } from './state.ts';

/** Messages the client sends to the server. */
export type ClientMsg =
  | { t: 'create_room'; deck: DeckList }
  | { t: 'join_room'; roomId: string; deck: DeckList }
  | { t: 'action'; action: Action }
  | { t: 'leave' };

/** Messages the server sends to the client. */
export type ServerMsg =
  | { t: 'room_created'; roomId: string }
  | { t: 'joined'; roomId: string; you: PlayerId; opponentFaction: PlayableFaction }
  /** `state` is always `redactState(full, seat)` — never the authoritative state. */
  | { t: 'state'; state: GameState }
  | { t: 'error'; code: ProtocolErrorCode; message: string }
  | { t: 'opponent_left' };

export type ProtocolErrorCode =
  | 'room_not_found'
  | 'room_full'
  | 'invalid_deck'
  | 'illegal_action'
  | 'not_your_turn'
  | 'bad_message'
  | 'not_in_room';
