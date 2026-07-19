import { byId, type CardDef, type Row } from '@gwent/data';
import type { Action, PlayCardAction } from './actions.ts';
import type { GameState, PlayerId, PlacedCard } from './state.ts';
import { IllegalActionError, cloneState, otherPlayer } from './state.ts';
import { scores } from './scoring.ts';
import { createRng, shuffle, pick, type Rng } from './rng.ts';
import { applyLeader, applyWeatherCard, clearWeather } from './abilities/leaders.ts';
import { unitScorch, globalScorch, scorchRowIfStrong } from './abilities/scorch.ts';

const ROWS: Row[] = ['melee', 'ranged', 'siege'];

export function applyAction(prev: GameState, action: Action): GameState {
  const s = cloneState(prev);
  const rng = createRng(0);
  rng.state = s.rngState;

  if (s.phase === 'finished') throw new IllegalActionError('Game is finished');

  switch (action.type) {
    case 'REDRAW':
      handleRedraw(s, rng, action.player, action.handIndex);
      break;
    case 'PLAY_CARD':
      requireTurn(s, action.player, 'play');
      handlePlayCard(s, rng, action);
      afterMove(s, action.player, rng);
      break;
    case 'PLAY_LEADER': {
      requireTurn(s, action.player, 'play');
      const p = s.players[action.player];
      if (p.leaderUsed) throw new IllegalActionError('Leader already used');
      const leader = byId(p.leaderId);
      if (isLeaderCancelled(s, action.player)) throw new IllegalActionError('Leader ability is cancelled');
      if (isPassiveLeader(leader)) throw new IllegalActionError('This leader ability is passive');
      if (leader.leaderAbility === 'eredin_destroyer_of_worlds' && p.hand.length < 2) {
        throw new IllegalActionError('Destroyer of Worlds requires 2 cards in hand');
      }
      p.leaderUsed = true;
      log(s, `Player ${action.player + 1} uses leader: ${leader.name}`);
      applyLeader(s, rng, action.player, leader.leaderAbility!);
      afterMove(s, action.player, rng);
      break;
    }
    case 'RESOLVE_CHOICE':
      handleResolveChoice(s, rng, action.player, action.cardId);
      break;
    case 'PASS': {
      requireTurn(s, action.player, 'play');
      const p = s.players[action.player];
      p.passed = true;
      log(s, `Player ${action.player + 1} passes`);
      afterMove(s, action.player, rng);
      break;
    }
  }

  s.rngState = rng.state;
  s.turnCount++;
  return s;
}

// ── helpers ──────────────────────────────────────────────────────────

function log(s: GameState, text: string): void {
  s.log.push({ turn: s.turnCount, text });
}

function requireTurn(s: GameState, player: PlayerId, phase: 'play'): void {
  if (s.phase !== phase) throw new IllegalActionError(`Not in ${phase} phase`);
  if (s.pendingChoice) throw new IllegalActionError('A choice is pending');
  if (s.turn !== player) throw new IllegalActionError('Not your turn');
  if (s.players[player].passed) throw new IllegalActionError('You have passed');
}

export function isPassiveLeader(def: CardDef): boolean {
  return (
    def.leaderAbility === 'emhyr_the_white_flame' ||
    def.leaderAbility === 'emhyr_invader_of_the_north' ||
    def.leaderAbility === 'francesca_daisy_of_the_valley' ||
    def.leaderAbility === 'eredin_treacherous' ||
    def.leaderAbility === 'bran_tuirseach'
  );
}

export function isLeaderCancelled(s: GameState, player: PlayerId): boolean {
  const opp = s.players[otherPlayer(player)];
  return byId(opp.leaderId).leaderAbility === 'emhyr_the_white_flame';
}

export function placeUnit(s: GameState, player: PlayerId, row: Row, cardId: string): PlacedCard {
  const placed: PlacedCard = { instanceId: `i${s.nextInstance++}`, cardId };
  s.players[player].rows[row].units.push(placed);
  return placed;
}

function queueSummonAvenger(s: GameState, boardPlayer: PlayerId, cardId: string): void {
  const d = byId(cardId);
  if (!d.abilities.includes('summon_avenger') || !d.transformsInto) return;
  s.players[boardPlayer].summonQueue.push(d.transformsInto);
}

// ── redraw phase ─────────────────────────────────────────────────────

