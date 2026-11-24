// Outfit presets for co-op characters. Players can start from one and change
// any part. Stored locally (no accounts).
import { DEFAULT_OUTFIT, OUTFIT_OPTIONS } from '../net/protocol.js';

export const PRESETS = [
  { name: 'Test Subject', ...DEFAULT_OUTFIT },
  { name: 'Sporty', shirtStyle: 'tank', pattern: 'stripes', shirt: '#e53935', shirt2: '#ffffff', shortsStyle: 'shorts', shorts: '#1a1a1a', shoeStyle: 'hightops', shoes: '#ffffff', hat: 'visor', hatColor: '#ffffff', skin: '#c68a62', hair: '#1b1410' },
  { name: 'Explorer', shirtStyle: 'longsleeve', pattern: 'solid', shirt: '#7b8a4a', shirt2: '#c9b27c', shortsStyle: 'cargo', shorts: '#8d7a55', shoeStyle: 'boots', shoes: '#5a3d24', hat: 'bucket', hatColor: '#c9b27c', skin: '#e8b48a', hair: '#6b4a2a' },
  { name: 'Night Shift', shirtStyle: 'hoodie', pattern: 'split', shirt: '#2b2d42', shirt2: '#8d99ae', shortsStyle: 'long', shorts: '#1d1e2c', shoeStyle: 'sneakers', shoes: '#ef233c', hat: 'beanie', hatColor: '#ef233c', skin: '#8d5a3b', hair: '#0f0b08' },
  { name: 'Sunny', shirtStyle: 'tee', pattern: 'dots', shirt: '#ffd54f', shirt2: '#ff7043', shortsStyle: 'shorts', shorts: '#29b6f6', shoeStyle: 'sneakers', shoes: '#ffffff', hat: 'cap', hatColor: '#ff7043', skin: '#f1c7a1', hair: '#d9a441' },
  { name: 'Lab Tech', shirtStyle: 'longsleeve', pattern: 'solid', shirt: '#eceff1', shirt2: '#26a69a', shortsStyle: 'long', shorts: '#455a64', shoeStyle: 'sneakers', shoes: '#26a69a', hat: 'none', hatColor: '#26a69a', skin: '#d9a07a', hair: '#2b1d14' },
  { name: 'Plaid', shirtStyle: 'tee', pattern: 'check', shirt: '#b71c1c', shirt2: '#212121', shortsStyle: 'cargo', shorts: '#3e4a5a', shoeStyle: 'boots', shoes: '#212121', hat: 'cap', hatColor: '#212121', skin: '#e8b48a', hair: '#8b5a2b' },
  { name: 'Showtime', shirtStyle: 'tee', pattern: 'wave', shirt: '#6a1b9a', shirt2: '#ffca28', shortsStyle: 'long', shorts: '#212121', shoeStyle: 'hightops', shoes: '#ffca28', hat: 'tophat', hatColor: '#212121', skin: '#a86b47', hair: '#1b1410' },
];

export const LABELS = {
  shirtStyle: { label: 'Shirt', names: { tee: 'T-shirt', longsleeve: 'Long sleeve', tank: 'Tank top', hoodie: 'Hoodie' } },
  pattern: { label: 'Shirt pattern', names: { solid: 'Plain', stripes: 'Stripes', wave: 'Wave', dots: 'Dots', check: 'Check', split: 'Two tone' } },
  shortsStyle: { label: 'Bottoms', names: { shorts: 'Shorts', long: 'Trousers', cargo: 'Cargo shorts' } },
  shoeStyle: { label: 'Shoes', names: { sneakers: 'Sneakers', boots: 'Boots', hightops: 'High tops' } },
  hat: { label: 'Hat', names: { none: 'No hat', cap: 'Cap', beanie: 'Beanie', bucket: 'Bucket hat', visor: 'Visor', tophat: 'Top hat' } },
};
export const COLOR_FIELDS = [
  ['shirt', 'Shirt colour'], ['shirt2', 'Pattern colour'], ['shorts', 'Bottoms colour'], ['shoes', 'Shoe colour'],
  ['hatColor', 'Hat colour'], ['skin', 'Skin tone'], ['hair', 'Hair colour'],
];

export function presetOutfit(i) {
  const { name, ...o } = PRESETS[((i % PRESETS.length) + PRESETS.length) % PRESETS.length];
  void name;
  return { ...o };
}

export { OUTFIT_OPTIONS };
