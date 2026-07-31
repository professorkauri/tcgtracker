import { access, readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile('data/pokemon.js', 'utf8');
const sandbox = { window: {} };
vm.runInNewContext(source, sandbox);
const data = sandbox.window.POKEMON_DATA;

if (!data || !Array.isArray(data.boxes) || !Array.isArray(data.formPages)) {
  throw new Error('pokemon.js must define boxes and formPages arrays.');
}

const allowedTypes = new Set(['Forms', 'Mega', 'Gmax']);
const formIds = new Set();
const missingImages = [];
for (const [index, page] of data.formPages.entries()) {
  if (!page.region || !allowedTypes.has(page.type) || !page.pokemon?.length) {
    throw new Error(`Invalid form page at index ${index}.`);
  }
  if (page.pokemon.length > 9) throw new Error(`Form page ${index} contains more than 9 Pokémon.`);
  for (const pokemon of page.pokemon) {
    if (formIds.has(pokemon.id)) throw new Error(`Duplicate form id: ${pokemon.id}`);
    formIds.add(pokemon.id);
    try {
      await access(`images/regular/${pokemon.id}.png`);
    } catch {
      try {
        await access(`images/regular/${pokemon.imageId}.png`);
      } catch {
        missingImages.push(pokemon.id);
      }
    }
  }
}

if (missingImages.length) throw new Error(`Forms without an image or fallback: ${missingImages.join(', ')}`);

const allForms = data.formPages.flatMap(page => page.pokemon);
for (const prefix of ['Alolan ', 'Galarian ', 'Hisuian ', 'Paldean ']) {
  if (!allForms.some(pokemon => pokemon.name.startsWith(prefix))) {
    throw new Error(`No ${prefix.trim()} forms found.`);
  }
}

console.log(`Validated ${data.boxes.flatMap(box => box.pokemon).length} species and ${formIds.size} forms across ${data.formPages.length} form pages.`);
