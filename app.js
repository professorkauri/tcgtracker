(() => {
  const DATA = window.POKEMON_DATA;
  const STORAGE_KEY = 'pokemon-home-tracker-v1';
  const REGION_STARTS = new Map([[1, 'Kanto'], [152, 'Johto'], [252, 'Hoenn'], [387, 'Sinnoh'], [494, 'Unova'], [650, 'Kalos'], [722, 'Alola'], [810, 'Galar'], [899, 'Hisui'], [906, 'Paldea']]);
  const boxesEl = document.querySelector('#boxes');
  const emptyEl = document.querySelector('#empty');
  const searchPanel = document.querySelector('#search-panel');
  const searchInput = document.querySelector('#search-input');
  const nationalSpecies = DATA.boxes.filter(box => box.id.startsWith('dex-')).flatMap(box => box.pokemon);
  const allPokemon = DATA.boxes.flatMap(box => box.pokemon);
  const boxById = new Map(DATA.boxes.map(box => [box.id, box]));
  const speciesIds = new Set(nationalSpecies.map(pokemon => pokemon.id));
  const evolutionLineBySpecies = new Map((DATA.evolutionLines || []).flatMap(line => line.map(id => [id, line])));
  const regionSpecialPageIds = new Map([
    ['Kalos', ['forms-6', 'forms-11']],
    ['Alola', ['forms-7', 'forms-12']],
    ['Galar', ['forms-8']],
    ['Paldea', ['forms-10']]
  ]);
  let view = 'pokedex';
  let openRegion = 'Kanto';
  let searchQuery = '';
  let state = loadState();

  function normalizeSearch(value) { return value.trim().toLowerCase().replace(/\s+/g, ' '); }
  function baseSpeciesId(pokemon) {
    const candidates = [pokemon.id, pokemon.imageId].filter(Boolean);
    for (const candidate of candidates) {
      const parts = candidate.split('-');
      while (parts.length) {
        const id = parts.join('-');
        if (speciesIds.has(id)) return id;
        parts.pop();
      }
    }
    return pokemon.id;
  }

  function chunkBy(items, size) {
    const chunks = [];
    for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
    return chunks;
  }

  function getRegionName(dex) {
    for (const [start, region] of [...REGION_STARTS.entries()].reverse()) {
      if (dex >= start) return region;
    }
    return 'Other';
  }

  function groupByRegion(pokemonList) {
    const grouped = new Map();
    for (const pokemon of pokemonList) {
      const region = getRegionName(pokemon.dex);
      if (!grouped.has(region)) grouped.set(region, []);
      grouped.get(region).push(pokemon);
    }
    return [...grouped.entries()].map(([region, members]) => ({ 
      name: region,
      pages: chunkBy(members, 9)
    }));
  }

  function appendRegionSpecialPages(groups) {
    return groups.map(group => {
      const boxIds = regionSpecialPageIds.get(group.name) || [];
      const extraPokemon = boxIds.flatMap(boxId => (boxById.get(boxId)?.pokemon || []));
      if (extraPokemon.length) {
        group.pages.push(...chunkBy(extraPokemon, 9));
      }
      return group;
    });
  }

  function searchMatcher(query) {
    const directQuery = normalizeSearch(query);
    const evolutionMatches = new Set();
    for (const pokemon of allPokemon) {
      if (normalizeSearch(pokemon.name) !== directQuery) continue;
      const speciesId = baseSpeciesId(pokemon);
      for (const lineSpecies of evolutionLineBySpecies.get(speciesId) || [speciesId]) evolutionMatches.add(lineSpecies);
    }
    return pokemon => pokemon.name.toLowerCase().includes(directQuery) || evolutionMatches.has(baseSpeciesId(pokemon));
  }

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
      const migrated = {};
      let changed = false;

      for (const [savedKey, value] of Object.entries(saved)) {
        if (savedKey.includes('|')) {
          const [, pokemonId] = savedKey.split('|');
          const legacyStatus = Number(value) || 0;
          const newKey = pokemonId || savedKey;
          migrated[newKey] = Math.max(migrated[newKey] || 0, legacyStatus);
          changed = true;
          continue;
        }
        migrated[savedKey] = value;
      }

      if (changed) localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    }
    catch {
      return {};
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    updateCounts();
  }

  function key(pokemonId) { return pokemonId; }
  function getStatus(pokemonId) { return state[key(pokemonId)] || 0; }
  function imagePath(pokemonId) { return `images/regular/${pokemonId}.png`; }

  function updateCounts() {
    const total = nationalSpecies.length;
    const haveCount = nationalSpecies.filter(pokemon => getStatus(pokemon.id) === 1).length;
    const replaceCount = nationalSpecies.filter(pokemon => getStatus(pokemon.id) === 2).length;
    const ownedProgress = document.querySelector('#owned-progress');
    const replaceProgress = document.querySelector('#replace-progress');

    ownedProgress.max = total;
    ownedProgress.value = haveCount;
    replaceProgress.max = total;
    replaceProgress.value = replaceCount;

    document.querySelector('#owned-count').textContent = `${haveCount} / ${total}`;
    document.querySelector('#replace-count').textContent = `${replaceCount} / ${total}`;
    document.querySelector('#transfer-count').textContent = replaceCount;
  }

  function card(pokemon, transferMode) {
    const status = getStatus(pokemon.id);
    const names = ['missing', 'have', 'replace'];
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `pokemon ${names[status]}`;
    button.dataset.label = pokemon.name;
    button.title = `${pokemon.name}: ${names[status]}`;
    button.setAttribute('aria-label', button.title);
    button.innerHTML = `<span class="status">${status === 2 ? '!' : ''}</span><img alt="" loading="lazy"><small>${pokemon.name}</small>`;

    const img = button.querySelector('img');
    img.src = imagePath(pokemon.id);
    img.onerror = () => {
      img.onerror = null;
      img.src = `images/regular/${pokemon.imageId || pokemon.id}.png`;
    };

    if (transferMode && status !== 2) {
      button.classList.add('transfer-card');
      button.disabled = true;
      button.setAttribute('aria-disabled', 'true');
    } else if (transferMode && status === 2) {
      button.classList.add('transfer-target');
      button.addEventListener('click', () => {
        state[key(pokemon.id)] = 1;
        saveState();
        render();
      });
    } else {
      button.addEventListener('click', () => {
        const nextStatus = (status + 1) % 3;
        if (nextStatus === 0) delete state[key(pokemon.id)];
        else state[key(pokemon.id)] = nextStatus;
        saveState();
        render();
      });
    }
    return button;
  }

  function pagePanel(pagePokemon, pageNumber, transferMode) {
    const article = document.createElement('article');
    article.className = 'page';
    const grid = document.createElement('div');
    grid.className = 'page-grid';

    pagePokemon.forEach(pokemon => grid.append(card(pokemon, transferMode)));
    article.innerHTML = `<div class="page-label">Page ${pageNumber}</div>`;
    article.append(grid);
    return article;
  }

  function regionPanel(regionGroup, transferMode) {
    const section = document.createElement('section');
    section.className = 'region';
    const isOpen = openRegion === regionGroup.name;
    const visiblePages = transferMode
      ? regionGroup.pages.filter(page => page.some(pokemon => getStatus(pokemon.id) === 2))
      : regionGroup.pages;
    const firstPokemon = regionGroup.pages.flat()[0];

    if (!visiblePages.length) return null;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'region-head';
    button.setAttribute('aria-expanded', String(isOpen));
    button.innerHTML = `
      <span class="region-watermark" aria-hidden="true">
        <img src="${imagePath(firstPokemon.id)}" alt="">
      </span>
      <span class="region-title">${regionGroup.name}</span>
      <span class="region-meta">${visiblePages.length} page${visiblePages.length === 1 ? '' : 's'}</span>
      <span class="chevron" aria-hidden="true"><svg viewBox="0 0 20 20" focusable="false"><path d="M5 8l5 5 5-5" /></svg></span>
    `;
    button.addEventListener('click', () => {
      openRegion = openRegion === regionGroup.name ? null : regionGroup.name;
      render();
    });

    section.append(button);

    if (isOpen) {
      const body = document.createElement('div');
      body.className = 'region-body';
      const pages = document.createElement('div');
      pages.className = 'pages-grid';
      visiblePages.forEach((pagePokemon, pageIndex) => pages.append(pagePanel(pagePokemon, pageIndex + 1, transferMode)));
      body.append(pages);
      section.append(body);
    }

    return section;
  }

  function appendRegionGroups(groups, transferMode) {
    const panels = groups.map(group => regionPanel(group, transferMode)).filter(Boolean);
    if (!panels.length) return;
    boxesEl.append(...panels);
  }

  function render() {
    boxesEl.replaceChildren();
    searchPanel.hidden = view !== 'search';
    document.body.classList.toggle('searching', view === 'search');

    const query = normalizeSearch(searchQuery);
    const groups = appendRegionSpecialPages(groupByRegion(query ? nationalSpecies.filter(searchMatcher(query)) : nationalSpecies));

    if (view === 'transfer') {
      appendRegionGroups(groups, true);
    } else if (view === 'search') {
      appendRegionGroups(groups, false);
    } else {
      appendRegionGroups(groups, false);
    }

    const hasBoxes = boxesEl.querySelector('.region') !== null;
    emptyEl.querySelector('h2').textContent = view === 'search' ? 'No matches' : 'No replacements queued';
    emptyEl.querySelector('p').textContent = view === 'search'
      ? 'Try a different Pokémon or form name.'
      : 'No Pokémon are marked as replacement priorities right now.';
    emptyEl.hidden = hasBoxes;
    updateCounts();
  }

  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value;
    render();
  });

  searchPanel.addEventListener('submit', e => e.preventDefault());
  document.querySelector('.dock').addEventListener('click', e => {
    const button = e.target.closest('[data-view]');
    if (!button) return;
    view = button.dataset.view;
    document.querySelectorAll('.dock button').forEach(b => b.classList.toggle('active', b === button));
    render();
    if (view === 'search') searchInput.focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  render();
})();