function handleRedraw(s: GameState, rng: Rng, player: PlayerId, handIndex: number | null): void {
  if (s.phase !== 'redraw') throw new IllegalActionError('Not in redraw phase');
  const p = s.players[player];
  if (p.redrawsLeft <= 0) throw new IllegalActionError('No redraws left');

  if (handIndex === null) {
    p.redrawsLeft = 0;
  } else {
    const cardId = p.hand[handIndex];
    if (cardId === undefined) throw new IllegalActionError('Bad hand index');
    p.hand.splice(handIndex, 1);
    p.redrawPile.push(cardId);
    p.hand.push(p.deck.pop()!);
    p.redrawsLeft--;
  }

  if (p.redrawsLeft <= 0 && p.redrawPile.length) {
    p.deck.push(...p.redrawPile);
    p.redrawPile = [];
    shuffle(rng, p.deck);
  }

  if (s.players[0].redrawsLeft <= 0 && s.players[1].redrawsLeft <= 0) {
    s.phase = 'play';
    log(s, 'Round 1 begins');
  }
}

// ── playing cards ────────────────────────────────────────────────────

function handlePlayCard(s: GameState, rng: Rng, action: PlayCardAction): void {
  const p = s.players[action.player];
  const cardId = p.hand[action.handIndex];
  if (cardId === undefined) throw new IllegalActionError('Bad hand index');
  const def = byId(cardId);

  p.hand.splice(action.handIndex, 1);

  if (def.type === 'special') {
    playSpecial(s, rng, action, def);
  } else if (def.type === 'unit') {
    playUnit(s, rng, action, def);
  } else {
    throw new IllegalActionError('Cannot play a leader card from hand');
  }
}

function resolveRow(action: PlayCardAction, def: CardDef): Row {
  const rows = def.rows ?? [];
  if (rows.length === 1) return rows[0]!;
  if (!action.row || !rows.includes(action.row)) {
    throw new IllegalActionError(`${def.name} requires a row choice of ${rows.join('/')}`);
  }
  return action.row;
}

function playUnit(s: GameState, rng: Rng, action: PlayCardAction, def: CardDef): void {
  const player = action.player;
  const p = s.players[player];

  // Spy goes to the opponent's row and you draw 2
  if (def.abilities.includes('spy')) {
    const row = resolveRow(action, def);
    const target = otherPlayer(player);
    placeUnit(s, target, row, def.id);
    for (let i = 0; i < 2 && p.deck.length; i++) p.hand.push(p.deck.pop()!);
    log(s, `Player ${player + 1} plays spy ${def.name}`);
    return;
  }

  const row = resolveRow(action, def);
  placeUnit(s, player, row, def.id);
  log(s, `Player ${player + 1} plays ${def.name} (${row})`);

  triggerUnitAbilities(s, rng, player, row, def);
}

function pullMusterCards(s: GameState, player: PlayerId, def: CardDef): void {
  if (!def.abilities.includes('muster')) return;
  const p = s.players[player];
  const explicitIds = new Set(def.musterIds ?? []);
  const matches = (id: string): boolean => {
    const candidate = byId(id);
    if (candidate.type !== 'unit') return false;
    if (explicitIds.size) return explicitIds.has(id);
    return Boolean(def.musterGroup && candidate.musterGroup === def.musterGroup);
  };

  const pull = (cards: string[]): void => {
    for (let i = cards.length - 1; i >= 0; i--) {
      const id = cards[i]!;
      if (matches(id)) {
        cards.splice(i, 1);
        const summoned = byId(id);
        const summonedRow = (summoned.rows ?? ['melee'])[0]!;
        placeUnit(s, player, summonedRow, id);
        log(s, `Player ${player + 1} musters ${summoned.name}`);
      }
    }
  };
  pull(p.hand);
  pull(p.deck);
}

function triggerUnitAbilities(
  s: GameState,
  rng: Rng,
  player: PlayerId,
  row: Row,
  def: CardDef,
): void {
  pullMusterCards(s, player, def);

  if (def.abilities.includes('scorch')) {
    if (def.id === 'ne_villentretenmerth') {
      scorchRowIfStrong(s, otherPlayer(player), 'melee', 10);
    } else if (def.id === 'mo_toad') {
      scorchRowIfStrong(s, otherPlayer(player), 'ranged', 10);
    } else if (def.id === 'sc_schirru') {
      scorchRowIfStrong(s, otherPlayer(player), 'siege', 10);
    } else if (def.id === 'sk_clan_dimun_pirate') {
      globalScorch(s);
    } else {
      unitScorch(s, player, row);
    }
  }

  if (def.abilities.includes('mardroeme')) transformBerserkers(s, player, row);
  if (def.abilities.includes('medic')) {
    openMedicChoice(s, rng, player);
  }
}

