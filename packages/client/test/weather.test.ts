import { describe, expect, it } from 'vitest';
import { weatherCardsInPlay } from '../src/components/SidePanel.tsx';

describe('weather sidebar', () => {
  it('includes Skellige Storm even when its row effects duplicate fog and rain', () => {
    const weather = weatherCardsInPlay([
      { player: 0, cardId: 'ne_fog' },
      { player: 1, cardId: 'ne_rain' },
      { player: 0, cardId: 'ne_storm' },
    ]);

    expect(weather).toEqual([
      { cardId: 'ne_fog', count: 1 },
      { cardId: 'ne_rain', count: 1 },
      { cardId: 'ne_storm', count: 1 },
    ]);
  });

  it('groups duplicate weather cards without hiding them', () => {
    const weather = weatherCardsInPlay([
      { player: 0, cardId: 'ne_frost' },
      { player: 1, cardId: 'ne_frost' },
    ]);

    expect(weather).toEqual([{ cardId: 'ne_frost', count: 2 }]);
  });
});
