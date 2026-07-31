import { mkdir, access, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = await (await import('node:fs/promises')).readFile(resolve(root, 'data/pokemon.js'), 'utf8');
const sandbox = { window: {} }; vm.runInNewContext(source, sandbox);
const data = sandbox.window.POKEMON_DATA;
const downloadQueue = [...new Map([
  ...data.boxes.flatMap(box => box.pokemon),
  ...data.formPages.flatMap(page => page.pokemon)
].map(pokemon => [pokemon.id, pokemon])).values()];
await mkdir(resolve(root, 'images/regular'), { recursive: true });
await mkdir(resolve(root, 'images/shiny'), { recursive: true });

async function exists(path) { try { await access(path); return true; } catch { return false; } }
async function fetchJson(url) { const res = await fetch(url); if (!res.ok) throw new Error(`${res.status} ${url}`); return res.json(); }
async function download(url, path) { const res = await fetch(url); if (!res.ok) throw new Error(`${res.status} ${url}`); await writeFile(path, Buffer.from(await res.arrayBuffer())); }
function homeArtwork(api, mode) {
  return mode === 'shiny' ? api.sprites.other.home.front_shiny : api.sprites.other.home.front_default;
}
function femaleHomeArtwork(api, mode) {
  return mode === 'shiny' ? api.sprites.other.home.front_shiny_female : api.sprites.other.home.front_female;
}
const specialIdAliases = {
  'toxtricity-gmax': 'toxtricity-amped-gmax',
  'urshifu-gmax': 'urshifu-single-strike-gmax'
};
async function imageUrls(id) {
  const lookupId = specialIdAliases[id] || id;
  try {
    const api = await fetchJson(`https://pokeapi.co/api/v2/pokemon/${lookupId}`);
    return Object.fromEntries(['regular', 'shiny'].map(mode => [mode, homeArtwork(api, mode)]));
  } catch (pokemonError) {
    if (lookupId.endsWith('-female')) {
      try {
        const api = await fetchJson(`https://pokeapi.co/api/v2/pokemon/${lookupId.replace(/-female$/, '')}`);
        const urls = Object.fromEntries(['regular', 'shiny'].map(mode => [mode, femaleHomeArtwork(api, mode)]));
        if (urls.regular || urls.shiny) return urls;
      } catch {}
    }
    try {
      const species = await fetchJson(`https://pokeapi.co/api/v2/pokemon-species/${lookupId}`);
      const defaultId = species.varieties?.find(variety => variety.is_default)?.pokemon?.name;
      if (!defaultId || defaultId === lookupId) throw pokemonError;
      const api = await fetchJson(`https://pokeapi.co/api/v2/pokemon/${defaultId}`);
      return Object.fromEntries(['regular', 'shiny'].map(mode => [mode, homeArtwork(api, mode)]));
    } catch {
      const form = await fetchJson(`https://pokeapi.co/api/v2/pokemon-form/${lookupId}`);
      if (lookupId.endsWith('-female')) {
        const api = await fetchJson(form.pokemon.url);
        const urls = Object.fromEntries(['regular', 'shiny'].map(mode => [mode, femaleHomeArtwork(api, mode)]));
        if (urls.regular || urls.shiny) return urls;
      }
      const pokemonNumber = form.pokemon.url.match(/\/(\d+)\/$/)?.[1];
      if (!pokemonNumber || !form.form_name) throw pokemonError;
      const filename = `${pokemonNumber}-${form.form_name}.png`;
      const base = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/home';
      return { regular: `${base}/${filename}`, shiny: `${base}/shiny/${filename}` };
    }
  }
}

let done = 0;
for (const p of downloadQueue) {
  try {
    const missingModes = [];
    for (const mode of ['regular', 'shiny']) {
      if (!await exists(resolve(root, `images/${mode}/${p.id}.png`))) missingModes.push(mode);
    }
    if (missingModes.length) {
      const urls = await imageUrls(p.imageId || p.id);
      for (const mode of missingModes) {
        const target = resolve(root, `images/${mode}/${p.id}.png`);
        const url = urls[mode];
        if (url) await download(url, target);
      }
    }
    process.stdout.write(`\r${++done}/${downloadQueue.length} ${p.name.padEnd(28)}`);
  } catch (error) { console.error(`\nSkipped ${p.id}: ${error.message}`); }
}
console.log('\nImages are ready. Re-run any time; existing files are skipped.');
