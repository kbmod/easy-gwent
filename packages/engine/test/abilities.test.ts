import { describe, it, expect } from 'vitest';
import { byId, LEADER_CARDS } from '@gwent/data';
import {
  createGame,
  applyAction,
  effectiveStrength,
  boardScore,
  type GameState,
  type PlayerId,
} from '@gwent/engine';
import { testDeck } from './helpers.ts';

function bareGame(f0 = 'northern_realms', f1 = 'nilfgaard'): GameState {
  let s = createGame(5, [testDeck(f0 as never), testDeck(f1 as never)]);
  s = applyAction(s, { type: 'REDRAW', player: 0, handIndex: null });
  s = applyAction(s, { type: 'REDRAW', player: 1, handIndex: null });
  if (s.pendingChoice?.kind === 'first_player') {
    const chooser = s.pendingChoice.player;
    s = applyAction(s, { type: 'RESOLVE_CHOICE', player: chooser, cardId: String(chooser) });
  }
  return s;
}

function place(s: GameState, player: PlayerId, cardId: string, row: 'melee' | 'ranged' | 'siege') {
  const placed = { instanceId: `x${cardId}${s.players[player].rows[row].units.length}`, cardId };
  s.players[player].rows[row].units.push(placed);
  return placed;
}

function removeCards(s: GameState, player: PlayerId, ids: string[]): void {
  const remove = new Set(ids);
  s.players[player].hand = s.players[player].hand.filter((id) => !remove.has(id));
  s.players[player].deck = s.players[player].deck.filter((id) => !remove.has(id));
  s.players[player].graveyard = s.players[player].graveyard.filter((id) => !remove.has(id));
}

/** Force a card into hand at index 0 and play it. */
function playFromHand(s: GameState, player: PlayerId, cardId: string, row?: 'melee' | 'ranged' | 'siege', targetInstanceId?: string) {
  s.turn = player;
  s.players[player].hand.unshift(cardId);
  return applyAction(s, { type: 'PLAY_CARD', player, handIndex: 0, row, targetInstanceId });
}

describe('spy', () => {
  it('goes to opponent side and draws 2', () => {
    let s = bareGame();
    const deckBefore = s.players[0].deck.length;
    const handBefore = s.players[0].hand.length;
    s = playFromHand(s, 0, 'nr_thaler');
    expect(s.players[1].rows.siege.units.some((u) => u.cardId === 'nr_thaler')).toBe(true);
    expect(s.players[0].rows.siege.units.length).toBe(0);
    expect(s.players[0].hand.length).toBe(handBefore + 2); // +1 spy added, -1 played, +2 drawn
    expect(s.players[0].deck.length).toBe(deckBefore - 2);
  });

  it("enters the battlefield owner's discard pile after the round", () => {
    let s = bareGame();
    place(s, 0, 'nf_stefan_skellen', 'melee');
    s.turn = 0;
    s = applyAction(s, { type: 'PASS', player: 0 });
    s = applyAction(s, { type: 'PASS', player: 1 });
    expect(s.players[0].graveyard).toContain('nf_stefan_skellen');
    expect(s.players[1].graveyard).not.toContain('nf_stefan_skellen');
  });

  it("can be replayed from the battlefield owner's discard pile by Medic", () => {
    let s = bareGame();
    s.players[0].graveyard.push('nf_vattier');
    const deckBefore = s.players[0].deck.length;
    s = playFromHand(s, 0, 'nr_dun_banner_medic');
    s = applyAction(s, { type: 'RESOLVE_CHOICE', player: 0, cardId: 'nf_vattier' });
    expect(s.players[1].rows.melee.units.some((u) => u.cardId === 'nf_vattier')).toBe(true);
    expect(s.players[0].deck.length).toBe(deckBefore - 2);
  });
});

describe('muster', () => {
  it('pulls the whole group from hand and deck', () => {
    let s = bareGame('monsters', 'nilfgaard');
    s.players[0].deck.push('mo_arachas', 'mo_arachas');
    s = playFromHand(s, 0, 'mo_arachas');
    const onBoard = s.players[0].rows.melee.units.filter((u) => byId(u.cardId).musterGroup === byId('mo_arachas').musterGroup);
    expect(onBoard.length).toBeGreaterThanOrEqual(3);
    expect(s.players[0].deck.filter((id) => byId(id).musterGroup === byId('mo_arachas').musterGroup)).toEqual([]);
  });
});