function isRandomRestoreActive(s: GameState): boolean {
  return ([0, 1] as PlayerId[]).some(
    (pid) =>
      byId(s.players[pid].leaderId).leaderAbility === 'emhyr_invader_of_the_north' &&
      !isLeaderCancelled(s, pid),
  );
}

export function openMedicChoice(s: GameState, rng: Rng, player: PlayerId): void {
  const options = s.players[player].graveyard.filter((id) => {
    const d = byId(id);
    return d.type === 'unit' && !d.hero;
  });
  if (options.length === 0) return;
  if (isRandomRestoreActive(s)) {
    reviveFromGraveyard(s, rng, player, pick(rng, options));
    return;
  }
  s.pendingChoice = { player, kind: 'medic', options: [...new Set(options)], remaining: 1 };
}

function playSpecial(s: GameState, rng: Rng, action: PlayCardAction, def: CardDef): void {
  const player = action.player;
  const p = s.players[player];
  let discardAfterResolution = true;

  switch (def.special) {
    case 'frost':
    case 'fog':
    case 'rain':
    case 'storm':
      applyWeatherCard(s, player, def.id);
      discardAfterResolution = false;
      break;
    case 'clear':
      clearWeather(s);
      break;
    case 'horn': {
      if (!action.row) throw new IllegalActionError('Horn requires a row');
      const rowState = p.rows[action.row];
      const hornUnit = rowState.units.some((u) => byId(u.cardId).abilities.includes('horn'));
      if (rowState.hornActive || rowState.specialCardId || hornUnit) {
        throw new IllegalActionError('Row already has a special effect');
      }
      rowState.hornActive = true;
      rowState.specialCardId = def.id;
      discardAfterResolution = false;
      break;
    }
    case 'scorch':
      globalScorch(s);
      break;
    case 'decoy': {
      const target = action.targetInstanceId;
      if (!target) throw new IllegalActionError('Decoy requires a target unit');
      for (const row of ROWS) {
        const units = p.rows[row].units;
        const idx = units.findIndex((u) => u.instanceId === target);
        if (idx >= 0) {
          const u = units[idx]!;
          const d = byId(u.cardId);
          if (d.hero) throw new IllegalActionError('Cannot decoy a hero');
          units.splice(idx, 1);
          p.hand.push(u.cardId);
          p.graveyard.push(def.id);
          log(s, `Player ${player + 1} decoys ${d.name}`);
          return;
        }
      }
      throw new IllegalActionError('Decoy target not found on your board');
    }
    case 'mardroeme': {
      if (!action.row) throw new IllegalActionError('Mardroeme requires a row');
      const rowState = p.rows[action.row];
      if (rowState.hornActive || rowState.specialCardId) {
        throw new IllegalActionError('Row already has a special effect');
      }
      rowState.specialCardId = def.id;
      discardAfterResolution = false;
      transformBerserkers(s, player, action.row);
      break;
    }
    default:
      throw new IllegalActionError(`Unhandled special: ${def.id}`);
  }
  if (discardAfterResolution) p.graveyard.push(def.id);
  log(s, `Player ${player + 1} plays ${def.name}`);
}

export function transformBerserkers(s: GameState, player: PlayerId, row: Row): void {
  const units = s.players[player].rows[row].units;
  for (const u of units) {
    const d = byId(u.cardId);
    if (d.abilities.includes('berserker') && d.transformsInto) {
      u.cardId = d.transformsInto;
    }
  }
}

// ── choices ──────────────────────────────────────────────────────────

