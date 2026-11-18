(() => {
  const field = document.getElementById('search-query-input');
  const results = document.getElementById('tracks-results-list');
  const searchStatus = document.getElementById('search-status');
  const player = document.getElementById('audiophile-player');
  const audio = document.getElementById('main-audio-element');
  const indicator = document.getElementById('player-vinyl');
  const trackTitle = document.getElementById('player-track-title');
  const trackArtist = document.getElementById('player-track-artist');
  const quality = document.getElementById('player-quality-tag');
  const playbackStatus = document.getElementById('player-source-tag');
  let searchRequest;
  let streamRequest;

  function textElement(className, value) {
    const element = document.createElement('div');
    element.className = className;
    element.textContent = value;
    return element;
  }

  function trackCard(track) {
    const row = document.createElement('article');
    row.className = 'track-card';
    const cover = document.createElement('div');
    cover.className = 'track-art-wrap';
    if (track.artworkURL && /^https?:\/\//i.test(track.artworkURL)) {
      const image = document.createElement('img');
      image.src = track.artworkURL;
      image.className = 'track-art';
      image.loading = 'lazy';
      image.alt = '';
      image.addEventListener('error', () => image.remove());
      cover.append(image);
    }

    const title = track.title || 'Untitled track';
    const meta = textElement('track-meta', '');
    meta.append(textElement('track-title', title), textElement('track-artist', track.artist || track.album || 'Unknown artist'));

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'track-play-button';
    button.setAttribute('aria-label', 'Play ' + title);
    button.textContent = '▶ Play';
    button.addEventListener('click', () => play(track));

    row.append(cover, meta, textElement('track-quality-badge', track.audioQuality || track.format || 'Lossless requested'), button);
    return row;
  }

  async function search(query) {
    searchRequest?.abort();
    const request = new AbortController();
    searchRequest = request;
    searchStatus.textContent = 'Searching for “' + query + '”…';
    results.replaceChildren();
    try {
      const response = await fetch('/search?' + new URLSearchParams({ q: query, quality: 'LOSSLESS' }), { cache: 'no-store', signal: request.signal });
      if (!response.ok) throw new Error('The search service is unavailable.');
      const { tracks } = await response.json();
      if (request.signal.aborted) return;
      if (!Array.isArray(tracks)) throw new Error('Invalid search response');
      window.dispatchEvent(new Event('relay:gateway-response'));
      searchStatus.textContent = tracks.length ? tracks.length + (tracks.length === 1 ? ' track' : ' tracks') : 'No tracks found. Try another song or artist.';
      results.replaceChildren(...tracks.map(trackCard));
    } catch {
      if (!request.signal.aborted) searchStatus.textContent = 'Search couldn’t connect. Try again in a moment.';
    }
  }

  async function play(track) {
    streamRequest?.abort();
    const request = new AbortController();
    streamRequest = request;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    player.style.display = 'flex';
    trackTitle.textContent = track.title || 'Untitled track';
    trackArtist.textContent = track.artist || track.album || '';
    quality.textContent = track.audioQuality || track.format || 'Lossless';
    playbackStatus.textContent = 'Getting stream…';
    try {
      const response = await fetch('/stream/' + encodeURIComponent(track.id) + '?quality=LOSSLESS', { cache: 'no-store', signal: request.signal });
      if (!response.ok) throw new Error('Stream unavailable');
      const data = await response.json();
      if (request.signal.aborted) return;
      if (typeof data.url !== 'string' || !/^https:\/\//i.test(data.url)) throw new Error('Stream unavailable');
      window.dispatchEvent(new Event('relay:gateway-response'));
      // Native audio plays the provider URL directly without a cross-origin Web Audio graph.
      quality.textContent = data.format || data.quality || quality.textContent;
      audio.src = data.url;
      playbackStatus.textContent = 'Direct stream';
      try {
        await audio.play();
      } catch {
        if (!request.signal.aborted && !audio.error) playbackStatus.textContent = 'Press play to start';
      }
    } catch {
      if (!request.signal.aborted) playbackStatus.textContent = 'Stream unavailable';
    }
  }

  audio.addEventListener('playing', () => {
    indicator.classList.add('spinning');
    playbackStatus.textContent = 'Direct stream';
  });
  for (const event of ['pause', 'ended', 'error']) {
    audio.addEventListener(event, () => indicator.classList.remove('spinning'));
  }
  audio.addEventListener('error', () => { playbackStatus.textContent = 'Playback unavailable'; });

  window.quickSearch = query => {
    field.value = query;
    void search(query);
  };
  window.handleSearchSubmit = event => {
    event.preventDefault();
    const query = field.value.trim();
    if (query) void search(query);
    return false;
  };
})();
