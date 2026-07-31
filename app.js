(() => {
  const DATA = window.POKEMON_DATA;
  const STORAGE_KEY = 'tcgtracker-pokedex-v1';
  const REGION_STARTS = new Map([[1, 'Kanto'], [152, 'Johto'], [252, 'Hoenn'], [387, 'Sinnoh'], [494, 'Unova'], [650, 'Kalos'], [722, 'Alola'], [810, 'Galar'], [899, 'Hisui'], [906, 'Paldea']]);
  const boxesEl = document.querySelector('#boxes');
  const emptyEl = document.querySelector('#empty');
  const searchPanel = document.querySelector('#search-panel');
  const searchInput = document.querySelector('#search-input');
  const nationalSpecies = DATA.boxes.flatMap(box => box.pokemon);
  const formPages = DATA.formPages || [];
  const formPokemon = formPages.flatMap(page => page.pokemon);
  const allPokemon = [...nationalSpecies, ...formPokemon];
  const collectionPokemon = [...new Map(allPokemon.map(pokemon => [pokemon.id, pokemon])).values()];
  const speciesIds = new Set(nationalSpecies.map(pokemon => pokemon.id));
  const evolutionLineBySpecies = new Map((DATA.evolutionLines || []).flatMap(line => line.map(id => [id, line])));
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

  function nationalGroups(pokemon = nationalSpecies) {
    const grouped = new Map();
    for (const entry of pokemon) {
      const region = getRegionName(entry.dex);
      if (!grouped.has(region)) grouped.set(region, []);
      grouped.get(region).push(entry);
    }
    return [...grouped.entries()].map(([name, members]) => ({
      name,
      pages: chunkBy(members, 9).map(pagePokemon => ({ pokemon: pagePokemon }))
    }));
  }

  function appendFormPages(groups, pages = formPages) {
    const byRegion = new Map(groups.map(group => [group.name, group]));
    for (const page of pages) {
      if (!byRegion.has(page.region)) {
        const group = { name: page.region, pages: [] };
        byRegion.set(page.region, group);
        groups.push(group);
      }
      byRegion.get(page.region).pages.push(page);
    }
    return groups;
  }

  function compactPages(pages) {
    let previousType = null;
    const pokemon = pages.flatMap(page => page.pokemon.map(entry => {
      const formType = page.type || entry.formType || null;
      const startsFormType = Boolean(formType && formType !== previousType);
      previousType = formType;
      return formType ? { ...entry, formType, startsFormType } : entry;
    }));
    return chunkBy(pokemon, 9).map(pagePokemon => ({ pokemon: pagePokemon }));
  }

  function compactGroups(groups) {
    return groups.map(group => ({ ...group, pages: compactPages(group.pages) }));
  }

  function searchMatcher(query) {
    const directQuery = normalizeSearch(query);
    const evolutionMatches = new Set();
    for (const pokemon of allPokemon) {
      if (normalizeSearch(pokemon.name) !== directQuery) continue;
      const speciesId = baseSpeciesId(pokemon);
      for (const lineSpecies of evolutionLineBySpecies.get(speciesId) || [speciesId]) evolutionMatches.add(lineSpecies);
    }
    return pokemon => normalizeSearch(pokemon.name).includes(directQuery) || evolutionMatches.has(baseSpeciesId(pokemon));
  }

  function searchGroups(query) {
    const matches = searchMatcher(query);
    const groups = nationalGroups(nationalSpecies.filter(matches));
    const matchingPages = [];
    for (const page of formPages) {
      const matchingPokemon = page.pokemon.filter(matches);
      for (const pokemon of chunkBy(matchingPokemon, 9)) {
        matchingPages.push({ region: page.region, type: page.type, pokemon });
      }
    }
    return appendFormPages(groups, matchingPages);
  }

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {};
      const migrated = {};
      let changed = false;
      for (const [savedKey, value] of Object.entries(saved)) {
        if (savedKey.includes('|')) {
          const [, pokemonId] = savedKey.split('|');
          migrated[pokemonId || savedKey] = Math.max(migrated[pokemonId] || 0, Number(value) || 0);
          changed = true;
        } else {
          migrated[savedKey] = value;
        }
      }
      if (changed) localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    } catch {
      return {};
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    updateCounts();
  }

  function getStatus(pokemonId) { return state[pokemonId] || 0; }
  function imagePath(pokemonId) { return `images/regular/${pokemonId}.png`; }
  function isOwned(pokemon) { return getStatus(pokemon.id) !== 0; }

  function updateCounts() {
    const total = collectionPokemon.length;
    const ownedCount = collectionPokemon.filter(isOwned).length;
    const replaceCount = collectionPokemon.filter(pokemon => getStatus(pokemon.id) === 2).length;
    const ownedProgress = document.querySelector('#owned-progress');
    ownedProgress.max = total;
    ownedProgress.value = ownedCount;
    document.querySelector('#owned-count').textContent = `${ownedCount} / ${total}`;
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
    button.innerHTML = `${pokemon.startsFormType ? `<span class="form-type">${pokemon.formType}</span>` : ''}<span class="status">${status === 2 ? '!' : ''}</span><img alt="" loading="lazy"><small>${pokemon.name}</small>`;
    const img = button.querySelector('img');
    img.src = imagePath(pokemon.id);
    img.onerror = () => {
      img.onerror = null;
      img.src = imagePath(pokemon.imageId || pokemon.id);
    };

    if (transferMode && status !== 2) {
      button.classList.add('transfer-card');
      button.disabled = true;
      button.setAttribute('aria-disabled', 'true');
    } else if (transferMode) {
      button.classList.add('transfer-target');
      button.addEventListener('click', () => {
        state[pokemon.id] = 1;
        saveState();
        render();
      });
    } else {
      button.addEventListener('click', () => {
        const nextStatus = (status + 1) % 3;
        if (nextStatus === 0) delete state[pokemon.id];
        else state[pokemon.id] = nextStatus;
        saveState();
        render();
      });
    }
    return button;
  }

  function emptySlot() {
    const slot = document.createElement('div');
    slot.className = 'empty-slot';
    slot.setAttribute('aria-hidden', 'true');
    slot.innerHTML = '<svg viewBox="0 0 32 32" focusable="false"><path class="pokeball-fill" d="M4 16a12 12 0 0 1 24 0Z"></path><circle cx="16" cy="16" r="12"></circle><path d="M4 16h7.75M20.25 16H28"></path><circle class="pokeball-cutout" cx="16" cy="16" r="4.25"></circle></svg>';
    return slot;
  }

  function pagePanel(page, pageNumber, transferMode) {
    const article = document.createElement('article');
    article.className = 'page';
    const grid = document.createElement('div');
    grid.className = 'page-grid';
    page.pokemon.forEach(pokemon => grid.append(card(pokemon, transferMode)));
    if (view !== 'search') {
      for (let index = page.pokemon.length; index < 9; index++) grid.append(emptySlot());
    }
    article.innerHTML = `<div class="page-label"><span>Page ${page.pageNumber || pageNumber}</span></div>`;
    article.append(grid);
    return article;
  }

  function progressDonut(regionName, pokemon) {
    const uniquePokemon = [...new Map(pokemon.map(entry => [entry.id, entry])).values()];
    const total = uniquePokemon.length;
    const owned = uniquePokemon.filter(isOwned).length;
    const percent = total ? (owned / total) * 100 : 0;
    const complete = total > 0 && owned === total;
    const tick = '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M5 10.4 8.4 14 15 6"></path></svg>';
    return `<span class="progress-donut ${complete ? 'complete' : ''}" role="progressbar" aria-label="${regionName} collection progress: ${owned} of ${total}" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${owned}" title="${owned} of ${total} owned" style="--progress:${percent}%">${complete ? tick : ''}</span>`;
  }

  function regionPanel(regionGroup, transferMode) {
    const section = document.createElement('section');
    section.className = 'region';
    section.dataset.region = regionGroup.name;
    const alwaysOpen = view === 'search' || transferMode;
    const isOpen = alwaysOpen || openRegion === regionGroup.name;
    const visiblePages = transferMode
      ? regionGroup.pages.map((page, index) => ({ ...page, pageNumber: index + 1 }))
        .filter(page => page.pokemon.some(pokemon => getStatus(pokemon.id) === 2))
      : regionGroup.pages.map((page, index) => ({ ...page, pageNumber: index + 1 }));
    const allRegionPokemon = regionGroup.pages.flatMap(page => page.pokemon);
    const firstPokemon = allRegionPokemon[0];
    if (!visiblePages.length) return null;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'region-head';
    button.setAttribute('aria-expanded', String(isOpen));
    if (alwaysOpen) button.setAttribute('aria-disabled', 'true');
    button.innerHTML = `
      <span class="region-watermark" aria-hidden="true"><img src="${imagePath(firstPokemon.id)}" alt=""></span>
      <span class="region-title">${regionGroup.name}</span>
      <span class="region-meta"><span>${visiblePages.length} page${visiblePages.length === 1 ? '' : 's'}</span>${progressDonut(regionGroup.name, allRegionPokemon)}</span>
      <span class="chevron" aria-hidden="true"><svg viewBox="0 0 20 20" focusable="false"><path d="M5 8l5 5 5-5" /></svg></span>`;
    if (!alwaysOpen) {
      button.addEventListener('click', () => {
        const opening = openRegion !== regionGroup.name;
        openRegion = opening ? regionGroup.name : null;
        render();
        if (opening) {
          requestAnimationFrame(() => {
            [...boxesEl.querySelectorAll('.region')]
              .find(region => region.dataset.region === regionGroup.name)
              ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          });
        }
      });
    }
    section.append(button);

    if (isOpen) {
      const body = document.createElement('div');
      body.className = 'region-body';
      const pages = document.createElement('div');
      pages.className = 'pages-grid';
      visiblePages.forEach((page, index) => pages.append(pagePanel(page, index + 1, transferMode)));
      body.append(pages);
      section.append(body);
    }
    return section;
  }

  function appendRegionGroups(groups, transferMode) {
    const panels = groups.map(group => regionPanel(group, transferMode)).filter(Boolean);
    if (panels.length) boxesEl.append(...panels);
  }

  function render() {
    boxesEl.replaceChildren();
    searchPanel.hidden = view !== 'search';
    document.body.classList.toggle('searching', view === 'search');
    const query = view === 'search' ? normalizeSearch(searchQuery) : '';
    const groups = compactGroups(view === 'search'
      ? (query ? searchGroups(query) : [])
      : appendFormPages(nationalGroups()));
    appendRegionGroups(groups, view === 'transfer');
    const hasBoxes = boxesEl.querySelector('.region') !== null;
    emptyEl.querySelector('h2').textContent = view === 'search' ? 'No matches' : 'No replacements queued';
    emptyEl.querySelector('p').textContent = view === 'search' ? 'Try a different Pokémon or form name.' : 'No Pokémon are marked as replacement priorities right now.';
    emptyEl.hidden = hasBoxes || (view === 'search' && !query);
    updateCounts();
  }

  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value;
    render();
  });
  searchPanel.addEventListener('submit', event => event.preventDefault());
  document.querySelector('.dock').addEventListener('click', event => {
    const button = event.target.closest('[data-view]');
    if (!button) return;
    view = button.dataset.view;
    document.querySelectorAll('.dock button').forEach(entry => entry.classList.toggle('active', entry === button));
    render();
    if (view === 'search') searchInput.focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  render();
})();
