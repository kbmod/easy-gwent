/** Ensure a remote build contains every card image before packaging the client. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_CARDS } from '../packages/data/src/index.ts';

const cardsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets/cards');
const extensions = ['.webp', '.png', '.jpg'] as const;
const missing: string[] = [];
const invalid: string[] = [];

for (const card of ALL_CARDS) {
  const file = extensions.map((ext) => path.join(cardsDir, card.id + ext)).find((candidate) => fs.existsSync(candidate));
  if (!file) {
    missing.push(card.id);
    continue;
  }

  const bytes = fs.readFileSync(file);
  const webp = bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  const png = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const matchesExtension =
    (file.endsWith('.webp') && webp) ||
    (file.endsWith('.png') && png) ||
    (file.endsWith('.jpg') && jpg);
  if (bytes.length < 100 || !matchesExtension) {
    invalid.push(path.basename(file));
  }
}

if (missing.length || invalid.length) {
  if (missing.length) console.error(`Missing card images: ${missing.join(', ')}`);
  if (invalid.length) console.error(`Invalid card images: ${invalid.join(', ')}`);
  process.exitCode = 1;
} else {
  console.log(`Verified ${ALL_CARDS.length} card images in assets/cards/`);
}