describe('medic', () => {
  it('opens a choice from graveyard, resolving places the unit', () => {
    let s = bareGame();
    s.players[0].graveyard.push('nr_ves');
    s = playFromHand(s, 0, 'nr_dun_banner_medic');
    expect(s.pendingChoice?.kind).toBe('medic');
    const target = s.pendingChoice!.options[0]!;
    s = applyAction(s, { type: 'RESOLVE_CHOICE', player: 0, cardId: target });
    expect(s.players[0].graveyard).not.toContain('nr_ves');
    expect(s.players[0].rows.melee.units.some((u) => u.cardId === 'nr_ves')).toBe(true);
    expect(s.turn).toBe(1);
  });

  it('with empty graveyard just places the medic', () => {
    let s = bareGame();
    s.players[0].graveyard = [];
    s = playFromHand(s, 0, 'nr_dun_banner_medic');
    expect(s.pendingChoice).toBeNull();
  });
});

describe('decoy', () => {
  it('returns a non-hero unit to hand and remains on its row until round end', () => {
    let s = bareGame();
    const placed = place(s, 0, 'nr_ves', 'melee');
    s = playFromHand(s, 0, 'ne_decoy', undefined, placed.instanceId);
    expect(s.players[0].hand).toContain('nr_ves');
    expect(s.players[0].rows.melee.units).toEqual([]);
    expect(s.players[0].rows.melee.decoys.map((card) => card.cardId)).toEqual(['ne_decoy']);
    expect(boardScore(s, 0)).toBe(0);
    expect(s.players[0].graveyard).not.toContain('ne_decoy');

    s = applyAction(s, { type: 'PASS', player: 1 });
    s = applyAction(s, { type: 'PASS', player: 0 });
    expect(s.players[0].rows.melee.decoys).toEqual([]);
    expect(s.players[0].graveyard).toContain('ne_decoy');
  });
});

describe('scorch', () => {
  it('kills all strongest non-hero units on the board', () => {
    let s = bareGame();
    place(s, 0, 'nr_ves', 'melee'); // 5
    place(s, 1, 'nf_black_archer', 'ranged'); // 10
    place(s, 1, 'nf_impera_brigade', 'melee'); // 3
    s = playFromHand(s, 0, 'ne_scorch');
    expect(s.players[1].rows.ranged.units.length).toBe(0);
    expect(s.players[1].graveyard).toContain('nf_black_archer');
    expect(s.players[0].rows.melee.units.length).toBe(1); // Ves survives
  });

  it('never kills heroes', () => {
    let s = bareGame();
    place(s, 1, 'nf_letho', 'melee'); // hero 10
    place(s, 1, 'nf_impera_brigade', 'melee'); // 3
    s = playFromHand(s, 0, 'ne_scorch');
    expect(s.players[1].rows.melee.units.some((u) => u.cardId === 'nf_letho')).toBe(true);
    expect(s.players[1].rows.melee.units.some((u) => u.cardId === 'nf_impera_brigade')).toBe(false);
  });
});