function handleResolveChoice(s: GameState, rng: Rng, player: PlayerId, cardId: string | null): void {
  const pc = s.pendingChoice;
  if (!pc) throw new IllegalActionError('No pending choice');
  if (pc.player !== player) throw new IllegalActionError('Not your choice');

  const validate = (): string => {
    if (cardId === null || !pc.options.includes(cardId)) throw new IllegalActionError('Invalid choice');
    return cardId;
  };
  const finish = (): void => {
    if (!s.pendingChoice) afterMove(s, player, rng);
  };

  switch (pc.kind) {
    case 'first_player': {
      if (s.phase !== 'play') throw new IllegalActionError('Finish redraws before choosing the first player');
      const chosen = validate();
      if (chosen !== '0' && chosen !== '1') throw new IllegalActionError('Invalid first player');
      s.turn = Number(chosen) as PlayerId;
      s.pendingChoice = null;
      log(s, `Player ${Number(chosen) + 1} will go first`);
      return;
    }
    case 'medic':
      s.pendingChoice = null;
      if (cardId !== null) reviveFromGraveyard(s, rng, player, validate());
      finish();
      return;
    case 'leader_opponent_graveyard': {
      s.pendingChoice = null;
      const id = validate();
      const graveyard = s.players[otherPlayer(player)].graveyard;
      const index = graveyard.indexOf(id);
      if (index < 0) throw new IllegalActionError('Card no longer in graveyard');
      graveyard.splice(index, 1);
      s.players[player].hand.push(id);
      finish();
      return;
    }
    case 'leader_own_graveyard': {
      s.pendingChoice = null;
      const id = validate();
      const graveyard = s.players[player].graveyard;
      const index = graveyard.indexOf(id);
      if (index < 0) throw new IllegalActionError('Card no longer in graveyard');
      graveyard.splice(index, 1);
      s.players[player].hand.push(id);
      finish();
      return;
    }
    case 'leader_weather': {
      s.pendingChoice = null;
      const id = validate();
      const deck = s.players[player].deck;
      const index = deck.indexOf(id);
      if (index < 0) throw new IllegalActionError('Card no longer in deck');
      deck.splice(index, 1);
      applyWeatherCard(s, player, id);
      finish();
      return;
    }
    case 'leader_discard': {
      const id = validate();
      const p = s.players[player];
      const index = p.hand.indexOf(id);
      if (index < 0) throw new IllegalActionError('Card no longer in hand');
      p.hand.splice(index, 1);
      p.graveyard.push(id);
      if (pc.remaining > 1 && p.hand.length) {
        s.pendingChoice = { ...pc, options: [...new Set(p.hand)], remaining: pc.remaining - 1 };
      } else if (p.deck.length) {
        s.pendingChoice = {
          player,
          kind: 'leader_draw',
          options: [...new Set(p.deck)],
          remaining: 1,
        };
      } else {
        s.pendingChoice = null;
      }
      finish();
      return;
    }
    case 'leader_draw': {
      s.pendingChoice = null;
      const id = validate();
      const p = s.players[player];
      const index = p.deck.indexOf(id);
      if (index < 0) throw new IllegalActionError('Card no longer in deck');
      p.deck.splice(index, 1);
      p.hand.push(id);
      finish();
      return;
    }
    case 'leader_peek':
      if (cardId !== null) throw new IllegalActionError('Close the preview to continue');
      s.pendingChoice = null;
      finish();
      return;
    default:
      throw new IllegalActionError(`Unhandled choice kind: ${pc.kind}`);
  }
}

function reviveFromGraveyard(s: GameState, rng: Rng, player: PlayerId, cardId: string): CardDef {
  const p = s.players[player];
  const gi = p.graveyard.indexOf(cardId);
  if (gi < 0) throw new IllegalActionError('Card no longer in graveyard');
  p.graveyard.splice(gi, 1);
  const def = byId(cardId);
  if (def.abilities.includes('spy')) {
    const row = (def.rows ?? ['melee'])[0]!;
    placeUnit(s, otherPlayer(player), row, def.id);
    for (let i = 0; i < 2 && p.deck.length; i++) p.hand.push(p.deck.pop()!);
  } else {
    const row = (def.rows ?? ['melee'])[0]!;
    placeUnit(s, player, row, def.id);
    triggerUnitAbilities(s, rng, player, row, def);
  }
  log(s, `Player ${player + 1} revives ${def.name}`);
  return def;
}

// ── turn / round flow ────────────────────────────────────────────────

/** After a player's move (incl. resolving into no pending choice), advance turn or end round. */
function afterMove(s: GameState, mover: PlayerId, rng: Rng): void {
  if (s.pendingChoice) return; // wait for resolution; turn does not advance yet

  const [a, b] = s.players;
  if (a.passed && b.passed) {
    endRound(s, rng);
    return;
  }
  const opp = otherPlayer(mover);
  if (!s.players[opp].passed) {
    s.turn = opp;
  } else {
    s.turn = mover; // opponent passed: mover keeps playing
  }
  // If current player has no cards and hasn't passed, auto-pass
  const cur = s.players[s.turn];
  if (!cur.passed && cur.hand.length === 0 && !canUseLeader(s, s.turn)) {
    cur.passed = true;
    log(s, `Player ${s.turn + 1} is out of cards and passes`);
    if (s.players[0].passed && s.players[1].passed) endRound(s, rng);
    else s.turn = otherPlayer(s.turn);
  }
}

export function canUseLeader(s: GameState, player: PlayerId): boolean {
  const p = s.players[player];
  if (p.leaderUsed || isLeaderCancelled(s, player)) return false;
  const leader = byId(p.leaderId);
  if (isPassiveLeader(leader)) return false;
  if (leader.leaderAbility === 'eredin_destroyer_of_worlds' && p.hand.length < 2) return false;
  return true;
}

