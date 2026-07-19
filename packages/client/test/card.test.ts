import { describe, expect, it } from 'vitest';
import { CARD_ART_REVISION, cardArtUrl } from '../src/components/Card.tsx';

describe('card artwork URLs', () => {
  it('version-busts mutable card artwork from browser caches', () => {
    expect(cardArtUrl('ne_gaunter_odimm', '.webp')).toBe(
      `/assets/cards/ne_gaunter_odimm.webp?v=${CARD_ART_REVISION}`,
    );
  });
});