describe('weather specials', () => {
  it('records a Horn play for client transitions', () => {
    let s = bareGame();
    s = playFromHand(s, 0, 'ne_horn', 'siege');

    expect(s.lastPlayedCard).toMatchObject({ player: 0, cardId: 'ne_horn', row: 'siege' });
  });

  it('storm sets fog+rain, clear wipes all', () => {
    let s = bareGame();
    s = playFromHand(s, 0, 'ne_storm');
    expect(s.weather.fog && s.weather.rain).toBe(true);
    expect(s.players[0].graveyard).not.toContain('ne_storm');
    expect(s.activeWeather).toContainEqual({ player: 0, cardId: 'ne_storm' });
    s = playFromHand(s, 1, 'ne_clear');
    expect(s.weather).toEqual({ frost: false, fog: false, rain: false });
    expect(s.players[0].graveyard).toContain('ne_storm');
    expect(s.players[1].graveyard).toContain('ne_clear');
    expect(s.activeWeather).toEqual([]);
  });

  it('Mardroeme occupies the row special slot until round cleanup', () => {
    let s = bareGame('skellige', 'nilfgaard');
    place(s, 0, 'sk_berserker', 'melee');
    s = playFromHand(s, 0, 'sk_mardroeme', 'melee');
    expect(s.players[0].rows.melee.specialCardId).toBe('sk_mardroeme');
    expect(s.players[0].graveyard).not.toContain('sk_mardroeme');
    expect(s.players[0].rows.melee.units.some((u) => u.cardId === 'sk_vildkaarl')).toBe(true);

    s.turn = 0;
    s = applyAction(s, { type: 'PASS', player: 0 });
    s = applyAction(s, { type: 'PASS', player: 1 });
    expect(s.players[0].graveyard).toContain('sk_mardroeme');
    expect(s.players[0].rows.melee.specialCardId).toBeUndefined();
  });
});

describe('faction passives', () => {
  it('Northern Realms draws an extra card on round win', () => {
    let s = bareGame('northern_realms', 'nilfgaard');
    place(s, 0, 'nr_ves', 'melee');
    const deckBefore = s.players[0].deck.length;
    s.turn = 0;
    s = applyAction(s, { type: 'PASS', player: 0 });
    s = applyAction(s, { type: 'PASS', player: 1 });
    expect(s.players[0].deck.length).toBe(deckBefore - 1); // drew 1
    expect(s.players[1].gems).toBe(1);
  });

  it('Nilfgaard wins ties', () => {
    let s = bareGame('northern_realms', 'nilfgaard');
    s.turn = 0;
    s = applyAction(s, { type: 'PASS', player: 0 });
    s = applyAction(s, { type: 'PASS', player: 1 });
    // 0-0 tie → nilfgaard (player 1) wins the round
    expect(s.players[0].gems).toBe(1);
    expect(s.players[1].gems).toBe(2);
  });

  it('Monsters keeps one random unit between rounds', () => {
    let s = bareGame('monsters', 'nilfgaard');
    place(s, 0, 'mo_ghoul', 'melee');
    place(s, 0, 'mo_wyvern', 'ranged');
    s.turn = 0;
    s = applyAction(s, { type: 'PASS', player: 0 });
    s = applyAction(s, { type: 'PASS', player: 1 });
    const kept =
      s.players[0].rows.melee.units.length +
      s.players[0].rows.ranged.units.length +
      s.players[0].rows.siege.units.length;
    expect(kept).toBe(1);
  });

  it('Skellige revives 2 random units at the start of round 3', () => {
    let s = bareGame('skellige', 'nilfgaard');
    s.players[0].graveyard.push('sk_an_craite_warrior', 'sk_war_longship', 'sk_berserker');
    place(s, 0, 'sk_hjalmar', 'ranged');

    s.turn = 0;
    s = applyAction(s, { type: 'PASS', player: 0 });
    s = applyAction(s, { type: 'PASS', player: 1 });
    place(s, 1, 'nf_menno', 'melee');
    s.turn = 0;
    s = applyAction(s, { type: 'PASS', player: 0 });
    s = applyAction(s, { type: 'PASS', player: 1 });

    expect(s.phase).toBe('play');
    expect(s.round).toBe(3);
    const onBoard =
      s.players[0].rows.melee.units.length +
      s.players[0].rows.ranged.units.length +
      s.players[0].rows.siege.units.length;
    expect(onBoard).toBe(2);
    expect(s.players[0].graveyard.filter((id) => id === 'sk_an_craite_warrior' || id === 'sk_war_longship' || id === 'sk_berserker').length).toBe(1);
  });

  it('Summon Avenger queues the replacement for the next round', () => {
    let s = bareGame('skellige', 'nilfgaard');
    place(s, 0, 'sk_kambi', 'melee');
    place(s, 1, 'nf_letho', 'melee');
    s.turn = 0;
    s = applyAction(s, { type: 'PASS', player: 0 });
    s = applyAction(s, { type: 'PASS', player: 1 });
    expect(s.players[0].graveyard).toContain('sk_kambi');
    expect(s.players[0].rows.melee.units.some((u) => u.cardId === 'sk_hemdall')).toBe(true);
    expect(s.players[0].summonQueue).toEqual([]);
  });
});

