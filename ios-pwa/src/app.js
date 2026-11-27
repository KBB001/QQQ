import {
  CLOUDFLARE_WORKER_TEMPLATE,
  MOOD_CHIPS,
  SonoraApi,
  extractPlaylistId
} from './api.js';
import { SonoraPlayer } from './player.js';
import { BackupCipher, escapeHtml, sanitizeHttpsUrl } from './security.js';
import { SonoraStorage } from './storage.js';

const SVG = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>',
  prev: '<svg viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>',
  more: '<svg viewBox="0 0 24 24"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>',
  heart: '<svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>',
  heartOutline: '<svg viewBox="0 0 24 24"><path d="M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 15.55l-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05z"/></svg>',
  shuffle: '<svg viewBox="0 0 24 24"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>',
  repeat: '<svg viewBox="0 0 24 24"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg>',
  repeatOne: '<svg viewBox="0 0 24 24"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z"/></svg>',
  chevronDown: '<svg viewBox="0 0 24 24"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/></svg>',
  search: '<svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79L20 21.49 21.49 20 15.5 14zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>'
};

function formatTime(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
  }
  return `${m}:${String(rem).padStart(2, '0')}`;
}

function getSafeThumb(trackOrUrl) {
  const url = typeof trackOrUrl === 'string' ? trackOrUrl : trackOrUrl?.thumbnailUrl;
  return sanitizeHttpsUrl(url) || 'icons/icon-192.png';
}

class SonoraApp {
  constructor() {
    this.storage = new SonoraStorage();
    this.api = new SonoraApi(() => this.storage.settings.customApiBaseUrl);
    this.player = null;

    this.state = {
      activeTab: 'home',
      homeMood: 'ALL',
      homeLoading: false,
      homeError: '',
      homeTracks: [],
      searchQuery: '',
      searchFilter: 'TRACKS',
      searchLoading: false,
      searchError: '',
      searchResults: [],
      searchSuggestions: [],
      librarySubtab: 'playlists',
      selectedPlaylistId: null,
      playerExpanded: false,
      playerLyricsOpen: false,
      isScrubbing: false,
      scrubValue: 0,
      installDismissed: localStorage.getItem('sonora_ios_install_dismissed') === '1',
      swUpdateWaiting: null,
      appVersionLabel: 'PWA (GitHub Pages)'
    };

    this.renderedTracks = new Map();
    this.renderedPlaylists = new Map();
    this.toastTimer = null;
    this.swRegistration = null;
  }

  async init() {
    await this.storage.init();
    this.applyTheme(this.storage.settings.themeMode);

    this.player = new SonoraPlayer({
      api: this.api,
      storage: this.storage,
      onStateChange: () => this.onPlayerTick(),
      onError: (msg) => this.showToast(msg)
    });

    this.bindGlobalEvents();
    this.registerServiceWorker();
    this.renderBanner();
    this.render();
    this.loadHomeMood('ALL');
  }

  applyTheme(mode) {
    const html = document.documentElement;
    if (mode === 'LIGHT') html.setAttribute('data-theme', 'light');
    else if (mode === 'DARK') html.setAttribute('data-theme', 'dark');
    else html.setAttribute('data-theme', 'auto');
  }