function endRound(s: GameState, rng: Rng): void {
  const [sa, sb] = scores(s);
  let winner: PlayerId | null;
  if (sa > sb) winner = 0;
  else if (sb > sa) winner = 1;
  else {
    // Nilfgaard wins ties (if exactly one side is Nilfgaard)
    const nf0 = s.players[0].faction === 'nilfgaard';
    const nf1 = s.players[1].faction === 'nilfgaard';
    winner = nf0 && !nf1 ? 0 : nf1 && !nf0 ? 1 : null;
  }
  s.roundHistory.push({ scores: [sa, sb], winner });
  log(s, `Round ${s.round} ends ${sa}-${sb}` + (winner === null ? ' (draw)' : `, player ${winner + 1} wins it`));

  if (winner === null) {
    s.players[0].gems--;
    s.players[1].gems--;
  } else {
    s.players[otherPlayer(winner)].gems--;
  }

  // Faction round-end passives before clearing the board
  applyRoundEndPassives(s, rng, winner);

  // Clear board into graveyards, reset weather/horns/pass
  for (const pid of [0, 1] as PlayerId[]) {
    const p = s.players[pid];
    for (const row of ROWS) {
      const rs = p.rows[row];
      for (const u of rs.units) {
        const d = byId(u.cardId);
        if (u.kept) continue;
        p.graveyard.push(u.cardId);
        queueSummonAvenger(s, pid, u.cardId);
      }
      rs.units = rs.units.filter((u) => u.kept);
      for (const u of rs.units) delete u.kept;
      if (rs.specialCardId) p.graveyard.push(rs.specialCardId);
      rs.hornActive = false;
      delete rs.specialCardId;
    }
    p.passed = false;
  }
  clearWeather(s);
  // Game over?
  if (s.players[0].gems <= 0 || s.players[1].gems <= 0) {
    s.phase = 'finished';
    const g0 = s.players[0].gems;
    const g1 = s.players[1].gems;
    if (g0 <= 0 && g1 <= 0) {
      s.winner = null;
      s.drawn = true;
      log(s, 'The game ends in a draw');
    } else {
      s.winner = g0 <= 0 ? 1 : 0;
      log(s, `Player ${s.winner + 1} wins the game`);
    }
    return;
  }

  s.round++;
  applyStartRoundPassives(s, rng);
  // The previous round winner leads; a draw keeps the existing turn holder.
  s.turn = winner !== null ? winner : s.turn;
  log(s, `Round ${s.round} begins`);
}

function applyRoundEndPassives(s: GameState, rng: Rng, winner: PlayerId | null): void {
  for (const pid of [0, 1] as PlayerId[]) {
    const p = s.players[pid];
    // Northern Realms: draw a card when you win a round
    if (p.faction === 'northern_realms' && winner === pid && p.deck.length) {
      p.hand.push(p.deck.pop()!);
      log(s, `Player ${pid + 1} draws a card (Northern Realms)`);
    }
    // Monsters: keep one random unit on the board
    if (p.faction === 'monsters') {
      const all: Array<{ row: Row; u: PlacedCard }> = [];
      for (const row of ROWS) {
        for (const u of p.rows[row].units) {
          if (!byId(u.cardId).abilities.includes('spy')) all.push({ row, u });
        }
      }
      if (all.length) {
        const keep = pick(rng, all);
        keep.u.kept = true;
        log(s, `Player ${pid + 1} keeps ${byId(keep.u.cardId).name} (Monsters)`);
      }
    }
  }
}

function applyStartRoundPassives(s: GameState, rng: Rng): void {
  for (const pid of [0, 1] as PlayerId[]) {
    const p = s.players[pid];
    while (p.summonQueue.length) {
      const id = p.summonQueue.shift()!;
      const d = byId(id);
      const row = (d.rows ?? ['melee'])[0]!;
      placeUnit(s, pid, row, id);
      log(s, `Player ${pid + 1} summons ${d.name}`);
    }
  }

  if (s.round === 3) {
    for (const pid of [0, 1] as PlayerId[]) {
      const p = s.players[pid];
      if (p.faction !== 'skellige') continue;
      for (let i = 0; i < 2; i++) {
        const opts = p.graveyard.filter((id) => {
          const d = byId(id);
          return d.type === 'unit' && !d.hero;
        });
        if (!opts.length) break;
        const id = pick(rng, opts);
        reviveFromGraveyard(s, rng, pid, id);
        log(s, `Player ${pid + 1} returns ${byId(id).name} (Skellige)`);
      }
    }
  }
}