describe('passive leaders', () => {
  it('Eredin Treacherous doubles spies on your side', () => {
    const s = bareGame('monsters', 'nilfgaard');
    s.players[0].leaderId = LEADER_CARDS.find((l) => l.leaderAbility === 'eredin_treacherous')!.id;
    const spy = place(s, 0, 'nf_stefan_skellen', 'melee'); // opponent's spy sits on our side, 9
    const base = byId('nf_stefan_skellen').strength!;
    expect(effectiveStrength(s, 0, 'melee', spy)).toBe(base * 2);
  });

  it('Bran halves weather damage instead of setting to 1', () => {
    const s = bareGame('skellige', 'nilfgaard');
    s.players[0].leaderId = LEADER_CARDS.find((l) => l.leaderAbility === 'bran_tuirseach')!.id;
    const u = place(s, 0, 'sk_an_craite_warrior', 'melee'); // 6
    s.weather.frost = true;
    expect(effectiveStrength(s, 0, 'melee', u)).toBe(3);
    expect(boardScore(s, 0)).toBe(3);
  });

  it('White Flame cancels the opponent leader', () => {
    let s = bareGame('northern_realms', 'nilfgaard');
    s.players[1].leaderId = LEADER_CARDS.find((l) => l.leaderAbility === 'emhyr_the_white_flame')!.id;
    s.turn = 0;
    expect(() => applyAction(s, { type: 'PLAY_LEADER', player: 0 })).toThrow();
  });

  it('White Flame cancels opposing passive leaders', () => {
    const s = bareGame('skellige', 'nilfgaard');
    s.players[0].leaderId = LEADER_CARDS.find((l) => l.leaderAbility === 'bran_tuirseach')!.id;
    s.players[1].leaderId = LEADER_CARDS.find((l) => l.leaderAbility === 'emhyr_the_white_flame')!.id;
    const unit = place(s, 0, 'sk_an_craite_warrior', 'melee');
    const spy = place(s, 0, 'nf_stefan_skellen', 'melee');
    s.weather.frost = true;
    expect(effectiveStrength(s, 0, 'melee', unit)).toBe(1);

    s.players[0].leaderId = LEADER_CARDS.find((l) => l.leaderAbility === 'eredin_treacherous')!.id;
    expect(effectiveStrength(s, 0, 'melee', spy)).toBe(1);
  });

  it('Daisy of the Valley grants an extra starting card', () => {
    const normalDeck = testDeck('scoiatael');
    normalDeck.leaderId = LEADER_CARDS.find((l) => l.leaderAbility === 'francesca_pureblood_elf')!.id;
    const normal = createGame(9, [normalDeck, testDeck('nilfgaard')]);
    const daisyDeck = testDeck('scoiatael');
    daisyDeck.leaderId = LEADER_CARDS.find((l) => l.leaderAbility === 'francesca_daisy_of_the_valley')!.id;
    const daisy = createGame(9, [daisyDeck, testDeck('nilfgaard')]);
    expect(normal.players[0].hand.length).toBe(10);
    expect(daisy.players[0].hand.length).toBe(11);
  });

  it('White Flame cancels Daisy before the extra starting card is drawn', () => {
    const daisyDeck = testDeck('scoiatael');
    daisyDeck.leaderId = LEADER_CARDS.find((l) => l.leaderAbility === 'francesca_daisy_of_the_valley')!.id;
    const whiteFlameDeck = testDeck('nilfgaard');
    whiteFlameDeck.leaderId = LEADER_CARDS.find((l) => l.leaderAbility === 'emhyr_the_white_flame')!.id;
    const s = createGame(9, [daisyDeck, whiteFlameDeck]);
    expect(s.players[0].hand).toHaveLength(10);
  });
});

