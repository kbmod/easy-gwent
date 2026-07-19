import { byId, type LeaderAbilityId, type Row, type SpecialKind } from '@gwent/data';
import type { GameState, PlacedCard, PlayerId } from './../state.ts';
import { otherPlayer } from './../state.ts';
import { boardScore } from './../scoring.ts';
import { pick, shuffle, type Rng } from './../rng.ts';
import { scorchRowIfStrong } from './scorch.ts';

const WEATHER_KINDS: SpecialKind[] = ['frost', 'fog', 'rain', 'storm', 'clear'];

function unique(ids: string[]): string[] {
  return [...new Set(ids)];
}

function rowHasHorn(s: GameState, player: PlayerId, row: Row): boolean {
  const rs = s.players[player].rows[row];
  return rs.hornActive || rs.units.some((u) => byId(u.cardId).abilities.includes('horn'));
}

function hornRow(s: GameState, player: PlayerId, row: Row): void {
  const rs = s.players[player].rows[row];
  if (!rowHasHorn(s, player, row) && !rs.specialCardId) rs.hornActive = true;
}

export function applyWeatherCard(s: GameState, player: PlayerId, cardId: string): void {
  const def = byId(cardId);
  switch (def.special) {
    case 'frost':
    case 'fog':
    case 'rain':
      s.weather[def.special] = true;
      break;
    case 'storm':
      s.weather.fog = true;
      s.weather.rain = true;
      break;
    case 'clear':
      clearWeather(s);
      s.players[player].graveyard.push(cardId);
      return;
    default:
      throw new Error(`${def.name} is not a weather card`);
  }
  s.activeWeather.push({ player, cardId });
}

export function clearWeather(s: GameState): void {
  for (const active of s.activeWeather) {
    s.players[active.player].graveyard.push(active.cardId);
  }
  s.activeWeather = [];
  s.weather = { frost: false, fog: false, rain: false };
}

function weatherFromDeck(s: GameState, player: PlayerId, kind: SpecialKind): void {
  const p = s.players[player];
  const idx = p.deck.findIndex((id) => byId(id).special === kind);
  if (idx < 0) return;
  const [id] = p.deck.splice(idx, 1);
  applyWeatherCard(s, player, id!);
}

function peekAtOpponentHand(s: GameState, rng: Rng, player: PlayerId): void {
  const pool = [...s.players[otherPlayer(player)].hand];
  const seen: string[] = [];
  while (pool.length && seen.length < 3) {
    const id = pick(rng, pool);
    pool.splice(pool.indexOf(id), 1);
    seen.push(id);
  }
  if (seen.length) s.pendingChoice = { player, kind: 'leader_peek', options: seen, remaining: 0 };
}

/** Move agile units to the legal melee/ranged assignment with the highest total score. */
export function optimizeAgileRows(s: GameState, player: PlayerId): void {
  const melee = s.players[player].rows.melee;
  const ranged = s.players[player].rows.ranged;
  const agile: Array<{ card: PlacedCard; original: Row }> = [];
  const fixedMelee = melee.units.filter((u) => {
    if (byId(u.cardId).rows?.length === 2) {
      agile.push({ card: u, original: 'melee' });
      return false;
    }
    return true;
  });
  const fixedRanged = ranged.units.filter((u) => {
    if (byId(u.cardId).rows?.length === 2) {
      agile.push({ card: u, original: 'ranged' });
      return false;
    }
    return true;
  });
  if (!agile.length) return;

  let bestMask = 0;
  let bestScore = -Infinity;
  let bestMoves = Infinity;
  const assignments = 2 ** agile.length;
  for (let mask = 0; mask < assignments; mask++) {
    melee.units = [...fixedMelee];
    ranged.units = [...fixedRanged];
    let moves = 0;
    agile.forEach(({ card, original }, i) => {
      const row: Row = mask & (1 << i) ? 'ranged' : 'melee';
      s.players[player].rows[row].units.push(card);
      if (row !== original) moves++;
    });
    const score = boardScore(s, player);
    if (score > bestScore || (score === bestScore && moves < bestMoves)) {
      bestScore = score;
      bestMoves = moves;
      bestMask = mask;
    }
  }

  melee.units = [...fixedMelee];
  ranged.units = [...fixedRanged];
  agile.forEach(({ card }, i) => {
    const row: Row = bestMask & (1 << i) ? 'ranged' : 'melee';
    s.players[player].rows[row].units.push(card);
  });
}

/** Active leader effects. Passive leaders are handled at their rule hook. */
export function applyLeader(s: GameState, rng: Rng, player: PlayerId, ability: LeaderAbilityId): void {
  const p = s.players[player];
  const opp = otherPlayer(player);
  switch (ability) {
    case 'foltest_lord_commander':
      clearWeather(s);
      break;
    case 'foltest_steel_forged':
      scorchRowIfStrong(s, opp, 'siege', 10);
      break;
    case 'foltest_siegemaster':
      hornRow(s, player, 'siege');
      break;
    case 'foltest_kingdom_of_temeria':
      weatherFromDeck(s, player, 'fog');
      break;
    case 'foltest_son_of_medell':
      scorchRowIfStrong(s, opp, 'ranged', 10);
      break;

    case 'emhyr_imperial_majesty':
      weatherFromDeck(s, player, 'rain');
      break;
    case 'emhyr_emperor_of_nilfgaard':
      peekAtOpponentHand(s, rng, player);
      break;
    case 'emhyr_his_imperial_majesty': {
      const options = unique(s.players[opp].graveyard);
      if (options.length) {
        s.pendingChoice = { player, kind: 'leader_opponent_graveyard', options, remaining: 1 };
      }
      break;
    }

    case 'francesca_pureblood_elf':
      weatherFromDeck(s, player, 'frost');
      break;
    case 'francesca_queen_of_dol_blathanna':
      scorchRowIfStrong(s, opp, 'melee', 10);
      break;
    case 'francesca_beautiful':
      hornRow(s, player, 'ranged');
      break;
    case 'francesca_hope_of_the_aen_seidhe':
      optimizeAgileRows(s, player);
      break;

    case 'eredin_commander_of_red_riders':
      hornRow(s, player, 'melee');
      break;
    case 'eredin_king_of_the_wild_hunt': {
      const options = unique(p.deck.filter((id) => WEATHER_KINDS.includes(byId(id).special!)));
      if (options.length) s.pendingChoice = { player, kind: 'leader_weather', options, remaining: 1 };
      break;
    }
    case 'eredin_bringer_of_death': {
      const options = unique(p.graveyard);
      if (options.length) s.pendingChoice = { player, kind: 'leader_own_graveyard', options, remaining: 1 };
      break;
    }
    case 'eredin_destroyer_of_worlds':
      if (p.hand.length >= 2) {
        s.pendingChoice = { player, kind: 'leader_discard', options: unique(p.hand), remaining: 2 };
      }
      break;

    case 'crach_an_craite':
      for (const pid of [0, 1] as PlayerId[]) {
        const pl = s.players[pid];
        pl.deck.push(...pl.graveyard);
        pl.graveyard = [];
        shuffle(rng, pl.deck);
      }
      break;
    default:
      throw new Error(`Leader ability not implemented or passive: ${ability}`);
  }
}