  showToast(message) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = message;
    el.classList.remove('hidden');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.add('hidden'), 3200);
  }

  async registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    try {
      const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
      this.swRegistration = reg;
      if (reg.waiting) {
        this.state.swUpdateWaiting = reg.waiting;
        this.renderBanner();
      }
      reg.addEventListener('updatefound', () => {
        const nextWorker = reg.installing;
        if (!nextWorker) return;
        nextWorker.addEventListener('statechange', () => {
          if (nextWorker.state === 'installed' && navigator.serviceWorker.controller) {
            this.state.swUpdateWaiting = nextWorker;
            this.renderBanner();
          }
        });
      });
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'SONORA_SW_UPDATED' && event.data?.version) {
          this.state.appVersionLabel = `Сборка ${String(event.data.version).slice(0, 7)}`;
          if (this.state.activeTab === 'settings') this.renderMain();
        }
      });
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        window.location.reload();
      });
    } catch {
      // Ignore SW error on non-HTTPS previews
    }
  }

  isIosSafariInstallPromptNeeded() {
    if (this.state.installDismissed) return false;
    const ua = navigator.userAgent || '';
    const isIos = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    return isIos && !isStandalone;
  }

  renderBanner() {
    const slot = document.getElementById('banner-slot');
    if (!slot) return;

    if (this.state.swUpdateWaiting) {
      slot.innerHTML = `
        <div class="ios-banner">
          <img src="icons/icon-192.png" alt="Sonora" class="ios-banner-icon" />
          <div class="ios-banner-text">
            <div class="ios-banner-title">Доступно обновление Sonora</div>
            <div class="ios-banner-sub">Новая версия загружена с GitHub. Нажмите «Обновить» для применения.</div>
          </div>
          <button type="button" class="btn-accent-sm" data-action="apply-sw-update">Обновить</button>
        </div>
      `;
      return;
    }

    if (this.isIosSafariInstallPromptNeeded()) {
      slot.innerHTML = `
        <div class="ios-banner">
          <img src="icons/apple-touch-icon.png" alt="Sonora" class="ios-banner-icon" />
          <div class="ios-banner-text">
            <div class="ios-banner-title">Установить Sonora на iPhone</div>
            <div class="ios-banner-sub">Нажмите «Поделиться» внизу Safari, затем «На экран «Домой»».</div>
          </div>
          <button type="button" class="btn-close-sm" data-action="dismiss-install" aria-label="Скрыть">✕</button>
        </div>
      `;
      return;
    }

    slot.innerHTML = '';
  }

  async loadHomeMood(moodId) {
    this.state.homeMood = moodId;
    this.state.homeLoading = true;
    this.state.homeError = '';
    if (this.state.activeTab === 'home') this.renderMain();

    const mood = MOOD_CHIPS.find((m) => m.id === moodId) || MOOD_CHIPS[0];
    try {
      const items = await this.api.search(mood.query, 'TRACKS');
      this.state.homeTracks = items.filter((i) => i.type === 'track');
      this.state.homeLoading = false;
    } catch (err) {
      this.state.homeLoading = false;
      this.state.homeError = err?.message || 'Не удалось загрузить подборку';
    }
    if (this.state.activeTab === 'home') this.renderMain();
  }

  async runSearch(query, filter = this.state.searchFilter) {
    const clean = String(query ?? '').trim();
    this.state.searchQuery = clean;
    this.state.searchFilter = filter;
    this.state.searchError = '';

    if (filter === 'LOCAL') {
      this.state.searchLoading = false;
      this.state.searchResults = this.searchLocalLibrary(clean);
      this.renderMain();
      return;
    }

    if (!clean) {
      this.state.searchResults = [];
      this.state.searchLoading = false;
      this.renderMain();
      return;
    }

    this.state.searchLoading = true;
    this.renderMain();
    await this.storage.recordSearchQuery(clean);

    try {
      this.state.searchResults = await this.api.search(clean, filter);
      this.state.searchLoading = false;
    } catch (err) {
      this.state.searchLoading = false;
      this.state.searchError = err?.message || 'Ошибка поиска';
    }
    if (this.state.activeTab === 'search') this.renderMain();
  }

  searchLocalLibrary(query) {
    const q = query.toLowerCase();
    const seen = new Set();
    const pool = [...this.storage.library.favorites, ...this.storage.library.history];
    for (const pl of this.storage.library.playlists) {
      pool.push(...pl.tracks);
    }
    return pool
      .filter((t) => {
        if (seen.has(t.id)) return false;
        seen.add(t.id);
        if (!q) return true;
        return t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q);
      })
      .map((t) => ({ type: 'track', ...t }));
  }

  onPlayerTick() {
    this.renderMiniPlayer();
    if (this.state.playerExpanded) {
      const sheet = document.getElementById('player-sheet');
      const snap = this.player.getSnapshot();
      // If active sheet content belongs to different track or lyrics toggled, re-render full sheet; otherwise update fast-tick controls
      if (sheet && sheet.dataset.trackId === (snap.currentTrack?.id || '') && !this.state.playerLyricsOpen) {
        this.updateFastPlayerProgress(snap);
      } else if (sheet) {
        this.renderPlayerSheet();
      }
    }
  }

  updateFastPlayerProgress(snap) {
    const slider = document.getElementById('full-scrub-slider');
    const curLabel = document.getElementById('full-cur-time');
    const durLabel = document.getElementById('full-dur-time');
    const playBtn = document.getElementById('full-play-btn');
    const sleepLabel = document.getElementById('full-sleep-label');

    if (slider && !this.state.isScrubbing) {
      slider.max = String(Math.max(1, Math.round(snap.duration || 1)));
      slider.value = String(Math.round(snap.currentTime || 0));
    }
    if (curLabel && !this.state.isScrubbing) curLabel.textContent = formatTime(snap.currentTime);
    if (durLabel) durLabel.textContent = formatTime(snap.duration);
    if (playBtn) {
      playBtn.innerHTML = snap.isPlaying ? SVG.pause : SVG.play;
    }
    if (sleepLabel) {
      sleepLabel.textContent =
        snap.sleepRemainingMs > 0
          ? `${Math.ceil(snap.sleepRemainingMs / 60000)} м`
          : 'Таймер';
    }
  }

  render() {
    this.renderHeader();
    this.renderTabBar();
    this.renderMain();
    this.renderMiniPlayer();
    this.renderPlayerSheet();
  }

  renderHeader() {
    const titleEl = document.getElementById('header-title');
    const actionsEl = document.getElementById('header-actions');
    const titles = {
      home: 'Главная',
      search: 'Поиск',
      library: 'Медиатека',
      settings: 'Настройки'
    };
    if (titleEl) {
      if (this.state.activeTab === 'library' && this.state.selectedPlaylistId) {
        const pl = this.storage.library.playlists.find((p) => p.id === this.state.selectedPlaylistId);
        titleEl.textContent = pl ? pl.name : 'Плейлист';
      } else {
        titleEl.textContent = titles[this.state.activeTab] || 'Sonora';
      }
    }
    if (!actionsEl) return;

    if (this.state.activeTab === 'library' && this.state.selectedPlaylistId) {
      actionsEl.innerHTML = `<button type="button" class="icon-pill-btn" data-action="close-playlist">Назад</button>`;
    } else if (this.state.activeTab === 'library') {
      actionsEl.innerHTML = `
        <button type="button" class="icon-pill-btn" data-action="open-create-playlist" aria-label="Создать плейлист">${SVG.plus}<span>Плейлист</span></button>
      `;
    } else if (this.state.activeTab === 'settings') {
      actionsEl.innerHTML = `<button type="button" class="icon-pill-btn" data-action="check-sw-update">Обновить</button>`;
    } else {
      actionsEl.innerHTML = '';
    }
  }

  renderTabBar() {
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === this.state.activeTab);
    });
  }

  _registerTrack(track) {
    if (track?.id) this.renderedTracks.set(track.id, track);
    return track;
  }

  _renderTrackRowHtml(track, listKey = 'default', idx = 0) {
    this._registerTrack(track);
    const active = this.player?.currentTrack?.id === track.id;
    const dur = track.durationSeconds ? formatTime(track.durationSeconds) : '';
    return `
      <div class="track-row ${active ? 'active-track' : ''}" data-track-id="${escapeHtml(track.id)}" data-list-key="${escapeHtml(listKey)}" data-index="${idx}">
        <img src="${escapeHtml(getSafeThumb(track))}" alt="" class="track-thumb" loading="lazy" />
        <button type="button" class="track-meta" data-action="play-track" data-track-id="${escapeHtml(track.id)}" data-list-key="${escapeHtml(listKey)}">
          <div class="track-title">${escapeHtml(track.title)}</div>
          <div class="track-sub">${escapeHtml(track.artist)}${dur ? ` • ${escapeHtml(dur)}` : ''}</div>
        </button>
        <button type="button" class="track-more-btn" data-action="open-track-menu" data-track-id="${escapeHtml(track.id)}" aria-label="Действия с треком">
          ${SVG.more}
        </button>
      </div>
    `;
  }

  renderMain() {
    const main = document.getElementById('main-content');
    if (!main) return;
    this.renderedTracks.clear();
    this.renderedPlaylists.clear();

    if (this.state.activeTab === 'home') {
      main.innerHTML = this.renderHomeHtml();
    } else if (this.state.activeTab === 'search') {
      main.innerHTML = this.renderSearchHtml();
      const input = document.getElementById('search-query-input');
      if (input) input.value = this.state.searchQuery;
    } else if (this.state.activeTab === 'library') {
      main.innerHTML = this.renderLibraryHtml();
    } else {
      main.innerHTML = this.renderSettingsHtml();
    }
  }

  renderHomeHtml() {
    const chipsHtml = MOOD_CHIPS.map(
      (m) => `
      <button type="button" class="chip-btn ${this.state.homeMood === m.id ? 'active' : ''}" data-action="select-mood" data-mood="${escapeHtml(m.id)}">
        ${escapeHtml(m.label)}
      </button>`
    ).join('');

    const quickSource = [...this.storage.library.favorites, ...this.storage.library.history];
    const quickUnique = [];
    const seen = new Set();
    for (const t of quickSource) {
      if (!seen.has(t.id)) {
        seen.add(t.id);
        quickUnique.push(t);
        this._registerTrack(t);
      }
      if (quickUnique.length >= 6) break;
    }

    const quickHtml =
      quickUnique.length > 0
        ? `
      <div class="section-header">
        <h2 class="section-title">Быстрый выбор</h2>
      </div>
      <div class="quick-grid">
        ${quickUnique
          .map(
            (t) => `
          <button type="button" class="quick-card" data-action="play-track" data-track-id="${escapeHtml(t.id)}" data-list-key="quick">
            <img src="${escapeHtml(getSafeThumb(t))}" alt="" loading="lazy" />
            <span class="quick-card-title">${escapeHtml(t.title)}</span>
          </button>`
          )
          .join('')}
      </div>`
        : '';

    const historyStrip =
      this.storage.library.history.length > 0
        ? `
      <div class="section-header">
        <h2 class="section-title">Недавно слушали</h2>
        <button type="button" class="section-action" data-action="goto-history">Все</button>
      </div>
      <div class="h-strip">
        ${this.storage.library.history
          .slice(0, 10)
          .map((t) => {
            this._registerTrack(t);
            return `
            <button type="button" class="square-card" data-action="play-track" data-track-id="${escapeHtml(t.id)}" data-list-key="history">
              <img src="${escapeHtml(getSafeThumb(t))}" alt="" class="square-thumb" loading="lazy" />
              <div class="square-title">${escapeHtml(t.title)}</div>
              <div class="square-sub">${escapeHtml(t.artist)}</div>
            </button>`;
          })
          .join('')}
      </div>`
        : '';

    let feedHtml = '';
    if (this.state.homeLoading && this.state.homeTracks.length === 0) {
      feedHtml = `<div class="state-card"><h3>Загрузка музыки…</h3><p>Подбираем треки для вас</p></div>`;
    } else if (this.state.homeError) {
      feedHtml = `
        <div class="state-card">
          <h3>Нет подключения к каталогу</h3>
          <p>${escapeHtml(this.state.homeError)}</p>
          <button type="button" class="btn-accent-sm" data-action="retry-home">Повторить</button>
        </div>`;
    } else if (this.state.homeTracks.length > 0) {
      feedHtml = `
        <div class="grouped-card">
          ${this.state.homeTracks.map((t, idx) => this._renderTrackRowHtml(t, 'home', idx)).join('')}
        </div>`;
    }

    return `
      <div class="chips-row">${chipsHtml}</div>
      ${quickHtml}
      ${historyStrip}
      <div class="section-header">
        <h2 class="section-title">Подборка дня</h2>
        <button type="button" class="section-action" data-action="play-all-home">Включить всё</button>
      </div>
      ${feedHtml}
    `;
  }

  renderSearchHtml() {
    const filters = [
      { id: 'TRACKS', label: 'Треки' },
      { id: 'PLAYLISTS', label: 'Плейлисты' },
      { id: 'ARTISTS', label: 'Артисты' },
      { id: 'LOCAL', label: 'Медиатека' }
    ];

    const filterHtml = `
      <div class="segmented-control">
        ${filters
          .map(
            (f) => `
          <button type="button" class="seg-btn ${this.state.searchFilter === f.id ? 'active' : ''}" data-action="set-search-filter" data-filter="${f.id}">
            ${f.label}
          </button>`
          )
          .join('')}
      </div>`;

    let bodyHtml = '';
    if (this.state.searchLoading) {
      bodyHtml = `<div class="state-card"><h3>Поиск…</h3><p>Ищем треки и плейлисты</p></div>`;
    } else if (this.state.searchError) {
      bodyHtml = `
        <div class="state-card">
          <h3>Ошибка поиска</h3>
          <p>${escapeHtml(this.state.searchError)}</p>
          <button type="button" class="btn-accent-sm" data-action="retry-search">Повторить</button>
        </div>`;
    } else if (!this.state.searchQuery && this.state.searchFilter !== 'LOCAL') {
      const hist = this.storage.library.searchHistory;
      bodyHtml =
        hist.length > 0
          ? `
        <div class="section-header">
          <h2 class="section-title">Недавние запросы</h2>
          <button type="button" class="section-action" data-action="clear-search-history">Очистить</button>
        </div>
        <div class="chips-row">
          ${hist
            .map(
              (q) => `<button type="button" class="chip-btn" data-action="run-saved-query" data-query="${escapeHtml(q)}">${escapeHtml(q)}</button>`
            )
            .join('')}
        </div>`
          : `<div class="state-card"><h3>Найдите любимую музыку</h3><p>Введите название трека, имя артиста или вставьте ссылку на YouTube / YouTube Music.</p></div>`;
    } else if (this.state.searchResults.length === 0) {
      bodyHtml = `<div class="state-card"><h3>Ничего не найдено</h3><p>Попробуйте изменить запрос или фильтр.</p></div>`;
    } else {
      const rows = this.state.searchResults
        .map((item, idx) => {
          if (item.type === 'playlist') {
            this.renderedPlaylists.set(item.id, item);
            return `
              <button type="button" class="track-row" data-action="open-remote-playlist" data-remote-id="${escapeHtml(item.id)}">
                <img src="${escapeHtml(getSafeThumb(item))}" alt="" class="track-thumb" loading="lazy" />
                <div class="track-meta">
                  <div class="track-title">${escapeHtml(item.title)}</div>
                  <div class="track-sub">${escapeHtml(item.artist)}${item.trackCount ? ` • ${item.trackCount} треков` : ''}</div>
                </div>
              </button>`;
          }
          if (item.type === 'artist') {
            return `
              <button type="button" class="track-row" data-action="run-saved-query" data-query="${escapeHtml(item.title)}">
                <img src="${escapeHtml(getSafeThumb(item))}" alt="" class="track-thumb" loading="lazy" />
                <div class="track-meta">
                  <div class="track-title">${escapeHtml(item.title)}</div>
                  <div class="track-sub">${escapeHtml(item.artist)}</div>
                </div>
              </button>`;
          }
          return this._renderTrackRowHtml(item, 'search', idx);
        })
        .join('');
      bodyHtml = `<div class="grouped-card">${rows}</div>`;
    }

    return `
      <form id="search-form" class="search-bar-wrap">
        <div class="search-input-box">
          ${SVG.search}
          <input id="search-query-input" class="search-input" type="search" placeholder="Трек, артист или ссылка YouTube…" autocomplete="off" />
        </div>
        <button type="submit" class="btn-accent-sm">Найти</button>
      </form>
      ${filterHtml}
      ${bodyHtml}
    `;
  }

  renderLibraryHtml() {
    if (this.state.selectedPlaylistId) {
      const pl = this.storage.library.playlists.find((p) => p.id === this.state.selectedPlaylistId);
      if (!pl) {
        this.state.selectedPlaylistId = null;
      } else {
        return `
          <div class="state-card">
            <h3>${escapeHtml(pl.name)}</h3>
            <p>${escapeHtml(pl.description || `${pl.tracks.length} треков`)}</p>
            <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">
              ${
                pl.tracks.length > 0
                  ? `<button type="button" class="btn-accent-sm" data-action="play-playlist" data-playlist-id="${pl.id}">Включить всё</button>`
                  : ''
              }
              <button type="button" class="icon-pill-btn" data-action="delete-playlist" data-playlist-id="${pl.id}">Удалить</button>
            </div>
          </div>
          ${
            pl.tracks.length > 0
              ? `<div class="grouped-card" style="margin-top:14px;">${pl.tracks.map((t, idx) => this._renderTrackRowHtml(t, `playlist:${pl.id}`, idx)).join('')}</div>`
              : `<div class="state-card"><p>В этом плейлисте пока нет треков. Добавляйте треки через меню «⋯».</p></div>`
          }
        `;
      }
    }

    const tabs = [
      { id: 'playlists', label: 'Плейлисты' },
      { id: 'favorites', label: 'Избранное' },
      { id: 'history', label: 'История' }
    ];

    const subtabHtml = `
      <div class="segmented-control cols-3">
        ${tabs
          .map(
            (t) => `
          <button type="button" class="seg-btn ${this.state.librarySubtab === t.id ? 'active' : ''}" data-action="set-library-subtab" data-subtab="${t.id}">
            ${t.label}
          </button>`
          )
          .join('')}
      </div>`;

    if (this.state.librarySubtab === 'playlists') {
      const pls = this.storage.library.playlists;
      const listHtml =
        pls.length > 0
          ? `<div class="grouped-card">
              ${pls
                .map(
                  (pl) => `
                <button type="button" class="track-row" data-action="open-playlist" data-playlist-id="${pl.id}">
                  <img src="${escapeHtml(getSafeThumb(pl.tracks[0]))}" alt="" class="track-thumb" loading="lazy" />
                  <div class="track-meta">
                    <div class="track-title">${escapeHtml(pl.name)}</div>
                    <div class="track-sub">${pl.tracks.length} треков${pl.youtubePlaylistId ? ' • YouTube Music' : ''}</div>
                  </div>
                </button>`
                )
                .join('')}
            </div>`
          : `<div class="state-card"><h3>Нет плейлистов</h3><p>Создайте свой плейлист или импортируйте готовый по ссылке из YouTube Music.</p></div>`;

      return `
        ${subtabHtml}
        <button type="button" class="btn-secondary-full" data-action="open-import-yt-playlist">Импортировать плейлист YouTube Music</button>
        <div style="height:12px;"></div>
        ${listHtml}
      `;
    }

    if (this.state.librarySubtab === 'favorites') {
      const favs = this.storage.library.favorites;
      return `
        ${subtabHtml}
        ${
          favs.length > 0
            ? `<div class="grouped-card">${favs.map((t, idx) => this._renderTrackRowHtml(t, 'favorites', idx)).join('')}</div>`
            : `<div class="state-card"><h3>Избранное пусто</h3><p>Нажимайте сердечко в плеере или меню трека, чтобы сохранять музыку сюда.</p></div>`
        }
      `;
    }

    const hist = this.storage.library.history;
    return `
      ${subtabHtml}
      ${
        hist.length > 0
          ? `<div class="section-header"><h2 class="section-title">Недавние</h2><button type="button" class="section-action" data-action="clear-history">Очистить</button></div>
             <div class="grouped-card">${hist.map((t, idx) => this._renderTrackRowHtml(t, 'history', idx)).join('')}</div>`
          : `<div class="state-card"><h3>История пуста</h3><p>Прослушанные треки появятся здесь автоматически.</p></div>`
      }
    `;
  }

  renderSettingsHtml() {
    const s = this.storage.settings;
    const acc = this.storage.account;
    const themeNames = { SYSTEM: 'Системная', LIGHT: 'Светлая', DARK: 'Тёмная' };
    const qualityNames = { HIGH: 'Высокое', MEDIUM: 'Среднее', LOW: 'Экономия' };

    return `
      <div class="settings-group-title">Аккаунт и синхронизация</div>
      <div class="grouped-card">
        <button type="button" class="setting-row" data-action="open-yt-account">
          <div>
            <div class="setting-label">${acc.proxyUrl ? escapeHtml(acc.name || 'YouTube Music подключён') : 'Войти в YouTube Music'}</div>
            <div class="setting-sub">${
              acc.lastSyncTimestamp
                ? `Синхр.: ♥ ${acc.syncedLikedCount} треков, ${acc.syncedPlaylistsCount} плейлистов`
                : 'Синхронизация через прокси и импорт медиатеки'
            }</div>
          </div>
          <span class="setting-value">${acc.proxyUrl ? 'Настроено ›' : 'Подключить ›'}</span>
        </button>
      </div>

      <div class="settings-group-title">Оформление и звук</div>
      <div class="grouped-card">
        <button type="button" class="setting-row" data-action="cycle-theme">
          <div>
            <div class="setting-label">Тема интерфейса</div>
            <div class="setting-sub">Адаптация под светлый/тёмный режим iOS</div>
          </div>
          <span class="setting-value">${themeNames[s.themeMode] || 'Системная'}</span>
        </button>
        <button type="button" class="setting-row" data-action="cycle-quality">
          <div>
            <div class="setting-label">Качество аудио (AAC / M4A)</div>
            <div class="setting-sub">Оптимизировано для фонового аудио iPhone</div>
          </div>
          <span class="setting-value">${qualityNames[s.audioQuality] || 'Высокое'}</span>
        </button>
        <button type="button" class="setting-row" data-action="toggle-autoplay">
          <div>
            <div class="setting-label">Автовоспроизведение радио</div>
            <div class="setting-sub">Подбирать похожие треки в конце очереди</div>
          </div>
          <span class="ios-switch ${s.autoplayEnabled ? 'on' : ''}" aria-hidden="true"><span class="ios-switch-thumb"></span></span>
        </button>
        <button type="button" class="setting-row" data-action="open-custom-api">
          <div>
            <div class="setting-label">Свой сервер каталога (HTTPS)</div>
            <div class="setting-sub">${escapeHtml(s.customApiBaseUrl || 'Используются публичные шлюзы с резервом')}</div>
          </div>
          <span class="setting-value">Изменить ›</span>
        </button>
      </div>

      <div class="settings-group-title">Резервное копирование (совместимо с Android)</div>
      <div class="grouped-card">
        <button type="button" class="setting-row" data-action="toggle-encrypt-backups">
          <div>
            <div class="setting-label">Шифровать экспорт (.sonoraenc)</div>
            <div class="setting-sub">AES-256-GCM с паролем, совместимо с Android Sonora</div>
          </div>
          <span class="ios-switch ${s.encryptBackupsEnabled ? 'on' : ''}" aria-hidden="true"><span class="ios-switch-thumb"></span></span>
        </button>
        <button type="button" class="setting-row" data-action="export-backup">
          <div>
            <div class="setting-label">Экспортировать резервную копию</div>
            <div class="setting-sub">Избранное, плейлисты, история и настройки</div>
          </div>
          <span class="setting-value">Сохранить ›</span>
        </button>
        <button type="button" class="setting-row" data-action="import-backup">
          <div>
            <div class="setting-label">Импортировать резервную копию</div>
            <div class="setting-sub">Файлы .sonoraenc или .json из Android / iOS</div>
          </div>
          <span class="setting-value">Выбрать ›</span>
        </button>
      </div>

      <div class="settings-group-title">Обновления и о приложении</div>
      <div class="grouped-card">
        <button type="button" class="setting-row" data-action="check-sw-update">
          <div>
            <div class="setting-label">Обновление PWA через GitHub</div>
            <div class="setting-sub">${escapeHtml(this.state.appVersionLabel)}</div>
          </div>
          <span class="setting-value">Проверить ›</span>
        </button>
      </div>
    `;
  }

  renderMiniPlayer() {
    const mini = document.getElementById('mini-player');
    if (!mini || !this.player) return;
    const snap = this.player.getSnapshot();
    const track = snap.currentTrack;
    if (!track) {
      mini.classList.add('hidden');
      return;
    }

    mini.classList.remove('hidden');
    const pct = snap.duration > 0 ? Math.min(100, (snap.currentTime / snap.duration) * 100) : 0;
    mini.innerHTML = `
      <div class="mini-progress-track"><div class="mini-progress-fill" style="width:${pct.toFixed(1)}%"></div></div>
      <div class="mini-body">
        <button type="button" class="mini-open-btn" data-action="open-full-player">
          <img src="${escapeHtml(getSafeThumb(track))}" alt="" class="mini-thumb" />
          <div class="track-meta">
            <div class="track-title">${escapeHtml(track.title)}</div>
            <div class="track-sub">${snap.isBuffering ? 'Буферизация…' : escapeHtml(track.artist)}</div>
          </div>
        </button>
        <div class="mini-controls">
          <button type="button" class="mini-ctrl-btn" data-action="toggle-play" aria-label="${snap.isPlaying ? 'Пауза' : 'Воспроизвести'}">
            ${snap.isPlaying ? SVG.pause : SVG.play}
          </button>
          <button type="button" class="mini-ctrl-btn" data-action="next-track" aria-label="Следующий трек">
            ${SVG.next}
          </button>
        </div>
      </div>
    `;
  }

  renderPlayerSheet() {
    const sheet = document.getElementById('player-sheet');
    if (!sheet || !this.player) return;
    const snap = this.player.getSnapshot();
    const track = snap.currentTrack;

    if (!this.state.playerExpanded || !track) {
      sheet.classList.add('hidden');
      sheet.dataset.trackId = '';
      return;
    }

    sheet.classList.remove('hidden');
    sheet.dataset.trackId = track.id;
    const isFav = this.storage.isFavorite(track.id);
    const repeatIcon = snap.repeatMode === 'ONE' ? SVG.repeatOne : SVG.repeat;

    let stageHtml = '';
    if (this.state.playerLyricsOpen) {
      const lyr = snap.lyrics;
      if (lyr.loading) {
        stageHtml = `<div class="lyrics-panel"><p style="color:rgba(255,255,255,0.7);">Загрузка текста песни…</p></div>`;
      } else if (lyr.synced.length > 0) {
        let activeIdx = -1;
        for (let i = 0; i < lyr.synced.length; i++) {
          if (snap.currentTime + 0.35 >= lyr.synced[i].timeSeconds) activeIdx = i;
          else break;
        }
        stageHtml = `
          <div class="lyrics-panel">
            ${lyr.synced
              .map(
                (line, idx) => `
              <button type="button" class="lyric-line ${idx === activeIdx ? 'active' : ''}" data-action="seek-lyric" data-time="${line.timeSeconds}">
                ${escapeHtml(line.text)}
              </button>`
              )
              .join('')}
          </div>`;
      } else if (lyr.plain) {
        stageHtml = `<div class="lyrics-panel"><pre style="white-space:pre-wrap;font:inherit;line-height:1.5;font-size:17px;">${escapeHtml(lyr.plain)}</pre></div>`;
      } else {
        stageHtml = `<div class="lyrics-panel"><p style="color:rgba(255,255,255,0.65);">Текст песни для этого трека не найден.</p></div>`;
      }
    } else {
      stageHtml = `
        <div class="player-artwork-stage" id="player-artwork-stage">
          <img src="${escapeHtml(getSafeThumb(track))}" alt="${escapeHtml(track.title)}" class="player-artwork-img" />
          <div class="seek-zone left" data-seek="-10">↺ 10 сек</div>
          <div class="seek-zone right" data-seek="10">10 сек ↻</div>
        </div>`;
    }

    sheet.innerHTML = `
      <div class="sheet-grabber" id="player-drag-handle"></div>
      <div class="player-topbar">
        <button type="button" class="player-ctrl-btn" data-action="close-full-player" aria-label="Свернуть плеер">${SVG.chevronDown}</button>
        <span style="font-size:13px;font-weight:600;color:rgba(255,255,255,0.72);">Сейчас играет</span>
        <button type="button" class="player-ctrl-btn" data-action="open-track-menu" data-track-id="${escapeHtml(track.id)}" aria-label="Меню трека">${SVG.more}</button>
      </div>

      ${stageHtml}

      <div class="player-meta-row">
        <div class="track-meta">
          <h2 class="player-track-title">${escapeHtml(track.title)}</h2>
          <div class="player-track-artist">${escapeHtml(track.artist)}</div>
        </div>
        <button type="button" class="player-ctrl-btn ${isFav ? 'is-active' : ''}" data-action="toggle-favorite" data-track-id="${escapeHtml(track.id)}" aria-label="Нравится">
          ${isFav ? SVG.heart : SVG.heartOutline}
        </button>
      </div>

      <div class="player-scrub-wrap">
        <input id="full-scrub-slider" class="player-slider" type="range" min="0" max="${Math.max(1, Math.round(snap.duration || 1))}" value="${Math.round(this.state.isScrubbing ? this.state.scrubValue : snap.currentTime)}" aria-label="Позиция трека" />
        <div class="player-times">
          <span id="full-cur-time">${formatTime(this.state.isScrubbing ? this.state.scrubValue : snap.currentTime)}</span>
          <span id="full-dur-time">${formatTime(snap.duration)}</span>
        </div>
      </div>

      <div class="player-controls">
        <button type="button" class="player-ctrl-btn ${snap.shuffleEnabled ? 'is-active' : ''}" data-action="toggle-shuffle" aria-label="Перемешать">${SVG.shuffle}</button>
        <button type="button" class="player-ctrl-btn" data-action="prev-track" aria-label="Назад">${SVG.prev}</button>
        <button type="button" id="full-play-btn" class="player-play-btn" data-action="toggle-play" aria-label="${snap.isPlaying ? 'Пауза' : 'Играть'}">
          ${snap.isPlaying ? SVG.pause : SVG.play}
        </button>
        <button type="button" class="player-ctrl-btn" data-action="next-track" aria-label="Вперёд">${SVG.next}</button>
        <button type="button" class="player-ctrl-btn ${snap.repeatMode !== 'OFF' ? 'is-active' : ''}" data-action="cycle-repeat" aria-label="Повтор">${repeatIcon}</button>
      </div>

      <div class="player-tools-row">
        <button type="button" class="player-tool-btn ${this.state.playerLyricsOpen ? 'active' : ''}" data-action="toggle-lyrics">Текст</button>
        <button type="button" class="player-tool-btn" data-action="cycle-speed">${snap.playbackSpeed}x</button>
        <button type="button" class="player-tool-btn ${snap.sleepRemainingMs > 0 ? 'active' : ''}" data-action="open-sleep-timer">
          <span id="full-sleep-label">${snap.sleepRemainingMs > 0 ? `${Math.ceil(snap.sleepRemainingMs / 60000)} м` : 'Таймер'}</span>
        </button>
        <button type="button" class="player-tool-btn" data-action="open-queue">Очередь (${snap.queue.length})</button>
      </div>
    `;

    this._bindPlayerInteractions();
  }

  _bindPlayerInteractions() {
    const slider = document.getElementById('full-scrub-slider');
    if (slider) {
      slider.addEventListener('input', (e) => {
        this.state.isScrubbing = true;
        this.state.scrubValue = Number(e.target.value) || 0;
        const cur = document.getElementById('full-cur-time');
        if (cur) cur.textContent = formatTime(this.state.scrubValue);
      });
      slider.addEventListener('change', (e) => {
        const targetSec = Number(e.target.value) || 0;
        this.state.isScrubbing = false;
        this.player.seekTo(targetSec);
      });
    }

    // Double-tap left/right seek zones on artwork
    const stage = document.getElementById('player-artwork-stage');
    if (stage) {
      let lastTapAt = 0;
      let lastZone = null;
      stage.querySelectorAll('.seek-zone').forEach((zone) => {
        zone.addEventListener('click', () => {
          const now = Date.now();
          const delta = Number(zone.dataset.seek);
          if (lastZone === zone && now - lastTapAt < 320) {
            this.player.seekBy(delta);
            zone.classList.add('flash');
            setTimeout(() => zone.classList.remove('flash'), 420);
            lastTapAt = 0;
          } else {
            lastTapAt = now;
            lastZone = zone;
          }
        });
      });
    }

    // Swipe-down to dismiss full player sheet
    const sheet = document.getElementById('player-sheet');
    if (sheet) {
      let startY = 0;
      sheet.ontouchstart = (e) => {
        if (sheet.scrollTop <= 0 && e.touches.length === 1) {
          startY = e.touches[0].clientY;
        } else {
          startY = 0;
        }
      };
      sheet.ontouchend = (e) => {
        if (!startY || e.changedTouches.length !== 1) return;
        const dy = e.changedTouches[0].clientY - startY;
        if (dy > 90) {
          this.state.playerExpanded = false;
          this.renderPlayerSheet();
        }
        startY = 0;
      };
    }
  }

  openModal(html) {
    const backdrop = document.getElementById('modal-backdrop');
    const sheet = document.getElementById('modal-sheet');
    if (!backdrop || !sheet) return;
    sheet.innerHTML = html;
    backdrop.classList.remove('hidden');
  }

  closeModal() {
    document.getElementById('modal-backdrop')?.classList.add('hidden');
  }

  getListForKey(key) {
    if (key === 'home') return this.state.homeTracks;
    if (key === 'favorites') return this.storage.library.favorites;
    if (key === 'history') return this.storage.library.history;
    if (key === 'search') return this.state.searchResults.filter((i) => i.type === 'track');
    if (key?.startsWith('playlist:')) {
      const pid = Number(key.slice('playlist:'.length));
      return this.storage.library.playlists.find((p) => p.id === pid)?.tracks || [];
    }
    return [];
  }

  bindGlobalEvents() {
    // Tab bar
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.state.activeTab = btn.dataset.tab;
        if (this.state.activeTab !== 'library') this.state.selectedPlaylistId = null;
        this.renderHeader();
        this.renderTabBar();
        this.renderMain();
      });
    });

    // Backdrop close
    document.getElementById('modal-backdrop')?.addEventListener('click', (e) => {
      if (e.target.id === 'modal-backdrop') this.closeModal();
    });

    // Search form submit delegation
    document.addEventListener('submit', (e) => {
      if (e.target.id === 'search-form') {
        e.preventDefault();
        const val = document.getElementById('search-query-input')?.value || '';
        this.runSearch(val, this.state.searchFilter);
      } else if (e.target.id === 'create-playlist-form') {
        e.preventDefault();
        const name = document.getElementById('new-playlist-name')?.value || '';
        const desc = document.getElementById('new-playlist-desc')?.value || '';
        this.storage
          .createPlaylist(name, desc)
          .then((pl) => {
            this.closeModal();
            this.state.selectedPlaylistId = pl.id;
            this.render();
            this.showToast(`Плейлист «${pl.name}» создан`);
          })
          .catch((err) => this.showToast(err.message));
      } else if (e.target.id === 'import-yt-playlist-form') {
        e.preventDefault();
        const urlInput = document.getElementById('yt-playlist-url')?.value || '';
        if (!extractPlaylistId(urlInput)) {
          this.showToast('Введите корректную ссылку или ID плейлиста YouTube');
          return;
        }
        this.showToast('Импорт плейлиста…');
        this.api
          .getPlaylist(urlInput)
          .then((remote) => this.storage.mergePlaylist(remote.title, remote.description, remote.tracks, remote.id))
          .then(({ playlist, addedCount }) => {
            this.closeModal();
            this.state.activeTab = 'library';
            this.state.librarySubtab = 'playlists';
            this.state.selectedPlaylistId = playlist.id;
            this.render();
            this.showToast(`Импортировано треков: ${addedCount}`);
          })
          .catch((err) => this.showToast(err.message));
      } else if (e.target.id === 'yt-account-form') {
        e.preventDefault();
        const proxyUrl = document.getElementById('yt-proxy-url')?.value || '';
        const cookieHeader = document.getElementById('yt-cookie-header')?.value || '';
        this.handleYouTubeAccountSync(proxyUrl, cookieHeader);
      } else if (e.target.id === 'custom-api-form') {
        e.preventDefault();
        const url = document.getElementById('custom-api-url')?.value || '';
        if (url.trim() && !sanitizeHttpsUrl(url)) {
          this.showToast('Допускается только безопасный адрес https://');
          return;
        }
        this.storage.updateSettings({ customApiBaseUrl: url.trim() }).then(() => {
          this.api.activeInstance = null;
          this.closeModal();
          this.renderMain();
          this.showToast(url.trim() ? 'Свой каталог сохранён' : 'Сброшено на публичные шлюзы');
        });
      }
    });

    // Hidden backup file input
    document.getElementById('backup-file-input')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      const text = await file.text();
      if (BackupCipher.isEncryptedBackup(text)) {
        this.openDecryptBackupModal(text);
      } else {
        await this.finishBackupImport(text);
      }
    });

    // Global action click delegation
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;

      if (action === 'dismiss-install') {
        this.state.installDismissed = true;
        localStorage.setItem('sonora_ios_install_dismissed', '1');
        this.renderBanner();
      } else if (action === 'apply-sw-update') {
        this.state.swUpdateWaiting?.postMessage({ type: 'SKIP_WAITING' });
      } else if (action === 'check-sw-update') {
        if (!this.swRegistration) {
          this.showToast('Автообновление активно только на HTTPS (GitHub Pages)');
        } else {
          this.showToast('Проверка обновления…');
          this.swRegistration.update().then(() => {
            if (this.swRegistration.waiting) {
              this.state.swUpdateWaiting = this.swRegistration.waiting;
              this.renderBanner();
              this.showToast('Найдена новая версия!');
            } else {
              this.showToast('У вас последняя версия Sonora');
            }
          });
        }
      } else if (action === 'select-mood') {
        this.loadHomeMood(btn.dataset.mood);
      } else if (action === 'retry-home') {
        this.loadHomeMood(this.state.homeMood);
      } else if (action === 'play-all-home') {
        if (this.state.homeTracks.length > 0) {
          this.player.playTrack(this.state.homeTracks[0], this.state.homeTracks);
        }
      } else if (action === 'goto-history') {
        this.state.activeTab = 'library';
        this.state.librarySubtab = 'history';
        this.render();
      } else if (action === 'play-track') {
        const track = this.renderedTracks.get(btn.dataset.trackId);
        const list = this.getListForKey(btn.dataset.listKey);
        if (track) this.player.playTrack(track, list.length > 0 ? list : [track]);
      } else if (action === 'set-search-filter') {
        this.runSearch(document.getElementById('search-query-input')?.value || this.state.searchQuery, btn.dataset.filter);
      } else if (action === 'retry-search') {
        this.runSearch(this.state.searchQuery, this.state.searchFilter);
      } else if (action === 'run-saved-query') {
        this.runSearch(btn.dataset.query, 'TRACKS');
      } else if (action === 'clear-search-history') {
        this.storage.clearSearchHistory().then(() => this.renderMain());
      } else if (action === 'open-remote-playlist') {
        const item = this.renderedPlaylists.get(btn.dataset.remoteId);
        if (item) this.openRemotePlaylistModal(item);
      } else if (action === 'set-library-subtab') {
        this.state.librarySubtab = btn.dataset.subtab;
        this.renderMain();
      } else if (action === 'open-playlist') {
        this.state.selectedPlaylistId = Number(btn.dataset.playlistId);
        this.renderHeader();
        this.renderMain();
      } else if (action === 'close-playlist') {
        this.state.selectedPlaylistId = null;
        this.renderHeader();
        this.renderMain();
      } else if (action === 'play-playlist') {
        const pl = this.storage.library.playlists.find((p) => p.id === Number(btn.dataset.playlistId));
        if (pl && pl.tracks.length > 0) this.player.playTrack(pl.tracks[0], pl.tracks);
      } else if (action === 'delete-playlist') {
        const pid = Number(btn.dataset.playlistId);
        this.storage.deletePlaylist(pid).then(() => {
          this.state.selectedPlaylistId = null;
          this.render();
          this.showToast('Плейлист удалён');
        });
      } else if (action === 'clear-history') {
        this.storage.clearHistory().then(() => this.renderMain());
      } else if (action === 'open-create-playlist') {
        this.openModal(`
          <h3 class="modal-title">Новый плейлист</h3>
          <form id="create-playlist-form">
            <input id="new-playlist-name" class="ios-field" type="text" placeholder="Название плейлиста" required />
            <input id="new-playlist-desc" class="ios-field" type="text" placeholder="Описание (необязательно)" />
            <button type="submit" class="btn-primary-full">Создать</button>
            <button type="button" class="btn-secondary-full" data-action="close-modal">Отмена</button>
          </form>
        `);
      } else if (action === 'open-import-yt-playlist') {
        this.openModal(`
          <h3 class="modal-title">Импорт плейлиста YouTube Music</h3>
          <form id="import-yt-playlist-form">
            <input id="yt-playlist-url" class="ios-field" type="url" placeholder="https://music.youtube.com/playlist?list=..." required />
            <button type="submit" class="btn-primary-full">Импортировать</button>
            <button type="button" class="btn-secondary-full" data-action="close-modal">Отмена</button>
          </form>
        `);
      } else if (action === 'open-full-player') {
        this.state.playerExpanded = true;
        this.renderPlayerSheet();
      } else if (action === 'close-full-player') {
        this.state.playerExpanded = false;
        this.renderPlayerSheet();
      } else if (action === 'toggle-play') {
        this.player.togglePlayPause();
      } else if (action === 'next-track') {
        this.player.next(false);
      } else if (action === 'prev-track') {
        this.player.previous();
      } else if (action === 'toggle-shuffle') {
        this.player.toggleShuffle();
      } else if (action === 'cycle-repeat') {
        this.player.cycleRepeat();
      } else if (action === 'toggle-lyrics') {
        this.state.playerLyricsOpen = !this.state.playerLyricsOpen;
        this.renderPlayerSheet();
      } else if (action === 'seek-lyric') {
        this.player.seekTo(Number(btn.dataset.time) || 0);
      } else if (action === 'cycle-speed') {
        const speeds = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
        const idx = speeds.indexOf(this.player.playbackSpeed);
        this.player.setPlaybackSpeed(speeds[(idx + 1) % speeds.length]);
      } else if (action === 'open-sleep-timer') {
        this.openModal(`
          <h3 class="modal-title">Таймер сна</h3>
          ${[15, 30, 45, 60, 90]
            .map(
              (m) => `<button type="button" class="btn-secondary-full" data-action="set-sleep" data-minutes="${m}">${m} минут</button>`
            )
            .join('')}
          <button type="button" class="btn-danger-full" data-action="set-sleep" data-minutes="0">Выключить таймер</button>
        `);
      } else if (action === 'set-sleep') {
        const mins = Number(btn.dataset.minutes) || 0;
        this.player.setSleepTimer(mins);
        this.closeModal();
        this.showToast(mins > 0 ? `Таймер сна на ${mins} мин.` : 'Таймер сна выключен');
      } else if (action === 'open-queue') {
        const q = this.player.queue;
        this.openModal(`
          <h3 class="modal-title">Очередь (${q.length})</h3>
          <div class="grouped-card">
            ${q
              .map(
                (t, i) => `
              <button type="button" class="track-row ${i === this.player.currentIndex ? 'active-track' : ''}" data-action="jump-queue" data-qindex="${i}">
                <img src="${escapeHtml(getSafeThumb(t))}" alt="" class="track-thumb" />
                <div class="track-meta">
                  <div class="track-title">${escapeHtml(t.title)}</div>
                  <div class="track-sub">${escapeHtml(t.artist)}</div>
                </div>
              </button>`
              )
              .join('')}
          </div>
          <button type="button" class="btn-secondary-full" data-action="close-modal">Закрыть</button>
        `);
      } else if (action === 'jump-queue') {
        const idx = Number(btn.dataset.qindex);
        if (idx >= 0 && idx < this.player.queue.length) {
          this.player.playTrack(this.player.queue[idx], this.player.queue);
        }
        this.closeModal();
      } else if (action === 'toggle-favorite') {
        const track = this.renderedTracks.get(btn.dataset.trackId) || this.player.currentTrack;
        if (track) {
          this.storage.toggleFavorite(track).then((added) => {
            this.renderPlayerSheet();
            if (this.state.activeTab === 'library') this.renderMain();
            this.showToast(added ? 'Добавлено в Избранное' : 'Удалено из Избранного');
          });
        }
      } else if (action === 'open-track-menu') {
        const track = this.renderedTracks.get(btn.dataset.trackId) || this.player.currentTrack;
        if (track) this.openTrackMenu(track);
      } else if (action === 'menu-play-next') {
        const track = this.renderedTracks.get(btn.dataset.trackId) || this.player.currentTrack;
        if (track) this.player.playNextInQueue(track).then(() => this.showToast('Сыграет следующим'));
        this.closeModal();
      } else if (action === 'menu-start-radio') {
        const track = this.renderedTracks.get(btn.dataset.trackId) || this.player.currentTrack;
        this.closeModal();
        if (track) this.player.startRadio(track);
      } else if (action === 'menu-add-playlist') {
        const track = this.renderedTracks.get(btn.dataset.trackId) || this.player.currentTrack;
        if (track) this.openAddToPlaylistModal(track);
      } else if (action === 'add-to-specific-playlist') {
        const track = this.renderedTracks.get(btn.dataset.trackId) || this.player.currentTrack;
        const pid = Number(btn.dataset.playlistId);
        if (track) {
          this.storage.addTrackToPlaylist(pid, track).then((added) => {
            this.closeModal();
            this.showToast(added ? 'Трек добавлен в плейлист' : 'Трек уже в плейлисте');
          });
        }
      } else if (action === 'remove-from-active-playlist') {
        if (this.state.selectedPlaylistId) {
          this.storage.removeTrackFromPlaylist(this.state.selectedPlaylistId, btn.dataset.trackId).then(() => {
            this.closeModal();
            this.renderMain();
            this.showToast('Трек удалён из плейлиста');
          });
        }
      } else if (action === 'cycle-theme') {
        const order = ['SYSTEM', 'LIGHT', 'DARK'];
        const next = order[(order.indexOf(this.storage.settings.themeMode) + 1) % order.length];
        this.storage.updateSettings({ themeMode: next }).then(() => {
          this.applyTheme(next);
          this.renderMain();
        });
      } else if (action === 'cycle-quality') {
        const order = ['HIGH', 'MEDIUM', 'LOW'];
        const next = order[(order.indexOf(this.storage.settings.audioQuality) + 1) % order.length];
        this.storage.updateSettings({ audioQuality: next }).then(() => this.renderMain());
      } else if (action === 'toggle-autoplay') {
        this.storage
          .updateSettings({ autoplayEnabled: !this.storage.settings.autoplayEnabled })
          .then(() => this.renderMain());
      } else if (action === 'toggle-encrypt-backups') {
        this.storage
          .updateSettings({ encryptBackupsEnabled: !this.storage.settings.encryptBackupsEnabled })
          .then(() => this.renderMain());
      } else if (action === 'open-custom-api') {
        this.openModal(`
          <h3 class="modal-title">Свой HTTPS-сервер каталога</h3>
          <p style="font-size:13px;color:var(--text-secondary);margin-top:0;">Можно указать свой инстанс Piped API (например, https://pipedapi.example.com). Оставьте пустым для автоподбора.</p>
          <form id="custom-api-form">
            <input id="custom-api-url" class="ios-field" type="url" placeholder="https://pipedapi.example.com" value="${escapeHtml(this.storage.settings.customApiBaseUrl)}" />
            <button type="submit" class="btn-primary-full">Сохранить</button>
            <button type="button" class="btn-secondary-full" data-action="close-modal">Отмена</button>
          </form>
        `);
      } else if (action === 'open-yt-account') {
        this.openYouTubeAccountModal();
      } else if (action === 'copy-worker-script') {
        navigator.clipboard?.writeText(CLOUDFLARE_WORKER_TEMPLATE).then(() => {
          this.showToast('Код Cloudflare Worker скопирован');
        });
      } else if (action === 'yt-signout') {
        this.storage.signOutAccount().then(() => {
          this.closeModal();
          this.renderMain();
          this.showToast('Вы вышли из аккаунта YouTube Music');
        });
      } else if (action === 'export-backup') {
        this.handleBackupExport();
      } else if (action === 'import-backup') {
        document.getElementById('backup-file-input')?.click();
      } else if (action === 'close-modal') {
        this.closeModal();
      }
    });
  }

  openTrackMenu(track) {
    this._registerTrack(track);
    const isFav = this.storage.isFavorite(track.id);
    const canRemoveFromPl = this.state.activeTab === 'library' && Boolean(this.state.selectedPlaylistId);
    this.openModal(`
      <h3 class="modal-title">${escapeHtml(track.title)}</h3>
      <p style="margin:-6px 0 14px;color:var(--text-secondary);font-size:14px;">${escapeHtml(track.artist)}</p>
      <button type="button" class="btn-secondary-full" data-action="toggle-favorite" data-track-id="${escapeHtml(track.id)}">
        ${isFav ? 'Убрать из Избранного' : 'Добавить в Избранное'}
      </button>
      <button type="button" class="btn-secondary-full" data-action="menu-play-next" data-track-id="${escapeHtml(track.id)}">Играть следующим</button>
      <button type="button" class="btn-secondary-full" data-action="menu-start-radio" data-track-id="${escapeHtml(track.id)}">Запустить радио по треку</button>
      <button type="button" class="btn-secondary-full" data-action="menu-add-playlist" data-track-id="${escapeHtml(track.id)}">Добавить в плейлист</button>
      ${
        canRemoveFromPl
          ? `<button type="button" class="btn-danger-full" data-action="remove-from-active-playlist" data-track-id="${escapeHtml(track.id)}">Удалить из плейлиста</button>`
          : ''
      }
      <button type="button" class="btn-secondary-full" data-action="close-modal">Закрыть</button>
    `);
  }

  openAddToPlaylistModal(track) {
    this._registerTrack(track);
    const pls = this.storage.library.playlists;
    this.openModal(`
      <h3 class="modal-title">Выберите плейлист</h3>
      ${
        pls.length > 0
          ? pls
              .map(
                (pl) => `<button type="button" class="btn-secondary-full" data-action="add-to-specific-playlist" data-playlist-id="${pl.id}" data-track-id="${escapeHtml(track.id)}">${escapeHtml(pl.name)} (${pl.tracks.length})</button>`
              )
              .join('')
          : '<p style="color:var(--text-secondary);font-size:14px;">У вас пока нет плейлистов.</p>'
      }
      <button type="button" class="btn-primary-full" data-action="open-create-playlist">Создать новый плейлист</button>
    `);
  }

  async openRemotePlaylistModal(item) {
    this.openModal(`<h3 class="modal-title">${escapeHtml(item.title)}</h3><p>Загрузка треков плейлиста…</p>`);
    try {
      const remote = item.tracks ? item : await this.api.getPlaylist(item.id);
      const tracks = remote.tracks || [];
      this.openModal(`
        <h3 class="modal-title">${escapeHtml(remote.title || item.title)}</h3>
        <p style="font-size:13px;color:var(--text-secondary);margin-top:0;">${tracks.length} треков</p>
        <button type="button" class="btn-primary-full" id="remote-pl-play">Включить всё</button>
        <button type="button" class="btn-secondary-full" id="remote-pl-save">Сохранить в Медиатеку</button>
        <button type="button" class="btn-secondary-full" data-action="close-modal">Закрыть</button>
      `);
      document.getElementById('remote-pl-play')?.addEventListener('click', () => {
        if (tracks.length > 0) this.player.playTrack(tracks[0], tracks);
        this.closeModal();
      });
      document.getElementById('remote-pl-save')?.addEventListener('click', async () => {
        await this.storage.mergePlaylist(remote.title || item.title, remote.description || '', tracks, item.id);
        this.closeModal();
        this.showToast('Плейлист сохранён в Медиатеку');
      });
    } catch (err) {
      this.closeModal();
      this.showToast(err.message);
    }
  }

  openYouTubeAccountModal() {
    const acc = this.storage.account;
    this.openModal(`
      <h3 class="modal-title">Аккаунт YouTube Music</h3>
      <p style="font-size:13px;color:var(--text-secondary);line-height:1.45;margin-top:0;">
        Из-за правил безопасности Safari (CORS) веб-приложение не может напрямую читать cookie Google.
        Вы можете подключить свой бесплатный HTTPS-прокси (например, Cloudflare Worker) для синхронизации лайков и плейлистов.
      </p>
      <button type="button" class="btn-secondary-full" data-action="copy-worker-script" style="margin-bottom:12px;">Скопировать код Cloudflare Worker</button>
      <form id="yt-account-form">
        <input id="yt-proxy-url" class="ios-field" type="url" placeholder="https://sonora-sync.yourname.workers.dev" value="${escapeHtml(acc.proxyUrl)}" required />
        <textarea id="yt-cookie-header" class="ios-field ios-textarea" placeholder="Вставьте Cookie из music.youtube.com (шифруется локально AES-GCM)" required>${escapeHtml(acc.cookieHeader)}</textarea>
        <button type="submit" class="btn-primary-full">Сохранить и синхронизировать</button>
        ${acc.proxyUrl ? `<button type="button" class="btn-danger-full" data-action="yt-signout">Выйти из аккаунта</button>` : ''}
        <button type="button" class="btn-secondary-full" data-action="close-modal">Закрыть</button>
      </form>
    `);
  }

  async handleYouTubeAccountSync(proxyUrl, cookieHeader) {
    try {
      this.showToast('Синхронизация с YouTube Music…');
      const result = await this.api.syncYouTubeAccount(proxyUrl, cookieHeader);

      let likedAdded = 0;
      for (const t of result.likedTracks) {
        if (!this.storage.isFavorite(t.id)) {
          await this.storage.toggleFavorite(t);
          likedAdded++;
        }
      }
      for (const pl of result.playlists) {
        await this.storage.mergePlaylist(pl.name, pl.description, pl.tracks, pl.id);
      }

      await this.storage.saveAccountConfig({
        name: result.accountName,
        email: result.accountEmail,
        proxyUrl,
        cookieHeader,
        lastSyncTimestamp: Date.now(),
        syncedLikedCount: result.likedTracks.length,
        syncedPlaylistsCount: result.playlists.length
      });

      this.closeModal();
      this.render();
      this.showToast(`Синхронизировано: +${likedAdded} лайков, ${result.playlists.length} плейлистов`);
    } catch (err) {
      this.showToast(err.message);
    }
  }

  handleBackupExport() {
    const payloadJson = JSON.stringify(this.storage.exportBackupObject(), null, 2);
    if (!this.storage.settings.encryptBackupsEnabled) {
      this._downloadTextFile(`sonora-backup-${new Date().toISOString().slice(0, 10)}.json`, payloadJson, 'application/json');
      this.showToast('Резервная копия JSON сохранена');
      return;
    }

    this.openModal(`
      <h3 class="modal-title">Пароль шифрования (.sonoraenc)</h3>
      <p style="font-size:13px;color:var(--text-secondary);margin-top:0;">Этот же пароль подойдёт для восстановления копии в Android-приложении Sonora.</p>
      <form id="encrypt-export-form">
        <input id="export-password" class="ios-field" type="password" minlength="6" placeholder="Минимум 6 символов" required />
        <button type="submit" class="btn-primary-full">Зашифровать и скачать</button>
        <button type="button" class="btn-secondary-full" data-action="close-modal">Отмена</button>
      </form>
    `);
    document.getElementById('encrypt-export-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const pwd = document.getElementById('export-password')?.value || '';
      try {
        const encrypted = await BackupCipher.encrypt(payloadJson, pwd);
        this._downloadTextFile(`sonora-backup-${new Date().toISOString().slice(0, 10)}.sonoraenc`, encrypted, 'application/json');
        this.closeModal();
        this.showToast('Зашифрованная копия сохранена');
      } catch (err) {
        this.showToast(err.message);
      }
    });
  }

  openDecryptBackupModal(encryptedText) {
    this.openModal(`
      <h3 class="modal-title">Расшифровка резервной копии</h3>
      <p style="font-size:13px;color:var(--text-secondary);margin-top:0;">Введите пароль, использованный при экспорте файла .sonoraenc.</p>
      <form id="decrypt-import-form">
        <input id="import-password" class="ios-field" type="password" placeholder="Пароль" required />
        <button type="submit" class="btn-primary-full">Расшифровать и восстановить</button>
        <button type="button" class="btn-secondary-full" data-action="close-modal">Отмена</button>
      </form>
    `);
    document.getElementById('decrypt-import-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const pwd = document.getElementById('import-password')?.value || '';
      try {
        const plainJson = await BackupCipher.decrypt(encryptedText, pwd);
        this.closeModal();
        await this.finishBackupImport(plainJson);
      } catch (err) {
        this.showToast(err.message);
      }
    });
  }

  async finishBackupImport(plainJson) {
    try {
      const stats = await this.storage.importBackupObject(plainJson);
      this.applyTheme(this.storage.settings.themeMode);
      this.render();
      this.showToast(`Восстановлено: треков ${stats.tracksRestored}, плейлистов ${stats.playlistsRestored}`);
    } catch (err) {
      this.showToast(err.message);
    }
  }

  _downloadTextFile(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
}

const app = new SonoraApp();
app.init();