describe('active leaders', () => {
  it('Foltest Siegemaster horns siege and is one-shot', () => {
    let s = bareGame('northern_realms', 'nilfgaard');
    s.players[0].leaderId = LEADER_CARDS.find((l) => l.leaderAbility === 'foltest_siegemaster')!.id;
    s.turn = 0;
    s = applyAction(s, { type: 'PLAY_LEADER', player: 0 });
    expect(s.players[0].rows.siege.hornActive).toBe(true);
    expect(s.players[0].leaderUsed).toBe(true);
    s.turn = 0;
    expect(() => applyAction(s, { type: 'PLAY_LEADER', player: 0 })).toThrow();
  });

  it('Foltest Steel-Forged scorches enemy siege when the row is 10+', () => {
    let s = bareGame('northern_realms', 'nilfgaard');
    s.players[0].leaderId = LEADER_CARDS.find((l) => l.leaderAbility === 'foltest_steel_forged')!.id;
    place(s, 1, 'nf_heavy_fire_scorpion', 'siege');
    place(s, 1, 'nf_rotten_mangonel', 'siege');
    s.turn = 0;
    s = applyAction(s, { type: 'PLAY_LEADER', player: 0 });
    expect(s.players[1].rows.siege.units.some((u) => u.cardId === 'nf_heavy_fire_scorpion')).toBe(false);
    expect(s.players[1].graveyard).toContain('nf_heavy_fire_scorpion');
  });

  it('Crach shuffles all graveyard cards back into decks', () => {
    let s = bareGame('skellige', 'nilfgaard');
    s.players[0].leaderId = LEADER_CARDS.find((l) => l.leaderAbility === 'crach_an_craite')!.id;
    s.players[0].graveyard.push('ne_scorch', 'sk_an_craite_warrior');
    s.players[1].graveyard.push('ne_frost', 'nf_albrich');
    s.turn = 0;
    s = applyAction(s, { type: 'PLAY_LEADER', player: 0 });
    expect(s.players[0].graveyard).toEqual([]);
    expect(s.players[1].graveyard).toEqual([]);
    expect(s.players[0].deck).toEqual(expect.arrayContaining(['ne_scorch', 'sk_an_craite_warrior']));
    expect(s.players[1].deck).toEqual(expect.arrayContaining(['ne_frost', 'nf_albrich']));
  });

  it('deck-weather leaders consume and play the matching weather card', () => {
    let s = bareGame('northern_realms', 'nilfgaard');
    s.players[0].leaderId = LEADER_CARDS.find((l) => l.leaderAbility === 'foltest_kingdom_of_temeria')!.id;
    removeCards(s, 0, ['ne_fog']);
    s.players[0].deck.push('ne_fog');
    s.turn = 0;
    s = applyAction(s, { type: 'PLAY_LEADER', player: 0 });
    expect(s.weather.fog).toBe(true);
    expect(s.players[0].deck).not.toContain('ne_fog');
    expect(s.activeWeather).toContainEqual({ player: 0, cardId: 'ne_fog' });
  });

  it('King of the Wild Hunt lets the player choose a weather card from deck', () => {
    let s = bareGame('monsters', 'nilfgaard');
    s.players[0].leaderId = LEADER_CARDS.find((l) => l.leaderAbility === 'eredin_king_of_the_wild_hunt')!.id;
    removeCards(s, 0, ['ne_frost', 'ne_rain']);
    s.players[0].deck.push('ne_frost', 'ne_rain');
    s.turn = 0;
    s = applyAction(s, { type: 'PLAY_LEADER', player: 0 });
    expect(s.pendingChoice).toMatchObject({ kind: 'leader_weather', options: expect.arrayContaining(['ne_frost', 'ne_rain']) });
    s = applyAction(s, { type: 'RESOLVE_CHOICE', player: 0, cardId: 'ne_rain' });
    expect(s.weather.rain).toBe(true);
    expect(s.turn).toBe(1);
  });

  it('graveyard leaders move the selected card into hand', () => {
    let s = bareGame('nilfgaard', 'monsters');
    s.players[0].leaderId = LEADER_CARDS.find((l) => l.leaderAbility === 'emhyr_his_imperial_majesty')!.id;
    s.players[1].graveyard.push('mo_fiend');
    s.turn = 0;
    s = applyAction(s, { type: 'PLAY_LEADER', player: 0 });
    s = applyAction(s, { type: 'RESOLVE_CHOICE', player: 0, cardId: 'mo_fiend' });
    expect(s.players[0].hand).toContain('mo_fiend');
    expect(s.players[1].graveyard).not.toContain('mo_fiend');

    s = bareGame('monsters', 'nilfgaard');
    s.players[0].leaderId = LEADER_CARDS.find((l) => l.leaderAbility === 'eredin_bringer_of_death')!.id;
    s.players[0].graveyard.push('mo_fiend');
    s.turn = 0;
    s = applyAction(s, { type: 'PLAY_LEADER', player: 0 });
    s = applyAction(s, { type: 'RESOLVE_CHOICE', player: 0, cardId: 'mo_fiend' });
    expect(s.players[0].hand).toContain('mo_fiend');
    expect(s.players[0].graveyard).not.toContain('mo_fiend');
  });

  it('Destroyer of Worlds discards two choices, then draws one chosen card', () => {
    let s = bareGame('monsters', 'nilfgaard');
    s.players[0].leaderId = LEADER_CARDS.find((l) => l.leaderAbility === 'eredin_destroyer_of_worlds')!.id;
    s.players[0].hand = ['mo_fiend', 'mo_griffin'];
    s.players[0].deck = ['mo_wyvern', 'mo_foglet'];
    s.turn = 0;
    s = applyAction(s, { type: 'PLAY_LEADER', player: 0 });
    s = applyAction(s, { type: 'RESOLVE_CHOICE', player: 0, cardId: 'mo_fiend' });
    s = applyAction(s, { type: 'RESOLVE_CHOICE', player: 0, cardId: 'mo_griffin' });
    expect(s.pendingChoice?.kind).toBe('leader_draw');
    s = applyAction(s, { type: 'RESOLVE_CHOICE', player: 0, cardId: 'mo_wyvern' });
    expect(s.players[0].graveyard).toEqual(expect.arrayContaining(['mo_fiend', 'mo_griffin']));
    expect(s.players[0].hand).toEqual(['mo_wyvern']);
    expect(s.turn).toBe(1);
  });

  it('Hope of the Aen Seidhe moves agile units to the stronger valid row', () => {
    let s = bareGame('scoiatael', 'nilfgaard');
    s.players[0].leaderId = LEADER_CARDS.find((l) => l.leaderAbility === 'francesca_hope_of_the_aen_seidhe')!.id;
    place(s, 0, 'sc_filavandrel', 'melee');
    place(s, 0, 'sc_yaevinn', 'melee');
    s.weather.frost = true;
    s.turn = 0;
    s = applyAction(s, { type: 'PLAY_LEADER', player: 0 });
    expect(s.players[0].rows.melee.units).toEqual([]);
    expect(s.players[0].rows.ranged.units).toHaveLength(2);
  });

  it('Emperor of Nilfgaard exposes only a private three-card preview', () => {
    let s = bareGame('nilfgaard', 'monsters');
    s.players[0].leaderId = LEADER_CARDS.find((l) => l.leaderAbility === 'emhyr_emperor_of_nilfgaard')!.id;
    s.turn = 0;
    s = applyAction(s, { type: 'PLAY_LEADER', player: 0 });
    expect(s.pendingChoice).toMatchObject({ player: 0, kind: 'leader_peek' });
    expect(s.pendingChoice?.options).toHaveLength(3);
  });
});

describe('gaunter odimm muster (regression)', () => {
  it('darkness pulls the other copies from deck on play', () => {
    let s = bareGame();
    s.players[0].deck.push('ne_gaunter_darkness', 'ne_gaunter_darkness', 'ne_gaunter_odimm');
    s = playFromHand(s, 0, 'ne_gaunter_darkness');
    const darkness = s.players[0].rows.ranged.units.filter((u) => u.cardId === 'ne_gaunter_darkness');
    expect(darkness.length).toBeGreaterThanOrEqual(3);
    expect(s.players[0].deck.filter((id) => id === 'ne_gaunter_darkness')).toEqual([]);
    expect(s.players[0].deck).toContain('ne_gaunter_odimm');
  });
});

describe('villentretenmerth unit scorch (regression)', () => {
  it('destroys strongest enemy melee unit when enemy melee >= 10', () => {
    let s = bareGame();
    place(s, 1, 'nf_black_archer', 'melee'); // if rows allow; strength 10 total via units below
    place(s, 1, 'nf_impera_brigade', 'melee'); // 3
    place(s, 1, 'nf_impera_brigade', 'melee'); // 3
    place(s, 1, 'nf_impera_brigade', 'melee'); // 3
    place(s, 1, 'nf_impera_brigade', 'melee'); // 3 -> 12+ total
    s = playFromHand(s, 0, 'ne_villentretenmerth', 'melee');
    const before = 5;
    expect(s.players[1].rows.melee.units.length).toBeLessThan(before);
    expect(s.log.some((l) => l.text.includes('scorched'))).toBe(true);
  });

  it('does nothing (with a log entry) when enemy melee < 10', () => {
    let s = bareGame();
    place(s, 1, 'nf_impera_brigade', 'melee'); // 3
    s = playFromHand(s, 0, 'ne_villentretenmerth', 'melee');
    expect(s.players[1].rows.melee.units.length).toBe(1);
  });
});

describe('unit scorch variants', () => {
  it('Schirrú scorches enemy siege, not melee', () => {
    let s = bareGame('scoiatael', 'nilfgaard');
    place(s, 1, 'nf_heavy_fire_scorpion', 'siege');
    place(s, 1, 'nf_impera_brigade', 'melee');
    s = playFromHand(s, 0, 'sc_schirru', 'siege');
    expect(s.players[1].rows.siege.units).toEqual([]);
    expect(s.players[1].rows.melee.units.length).toBe(1);
  });

  it('Clan Dimun Pirate uses global Scorch and survives only when not strongest', () => {
    let s = bareGame('skellige', 'nilfgaard');
    place(s, 0, 'sk_an_craite_warrior', 'melee'); // 6
    place(s, 1, 'nf_heavy_fire_scorpion', 'siege'); // 10
    s = playFromHand(s, 0, 'sk_clan_dimun_pirate', 'ranged');
    expect(s.players[1].rows.siege.units).toEqual([]);
    expect(s.players[0].rows.ranged.units.some((u) => u.cardId === 'sk_clan_dimun_pirate')).toBe(true);
  });

  it('Clan Dimun Pirate can destroy itself', () => {
    let s = bareGame('skellige', 'nilfgaard');
    s = playFromHand(s, 0, 'sk_clan_dimun_pirate', 'ranged');
    expect(s.players[0].rows.ranged.units.some((u) => u.cardId === 'sk_clan_dimun_pirate')).toBe(false);
    expect(s.players[0].graveyard).toContain('sk_clan_dimun_pirate');
  });

  it('Toad scorches the enemy ranged row', () => {
    let s = bareGame('monsters', 'nilfgaard');
    place(s, 1, 'nf_black_archer', 'ranged');
    place(s, 1, 'nf_impera_brigade', 'melee');
    s = playFromHand(s, 0, 'mo_toad', 'ranged');
    expect(s.players[1].rows.ranged.units).toEqual([]);
    expect(s.players[1].rows.melee.units).toHaveLength(1);
  });
});

describe('directional muster', () => {
  it('Arachas Behemoth summons Arachas, but Arachas does not summon Behemoth', () => {
    let s = bareGame('monsters', 'nilfgaard');
    removeCards(s, 0, ['mo_arachas', 'mo_arachas_behemoth']);
    s.players[0].deck.push('mo_arachas_behemoth', 'mo_arachas', 'mo_arachas');
    s = playFromHand(s, 0, 'mo_arachas');
    expect(s.players[0].rows.melee.units.filter((u) => u.cardId === 'mo_arachas')).toHaveLength(3);
    expect(s.players[0].deck).toContain('mo_arachas_behemoth');

    s = bareGame('monsters', 'nilfgaard');
    removeCards(s, 0, ['mo_arachas', 'mo_arachas_behemoth']);
    s.players[0].deck.push('mo_arachas', 'mo_arachas');
    s = playFromHand(s, 0, 'mo_arachas_behemoth');
    expect(s.players[0].rows.melee.units.filter((u) => u.cardId === 'mo_arachas')).toHaveLength(2);
  });

  it('Cerys summons all Shield Maidens from hand and deck', () => {
    let s = bareGame('skellige', 'nilfgaard');
    removeCards(s, 0, ['sk_cerys', 'sk_shield_maiden']);
    s.players[0].hand.push('sk_shield_maiden');
    s.players[0].deck.push('sk_shield_maiden', 'sk_shield_maiden');
    s = playFromHand(s, 0, 'sk_cerys');
    expect(s.players[0].rows.melee.units.filter((u) => u.cardId === 'sk_shield_maiden')).toHaveLength(3);
  });

  it('Geralt summons Roach without Ciri summoning Geralt', () => {
    let s = bareGame();
    removeCards(s, 0, ['ne_geralt', 'ne_ciri', 'ne_roach']);
    s.players[0].deck.push('ne_roach', 'ne_ciri');
    s = playFromHand(s, 0, 'ne_geralt');
    expect(s.players[0].rows.melee.units.some((u) => u.cardId === 'ne_roach')).toBe(true);
    expect(s.players[0].deck).toContain('ne_ciri');
  });
});

describe('replayed abilities', () => {
  it('logs and presents a revived Scorch unit before resolving its ability', () => {
    let s = bareGame();
    s.players[0].graveyard.push('ne_villentretenmerth');
    place(s, 1, 'nf_black_archer', 'melee');
    s = playFromHand(s, 0, 'nr_dun_banner_medic');
    s = applyAction(s, { type: 'RESOLVE_CHOICE', player: 0, cardId: 'ne_villentretenmerth' });

    const revived = s.log.findIndex((entry) => entry.text.includes('revives Villentretenmerth'));
    const scorched = s.log.findIndex((entry) => entry.text.includes('Black Infantry Archer is scorched'));
    expect(revived).toBeGreaterThanOrEqual(0);
    expect(scorched).toBeGreaterThan(revived);
    expect(s.lastPlayedCard).toMatchObject({
      player: 0,
      cardId: 'ne_villentretenmerth',
      kind: 'revive',
    });
  });

  it('a Muster unit revived by Medic pulls matching cards from the hand and deck', () => {
    let s = bareGame('scoiatael', 'nilfgaard');
    removeCards(s, 0, ['sc_elven_skirmisher']);
    s.players[0].graveyard.push('sc_elven_skirmisher');
    s.players[0].deck.push('sc_elven_skirmisher', 'sc_elven_skirmisher');
    s = playFromHand(s, 0, 'sc_havekar_healer');
    s = applyAction(s, { type: 'RESOLVE_CHOICE', player: 0, cardId: 'sc_elven_skirmisher' });
    expect(s.players[0].rows.ranged.units.filter((u) => u.cardId === 'sc_elven_skirmisher')).toHaveLength(3);
  });

  it('Ermion transforms every Berserker in its ranged row', () => {
    let s = bareGame('skellige', 'nilfgaard');
    place(s, 0, 'sk_young_berserker', 'ranged');
    place(s, 0, 'sk_young_berserker', 'ranged');
    s = playFromHand(s, 0, 'sk_ermion');
    expect(s.players[0].rows.ranged.units.filter((u) => u.cardId === 'sk_young_vildkaarl')).toHaveLength(2);
  });
});

describe('summon avenger removal timing', () => {
  it('Scorch summons Cow replacement immediately', () => {
    let s = bareGame();
    place(s, 0, 'ne_cow', 'ranged');
    s = playFromHand(s, 1, 'ne_scorch');
    expect(s.players[0].graveyard).toContain('ne_cow');
    expect(s.players[0].rows.melee.units.some((u) => u.cardId === 'ne_bovine_defense_force')).toBe(true);
  });

  it('Decoy returns Cow without triggering its replacement', () => {
    let s = bareGame();
    const cow = place(s, 0, 'ne_cow', 'ranged');
    s = playFromHand(s, 0, 'ne_decoy', undefined, cow.instanceId);
    expect(s.players[0].hand).toContain('ne_cow');
    expect(s.players[0].rows.melee.units.some((u) => u.cardId === 'ne_bovine_defense_force')).toBe(false);
  });
});
