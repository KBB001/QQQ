import {
  MOOD_CHIPS,
  SonoraApi,
  extractPlaylistId,
  extractVideoId
} from './api.js';
import {
  buildAccountAuthModalHtml,
  buildAddToPlaylistModalHtml,
  buildAddTracksPickerModalHtml,
  buildCatalogSourcesModalHtml,
  buildCreatePlaylistModalHtml,
  buildDecryptImportModalHtml,
  buildDeletePlaylistModalHtml,
  buildEncryptExportModalHtml,
  buildImportPlaylistModalHtml,
  buildListeningStatsModalHtml,
  buildMixPreviewModalHtml,
  buildQueueModalHtml,
  buildRemotePlaylistModalHtml,
  buildRenamePlaylistModalHtml,
  buildSleepTimerModalHtml,
  buildTrackMenuHtml,
  buildTrackVersionsModalHtml
} from './modals.js';
import { SonoraOfflineManager, formatBytesRu } from './offline.js';
import { SonoraPlayer } from './player.js';
import {
  ImplicitSignalType,
  MoodCategory,
  SmartRecommendationEngine,
  VERSION_LABELS_RU,
  diversifyRecommendations,
  groupTrackVersions
} from './recommendations.js';
import {
  BackupCipher,
  escapeHtml,
  formatUserErrorRu,
  sanitizeHttpsUrl,
  sanitizeTrack
} from './security.js';
import { SonoraStorage } from './storage.js';
import {
  consumeOAuthRedirectCallback,
  fetchYouTubePlaylistTracksWithOAuth,
  revokeGoogleOAuthToken,
  syncYouTubeLibraryWithOAuth
} from './youtube-oauth.js';

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
  plus: '<svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>',
  refresh: '<svg viewBox="0 0 24 24"><path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>',
  download: '<svg viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>',
  checkCircle: '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>'
};

const GENRE_DISCOVERY_CARDS = [
  { query: 'Lo-Fi радио', title: 'Lo-Fi радио', subtitle: 'Бесконечный поток кассетного уюта', badge: 'ХИТ', variant: 'warm' },
  { query: 'Акустический инди', title: 'Акустический инди', subtitle: 'Живые гитары и камерный вокал', badge: 'НОВИНКА', variant: 'teal' },
  { query: 'Джаз пиано', title: 'Джаз пиано', subtitle: 'Ночной джаз-клуб в центре города', badge: 'VIBE', variant: 'violet' },
  { query: 'Synthwave', title: 'Synthwave', subtitle: 'Ночной неон и глубокий бас', badge: 'LIVE', variant: 'emerald' },
  { query: 'Hans Zimmer soundtrack', title: 'Hans Zimmer', subtitle: 'Эпические саундтреки и оркестр', badge: 'КИНО', variant: 'amber' },
  { query: 'Daft Punk', title: 'Daft Punk', subtitle: 'Электронная классика и грув', badge: 'ЭЛЕКТРО', variant: 'cobalt' }
];

function formatTime(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`
    : `${m}:${String(rem).padStart(2, '0')}`;
}

function formatTotalDurationRu(tracks = []) {
  const totalSec = tracks.reduce((sum, t) => sum + (Number(t?.durationSeconds) || 0), 0);
  if (totalSec <= 0) return '';
  const mins = Math.round(totalSec / 60);
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const remM = mins % 60;
    return remM > 0 ? `${h} ч ${remM} мин` : `${h} ч`;
  }
  return `${Math.max(1, mins)} мин`;
}

function getSafeThumb(trackOrUrl) {
  const url = typeof trackOrUrl === 'string' ? trackOrUrl : trackOrUrl?.thumbnailUrl;
  return sanitizeHttpsUrl(url) || 'icons/icon-192.png';
}

function sameTrackList(a = [], b = []) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i]?.id !== b[i]?.id) return false;
  }
  return true;
}

class SonoraApp {
  constructor() {
    this.storage = new SonoraStorage();
    this.api = new SonoraApi(() => ({
      customApiBaseUrl: this.storage.settings.customApiBaseUrl,
      fastNodes: this.storage.fastNodes,
      onFastNode: (kind, url) => this.storage.saveFastNode(kind, url)
    }));
    this.offline = new SonoraOfflineManager(this.storage);
    this.recommendations = new SmartRecommendationEngine({
      api: this.api,
      storage: this.storage
    });
    this.player = null;

    this.state = {
      activeTab: 'home',
      homeMood: 'ALL',
      homeLoading: false,
      homeRefreshing: false,
      homeError: '',
      homeTracks: [],
      homeFeedTracks: [],
      searchQuery: '',
      searchFilter: 'TRACKS',
      searchLoading: false,
      searchError: '',
      searchResults: [],
      searchSuggestions: [],
      selectedArtist: null,
      artistLoading: false,
      librarySubtab: 'playlists',
      selectedPlaylistId: null,
      playlistFilter: '',
      playlistEditMode: false,
      pickerState: { playlistId: null, tab: 'search', query: '', results: [], loading: false },
      accountModalTab: 'youtube',
      accountShowAddForm: false,
      accountLoading: false,
      accountStatusMsg: '',
      catalogDiagnosticsHtml: '',
      playerExpanded: false,
      playerLyricsOpen: false,
      lyricsManualOpen: false,
      lyricsManualQuery: '',
      isScrubbing: false,
      scrubValue: 0,
      batchOfflineState: null,
      similarToFavoritesCache: [],
      alsoLikedCache: [],
      versionPoolTracks: [],
      installDismissed: localStorage.getItem('sonora_ios_install_dismissed') === '1',
      swUpdateWaiting: null,
      appVersionLabel: 'PWA (GitHub Pages)'
    };

    this.renderedTracks = new Map();
    this.renderedPlaylists = new Map();
    this.renderedArtists = new Map();
    this.renderedMixes = new Map();
    this.listLimits = new Map();
    this.coverColorCache = new Map();
    this.activeRemotePlaylist = null;
    this.toastTimer = null;
    this.suggestTimer = null;
    this._playlistFilterTimer = null;
    this.swRegistration = null;
    this._homeLoadSeq = 0;
    this._lyricsTouchLockUntil = 0;
    this._batchOfflineController = null;
    this._suppressMiniClickUntil = 0;
    this._miniGesturesBound = false;
    this._lastSyncedActiveTrackId = null;
    this._listObserver = null;
  }

  async init() {
    const oauthCallback = consumeOAuthRedirectCallback();
    if (oauthCallback?.relayedToOpener) {
      return;
    }

    await this.storage.init();
    this.recommendations.tasteTracker.rehydrate();
    this.applyTheme(this.storage.settings.themeMode);

    // Hydrate cached home immediately before rendering so first paint is instant
    const cachedHome = this.storage.getCachedHomeMood('ALL');
    if (cachedHome?.tracks?.length > 0) {
      this.state.homeTracks = cachedHome.tracks;
    }

    this.player = new SonoraPlayer({
      api: this.api,
      storage: this.storage,
      offline: this.offline,
      recommendations: this.recommendations,
      onStateChange: () => this.onPlayerTick(),
      onError: (msg) => this.showToast(msg)
    });

    this.bindGlobalEvents();
    this.registerServiceWorker();
    this.renderBanner();
    this.render();

    if (oauthCallback?.ok && oauthCallback.accessToken) {
      this.completeGoogleOAuthLogin(oauthCallback.accessToken, oauthCallback.expiresAt);
    } else if (oauthCallback && !oauthCallback.ok && oauthCallback.error) {
      this.showToast(`Ошибка входа Google: ${oauthCallback.error}`);
    }

    // Non-blocking background node discovery + SWR revalidation
    this.api.warmUpPools().catch(() => {});
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
    this.toastTimer = setTimeout(() => el.classList.add('hidden'), 2800);
  }

  async registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    try {
      const hadController = Boolean(navigator.serviceWorker.controller);
      const reg = await navigator.serviceWorker.register('./sw.js', {
        scope: './',
        updateViaCache: 'none'
      });
      this.swRegistration = reg;
      reg.update().catch(() => {});
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
        if (hadController) {
          window.location.reload();
        }
      });
    } catch {
      // Ignore
    }
  }

  isIosSafariInstallPromptNeeded() {
    if (this.state.installDismissed) return false;
    const ua = navigator.userAgent || '';
    const isIos =
      /iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    return isIos && !isStandalone;
  }

  renderBanner() {
    const slot = document.getElementById('banner-slot');
    if (!slot) return;

    if (this.state.batchOfflineState) {
      const b = this.state.batchOfflineState;
      slot.innerHTML = `
        <div class="ios-banner">
          <div class="ios-banner-text">
            <div class="ios-banner-title">Оффлайн-загрузка: ${b.done} из ${b.total}</div>
            <div class="ios-banner-sub">${escapeHtml(b.currentTitle || 'Подготовка…')} ${b.percent > 0 ? `(${b.percent}%)` : ''}</div>
            <div class="batch-progress-bar"><div class="batch-progress-fill" style="width:${Math.round((b.done / Math.max(1, b.total)) * 100)}%"></div></div>
          </div>
          <button type="button" class="btn-close-sm" data-action="cancel-batch-offline" aria-label="Отменить загрузку">✕</button>
        </div>
      `;
      return;
    }

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

  async loadHomeMood(moodId, { forceFresh = false } = {}) {
    const seq = ++this._homeLoadSeq;
    this.state.homeMood = moodId;
    this.state.homeError = '';

    const cached = this.storage.getCachedHomeMood(moodId);
    const hasCache = Boolean(cached?.tracks?.length > 0);
    if (hasCache && !forceFresh) {
      this.state.homeTracks = cached.tracks;
      this.state.homeLoading = false;
      this.state.homeRefreshing = true;
    } else {
      this.state.homeLoading = true;
      this.state.homeRefreshing = false;
    }

    if (this.state.activeTab === 'home') this.renderMain();

    const mood = MOOD_CHIPS.find((m) => m.id === moodId) || MOOD_CHIPS[0];
    try {
      const items = await this.api.search(mood.query, 'TRACKS', {
        isMoodTrending: true,
        forceFresh
      });
      if (this._homeLoadSeq !== seq) return;
      const freshTracks = items.filter((i) => i.type === 'track');
      this.state.homeLoading = false;
      this.state.homeRefreshing = false;

      if (freshTracks.length > 0) {
        const changed = !sameTrackList(this.state.homeTracks, freshTracks);
        this.state.homeTracks = freshTracks;
        await this.storage.saveCachedHomeMood(moodId, freshTracks);
        if (this.state.activeTab === 'home' && (changed || !hasCache)) {
          this.renderMain();
        }
      } else if (this.state.activeTab === 'home') {
        this.renderMain();
      }
    } catch (err) {
      if (this._homeLoadSeq !== seq) return;
      this.state.homeLoading = false;
      this.state.homeRefreshing = false;
      if (!hasCache || this.state.homeTracks.length === 0) {
        this.state.homeError = formatUserErrorRu(err, 'Не удалось загрузить подборку');
      }
      if (this.state.activeTab === 'home') this.renderMain();
    }
  }

  async runSearch(query, filter = this.state.searchFilter) {
    const clean = String(query ?? '').trim();
    this.state.searchQuery = clean;
    this.state.searchFilter = filter;
    this.state.searchError = '';
    this.state.selectedArtist = null;
    this.state.searchSuggestions = [];

    if (filter === 'LOCAL') {
      this.state.searchLoading = false;
      this.state.searchResults = this.searchLocalLibrary(clean);
      this.renderHeader();
      this.renderMain();
      return;
    }

    if (!clean) {
      this.state.searchResults = [];
      this.state.searchLoading = false;
      this.renderHeader();
      this.renderMain();
      return;
    }

    this.state.searchLoading = true;
    this.renderHeader();
    this.renderMain();
    await this.storage.recordSearchQuery(clean);

    try {
      this.state.searchResults = await this.api.search(clean, filter);
      this.state.searchLoading = false;
    } catch (err) {
      this.state.searchLoading = false;
      this.state.searchError = formatUserErrorRu(err, 'Ошибка поиска');
    }
    if (this.state.activeTab === 'search') this.renderMain();
  }

  async openArtistView(artistItem) {
    this.state.artistLoading = true;
    this.state.selectedArtist = {
      title: artistItem.title,
      subtitle: artistItem.artist,
      thumbnailUrl: artistItem.thumbnailUrl,
      tracks: []
    };
    this.renderHeader();
    this.renderMain();

    try {
      const details = await this.api.getArtistDetails(artistItem);
      this.state.selectedArtist = details;
    } catch (err) {
      this.showToast(formatUserErrorRu(err, 'Не удалось загрузить профиль артиста'));
    } finally {
      this.state.artistLoading = false;
      if (this.state.activeTab === 'search') {
        this.renderHeader();
        this.renderMain();
      }
    }
  }

  searchLocalLibrary(query) {
    const q = query.toLowerCase();
    const seen = new Set();
    const pool = [
      ...this.storage.library.favorites,
      ...this.storage.downloadedTracks,
      ...this.storage.library.history
    ];
    for (const pl of this.storage.library.playlists) {
      pool.push(...pl.tracks);
    }
    return pool
      .filter((t) => {
        if (!t?.id || seen.has(t.id)) return false;
        seen.add(t.id);
        if (!q) return true;
        return t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q);
      })
      .map((t) => ({ type: 'track', ...t }));
  }

  onPlayerTick() {
    this.renderMiniPlayer();
    const snap = this.player.getSnapshot();
    const curId = snap.currentTrack?.id || null;
    if (curId !== this._lastSyncedActiveTrackId) {
      this._syncTrackActiveState(curId);
    }
    if (this.state.playerExpanded) {
      const sheet = document.getElementById('player-sheet');
      const lyrSig = this.state.playerLyricsOpen
        ? `lyr:${snap.lyrics.loading ? 'load' : snap.lyrics.synced.length}:${snap.lyrics.plain ? 1 : 0}:${this.state.lyricsManualOpen ? 1 : 0}`
        : 'art';
      const expectedKey = `${snap.currentTrack?.id || ''}:${snap.sourceType || snap.engine}:${snap.isOfflineSource ? 'off' : 'on'}:${lyrSig}`;
      if (sheet && sheet.dataset.renderKey === expectedKey) {
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
      const wantPlaying = snap.isPlaying ? '1' : '0';
      if (playBtn.dataset.playing !== wantPlaying) {
        playBtn.dataset.playing = wantPlaying;
        playBtn.innerHTML = snap.isPlaying ? SVG.pause : SVG.play;
        playBtn.setAttribute('aria-label', snap.isPlaying ? 'Пауза' : 'Играть');
      }
    }
    if (sleepLabel) {
      sleepLabel.textContent =
        snap.sleepRemainingMs > 0 ? `${Math.ceil(snap.sleepRemainingMs / 60000)} м` : 'Таймер';
    }

    if (this.state.playerLyricsOpen && snap.lyrics?.synced?.length > 0) {
      const panel = document.getElementById('lyrics-panel');
      if (panel) {
        let activeIdx = -1;
        for (let i = 0; i < snap.lyrics.synced.length; i++) {
          if (snap.currentTime + 0.35 >= snap.lyrics.synced[i].timeSeconds) activeIdx = i;
          else break;
        }
        const prevIdx = Number(panel.dataset.activeIdx ?? -2);
        if (activeIdx !== prevIdx) {
          panel.dataset.activeIdx = String(activeIdx);
          const lines = panel.querySelectorAll('.lyric-line');
          if (prevIdx >= 0 && lines[prevIdx]) lines[prevIdx].classList.remove('active');
          if (activeIdx >= 0 && lines[activeIdx]) {
            lines[activeIdx].classList.add('active');
            if (Date.now() > this._lyricsTouchLockUntil) {
              lines[activeIdx].scrollIntoView?.({ block: 'center', behavior: 'smooth' });
            }
          }
        }
      }
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
      } else if (this.state.activeTab === 'search' && this.state.selectedArtist) {
        titleEl.textContent = this.state.selectedArtist.title;
      } else {
        titleEl.textContent = titles[this.state.activeTab] || 'Sonora';
      }
    }
    if (!actionsEl) return;

    if (this.state.activeTab === 'library' && this.state.selectedPlaylistId) {
      actionsEl.innerHTML = `<button type="button" class="icon-pill-btn" data-action="close-playlist">Назад</button>`;
    } else if (this.state.activeTab === 'search' && this.state.selectedArtist) {
      actionsEl.innerHTML = `<button type="button" class="icon-pill-btn" data-action="close-artist">Назад</button>`;
    } else if (this.state.activeTab === 'library') {
      actionsEl.innerHTML = `
        <button type="button" class="icon-pill-btn" data-action="open-create-playlist" aria-label="Создать плейлист">${SVG.plus}<span>Плейлист</span></button>
      `;
    } else if (this.state.activeTab === 'settings') {
      actionsEl.innerHTML = `<button type="button" class="icon-pill-btn" data-action="check-sw-update">Обновить</button>`;
    } else {
      const acc = this.storage.activeAccount;
      const avatarHtml = acc
        ? `<button type="button" class="header-avatar-btn" data-action="open-yt-account" title="${escapeHtml(acc.name)}" aria-label="Аккаунт">
             ${
               acc.avatarUrl
                 ? `<img src="${escapeHtml(acc.avatarUrl)}" alt="" class="header-avatar-img" />`
                 : `<span class="header-avatar-fallback">${escapeHtml((acc.name || 'S')[0].toUpperCase())}</span>`
             }
           </button>`
        : `<button type="button" class="icon-pill-btn" data-action="open-yt-account" aria-label="Войти в аккаунт">Войти</button>`;
      actionsEl.innerHTML = `
        ${avatarHtml}
        <button type="button" class="icon-pill-btn" data-action="retry-home" aria-label="Обновить ленту">${SVG.refresh}</button>
      `;
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

  _renderCollageHtml(tracks = [], sizeClass = 'track-thumb') {
    const thumbs = [];
    const seen = new Set();
    for (const t of tracks) {
      const url = getSafeThumb(t);
      if (url && !seen.has(url)) {
        seen.add(url);
        thumbs.push(url);
      }
      if (thumbs.length >= 4) break;
    }
    if (tracks.length >= 4 && thumbs.length >= 4) {
      return `
        <div class="collage-2x2 ${sizeClass}" aria-hidden="true">
          ${thumbs.slice(0, 4).map((u) => `<img src="${escapeHtml(u)}" alt="" loading="lazy" />`).join('')}
        </div>`;
    }
    return `<img src="${escapeHtml(getSafeThumb(tracks[0]))}" alt="" class="${sizeClass}" loading="lazy" />`;
  }

  _renderTrackRowHtml(
    track,
    listKey = 'default',
    idx = 0,
    { showIndex = false, playlistEditPid = null, totalCount = 0 } = {}
  ) {
    this._registerTrack(track);
    const active = this.player?.currentTrack?.id === track.id;
    const isFav = this.storage.isFavorite(track.id);
    const isOffline = this.offline.isDownloaded(track.id);
    const isDownloading = this.offline.isDownloading(track.id);
    const prog = isDownloading ? this.offline.getProgress(track.id) : null;
    const dur = track.durationSeconds ? formatTime(track.durationSeconds) : '';

    const trailingActions = playlistEditPid
      ? `
        ${idx > 0 ? `<button type="button" class="track-more-btn" data-action="pl-move-up" data-playlist-id="${playlistEditPid}" data-index="${idx}" aria-label="Выше">↑</button>` : ''}
        ${idx + 1 < totalCount ? `<button type="button" class="track-more-btn" data-action="pl-move-down" data-playlist-id="${playlistEditPid}" data-index="${idx}" aria-label="Ниже">↓</button>` : ''}
        <button type="button" class="track-more-btn danger-text" data-action="pl-remove-track" data-playlist-id="${playlistEditPid}" data-track-id="${escapeHtml(track.id)}" aria-label="Удалить">✕</button>
      `
      : `
        <button type="button" class="track-more-btn ${isFav ? 'fav-active' : ''}" data-action="toggle-favorite" data-track-id="${escapeHtml(track.id)}" aria-label="Нравится">
          ${isFav ? SVG.heart : SVG.heartOutline}
        </button>
        <button type="button" class="track-more-btn" data-action="open-track-menu" data-track-id="${escapeHtml(track.id)}" aria-label="Действия с треком">
          ${SVG.more}
        </button>
      `;

    const versionBadge =
      track.versionType && track.versionType !== 'original' && VERSION_LABELS_RU[track.versionType]
        ? `<span class="version-pill">${escapeHtml(VERSION_LABELS_RU[track.versionType])}</span>`
        : '';

    const badge = isDownloading
      ? `<span class="dl-pct-badge" data-dl-track="${escapeHtml(track.id)}">${prog?.percent > 0 ? `${prog.percent}%` : '…'}</span>`
      : isOffline
        ? `<span class="offline-dot" title="Доступно оффлайн">${SVG.checkCircle}</span>`
        : '';

    const subParts = [
      track.artist,
      track.album || '',
      track.year > 1900 ? String(track.year) : '',
      dur
    ].filter(Boolean);

    return `
      <div class="track-row ${active ? 'active-track' : ''}" data-track-id="${escapeHtml(track.id)}" data-list-key="${escapeHtml(listKey)}" data-index="${idx}">
        ${showIndex ? `<span class="track-index-num">${idx + 1}</span>` : ''}
        <img src="${escapeHtml(getSafeThumb(track))}" alt="" class="track-thumb" loading="lazy" />
        <button type="button" class="track-meta" data-action="play-track" data-track-id="${escapeHtml(track.id)}" data-list-key="${escapeHtml(listKey)}">
          <div class="track-title">
            ${escapeHtml(track.title)}
            ${versionBadge}
            ${badge}
          </div>
          <div class="track-sub">${escapeHtml(subParts.join(' • '))}</div>
        </button>
        ${trailingActions}
      </div>
    `;
  }

  _getListLimit(listKey) {
    return this.listLimits.get(listKey) || 40;
  }

  _renderChunkedTrackRowsHtml(tracks = [], listKey = 'default', opts = {}) {
    if (!Array.isArray(tracks) || tracks.length === 0) return '';
    // Register all tracks immediately so playback queues stay complete even beyond rendered viewport chunk
    for (const t of tracks) {
      this._registerTrack(t);
    }
    const limit = this._getListLimit(listKey);
    const slice = tracks.slice(0, limit);
    const rowsHtml = slice.map((t, idx) => this._renderTrackRowHtml(t, listKey, idx, opts)).join('');
    const remaining = tracks.length - slice.length;
    const moreHtml =
      remaining > 0
        ? `<div class="list-load-more-wrap" data-more-wrap="${escapeHtml(listKey)}">
             <button type="button" class="btn-secondary-full" data-action="load-more-tracks" data-list-key="${escapeHtml(listKey)}">
               Показать ещё (${remaining})
             </button>
             <div class="scroll-sentinel" data-sentinel-key="${escapeHtml(listKey)}"></div>
           </div>`
        : '';
    return `${rowsHtml}${moreHtml}`;
  }

  _observeListSentinels() {
    this._listObserver?.disconnect();
    if (typeof IntersectionObserver === 'undefined') return;
    const sentinels = document.querySelectorAll('.scroll-sentinel[data-sentinel-key]');
    if (sentinels.length === 0) return;

    this._listObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const key = entry.target?.dataset?.sentinelKey;
            if (key) this._appendNextListChunk(key);
          }
        }
      },
      { rootMargin: '260px 0px' }
    );
    sentinels.forEach((el) => this._listObserver.observe(el));
  }

  _appendNextListChunk(listKey) {
    const allTracks = this.getListForKey(listKey);
    if (!allTracks || allTracks.length === 0) return;
    const curLimit = this._getListLimit(listKey);
    if (curLimit >= allTracks.length) return;

    const nextLimit = Math.min(allTracks.length, curLimit + 40);
    this.listLimits.set(listKey, nextLimit);

    const wrap = document.querySelector(`[data-more-wrap="${this._cssEscape(listKey)}"]`);
    if (!wrap || !wrap.parentElement) {
      this.renderMain();
      return;
    }

    const opts = listKey.startsWith('playlist:')
      ? {
          showIndex: true,
          playlistEditPid:
            this.state.playlistEditMode && !this.state.playlistFilter.trim()
              ? Number(listKey.slice('playlist:'.length))
              : null,
          totalCount: allTracks.length
        }
      : listKey === 'artist'
        ? { showIndex: true }
        : {};

    const newSlice = allTracks.slice(curLimit, nextLimit);
    const html = newSlice
      .map((t, offset) => this._renderTrackRowHtml(t, listKey, curLimit + offset, opts))
      .join('');
    wrap.insertAdjacentHTML('beforebegin', html);

    const remaining = allTracks.length - nextLimit;
    if (remaining <= 0) {
      wrap.remove();
    } else {
      const btn = wrap.querySelector('[data-action="load-more-tracks"]');
      if (btn) btn.textContent = `Показать ещё (${remaining})`;
    }
  }

  _cssEscape(val) {
    return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(val) : String(val).replace(/"/g, '\\"');
  }

  _syncTrackActiveState(activeTrackId) {
    this._lastSyncedActiveTrackId = activeTrackId || null;
    document.querySelectorAll('.track-row[data-track-id]').forEach((row) => {
      row.classList.toggle('active-track', Boolean(activeTrackId) && row.dataset.trackId === activeTrackId);
    });
  }

  _syncTrackFavoriteUi(trackId, isFav) {
    const esc = this._cssEscape(trackId);
    document
      .querySelectorAll(`.track-more-btn[data-action="toggle-favorite"][data-track-id="${esc}"]`)
      .forEach((btn) => {
        btn.classList.toggle('fav-active', isFav);
        btn.innerHTML = isFav ? SVG.heart : SVG.heartOutline;
      });
    const playerFav = document.querySelector(
      `#player-sheet [data-action="toggle-favorite"][data-track-id="${esc}"]`
    );
    if (playerFav) {
      playerFav.classList.toggle('is-active', isFav);
      playerFav.innerHTML = isFav ? SVG.heart : SVG.heartOutline;
    }
  }

  _syncTrackOfflineUi(trackId) {
    const esc = this._cssEscape(trackId);
    const isOff = this.offline.isDownloaded(trackId);
    const isDl = this.offline.isDownloading(trackId);
    const prog = isDl ? this.offline.getProgress(trackId) : null;

    document.querySelectorAll(`.track-row[data-track-id="${esc}"] .track-title`).forEach((titleEl) => {
      titleEl.querySelector('.dl-pct-badge, .offline-dot')?.remove();
      if (isDl) {
        titleEl.insertAdjacentHTML(
          'beforeend',
          `<span class="dl-pct-badge" data-dl-track="${escapeHtml(trackId)}">${prog?.percent > 0 ? `${prog.percent}%` : '…'}</span>`
        );
      } else if (isOff) {
        titleEl.insertAdjacentHTML(
          'beforeend',
          `<span class="offline-dot" title="Доступно оффлайн">${SVG.checkCircle}</span>`
        );
      }
    });

    if (this.state.playerExpanded && this.player?.currentTrack?.id === trackId) {
      this.renderPlayerSheet();
    }
  }

  renderMain() {
    const main = document.getElementById('main-content');
    if (!main) return;
    this.renderedTracks.clear();
    this.renderedPlaylists.clear();
    this.renderedArtists.clear();
    this.renderedMixes.clear();
    this._lastSyncedActiveTrackId = this.player?.currentTrack?.id || null;

    if (this.state.activeTab === 'home') {
      main.innerHTML = this.renderHomeHtml();
    } else if (this.state.activeTab === 'search') {
      main.innerHTML = this.renderSearchHtml();
      const input = document.getElementById('search-query-input');
      if (input) input.value = this.state.searchQuery;
    } else if (this.state.activeTab === 'library') {
      main.innerHTML = this.renderLibraryHtml();
      const plInput = document.getElementById('playlist-filter-input');
      if (plInput) plInput.value = this.state.playlistFilter;
    } else {
      main.innerHTML = this.renderSettingsHtml();
    }
    this._observeListSentinels();
  }

  renderHomeHtml() {
    const chipsHtml = MOOD_CHIPS.map(
      (m) => `
      <button type="button" class="chip-btn ${this.state.homeMood === m.id ? 'active' : ''}" data-action="select-mood" data-mood="${escapeHtml(m.id)}">
        ${escapeHtml(m.label)}
      </button>`
    ).join('');

    const { dailyMixTracks, dailyMixSubtitle, madeForYou, similarToFavorites, alsoLikedTracks } =
      this.recommendations.buildPersonalizedMixes(this.state.homeTracks, [
        this.storage.library.favorites,
        this.storage.library.history
      ]);
    this.state.similarToFavoritesCache = similarToFavorites || [];
    this.state.alsoLikedCache = alsoLikedTracks || [];

    if (dailyMixTracks.length > 0) {
      this.renderedMixes.set('daily', {
        id: 'daily',
        title: 'Микс дня',
        subtitle: dailyMixSubtitle,
        tracks: dailyMixTracks
      });
    }

    let heroHtml = '';
    const cur = this.player?.currentTrack;
    if (cur) {
      heroHtml = `
        <div class="hero-banner">
          <img src="${escapeHtml(getSafeThumb(cur))}" alt="" class="hero-cover" />
          <div class="hero-body">
            <span class="hero-badge">${this.player.isPlaying ? 'СЕЙЧАС ИГРАЕТ' : 'ПРОДОЛЖИТЬ'}</span>
            <h2 class="hero-title">${escapeHtml(cur.title)}</h2>
            <p class="hero-sub">${escapeHtml(cur.artist)}</p>
            <div class="hero-actions">
              <button type="button" class="btn-accent-sm" data-action="toggle-play">${this.player.isPlaying ? 'Пауза' : 'Играть'}</button>
              <button type="button" class="icon-pill-btn" data-action="open-full-player">Плеер</button>
            </div>
          </div>
        </div>`;
    } else if (dailyMixTracks.length > 0) {
      heroHtml = `
        <div class="hero-banner">
          ${this._renderCollageHtml(dailyMixTracks, 'hero-cover')}
          <div class="hero-body">
            <span class="hero-badge">МИКС ДНЯ</span>
            <h2 class="hero-title">Персональный поток</h2>
            <p class="hero-sub">${escapeHtml(dailyMixSubtitle)}</p>
            <div class="hero-actions">
              <button type="button" class="btn-accent-sm" data-action="play-mix" data-mix-id="daily">Слушать</button>
              <button type="button" class="icon-pill-btn" data-action="open-mix" data-mix-id="daily">Список</button>
            </div>
          </div>
        </div>`;
    }

    const madeForYouHtml =
      madeForYou.length > 0
        ? `
      <div class="section-header">
        <h2 class="section-title">Собрано для вас</h2>
      </div>
      <div class="h-strip">
        ${madeForYou
          .map((mix) => {
            this.renderedMixes.set(mix.id, mix);
            return `
            <button type="button" class="square-card" data-action="open-mix" data-mix-id="${escapeHtml(mix.id)}">
              ${this._renderCollageHtml(mix.tracks, 'square-thumb')}
              <div class="square-title">${escapeHtml(mix.title)}</div>
              <div class="square-sub">${escapeHtml(mix.subtitle)}</div>
            </button>`;
          })
          .join('')}
      </div>`
        : '';

    const renderTrackStripSection = (title, tracks, listKey) => {
      if (!tracks || tracks.length === 0) return '';
      return `
      <div class="section-header">
        <h2 class="section-title">${escapeHtml(title)}</h2>
      </div>
      <div class="h-strip">
        ${tracks
          .slice(0, 14)
          .map((t) => {
            this._registerTrack(t);
            return `
            <button type="button" class="square-card" data-action="play-track" data-track-id="${escapeHtml(t.id)}" data-list-key="${escapeHtml(listKey)}">
              <img src="${escapeHtml(getSafeThumb(t))}" alt="" class="square-thumb" loading="lazy" />
              <div class="square-title">${escapeHtml(t.title)}</div>
              <div class="square-sub">${escapeHtml(t.artist)}</div>
            </button>`;
          })
          .join('')}
      </div>`;
    };

    const similarFavsHtml = renderTrackStripSection(
      'Похожее на любимое',
      similarToFavorites,
      'similar_favs'
    );
    const alsoLikedHtml = renderTrackStripSection(
      'Другим тоже нравится',
      alsoLikedTracks,
      'also_liked'
    );

    const quickSource = [
      ...this.storage.library.favorites,
      ...this.storage.downloadedTracks,
      ...this.storage.library.history
    ];
    const quickUnique = [];
    const seen = new Set();
    for (const t of quickSource) {
      if (t?.id && !seen.has(t.id)) {
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

    const seed = this.storage.library.favorites[0] || this.storage.library.history[0] || null;
    const rawFeed =
      this.state.homeMood === 'ALL' && seed
        ? this.recommendations.rankCandidates(this.state.homeTracks, seed)
        : this.state.homeTracks;
    const feedTracks = diversifyRecommendations(rawFeed, this.recommendations.moodProfiler);
    this.state.homeFeedTracks = feedTracks;

    let feedHtml = '';
    if (this.state.homeLoading && feedTracks.length === 0) {
      feedHtml = `<div class="state-card"><h3>Загрузка музыки…</h3><p>Подбираем треки (${escapeHtml(this.api.activeSourceLabel)})</p></div>`;
    } else if (this.state.homeError && feedTracks.length === 0) {
      feedHtml = `
        <div class="state-card">
          <h3>Нет подключения к каталогу</h3>
          <p>${escapeHtml(this.state.homeError)}</p>
          <div class="action-pills-row">
            <button type="button" class="btn-accent-sm" data-action="retry-home">Повторить</button>
            <button type="button" class="icon-pill-btn" data-action="open-routing-modal">Источники каталога</button>
          </div>
        </div>`;
    } else if (feedTracks.length > 0) {
      feedHtml = `
        <div class="grouped-card">
          ${this._renderChunkedTrackRowsHtml(feedTracks, 'home')}
        </div>`;
    }

    return `
      <div class="chips-row">${chipsHtml}</div>
      ${heroHtml}
      ${madeForYouHtml}
      ${similarFavsHtml}
      ${alsoLikedHtml}
      ${quickHtml}
      ${historyStrip}
      <div class="section-header">
        <div>
          <h2 class="section-title">Подборка дня</h2>
          <div class="section-sub-badge">${escapeHtml(this.api.activeSourceLabel)}${this.state.homeRefreshing ? ' • обновление…' : ''}</div>
        </div>
        ${feedTracks.length > 0 ? `<button type="button" class="section-action" data-action="play-all-home">Включить всё</button>` : ''}
      </div>
      ${feedHtml}
    `;
  }

  renderSearchSuggestionsHtml() {
    if (this.state.searchSuggestions.length === 0 || this.state.searchLoading) return '';
    return `<div class="chips-row">${this.state.searchSuggestions
      .map(
        (s) =>
          `<button type="button" class="chip-btn" data-action="run-saved-query" data-query="${escapeHtml(s)}">${escapeHtml(s)}</button>`
      )
      .join('')}</div>`;
  }

  renderSearchBodyHtml() {
    if (this.state.searchLoading) {
      return `<div class="state-card"><h3>Поиск…</h3><p>Ищем треки и плейлисты</p></div>`;
    }
    if (this.state.searchError) {
      return `
        <div class="state-card">
          <h3>Ошибка поиска</h3>
          <p>${escapeHtml(this.state.searchError)}</p>
          <div class="action-pills-row">
            <button type="button" class="btn-accent-sm" data-action="retry-search">Повторить</button>
            <button type="button" class="icon-pill-btn" data-action="open-routing-modal">Источники каталога</button>
          </div>
        </div>`;
    }
    if (!this.state.searchQuery && this.state.searchFilter !== 'LOCAL') {
      const hist = this.storage.library.searchHistory;
      const recentHtml =
        hist.length > 0
          ? `
        <div class="section-header">
          <h2 class="section-title">Недавние запросы</h2>
          <button type="button" class="section-action" data-action="clear-search-history">Очистить</button>
        </div>
        <div class="chips-row">
          ${hist
            .map(
              (q) => `
              <div class="chip-pill-group">
                <button type="button" class="chip-pill-main" data-action="run-saved-query" data-query="${escapeHtml(q)}">${escapeHtml(q)}</button>
                <button type="button" class="chip-pill-del" data-action="delete-search-query" data-query="${escapeHtml(q)}" aria-label="Удалить запрос">✕</button>
              </div>`
            )
            .join('')}
        </div>`
          : '';

      const genresHtml = `
        <div class="section-header">
          <h2 class="section-title">Жанры и подборки</h2>
        </div>
        <div class="genre-grid">
          ${GENRE_DISCOVERY_CARDS.map(
            (card) => `
            <button type="button" class="genre-card variant-${card.variant}" data-action="run-saved-query" data-query="${escapeHtml(card.query)}">
              <span class="genre-badge">${escapeHtml(card.badge)}</span>
              <div class="genre-title">${escapeHtml(card.title)}</div>
              <div class="genre-sub">${escapeHtml(card.subtitle)}</div>
            </button>`
          ).join('')}
        </div>`;

      return `${recentHtml}${genresHtml}`;
    }

    if (this.state.searchResults.length === 0) {
      return `<div class="state-card"><h3>Ничего не найдено</h3><p>Попробуйте изменить запрос или фильтр.</p></div>`;
    }

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
          this.renderedArtists.set(item.id, item);
          return `
            <button type="button" class="track-row" data-action="open-artist" data-artist-id="${escapeHtml(item.id)}">
              <img src="${escapeHtml(getSafeThumb(item))}" alt="" class="track-thumb round" loading="lazy" />
              <div class="track-meta">
                <div class="track-title">${escapeHtml(item.title)}</div>
                <div class="track-sub">${escapeHtml(item.artist)}</div>
              </div>
            </button>`;
        }
        return this._renderTrackRowHtml(item, 'search', idx);
      })
      .join('');
    return `<div class="grouped-card">${rows}</div>`;
  }

  renderSearchHtml() {
    if (this.state.selectedArtist) {
      const a = this.state.selectedArtist;
      return `
        <div class="state-card">
          <img src="${escapeHtml(getSafeThumb(a.thumbnailUrl))}" alt="" class="artist-hero-avatar" />
          <h3>${escapeHtml(a.title)}</h3>
          <p>${escapeHtml(a.subtitle)}</p>
          ${
            a.tracks.length > 0
              ? `<div class="action-pills-row">
                   <button type="button" class="btn-accent-sm" data-action="play-artist-all">Включить всё</button>
                   <button type="button" class="icon-pill-btn" data-action="shuffle-artist-all">Перемешать</button>
                 </div>`
              : ''
          }
        </div>
        ${
          this.state.artistLoading
            ? `<div class="state-card"><h3>Загрузка треков…</h3></div>`
            : a.tracks.length > 0
              ? `<div class="grouped-card mt-12">${this._renderChunkedTrackRowsHtml(a.tracks, 'artist', { showIndex: true })}</div>`
              : `<div class="state-card"><p>Треки не найдены</p></div>`
        }
      `;
    }

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

    return `
      <form id="search-form" class="search-bar-wrap">
        <div class="search-input-box">
          ${SVG.search}
          <input id="search-query-input" class="search-input" type="search" placeholder="Трек, артист или ссылка YouTube…" autocomplete="off" />
          ${
            this.state.searchQuery
              ? `<button type="button" class="search-clear-btn" data-action="clear-search-input" aria-label="Очистить">✕</button>`
              : ''
          }
        </div>
        <button type="submit" class="btn-accent-sm">Найти</button>
      </form>
      <div id="search-suggestions-container">${this.renderSearchSuggestionsHtml()}</div>
      ${filterHtml}
      <div id="search-results-container">${this.renderSearchBodyHtml()}</div>
    `;
  }

  _getFilteredPlaylistTracks(pl) {
    if (!pl || !Array.isArray(pl.tracks)) return [];
    const filterQ = this.state.playlistFilter.trim().toLowerCase();
    if (!filterQ) return pl.tracks;
    return pl.tracks.filter(
      (t) =>
        t.title.toLowerCase().includes(filterQ) ||
        t.artist.toLowerCase().includes(filterQ)
    );
  }

  renderPlaylistTracksHtml(pl) {
    const filterQ = this.state.playlistFilter.trim();
    const filteredTracks = this._getFilteredPlaylistTracks(pl);

    if (filteredTracks.length === 0) {
      return `<div class="state-card no-border"><p>По запросу «${escapeHtml(this.state.playlistFilter)}» ничего не найдено.</p></div>`;
    }

    const canEdit = this.state.playlistEditMode && !filterQ;
    return this._renderChunkedTrackRowsHtml(filteredTracks, `playlist:${pl.id}`, {
      showIndex: true,
      playlistEditPid: canEdit ? pl.id : null,
      totalCount: filteredTracks.length
    });
  }

  renderLibraryHtml() {
    if (this.state.selectedPlaylistId) {
      const pl = this.storage.library.playlists.find((p) => p.id === this.state.selectedPlaylistId);
      if (!pl) {
        this.state.selectedPlaylistId = null;
      } else {
        const durLabel = formatTotalDurationRu(pl.tracks);
        const offlineCount = pl.tracks.filter((t) => this.offline.isDownloaded(t.id)).length;
        const statsParts = [`${pl.tracks.length} треков`];
        if (durLabel) statsParts.push(durLabel);
        if (offlineCount > 0) statsParts.push(`${offlineCount} оффлайн`);

        return `
          <div class="state-card playlist-hero-card">
            <div class="playlist-hero-cover-wrap">
              ${this._renderCollageHtml(pl.tracks, 'playlist-hero-cover')}
            </div>
            <h3>${escapeHtml(pl.name)}</h3>
            <p>${escapeHtml(pl.description || statsParts.join(' • '))}</p>
            ${
              pl.description
                ? `<div class="playlist-stats-sub">${escapeHtml(statsParts.join(' • '))}</div>`
                : ''
            }
            ${
              pl.youtubePlaylistId
                ? `<div class="status-pill ok mt-8">Синхронизирован с YouTube Music</div>`
                : ''
            }
            <div class="action-pills-row">
              ${
                pl.tracks.length > 0
                  ? `<button type="button" class="btn-accent-sm" data-action="play-playlist" data-playlist-id="${pl.id}">Слушать</button>
                     <button type="button" class="icon-pill-btn" data-action="shuffle-playlist" data-playlist-id="${pl.id}">Перемешать</button>
                     <button type="button" class="icon-pill-btn" data-action="queue-playlist" data-playlist-id="${pl.id}">В очередь</button>
                     <button type="button" class="icon-pill-btn" data-action="download-playlist-offline" data-playlist-id="${pl.id}">${SVG.download}<span>Оффлайн</span></button>
                     <button type="button" class="icon-pill-btn" data-action="share-playlist" data-playlist-id="${pl.id}">Поделиться</button>`
                  : ''
              }
              <button type="button" class="icon-pill-btn" data-action="open-add-tracks-picker" data-playlist-id="${pl.id}">+ Добавить</button>
              ${
                pl.youtubePlaylistId
                  ? `<button type="button" class="icon-pill-btn" data-action="sync-youtube-playlist" data-playlist-id="${pl.id}">Обновить из YT</button>`
                  : ''
              }
              ${
                pl.tracks.length > 1
                  ? `<button type="button" class="icon-pill-btn ${this.state.playlistEditMode ? 'active-pill' : ''}" data-action="toggle-playlist-edit">Порядок</button>
                     <button type="button" class="icon-pill-btn" data-action="dedupe-playlist" data-playlist-id="${pl.id}">Дубликаты</button>`
                  : ''
              }
              <button type="button" class="icon-pill-btn" data-action="open-rename-playlist" data-playlist-id="${pl.id}">Изменить</button>
              <button type="button" class="icon-pill-btn danger-text" data-action="confirm-delete-playlist" data-playlist-id="${pl.id}">Удалить</button>
            </div>
            ${
              pl.tracks.length > 1
                ? `<div class="chips-row mt-12">
                     <button type="button" class="chip-btn" data-action="sort-playlist" data-playlist-id="${pl.id}" data-sort="TITLE">Сорт: А–Я</button>
                     <button type="button" class="chip-btn" data-action="sort-playlist" data-playlist-id="${pl.id}" data-sort="ARTIST">Артист</button>
                     <button type="button" class="chip-btn" data-action="sort-playlist" data-playlist-id="${pl.id}" data-sort="DURATION">Длительность</button>
                     <button type="button" class="chip-btn" data-action="sort-playlist" data-playlist-id="${pl.id}" data-sort="REVERSE">Перевернуть</button>
                   </div>`
                : ''
            }
          </div>
          ${
            pl.tracks.length > 0
              ? `<div class="search-input-box mt-12">
                   ${SVG.search}
                   <input id="playlist-filter-input" class="search-input" type="search" placeholder="Поиск в плейлисте…" autocomplete="off" />
                 </div>
                 <div id="playlist-tracks-container" class="grouped-card mt-12">
                   ${this.renderPlaylistTracksHtml(pl)}
                 </div>`
              : `<div class="state-card"><p>В этом плейлисте пока нет треков. Нажмите «+ Добавить» или используйте меню «⋯» у любого трека.</p></div>`
          }
        `;
      }
    }

    const tabs = [
      { id: 'playlists', label: 'Плейлисты' },
      { id: 'favorites', label: 'Избранное' },
      { id: 'history', label: 'История' },
      { id: 'offline', label: 'Оффлайн' }
    ];

    const subtabHtml = `
      <div class="segmented-control">
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
                .map((pl) => {
                  const dur = formatTotalDurationRu(pl.tracks);
                  return `
                <button type="button" class="track-row" data-action="open-playlist" data-playlist-id="${pl.id}">
                  ${this._renderCollageHtml(pl.tracks, 'track-thumb')}
                  <div class="track-meta">
                    <div class="track-title">${escapeHtml(pl.name)}</div>
                    <div class="track-sub">${pl.tracks.length} треков${dur ? ` • ${dur}` : ''}${pl.youtubePlaylistId ? ' • YouTube Music' : ''}</div>
                  </div>
                </button>`;
                })
                .join('')}
            </div>`
          : `<div class="state-card"><h3>Нет плейлистов</h3><p>Создайте свой плейлист или импортируйте готовый по ссылкам из YouTube Music.</p></div>`;

      return `
        ${subtabHtml}
        <button type="button" class="btn-secondary-full" data-action="open-import-yt-playlist">Импорт по ссылкам YouTube Music</button>
        <div class="spacer-12"></div>
        ${listHtml}
      `;
    }

    if (this.state.librarySubtab === 'favorites') {
      const favs = this.storage.library.favorites;
      const dur = formatTotalDurationRu(favs);
      return `
        ${subtabHtml}
        ${
          favs.length > 0
            ? `<div class="section-header">
                 <h2 class="section-title">Любимые (${favs.length}${dur ? ` • ${dur}` : ''})</h2>
                 <div class="inline-actions-row">
                   <button type="button" class="section-action" data-action="download-favorites-offline">Оффлайн</button>
                   <button type="button" class="section-action" data-action="shuffle-favorites">Перемешать</button>
                   <button type="button" class="section-action" data-action="play-favorites">Включить</button>
                 </div>
               </div>
               <div class="grouped-card">${this._renderChunkedTrackRowsHtml(favs, 'favorites')}</div>`
            : `<div class="state-card"><h3>Избранное пусто</h3><p>Нажимайте сердечко рядом с треком или в плеере, чтобы сохранять музыку сюда.</p></div>`
        }
      `;
    }

    if (this.state.librarySubtab === 'offline') {
      const offList = this.storage.downloadedTracks;
      const stats = this.offline.getStats();
      return `
        ${subtabHtml}
        ${
          offList.length > 0
            ? `<div class="section-header">
                 <h2 class="section-title">Оффлайн (${stats.count} • ${stats.formattedSize})</h2>
                 <div class="inline-actions-row">
                   <button type="button" class="section-action" data-action="shuffle-offline">Перемешать</button>
                   <button type="button" class="section-action" data-action="play-offline">Включить</button>
                   <button type="button" class="section-action danger-text" data-action="clear-offline-cache">Очистить</button>
                 </div>
               </div>
               <div class="grouped-card">${this._renderChunkedTrackRowsHtml(offList, 'offline')}</div>`
            : `<div class="state-card"><h3>Нет сохранённых треков</h3><p>Откройте меню «⋯» у любого трека или нажмите «Оффлайн» в плейлисте, чтобы слушать музыку без интернета.</p></div>`
        }
      `;
    }

    const hist = this.storage.library.history;
    return `
      ${subtabHtml}
      ${
        hist.length > 0
          ? `<div class="section-header">
               <h2 class="section-title">Недавние (${hist.length})</h2>
               <div class="inline-actions-row">
                 <button type="button" class="section-action" data-action="play-history">Включить</button>
                 <button type="button" class="section-action" data-action="clear-history">Очистить</button>
               </div>
             </div>
             <div class="grouped-card">${this._renderChunkedTrackRowsHtml(hist, 'history')}</div>`
          : `<div class="state-card"><h3>История пуста</h3><p>Прослушанные треки появятся здесь автоматически.</p></div>`
      }
    `;
  }

  renderSettingsHtml() {
    const s = this.storage.settings;
    const acc = this.storage.activeAccount;
    const accounts = this.storage.accounts;
    const offlineStats = this.offline.getStats();
    const listeningStats = this.storage.getListeningStats();

    const themeNames = { SYSTEM: 'Системная', LIGHT: 'Светлая', DARK: 'Тёмная' };
    const qualityNames = { AUTO: 'Авто (по сети)', HIGH: 'Высокое', MEDIUM: 'Среднее', LOW: 'Экономия' };

    const accTypeLabel =
      acc?.authType === 'youtube_channel'
        ? 'YouTube канал'
        : acc?.authType === 'google_oauth'
          ? 'Google аккаунт'
          : 'Профиль Sonora';
    const accSub = acc
      ? [
          acc.handle || acc.email || accTypeLabel,
          acc.syncedPlaylistsCount > 0 ? `${acc.syncedPlaylistsCount} плейлистов` : ''
        ]
          .filter(Boolean)
          .join(' • ')
      : 'Профиль Sonora или ваш канал YouTube';

    return `
      <div class="settings-group-title">Аккаунт</div>
      <div class="grouped-card">
        ${
          accounts.length > 1
            ? `<div class="account-switcher-pad">
                 <div class="chips-row">
                   ${accounts
                     .map(
                       (a) => `
                     <button type="button" class="chip-btn ${a.id === acc?.id ? 'active' : ''}" data-action="switch-yt-account" data-account-id="${escapeHtml(a.id)}">
                       ${escapeHtml(a.name)}
                     </button>`
                     )
                     .join('')}
                 </div>
               </div>`
            : ''
        }
        <button type="button" class="setting-row" data-action="open-yt-account">
          <div class="setting-row-left">
            ${
              acc?.avatarUrl
                ? `<img src="${escapeHtml(acc.avatarUrl)}" alt="" class="setting-avatar" />`
                : ''
            }
            <div>
              <div class="setting-label">${acc ? escapeHtml(acc.name) : 'Войти в аккаунт'}</div>
              <div class="setting-sub">${escapeHtml(accSub)}</div>
            </div>
          </div>
          <span class="setting-value">${acc ? 'Профиль ›' : 'Войти ›'}</span>
        </button>
      </div>

      <div class="settings-group-title">Статистика медиатеки</div>
      <div class="grouped-card">
        <div class="stats-grid-pad">
          <div class="stat-tile">
            <div class="stat-val">${listeningStats.favoritesCount}</div>
            <div class="stat-lbl">Избранное</div>
          </div>
          <div class="stat-tile">
            <div class="stat-val">${listeningStats.playlistsCount}</div>
            <div class="stat-lbl">Плейлистов</div>
          </div>
          <div class="stat-tile">
            <div class="stat-val">${listeningStats.historyCount}</div>
            <div class="stat-lbl">В истории</div>
          </div>
        </div>
        ${
          listeningStats.topArtists.length > 0
            ? `<div class="setting-row">
                 <div>
                   <div class="setting-label">Частые исполнители</div>
                   <div class="setting-sub">${escapeHtml(listeningStats.topArtists.join(' • '))}</div>
                 </div>
               </div>`
            : ''
        }
        <button type="button" class="setting-row" data-action="open-listening-stats">
          <div>
            <div class="setting-label">Подробная статистика прослушиваний</div>
            <div class="setting-sub">Включений: ${listeningStats.totalPlays} • Дослушано: ${listeningStats.completionRatePct}% • ${listeningStats.totalListenedMinutes} мин</div>
          </div>
          <span class="setting-value">Открыть ›</span>
        </button>
      </div>

      <div class="settings-group-title">Источники каталога</div>
      <div class="grouped-card">
        <button type="button" class="setting-row" data-action="open-routing-modal">
          <div>
            <div class="setting-label">Публичные источники и диагностика</div>
            <div class="setting-sub">${escapeHtml(
              s.customApiBaseUrl
                ? `Приоритетный узел: ${s.customApiBaseUrl}`
                : `Активный источник: ${this.api.activeSourceLabel}`
            )}</div>
          </div>
          <span class="setting-value">Проверить ›</span>
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
            <div class="setting-sub">Подбирать похожие треки с учётом пропусков и вкуса</div>
          </div>
          <span class="ios-switch ${s.autoplayEnabled ? 'on' : ''}" aria-hidden="true"><span class="ios-switch-thumb"></span></span>
        </button>
      </div>

      <div class="settings-group-title">Оффлайн-кэш</div>
      <div class="grouped-card">
        <button type="button" class="setting-row" data-action="open-offline-tab">
          <div>
            <div class="setting-label">Сохранённые треки</div>
            <div class="setting-sub">${offlineStats.count} треков • ${offlineStats.formattedSize}</div>
          </div>
          <span class="setting-value">Открыть ›</span>
        </button>
        ${
          offlineStats.count > 0
            ? `<button type="button" class="setting-row" data-action="clear-offline-cache">
                 <div>
                   <div class="setting-label danger-text">Очистить оффлайн-кэш</div>
                   <div class="setting-sub">Освободить ${offlineStats.formattedSize} в хранилище браузера</div>
                 </div>
                 <span class="setting-value">Удалить ›</span>
               </button>`
            : ''
        }
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

  _bindMiniPlayerGestures(mini) {
    if (!mini || this._miniGesturesBound) return;
    this._miniGesturesBound = true;

    let startX = 0;
    let startY = 0;
    let startAt = 0;
    let dx = 0;
    let locked = null; // 'h' | 'v' | null
    let tracking = false;

    const resetTransform = (animate = true) => {
      mini.style.transition = animate
        ? 'transform 0.24s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.2s ease'
        : 'none';
      mini.style.transform = 'translate3d(-50%, 0, 0)';
      mini.style.opacity = '1';
    };

    mini.addEventListener(
      'touchstart',
      (e) => {
        if (e.touches.length !== 1) return;
        if (e.target.closest('.mini-ctrl-btn')) {
          tracking = false;
          return;
        }
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        startAt = Date.now();
        dx = 0;
        locked = null;
        tracking = true;
        mini.style.transition = 'none';
      },
      { passive: true }
    );

    mini.addEventListener(
      'touchmove',
      (e) => {
        if (!tracking || e.touches.length !== 1) return;
        const curDx = e.touches[0].clientX - startX;
        const curDy = e.touches[0].clientY - startY;
        if (!locked) {
          if (Math.abs(curDx) < 8 && Math.abs(curDy) < 8) return;
          locked = Math.abs(curDx) > Math.abs(curDy) * 1.15 ? 'h' : 'v';
        }
        if (locked !== 'h') return;
        if (e.cancelable) e.preventDefault();
        dx = Math.max(-160, Math.min(160, curDx));
        mini.style.transform = `translate3d(calc(-50% + ${dx}px), 0, 0)`;
        mini.style.opacity = String(Math.max(0.42, 1 - Math.abs(dx) / 240));
      },
      { passive: false }
    );

    const finishSwipe = () => {
      if (!tracking) return;
      tracking = false;
      if (locked !== 'h') {
        resetTransform(true);
        return;
      }

      this._suppressMiniClickUntil = Date.now() + 350;
      const elapsed = Math.max(1, Date.now() - startAt);
      const velocity = Math.abs(dx) / elapsed;

      if (Math.abs(dx) > 58 || (Math.abs(dx) > 24 && velocity > 0.42)) {
        const goNext = dx < 0;
        try {
          navigator.vibrate?.(10);
        } catch {
          // Ignore
        }
        mini.style.transition = 'transform 0.14s ease-out, opacity 0.14s ease-out';
        mini.style.transform = `translate3d(calc(-50% + ${goNext ? -180 : 180}px), 0, 0)`;
        mini.style.opacity = '0';

        this.player.unlockGesture({ forcePrime: true });
        if (goNext) this.player.next(false);
        else this.player.previous();

        setTimeout(() => {
          mini.style.transition = 'none';
          mini.style.transform = `translate3d(calc(-50% + ${goNext ? 60 : -60}px), 0, 0)`;
          requestAnimationFrame(() => resetTransform(true));
        }, 120);
      } else {
        resetTransform(true);
      }
      dx = 0;
      locked = null;
    };

    mini.addEventListener('touchend', finishSwipe, { passive: true });
    mini.addEventListener('touchcancel', finishSwipe, { passive: true });
  }

  renderMiniPlayer() {
    const mini = document.getElementById('mini-player');
    if (!mini || !this.player) return;
    this._bindMiniPlayerGestures(mini);
    const snap = this.player.getSnapshot();
    const track = snap.currentTrack;
    if (!track) {
      mini.classList.add('hidden');
      mini.dataset.trackId = '';
      return;
    }

    mini.classList.remove('hidden');
    const pct = snap.duration > 0 ? Math.min(100, (snap.currentTime / snap.duration) * 100) : 0;
    const subText = snap.isBuffering ? 'Буферизация…' : track.artist;

    if (mini.dataset.trackId === track.id && mini.firstElementChild) {
      const fill = mini.querySelector('.mini-progress-fill');
      if (fill) fill.style.width = `${pct.toFixed(1)}%`;

      if (mini.dataset.subText !== subText) {
        mini.dataset.subText = subText;
        const subEl = mini.querySelector('.mini-body .track-sub');
        if (subEl) subEl.textContent = subText;
      }

      const playStr = snap.isPlaying ? '1' : '0';
      if (mini.dataset.playing !== playStr) {
        mini.dataset.playing = playStr;
        const playBtn = mini.querySelector('[data-action="toggle-play"]');
        if (playBtn) {
          playBtn.innerHTML = snap.isPlaying ? SVG.pause : SVG.play;
          playBtn.setAttribute('aria-label', snap.isPlaying ? 'Пауза' : 'Воспроизвести');
        }
      }
      return;
    }

    mini.dataset.trackId = track.id;
    mini.dataset.subText = subText;
    mini.dataset.playing = snap.isPlaying ? '1' : '0';
    mini.innerHTML = `
      <div class="mini-progress-track"><div class="mini-progress-fill" style="width:${pct.toFixed(1)}%"></div></div>
      <div class="mini-body">
        <button type="button" class="mini-open-btn" data-action="open-full-player">
          <img src="${escapeHtml(getSafeThumb(track))}" alt="" class="mini-thumb" />
          <div class="track-meta">
            <div class="track-title">${escapeHtml(track.title)}</div>
            <div class="track-sub">${escapeHtml(subText)}</div>
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
      sheet.dataset.renderKey = '';
      return;
    }

    sheet.classList.remove('hidden');
    const lyrSig = this.state.playerLyricsOpen
      ? `lyr:${snap.lyrics.loading ? 'load' : snap.lyrics.synced.length}:${snap.lyrics.plain ? 1 : 0}:${this.state.lyricsManualOpen ? 1 : 0}`
      : 'art';
    sheet.dataset.renderKey = `${track.id}:${snap.sourceType || snap.engine}:${snap.isOfflineSource ? 'off' : 'on'}:${lyrSig}`;

    const isFav = this.storage.isFavorite(track.id);
    const isOffline = this.offline.isDownloaded(track.id);
    const isDownloading = this.offline.isDownloading(track.id);
    const dlProg = isDownloading ? this.offline.getProgress(track.id) : null;
    const repeatIcon = snap.repeatMode === 'ONE' ? SVG.repeatOne : SVG.repeat;
    const sourceLabels = {
      offline: 'Оффлайн-кэш',
      piped: 'Прямое аудио (без рекламы)',
      invidious: 'Прямое аудио (без рекламы)',
      audius: 'Audius Audio (без рекламы)'
    };
    const engineLabel = snap.isOfflineSource
      ? 'Оффлайн-кэш'
      : sourceLabels[snap.sourceType] || 'Прямое аудио (без рекламы)';

    let stageHtml = '';
    if (this.state.playerLyricsOpen) {
      const lyr = snap.lyrics;
      const manualFormHtml = this.state.lyricsManualOpen
        ? `<form id="manual-lyrics-form" class="search-bar-wrap mt-8">
             <div class="search-input-box lyrics-search-box">
               <input id="manual-lyrics-input" class="search-input" type="search" placeholder="Исполнитель и название песни…" value="${escapeHtml(this.state.lyricsManualQuery || `${track.artist} ${track.title}`)}" />
             </div>
             <button type="submit" class="btn-accent-sm">Найти</button>
           </form>`
        : '';
      const headerRow = `
        <div class="lyrics-tools-bar">
          <span class="lyrics-source-tag">${lyr.source ? `Источник: ${escapeHtml(lyr.source)}` : 'Текст песни'}</span>
          <button type="button" class="icon-pill-btn player-pill-sm" data-action="toggle-manual-lyrics">Уточнить</button>
        </div>
        ${manualFormHtml}`;

      let contentHtml = '';
      if (lyr.loading) {
        contentHtml = `<p class="lyrics-muted">Поиск текста песни…</p>`;
      } else if (lyr.synced.length > 0) {
        let activeIdx = -1;
        for (let i = 0; i < lyr.synced.length; i++) {
          if (snap.currentTime + 0.35 >= lyr.synced[i].timeSeconds) activeIdx = i;
          else break;
        }
        contentHtml = lyr.synced
          .map(
            (line, idx) => `
          <button type="button" class="lyric-line ${idx === activeIdx ? 'active' : ''}" data-action="seek-lyric" data-time="${line.timeSeconds}">
            ${escapeHtml(line.text)}
          </button>`
          )
          .join('');
      } else if (lyr.plain) {
        contentHtml = `<pre class="lyrics-plain">${escapeHtml(lyr.plain)}</pre>`;
      } else {
        contentHtml = `
          <div class="lyrics-empty-wrap">
            <p class="lyrics-muted">Текст не найден автоматически.</p>
            <button type="button" class="btn-accent-sm" data-action="open-manual-lyrics">Найти текст вручную</button>
          </div>`;
      }
      stageHtml = `<div class="lyrics-panel" id="lyrics-panel" data-active-idx="-2">${headerRow}${contentHtml}</div>`;
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
        <div class="player-topbar-center">
          <div class="player-topbar-label">Сейчас играет</div>
          <span class="engine-badge">${engineLabel}</span>
        </div>
        <button type="button" class="player-ctrl-btn" data-action="open-track-menu" data-track-id="${escapeHtml(track.id)}" aria-label="Меню трека">${SVG.more}</button>
      </div>

      ${stageHtml}

      <div class="player-meta-row">
        <div class="track-meta">
          <h2 class="player-track-title">${escapeHtml(track.title)}</h2>
          <button type="button" class="player-track-artist player-artist-link" data-action="open-player-artist">${escapeHtml(track.artist)} ›</button>
        </div>
        <div class="player-meta-actions">
          <button type="button" class="player-ctrl-btn ${isOffline ? 'is-active' : ''}" data-action="${isDownloading ? 'cancel-offline-track' : 'toggle-offline-track'}" data-track-id="${escapeHtml(track.id)}" aria-label="Скачать оффлайн">
            ${isDownloading ? `<span class="dl-pct-badge">${dlProg?.percent > 0 ? `${dlProg.percent}%` : '…'}</span>` : isOffline ? SVG.checkCircle : SVG.download}
          </button>
          <button type="button" class="player-ctrl-btn ${isFav ? 'is-active' : ''}" data-action="toggle-favorite" data-track-id="${escapeHtml(track.id)}" aria-label="Нравится">
            ${isFav ? SVG.heart : SVG.heartOutline}
          </button>
        </div>
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
        <button type="button" id="full-play-btn" data-playing="${snap.isPlaying ? '1' : '0'}" class="player-play-btn" data-action="toggle-play" aria-label="${snap.isPlaying ? 'Пауза' : 'Играть'}">
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

    sheet.style.transform = '';
    sheet.style.opacity = '';
    this._updatePlayerAdaptiveAccent(track);
    this._bindPlayerInteractions();
  }

  _updatePlayerAdaptiveAccent(track) {
    const sheet = document.getElementById('player-sheet');
    if (!sheet || !track) return;
    const key = track.id || track.thumbnailUrl || '';
    const cached = this.coverColorCache.get(key);
    if (cached) {
      sheet.style.setProperty('--player-bg', cached);
      return;
    }

    const moodGradients = {
      [MoodCategory.ENERGETIC]: 'linear-gradient(180deg, #1b3528 0%, #0d1612 58%, #000000 100%)',
      [MoodCategory.WORKOUT_DRIVE]: 'linear-gradient(180deg, #3c181a 0%, #170a0b 58%, #000000 100%)',
      [MoodCategory.CHILL_FOCUS]: 'linear-gradient(180deg, #172b3b 0%, #0b141c 58%, #000000 100%)',
      [MoodCategory.NIGHT_SYNTH]: 'linear-gradient(180deg, #2f1a46 0%, #140b1f 58%, #000000 100%)',
      [MoodCategory.ACOUSTIC_CALM]: 'linear-gradient(180deg, #36291a 0%, #16110b 58%, #000000 100%)',
      [MoodCategory.MELANCHOLIC]: 'linear-gradient(180deg, #1d243b 0%, #0c101b 58%, #000000 100%)',
      [MoodCategory.JAZZ_LOUNGE]: 'linear-gradient(180deg, #3a2315 0%, #170e09 58%, #000000 100%)'
    };
    const mood = this.recommendations?.moodProfiler?.profile(track)?.mood;
    const fallbackGrad =
      moodGradients[mood] || 'linear-gradient(180deg, #1b2820 0%, #0d1210 55%, #000000 100%)';
    sheet.style.setProperty('--player-bg', fallbackGrad);

    const thumb = getSafeThumb(track);
    if (!thumb || thumb.startsWith('icons/') || typeof document === 'undefined') return;
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 12;
          canvas.height = 12;
          const ctx = canvas.getContext('2d');
          if (!ctx) return;
          ctx.drawImage(img, 0, 0, 12, 12);
          const data = ctx.getImageData(0, 0, 12, 12).data;
          let r = 0;
          let g = 0;
          let b = 0;
          let n = 0;
          for (let i = 0; i < data.length; i += 4) {
            r += data[i];
            g += data[i + 1];
            b += data[i + 2];
            n++;
          }
          if (n > 0) {
            const topR = Math.max(18, Math.min(95, Math.round((r / n) * 0.42)));
            const topG = Math.max(18, Math.min(95, Math.round((g / n) * 0.42)));
            const topB = Math.max(18, Math.min(95, Math.round((b / n) * 0.42)));
            const midR = Math.round(topR * 0.45);
            const midG = Math.round(topG * 0.45);
            const midB = Math.round(topB * 0.45);
            const grad = `linear-gradient(180deg, rgb(${topR}, ${topG}, ${topB}) 0%, rgb(${midR}, ${midG}, ${midB}) 56%, #000000 100%)`;
            this.coverColorCache.set(key, grad);
            if (this.player?.currentTrack?.id === track.id) {
              document.getElementById('player-sheet')?.style.setProperty('--player-bg', grad);
            }
          }
        } catch {
          // CORS-tainted canvas: keep mood fallback cleanly
        }
      };
      img.src = thumb;
    } catch {
      // Keep fallback gradient
    }
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

    const lyricsPanel = document.getElementById('lyrics-panel');
    if (lyricsPanel) {
      const pauseAutoScroll = () => {
        this._lyricsTouchLockUntil = Date.now() + 3500;
      };
      lyricsPanel.addEventListener('touchstart', pauseAutoScroll, { passive: true });
      lyricsPanel.addEventListener('wheel', pauseAutoScroll, { passive: true });
    }

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

    const sheet = document.getElementById('player-sheet');
    if (sheet) {
      let startX = 0;
      let startY = 0;
      let startAt = 0;
      let dy = 0;
      let locked = null; // 'v' | 'h' | null
      let dragging = false;

      sheet.ontouchstart = (e) => {
        if (e.touches.length !== 1) return;
        if (e.target.closest('#full-scrub-slider')) {
          dragging = false;
          return;
        }
        const lyricsBox = e.target.closest('#lyrics-panel');
        if (lyricsBox && lyricsBox.scrollTop > 4) {
          dragging = false;
          return;
        }
        if (sheet.scrollTop > 2) {
          dragging = false;
          return;
        }
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        startAt = Date.now();
        dy = 0;
        locked = null;
        dragging = true;
        sheet.style.transition = 'none';
      };

      sheet.ontouchmove = (e) => {
        if (!dragging || e.touches.length !== 1) return;
        const curDx = e.touches[0].clientX - startX;
        const curDy = e.touches[0].clientY - startY;
        if (!locked) {
          if (Math.abs(curDy) < 8 && Math.abs(curDx) < 8) return;
          locked = curDy > 0 && Math.abs(curDy) > Math.abs(curDx) * 1.15 ? 'v' : 'h';
        }
        if (locked !== 'v') return;
        if (curDy <= 0) {
          dy = 0;
          sheet.style.transform = 'translate3d(0, 0, 0)';
          return;
        }
        if (e.cancelable) e.preventDefault();
        dy = curDy;
        sheet.style.transform = `translate3d(0, ${dy}px, 0)`;
        sheet.style.opacity = String(Math.max(0.58, 1 - dy / 560));
      };

      const finishDrag = () => {
        if (!dragging) return;
        dragging = false;
        if (locked !== 'v' || dy <= 0) {
          sheet.style.transition = '';
          sheet.style.transform = '';
          sheet.style.opacity = '';
          return;
        }
        const elapsed = Math.max(1, Date.now() - startAt);
        const velocity = dy / elapsed;
        if (dy > 105 || (dy > 45 && velocity > 0.45)) {
          sheet.style.transition = 'transform 0.2s ease-out, opacity 0.2s ease-out';
          sheet.style.transform = 'translate3d(0, 100%, 0)';
          sheet.style.opacity = '0.4';
          setTimeout(() => {
            this.state.playerExpanded = false;
            sheet.style.transition = '';
            sheet.style.transform = '';
            sheet.style.opacity = '';
            this.renderPlayerSheet();
          }, 180);
        } else {
          sheet.style.transition = 'transform 0.24s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.2s ease';
          sheet.style.transform = 'translate3d(0, 0, 0)';
          sheet.style.opacity = '1';
          setTimeout(() => {
            sheet.style.transition = '';
          }, 240);
        }
        dy = 0;
        locked = null;
      };

      sheet.ontouchend = finishDrag;
      sheet.ontouchcancel = finishDrag;
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
    if (key === 'home') {
      return this.state.homeFeedTracks.length > 0 ? this.state.homeFeedTracks : this.state.homeTracks;
    }
    if (key === 'similar_favs') return this.state.similarToFavoritesCache;
    if (key === 'also_liked') return this.state.alsoLikedCache;
    if (key === 'versions') return this.state.versionPoolTracks;
    if (key === 'favorites') return this.storage.library.favorites;
    if (key === 'history') return this.storage.library.history;
    if (key === 'offline') return this.storage.downloadedTracks;
    if (key === 'search') return this.state.searchResults.filter((i) => i.type === 'track');
    if (key === 'artist') return this.state.selectedArtist?.tracks || [];
    if (key === 'quick') {
      return [
        ...this.storage.library.favorites,
        ...this.storage.downloadedTracks,
        ...this.storage.library.history
      ];
    }
    if (key?.startsWith('playlist:')) {
      const pid = Number(key.slice('playlist:'.length));
      const pl = this.storage.library.playlists.find((p) => p.id === pid);
      if (!pl) return [];
      return pid === this.state.selectedPlaylistId ? this._getFilteredPlaylistTracks(pl) : pl.tracks || [];
    }
    return [];
  }

  bindGlobalEvents() {
    // Graceful image fallback for broken third-party cover thumbnails
    document.addEventListener(
      'error',
      (e) => {
        const target = e.target;
        if (target?.tagName === 'IMG' && !target.dataset.fallbackApplied) {
          target.dataset.fallbackApplied = '1';
          target.src = 'icons/icon-192.png';
        }
      },
      true
    );

    // Desktop keyboard shortcuts (Space play/pause, arrows seek/skip, Escape close modals)
    document.addEventListener('keydown', (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) {
        return;
      }
      const modalOpen = !document.getElementById('modal-backdrop')?.classList.contains('hidden');
      if (e.key === 'Escape') {
        if (modalOpen) {
          this.closeModal();
        } else if (this.state.playerExpanded) {
          this.state.playerExpanded = false;
          this.renderPlayerSheet();
        }
        return;
      }
      if (modalOpen || !this.player?.currentTrack) return;

      if (e.code === 'Space') {
        e.preventDefault();
        this.player.unlockGesture();
        this.player.togglePlayPause();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (e.shiftKey) this.player.previous();
        else this.player.seekBy(-10);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (e.shiftKey) this.player.next(false);
        else this.player.seekBy(10);
      }
    });

    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.state.activeTab = btn.dataset.tab;
        if (this.state.activeTab !== 'library') {
          this.state.selectedPlaylistId = null;
          this.state.playlistEditMode = false;
        }
        if (this.state.activeTab !== 'search') this.state.selectedArtist = null;
        this.renderHeader();
        this.renderTabBar();
        this.renderMain();
      });
    });

    document.getElementById('modal-backdrop')?.addEventListener('click', (e) => {
      if (e.target.id === 'modal-backdrop') this.closeModal();
    });

    window.addEventListener('message', (event) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === 'SONORA_GOOGLE_OAUTH_TOKEN' && event.data?.accessToken) {
        this.completeGoogleOAuthLogin(event.data.accessToken, event.data.expiresAt);
      }
    });

    document.addEventListener('input', (e) => {
      if (e.target.id === 'playlist-filter-input') {
        const val = e.target.value;
        this.state.playlistFilter = val;
        const pid = this.state.selectedPlaylistId;
        const pl = this.storage.library.playlists.find((p) => p.id === pid);
        if (!pl) return;
        const applyFilter = () => {
          const container = document.getElementById('playlist-tracks-container');
          const latestPl = this.storage.library.playlists.find((p) => p.id === pid);
          if (container && latestPl) {
            this.listLimits.delete(`playlist:${pid}`);
            container.innerHTML = this.renderPlaylistTracksHtml(latestPl);
            this._observeListSentinels();
          }
        };
        clearTimeout(this._playlistFilterTimer);
        if ((pl.tracks?.length || 0) > 60) {
          this._playlistFilterTimer = setTimeout(applyFilter, 90);
        } else {
          applyFilter();
        }
        return;
      }

      if (e.target.id !== 'search-query-input') return;
      const val = e.target.value;
      this.state.searchQuery = val;

      if (this.state.searchFilter === 'LOCAL') {
        this.state.searchResults = this.searchLocalLibrary(val);
        const container = document.getElementById('search-results-container');
        if (container) {
          container.innerHTML = this.renderSearchBodyHtml();
        }
        return;
      }

      clearTimeout(this.suggestTimer);
      if (val.trim().length < 2) {
        this.state.searchSuggestions = [];
        const sugBox = document.getElementById('search-suggestions-container');
        if (sugBox) sugBox.innerHTML = '';
        return;
      }
      this.suggestTimer = setTimeout(async () => {
        const suggestions = await this.api.getSuggestions(val.trim());
        if (
          this.state.activeTab === 'search' &&
          this.state.searchQuery.trim() === val.trim() &&
          !this.state.searchLoading
        ) {
          this.state.searchSuggestions = suggestions;
          const sugBox = document.getElementById('search-suggestions-container');
          if (sugBox) sugBox.innerHTML = this.renderSearchSuggestionsHtml();
        }
      }, 280);
    });

    document.addEventListener('submit', (e) => {
      if (e.target.id === 'search-form') {
        e.preventDefault();
        const val = document.getElementById('search-query-input')?.value || '';
        this.runSearch(val, this.state.searchFilter);
      } else if (e.target.id === 'picker-search-form') {
        e.preventDefault();
        const q = document.getElementById('picker-search-input')?.value || '';
        this.runPickerSearch(Number(e.target.dataset.playlistId), q);
      } else if (e.target.id === 'manual-lyrics-form') {
        e.preventDefault();
        const q = document.getElementById('manual-lyrics-input')?.value?.trim() || '';
        if (!q || !this.player.currentTrack) return;
        this.state.lyricsManualQuery = q;
        this.state.lyricsManualOpen = false;
        this.player.loadLyricsForCurrentTrack(this.player.currentTrack, {
          force: true,
          customQuery: q
        });
      } else if (e.target.id === 'create-playlist-form') {
        e.preventDefault();
        const name = document.getElementById('new-playlist-name')?.value || '';
        const desc = document.getElementById('new-playlist-desc')?.value || '';
        this.storage
          .createPlaylist(name, desc)
          .then((pl) => {
            this.closeModal();
            this.state.activeTab = 'library';
            this.state.librarySubtab = 'playlists';
            this.state.selectedPlaylistId = pl.id;
            this.state.playlistFilter = '';
            this.state.playlistEditMode = false;
            this.render();
            this.showToast(`Плейлист «${pl.name}» создан`);
          })
          .catch((err) => this.showToast(err.message));
      } else if (e.target.id === 'rename-playlist-form') {
        e.preventDefault();
        const pid = Number(e.target.dataset.playlistId);
        const name = document.getElementById('rename-playlist-name')?.value || '';
        const desc = document.getElementById('rename-playlist-desc')?.value || '';
        this.storage
          .renamePlaylist(pid, name, desc)
          .then(() => {
            this.closeModal();
            this.render();
            this.showToast('Плейлист обновлён');
          })
          .catch((err) => this.showToast(err.message));
      } else if (e.target.id === 'import-yt-playlist-form') {
        e.preventDefault();
        const rawText = document.getElementById('yt-playlist-url')?.value || '';
        this.handleBatchLinksImport(rawText);
      } else if (e.target.id === 'account-youtube-form') {
        e.preventDefault();
        const rawChannel = document.getElementById('account-yt-channel')?.value?.trim() || '';
        this.signInWithYouTubeChannel(rawChannel);
      } else if (e.target.id === 'account-profile-form') {
        e.preventDefault();
        const name = document.getElementById('account-profile-name')?.value?.trim() || '';
        const email = document.getElementById('account-profile-email')?.value?.trim() || '';
        this.signInWithLocalProfile(name, email);
      } else if (e.target.id === 'catalog-sources-form') {
        e.preventDefault();
        const customApiBaseUrl = document.getElementById('custom-api-url')?.value?.trim() || '';
        if (customApiBaseUrl && !sanitizeHttpsUrl(customApiBaseUrl)) {
          this.showToast('Узел Piped API должен использовать https://');
          return;
        }
        this.storage
          .updateSettings({ customApiBaseUrl })
          .then(() => {
            this.api.activeInstance = null;
            this.closeModal();
            this.renderMain();
            this.loadHomeMood(this.state.homeMood, { forceFresh: true });
            this.showToast('Источники каталога обновлены');
          });
      }
    });

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
          this.showToast('Автообновление активно на HTTPS (GitHub Pages)');
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
        this.loadHomeMood(this.state.homeMood, { forceFresh: true });
      } else if (action === 'play-all-home') {
        const homeQueue = this.getListForKey('home');
        if (homeQueue.length > 0) {
          this.player.playTrack(homeQueue[0], homeQueue);
        }
      } else if (action === 'play-mix') {
        const mix = this.renderedMixes.get(btn.dataset.mixId);
        const mixTracks = mix?.tracks || [];
        if (mixTracks.length > 0) {
          this.player.playTrack(mixTracks[0], mixTracks);
        }
      } else if (action === 'open-mix') {
        const mix = this.renderedMixes.get(btn.dataset.mixId);
        if (mix) this.openMixPreviewModal(mix);
      } else if (action === 'play-mix-track') {
        const mix = this.renderedMixes.get(btn.dataset.mixId);
        const idx = Number(btn.dataset.mixIdx) || 0;
        const tracks = mix?.tracks || [];
        if (tracks[idx]) {
          this.player.playTrack(tracks[idx], tracks);
          this.closeModal();
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
        const val = document.getElementById('search-query-input')?.value || this.state.searchQuery;
        this.runSearch(val, btn.dataset.filter);
      } else if (action === 'clear-search-input') {
        this.state.searchQuery = '';
        this.state.searchResults = [];
        this.state.searchSuggestions = [];
        this.state.searchError = '';
        this.renderMain();
        document.getElementById('search-query-input')?.focus();
      } else if (action === 'retry-search') {
        this.runSearch(this.state.searchQuery, this.state.searchFilter);
      } else if (action === 'run-saved-query') {
        this.runSearch(btn.dataset.query, 'TRACKS');
      } else if (action === 'delete-search-query') {
        this.storage.removeSearchHistoryItem(btn.dataset.query).then(() => this.renderMain());
      } else if (action === 'clear-search-history') {
        this.storage.clearSearchHistory().then(() => this.renderMain());
      } else if (action === 'open-remote-playlist') {
        const item = this.renderedPlaylists.get(btn.dataset.remoteId);
        if (item) this.openRemotePlaylistModal(item);
      } else if (action === 'play-remote-track') {
        const idx = Number(btn.dataset.remoteIdx) || 0;
        const tracks = this.activeRemotePlaylist?.tracks || [];
        if (tracks[idx]) {
          this.player.playTrack(tracks[idx], tracks);
          this.closeModal();
        }
      } else if (action === 'open-artist') {
        const item = this.renderedArtists.get(btn.dataset.artistId);
        if (item) this.openArtistView(item);
      } else if (action === 'close-artist') {
        this.state.selectedArtist = null;
        this.renderHeader();
        this.renderMain();
      } else if (action === 'play-artist-all') {
        const tracks = this.state.selectedArtist?.tracks || [];
        if (tracks.length > 0) this.player.playTrack(tracks[0], tracks);
      } else if (action === 'shuffle-artist-all') {
        const tracks = this.state.selectedArtist?.tracks || [];
        if (tracks.length > 0) {
          this.player.shuffleEnabled = true;
          this.player.playTrack(tracks[Math.floor(Math.random() * tracks.length)], tracks);
        }
      } else if (action === 'set-library-subtab') {
        this.state.librarySubtab = btn.dataset.subtab;
        this.renderMain();
      } else if (action === 'open-offline-tab') {
        this.state.activeTab = 'library';
        this.state.selectedPlaylistId = null;
        this.state.librarySubtab = 'offline';
        this.render();
      } else if (action === 'open-playlist') {
        this.state.selectedPlaylistId = Number(btn.dataset.playlistId);
        this.state.playlistFilter = '';
        this.state.playlistEditMode = false;
        this.renderHeader();
        this.renderMain();
      } else if (action === 'close-playlist') {
        this.state.selectedPlaylistId = null;
        this.state.playlistFilter = '';
        this.state.playlistEditMode = false;
        this.renderHeader();
        this.renderMain();
      } else if (action === 'load-more-tracks') {
        if (btn.dataset.listKey) this._appendNextListChunk(btn.dataset.listKey);
      } else if (action === 'toggle-playlist-edit') {
        this.state.playlistEditMode = !this.state.playlistEditMode;
        this.renderMain();
      } else if (action === 'dedupe-playlist') {
        const pid = Number(btn.dataset.playlistId);
        this.storage.deduplicatePlaylistTracks(pid).then((removed) => {
          if (removed > 0) {
            this.renderMain();
            this.showToast(`Удалено дубликатов: ${removed}`);
          } else {
            this.showToast('Дубликатов не найдено');
          }
        });
      } else if (action === 'sync-youtube-playlist') {
        const pid = Number(btn.dataset.playlistId);
        this.syncYouTubePlaylistById(pid);
      } else if (action === 'sort-playlist') {
        const pid = Number(btn.dataset.playlistId);
        const mode = btn.dataset.sort;
        this.storage.sortPlaylistTracks(pid, mode).then((ok) => {
          if (ok) {
            this.renderMain();
            this.showToast('Плейлист отсортирован');
          }
        });
      } else if (action === 'pl-move-up' || action === 'pl-move-down') {
        const pid = Number(btn.dataset.playlistId);
        const idx = Number(btn.dataset.index);
        const targetIdx = action === 'pl-move-up' ? idx - 1 : idx + 1;
        this.storage.moveTrackInPlaylist(pid, idx, targetIdx).then((ok) => {
          if (ok) this.renderMain();
        });
      } else if (action === 'pl-remove-track') {
        const pid = Number(btn.dataset.playlistId);
        const tid = btn.dataset.trackId;
        this.storage.removeTrackFromPlaylist(pid, tid).then(() => {
          this.renderMain();
          this.showToast('Трек удалён из плейлиста');
        });
      } else if (action === 'play-playlist') {
        const pl = this.storage.library.playlists.find((p) => p.id === Number(btn.dataset.playlistId));
        if (pl && pl.tracks.length > 0) this.player.playTrack(pl.tracks[0], pl.tracks);
      } else if (action === 'shuffle-playlist') {
        const pl = this.storage.library.playlists.find((p) => p.id === Number(btn.dataset.playlistId));
        if (pl && pl.tracks.length > 0) {
          this.player.shuffleEnabled = true;
          this.player.playTrack(pl.tracks[Math.floor(Math.random() * pl.tracks.length)], pl.tracks);
        }
      } else if (action === 'queue-playlist') {
        const pl = this.storage.library.playlists.find((p) => p.id === Number(btn.dataset.playlistId));
        if (pl && pl.tracks.length > 0) {
          this.player.addTracksToQueue(pl.tracks).then((added) => {
            this.showToast(added > 0 ? `Добавлено в очередь: ${added}` : 'Все треки уже в очереди');
          });
        }
      } else if (action === 'share-playlist') {
        const pl = this.storage.library.playlists.find((p) => p.id === Number(btn.dataset.playlistId));
        if (pl) this.sharePlaylist(pl);
      } else if (action === 'share-track') {
        const track = this.renderedTracks.get(btn.dataset.trackId) || this.player.currentTrack;
        if (track) this.shareTrack(track);
      } else if (action === 'download-playlist-offline') {
        const pl = this.storage.library.playlists.find((p) => p.id === Number(btn.dataset.playlistId));
        if (pl) this.downloadTracksBatchOffline(pl.tracks);
      } else if (action === 'download-favorites-offline') {
        this.downloadTracksBatchOffline(this.storage.library.favorites);
      } else if (action === 'cancel-batch-offline') {
        this._batchOfflineController?.abort();
        this.state.batchOfflineState = null;
        this.renderBanner();
        this.showToast('Пакетная загрузка остановлена');
      } else if (action === 'cancel-offline-track') {
        this.offline.cancelDownload(btn.dataset.trackId);
        this.closeModal();
        if (this.state.playerExpanded) this.renderPlayerSheet();
        this.renderMain();
        this.showToast('Загрузка отменена');
      } else if (action === 'open-add-tracks-picker') {
        const pid = Number(btn.dataset.playlistId);
        this.openAddTracksPickerModal(pid);
      } else if (action === 'picker-set-tab') {
        this.state.pickerState.tab = btn.dataset.pickerTab;
        this.renderPickerModal();
      } else if (action === 'pick-track-for-playlist') {
        const pid = Number(btn.dataset.playlistId);
        const track = this.renderedTracks.get(btn.dataset.trackId);
        if (track) {
          this.storage.addTrackToPlaylist(pid, track).then((added) => {
            this.renderPickerModal();
            this.renderMain();
            this.showToast(added ? 'Добавлено в плейлист' : 'Уже в плейлисте');
          });
        }
      } else if (action === 'open-rename-playlist') {
        const pl = this.storage.library.playlists.find((p) => p.id === Number(btn.dataset.playlistId));
        if (pl) this.openModal(buildRenamePlaylistModalHtml(pl));
      } else if (action === 'confirm-delete-playlist') {
        const pl = this.storage.library.playlists.find((p) => p.id === Number(btn.dataset.playlistId));
        if (pl) this.openModal(buildDeletePlaylistModalHtml(pl));
      } else if (action === 'delete-playlist') {
        const pid = Number(btn.dataset.playlistId);
        this.storage.deletePlaylist(pid).then(() => {
          this.closeModal();
          this.state.selectedPlaylistId = null;
          this.render();
          this.showToast('Плейлист удалён');
        });
      } else if (action === 'play-favorites') {
        const favs = this.storage.library.favorites;
        if (favs.length > 0) this.player.playTrack(favs[0], favs);
      } else if (action === 'shuffle-favorites') {
        const favs = this.storage.library.favorites;
        if (favs.length > 0) {
          this.player.shuffleEnabled = true;
          this.player.playTrack(favs[Math.floor(Math.random() * favs.length)], favs);
        }
      } else if (action === 'play-offline') {
        const list = this.storage.downloadedTracks;
        if (list.length > 0) this.player.playTrack(list[0], list);
      } else if (action === 'shuffle-offline') {
        const list = this.storage.downloadedTracks;
        if (list.length > 0) {
          this.player.shuffleEnabled = true;
          this.player.playTrack(list[Math.floor(Math.random() * list.length)], list);
        }
      } else if (action === 'clear-offline-cache') {
        this.offline.clearAll().then(() => {
          this.renderMain();
          this.showToast('Оффлайн-кэш очищен');
        });
      } else if (action === 'play-history') {
        const hist = this.storage.library.history;
        if (hist.length > 0) this.player.playTrack(hist[0], hist);
      } else if (action === 'clear-history') {
        this.storage.clearHistory().then(() => this.renderMain());
      } else if (action === 'open-create-playlist') {
        this.openModal(buildCreatePlaylistModalHtml());
      } else if (action === 'open-import-yt-playlist') {
        this.openModal(buildImportPlaylistModalHtml());
      } else if (action === 'open-full-player') {
        if (Date.now() < this._suppressMiniClickUntil) return;
        this.state.playerExpanded = true;
        this.renderPlayerSheet();
      } else if (action === 'close-full-player') {
        this.state.playerExpanded = false;
        this.renderPlayerSheet();
      } else if (action === 'open-player-artist') {
        const artistName = this.player?.currentTrack?.artist;
        if (artistName) {
          this.state.playerExpanded = false;
          this.renderPlayerSheet();
          this.openArtistByName(artistName);
        }
      } else if (action === 'menu-open-artist') {
        const track = this.renderedTracks.get(btn.dataset.trackId) || this.player.currentTrack;
        this.closeModal();
        if (track?.artist) {
          this.state.playerExpanded = false;
          this.renderPlayerSheet();
          this.openArtistByName(track.artist);
        }
      } else if (action === 'toggle-play') {
        this.player.unlockGesture();
        this.player.togglePlayPause();
      } else if (action === 'next-track') {
        this.player.unlockGesture({ forcePrime: true });
        this.player.next(false);
      } else if (action === 'prev-track') {
        this.player.unlockGesture({ forcePrime: true });
        this.player.previous();
      } else if (action === 'toggle-shuffle') {
        this.player.toggleShuffle();
      } else if (action === 'cycle-repeat') {
        this.player.cycleRepeat();
      } else if (action === 'toggle-lyrics') {
        this.state.playerLyricsOpen = !this.state.playerLyricsOpen;
        this.state.lyricsManualOpen = false;
        this.renderPlayerSheet();
      } else if (action === 'toggle-manual-lyrics' || action === 'open-manual-lyrics') {
        this.state.lyricsManualOpen = action === 'open-manual-lyrics' ? true : !this.state.lyricsManualOpen;
        this.renderPlayerSheet();
        document.getElementById('manual-lyrics-input')?.focus();
      } else if (action === 'seek-lyric') {
        this.player.seekTo(Number(btn.dataset.time) || 0);
      } else if (action === 'cycle-speed') {
        const speeds = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
        const idx = speeds.indexOf(this.player.playbackSpeed);
        this.player.setPlaybackSpeed(speeds[(idx + 1) % speeds.length]);
      } else if (action === 'open-sleep-timer') {
        this.openModal(buildSleepTimerModalHtml());
      } else if (action === 'set-sleep') {
        const mins = Number(btn.dataset.minutes) || 0;
        this.player.setSleepTimer(mins);
        this.closeModal();
        this.showToast(mins > 0 ? `Таймер сна на ${mins} мин.` : 'Таймер сна выключен');
      } else if (action === 'open-queue') {
        this.openQueueModal();
      } else if (action === 'jump-queue') {
        const idx = Number(btn.dataset.qindex);
        if (idx >= 0 && idx < this.player.queue.length) {
          this.player.playTrack(this.player.queue[idx], this.player.queue);
        }
        this.closeModal();
      } else if (action === 'queue-move-up' || action === 'queue-move-down') {
        const idx = Number(btn.dataset.qindex);
        const target = action === 'queue-move-up' ? idx - 1 : idx + 1;
        this.player.moveQueueTrack(idx, target).then(() => this.openQueueModal());
      } else if (action === 'queue-remove') {
        const idx = Number(btn.dataset.qindex);
        this.player.removeFromQueue(idx).then(() => {
          if (this.player.queue.length === 0) this.closeModal();
          else this.openQueueModal();
        });
      } else if (action === 'clear-queue') {
        this.player.clearQueue().then(() => {
          this.closeModal();
          this.showToast('Очередь очищена');
        });
      } else if (action === 'toggle-favorite') {
        const track = this.renderedTracks.get(btn.dataset.trackId) || this.player.currentTrack;
        if (track) {
          this.storage.toggleFavorite(track).then((added) => {
            this.recommendations.tasteTracker.recordSignal(
              track,
              added ? ImplicitSignalType.FAVORITE_ADDED : ImplicitSignalType.FAVORITE_REMOVED
            );
            this._syncTrackFavoriteUi(track.id, added);
            if (
              (this.state.activeTab === 'library' && this.state.librarySubtab === 'favorites') ||
              this.state.activeTab === 'settings'
            ) {
              this.renderMain();
            }
            this.showToast(added ? 'Добавлено в Избранное' : 'Удалено из Избранного');
          });
        }
      } else if (action === 'toggle-offline-track') {
        const track = this.renderedTracks.get(btn.dataset.trackId) || this.player.currentTrack;
        if (track) {
          this.closeModal();
          this.toggleOfflineTrack(track);
        }
      } else if (action === 'open-track-menu') {
        const track = this.renderedTracks.get(btn.dataset.trackId) || this.player.currentTrack;
        if (track) this.openTrackMenu(track);
      } else if (action === 'menu-play-next') {
        const track = this.renderedTracks.get(btn.dataset.trackId) || this.player.currentTrack;
        if (track) this.player.playNextInQueue(track).then(() => this.showToast('Сыграет следующим'));
        this.closeModal();
      } else if (action === 'menu-add-queue') {
        const track = this.renderedTracks.get(btn.dataset.trackId) || this.player.currentTrack;
        if (track) {
          this.player.addTracksToQueue([track]).then((added) => {
            this.showToast(added > 0 ? 'Добавлено в очередь' : 'Уже в очереди');
          });
        }
        this.closeModal();
      } else if (action === 'menu-start-radio') {
        const track = this.renderedTracks.get(btn.dataset.trackId) || this.player.currentTrack;
        this.closeModal();
        if (track) this.player.startRadio(track);
      } else if (action === 'menu-open-versions') {
        const track = this.renderedTracks.get(btn.dataset.trackId) || this.player.currentTrack;
        if (track) this.openTrackVersionsModal(track, { fetchCatalog: false });
      } else if (action === 'search-more-versions') {
        const track = this.renderedTracks.get(btn.dataset.trackId) || this.player.currentTrack;
        if (track) this.openTrackVersionsModal(track, { fetchCatalog: true });
      } else if (action === 'play-version-track') {
        const track = this.renderedTracks.get(btn.dataset.trackId);
        if (track) {
          const list = this.state.versionPoolTracks.length > 0 ? this.state.versionPoolTracks : [track];
          this.player.playTrack(track, list);
          this.closeModal();
        }
      } else if (action === 'export-offline-file') {
        this.exportOfflineAudioTrack(btn.dataset.trackId);
      } else if (action === 'open-listening-stats') {
        const stats = this.storage.getListeningStats();
        this.openModal(
          buildListeningStatsModalHtml(stats, (m) => this.recommendations.moodProfiler.moodLabelRu(m))
        );
      } else if (action === 'menu-add-playlist') {
        const track = this.renderedTracks.get(btn.dataset.trackId) || this.player.currentTrack;
        if (track) {
          this._registerTrack(track);
          this.openModal(buildAddToPlaylistModalHtml(track, this.storage.library.playlists));
        }
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
          const pid = this.state.selectedPlaylistId;
          const vid = btn.dataset.trackId;
          this.storage.removeTrackFromPlaylist(pid, vid).then(() => {
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
        const order = ['AUTO', 'HIGH', 'MEDIUM', 'LOW'];
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
      } else if (action === 'open-routing-modal') {
        this.openCatalogSourcesModal();
      } else if (action === 'test-catalog-health') {
        this.testCatalogHealthFromModal();
      } else if (action === 'open-yt-account') {
        this.state.accountShowAddForm = false;
        this.state.accountStatusMsg = '';
        this.openAccountModal();
      } else if (action === 'set-account-tab') {
        this.state.accountModalTab = btn.dataset.accountTab === 'profile' ? 'profile' : 'youtube';
        this.state.accountStatusMsg = '';
        this.openAccountModal();
      } else if (action === 'toggle-add-account') {
        this.state.accountShowAddForm = !this.state.accountShowAddForm;
        this.state.accountStatusMsg = '';
        this.openAccountModal();
      } else if (action === 'sync-active-account') {
        this.syncActiveAccount();
      } else if (action === 'switch-yt-account') {
        this.storage.switchAccount(btn.dataset.accountId).then(() => {
          this.state.accountShowAddForm = false;
          this.state.accountStatusMsg = '';
          this.render();
          if (!document.getElementById('modal-backdrop')?.classList.contains('hidden')) {
            this.openAccountModal();
          }
          this.showToast(`Аккаунт: ${this.storage.activeAccount?.name || 'Sonora'}`);
        });
      } else if (action === 'remove-current-account') {
        const acc = this.storage.accounts.find((a) => a.id === btn.dataset.accountId);
        if (acc?.accessToken) {
          revokeGoogleOAuthToken(acc.accessToken).catch(() => {});
        }
        this.storage.removeAccount(btn.dataset.accountId).then(() => {
          this.state.accountShowAddForm = false;
          this.state.accountStatusMsg = '';
          this.closeModal();
          this.render();
          this.showToast('Вы вышли из аккаунта');
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

  openQueueModal() {
    this.openModal(
      buildQueueModalHtml({
        queue: this.player.queue,
        currentIndex: this.player.currentIndex,
        getSafeThumb
      })
    );
  }

  openMixPreviewModal(mix) {
    this.openModal(buildMixPreviewModalHtml(mix, getSafeThumb));
    const tracks = mix.tracks || [];
    document.getElementById('mix-modal-play')?.addEventListener('click', () => {
      if (tracks.length > 0) this.player.playTrack(tracks[0], tracks);
      this.closeModal();
    });
    document.getElementById('mix-modal-shuffle')?.addEventListener('click', () => {
      if (tracks.length > 0) {
        this.player.shuffleEnabled = true;
        this.player.playTrack(tracks[Math.floor(Math.random() * tracks.length)], tracks);
      }
      this.closeModal();
    });
    document.getElementById('mix-modal-queue')?.addEventListener('click', async () => {
      const added = await this.player.addTracksToQueue(tracks);
      this.closeModal();
      this.showToast(added > 0 ? `Добавлено в очередь: ${added}` : 'Треки уже в очереди');
    });
    document.getElementById('mix-modal-save')?.addEventListener('click', async () => {
      try {
        await this.storage.createPlaylist(mix.title || 'Персональный микс', mix.subtitle || '', tracks);
        this.closeModal();
        if (this.state.activeTab === 'library') this.renderMain();
        this.showToast('Микс сохранён в Медиатеку');
      } catch (err) {
        this.showToast(formatUserErrorRu(err, 'Не удалось сохранить микс'));
      }
    });
  }

  async handleBatchLinksImport(rawText) {
    const lines = String(rawText || '')
      .split(/[\r\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const playlistIds = [];
    const videoIds = [];
    const seenPls = new Set();
    const seenVids = new Set();

    for (const line of lines) {
      const pid = extractPlaylistId(line);
      if (pid && !seenPls.has(pid)) {
        seenPls.add(pid);
        playlistIds.push(pid);
        continue;
      }
      const vid = extractVideoId(line);
      if (vid && !seenVids.has(vid)) {
        seenVids.add(vid);
        videoIds.push(vid);
      }
    }

    if (playlistIds.length === 0 && videoIds.length === 0) {
      this.showToast('Не найдено корректных ссылок или ID YouTube Music');
      return;
    }

    this.showToast(`Импортируем (${playlistIds.length + videoIds.length})…`);
    let playlistsImported = 0;
    let totalTracks = 0;
    let lastPlaylistId = null;

    for (const pid of playlistIds) {
      try {
        const remote = await this.api.getPlaylist(pid);
        const { playlist, addedCount } = await this.storage.mergePlaylist(
          remote.title,
          remote.description,
          remote.tracks,
          remote.id
        );
        playlistsImported++;
        totalTracks += addedCount;
        lastPlaylistId = playlist.id;
      } catch {
        // Continue remaining playlist links
      }
    }

    if (videoIds.length > 0) {
      const importedTracks = [];
      for (const vid of videoIds.slice(0, 30)) {
        try {
          const info = await this.api.getStreamInfo(vid, 'HIGH');
          const clean = sanitizeTrack({
            id: vid,
            title: info?.title || `YouTube трек (${vid})`,
            artist: info?.artist || 'YouTube Music',
            album: info?.album || '',
            year: info?.year || 0,
            genre: info?.genre || '',
            moodTags: info?.moodTags || [],
            durationSeconds: info?.durationSeconds || 0,
            thumbnailUrl: info?.thumbnailUrl || `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`
          });
          if (clean) importedTracks.push(clean);
        } catch {
          importedTracks.push({
            id: vid,
            title: `YouTube трек (${vid})`,
            artist: 'YouTube Music',
            durationSeconds: 0,
            thumbnailUrl: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`
          });
        }
      }
      if (importedTracks.length > 0) {
        const { playlist, addedCount } = await this.storage.mergePlaylist(
          'Импорт по ссылкам',
          'Добавлено вручную по ссылкам YouTube Music',
          importedTracks,
          null
        );
        playlistsImported++;
        totalTracks += addedCount;
        lastPlaylistId = playlist.id;
      }
    }

    this.closeModal();
    if (lastPlaylistId) {
      this.state.activeTab = 'library';
      this.state.librarySubtab = 'playlists';
      this.state.selectedPlaylistId = lastPlaylistId;
      this.state.playlistFilter = '';
    }
    this.render();
    this.showToast(
      playlistsImported > 0
        ? `Импортировано плейлистов: ${playlistsImported}, треков: ${totalTracks}`
        : 'Не удалось загрузить данные по этим ссылкам'
    );
  }

  _updateInlineDownloadProgress(trackId, percent) {
    document.querySelectorAll(`[data-dl-track="${this._cssEscape(trackId)}"]`).forEach((el) => {
      el.textContent = percent > 0 ? `${percent}%` : '…';
    });
    if (this.state.playerExpanded && this.player.currentTrack?.id === trackId) {
      const badge = document.querySelector('#player-sheet .player-meta-actions .dl-pct-badge');
      if (badge) badge.textContent = percent > 0 ? `${percent}%` : '…';
    }
  }

  async toggleOfflineTrack(track) {
    const onOfflineTab = this.state.activeTab === 'library' && this.state.librarySubtab === 'offline';
    if (this.offline.isDownloaded(track.id)) {
      await this.offline.removeTrack(track.id);
      this._syncTrackOfflineUi(track.id);
      if (onOfflineTab) this.renderMain();
      this.showToast('Трек удалён из оффлайн-кэша');
      return;
    }

    try {
      this.showToast(`Скачиваем «${track.title}»…`);
      const info = await this.api.getStreamInfo(track.id, this.storage.settings.audioQuality);
      const initialCandidates =
        Array.isArray(info.streamCandidates) && info.streamCandidates.length > 0
          ? info.streamCandidates
          : [info.proxyCacheUrl || info.streamUrl].filter(Boolean);
      const corsSafeCandidates = await this.api.getOfflineStreamCandidates(
        track.id,
        this.storage.settings.audioQuality,
        initialCandidates
      );

      this.offline.downloadingIds.add(track.id);
      this._syncTrackOfflineUi(track.id);

      const bytes = await this.offline.downloadTrackWithCandidates(track, corsSafeCandidates, {
        onProgress: ({ trackId, percent }) => this._updateInlineDownloadProgress(trackId, percent)
      });

      this.recommendations.tasteTracker.recordSignal(track, ImplicitSignalType.DOWNLOADED);
      this._syncTrackOfflineUi(track.id);
      if (onOfflineTab) this.renderMain();
      this.showToast(`Сохранено оффлайн (${formatBytesRu(bytes)})`);
    } catch (err) {
      this._syncTrackOfflineUi(track.id);
      if (err?.name !== 'AbortError') {
        this.showToast(formatUserErrorRu(err, 'Ошибка оффлайн-загрузки'));
      }
    }
  }

  async downloadTracksBatchOffline(tracks = []) {
    const missing = tracks.filter((t) => t?.id && !this.offline.isDownloaded(t.id));
    if (missing.length === 0) {
      this.showToast('Все треки уже доступны оффлайн');
      return;
    }

    this._batchOfflineController?.abort();
    this._batchOfflineController = new AbortController();
    const signal = this._batchOfflineController.signal;

    this.state.batchOfflineState = {
      done: 0,
      total: missing.length,
      currentTitle: missing[0]?.title || '',
      percent: 0
    };
    this.renderBanner();

    let okCount = 0;
    for (let i = 0; i < missing.length; i++) {
      if (signal.aborted) break;
      const track = missing[i];
      this.state.batchOfflineState = {
        done: i,
        total: missing.length,
        currentTitle: track.title,
        percent: 0
      };
      this.renderBanner();

      try {
        const info = await this.api.getStreamInfo(track.id, this.storage.settings.audioQuality);
        const initialCandidates =
          Array.isArray(info.streamCandidates) && info.streamCandidates.length > 0
            ? info.streamCandidates
            : [info.proxyCacheUrl || info.streamUrl].filter(Boolean);
        const candidates = await this.api.getOfflineStreamCandidates(
          track.id,
          this.storage.settings.audioQuality,
          initialCandidates
        );
        if (candidates.length === 0) continue;
        await this.offline.downloadTrackWithCandidates(track, candidates, {
          signal,
          onProgress: ({ percent }) => {
            if (this.state.batchOfflineState) {
              this.state.batchOfflineState.percent = percent;
              this.renderBanner();
            }
          }
        });
        okCount++;
      } catch (err) {
        if (signal.aborted || err?.name === 'AbortError') break;
      }
    }

    const aborted = signal.aborted;
    this.state.batchOfflineState = null;
    this._batchOfflineController = null;
    this.renderBanner();
    this.renderMain();
    if (!aborted) {
      this.showToast(`Сохранено оффлайн: ${okCount} из ${missing.length}`);
    }
  }

  async sharePlaylist(playlist) {
    const lines = [
      `Плейлист «${playlist.name}» (${playlist.tracks.length} треков):`,
      ...playlist.tracks.slice(0, 15).map((t, i) => `${i + 1}. ${t.artist} — ${t.title}`)
    ];
    if (playlist.youtubePlaylistId) {
      lines.push(`https://music.youtube.com/playlist?list=${playlist.youtubePlaylistId}`);
    }
    const text = lines.join('\n');
    try {
      if (navigator.share) {
        await navigator.share({ title: playlist.name, text });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        this.showToast('Список треков скопирован в буфер обмена');
      }
    } catch {
      // User cancelled share sheet
    }
  }

  async shareTrack(track) {
    const ytLink = !String(track.id).startsWith('aud:')
      ? `https://music.youtube.com/watch?v=${track.id}`
      : '';
    const text = ytLink ? `${track.artist} — ${track.title}\n${ytLink}` : `${track.artist} — ${track.title}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: track.title, text, url: ytLink || undefined });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        this.closeModal();
        this.showToast('Ссылка на трек скопирована');
      }
    } catch {
      // Cancelled
    }
  }

  openAddTracksPickerModal(playlistId) {
    this.state.pickerState = {
      playlistId,
      tab: 'search',
      query: '',
      results: this.state.homeTracks.slice(0, 20),
      loading: false
    };
    this.renderPickerModal();
  }

  async runPickerSearch(playlistId, query) {
    const q = String(query || '').trim();
    this.state.pickerState = {
      playlistId,
      tab: 'search',
      query: q,
      results: [],
      loading: Boolean(q)
    };
    this.renderPickerModal();
    if (!q) return;
    try {
      const items = await this.api.search(q, 'TRACKS');
      this.state.pickerState.results = items.filter((i) => i.type === 'track');
    } catch (err) {
      this.showToast(formatUserErrorRu(err, 'Ошибка поиска'));
    } finally {
      this.state.pickerState.loading = false;
      this.renderPickerModal();
    }
  }

  renderPickerModal() {
    const st = this.state.pickerState;
    const pl = this.storage.library.playlists.find((p) => p.id === st.playlistId);
    const playlistTrackIds = new Set((pl?.tracks || []).map((t) => t.id));
    this.openModal(
      buildAddTracksPickerModalHtml({
        playlistId: st.playlistId,
        tab: st.tab,
        query: st.query,
        results: st.results,
        loading: st.loading,
        playlistTrackIds,
        favorites: this.storage.library.favorites,
        history: this.storage.library.history,
        registerTrack: (t) => this._registerTrack(t),
        getSafeThumb
      })
    );
  }

  openTrackMenu(track) {
    this._registerTrack(track);
    const isFav = this.storage.isFavorite(track.id);
    const isOffline = this.offline.isDownloaded(track.id);
    const isDownloading = this.offline.isDownloading(track.id);
    const progressPct = isDownloading ? (this.offline.getProgress(track.id)?.percent || 0) : 0;
    const canRemoveFromPl = this.state.activeTab === 'library' && Boolean(this.state.selectedPlaylistId);
    this.openModal(
      buildTrackMenuHtml(track, { isFav, isOffline, isDownloading, progressPct, canRemoveFromPl })
    );
  }

  async openTrackVersionsModal(track, { fetchCatalog = false } = {}) {
    this._registerTrack(track);
    const localPool = [
      ...Array.from(this.renderedTracks.values()),
      ...this.state.homeTracks,
      ...this.storage.library.favorites,
      ...this.storage.library.history,
      ...this.storage.library.playlists.flatMap((pl) => pl.tracks || [])
    ];
    let grouped = groupTrackVersions(track, localPool);
    for (const t of grouped.all) this._registerTrack(t);
    this.state.versionPoolTracks = grouped.all;

    this.openModal(
      buildTrackVersionsModalHtml(track, grouped, {
        loadingCatalog: fetchCatalog,
        getSafeThumb
      })
    );

    if (!fetchCatalog) return;
    try {
      const remoteVersions = await this.api.getTrackVersions(track);
      grouped = groupTrackVersions(track, [...localPool, ...remoteVersions]);
      for (const t of grouped.all) this._registerTrack(t);
      this.state.versionPoolTracks = grouped.all;
      if (!document.getElementById('modal-backdrop')?.classList.contains('hidden')) {
        this.openModal(
          buildTrackVersionsModalHtml(track, grouped, {
            loadingCatalog: false,
            getSafeThumb
          })
        );
      }
    } catch (err) {
      if (!document.getElementById('modal-backdrop')?.classList.contains('hidden')) {
        this.openModal(
          buildTrackVersionsModalHtml(track, grouped, {
            loadingCatalog: false,
            getSafeThumb
          })
        );
      }
      this.showToast(formatUserErrorRu(err, 'Не удалось найти дополнительные версии'));
    }
  }

  async exportOfflineAudioTrack(trackId) {
    try {
      const { blob, filename } = await this.offline.getOfflineBlobForExport(trackId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      this.closeModal();
      this.showToast(`Сохраняем файл: ${filename}`);
    } catch (err) {
      this.showToast(formatUserErrorRu(err, 'Не удалось выгрузить аудиофайл'));
    }
  }

  async openRemotePlaylistModal(item) {
    this.openModal(`<h3 class="modal-title">${escapeHtml(item.title)}</h3><p class="modal-desc">Загрузка треков плейлиста…</p>`);
    try {
      const remote = item.tracks ? item : await this.api.getPlaylist(item.id);
      const tracks = remote.tracks || [];
      this.activeRemotePlaylist = { remote, tracks };
      this.openModal(buildRemotePlaylistModalHtml(remote, item, tracks, getSafeThumb));
      document.getElementById('remote-pl-play')?.addEventListener('click', () => {
        if (tracks.length > 0) this.player.playTrack(tracks[0], tracks);
        this.closeModal();
      });
      document.getElementById('remote-pl-queue')?.addEventListener('click', async () => {
        const added = await this.player.addTracksToQueue(tracks);
        this.closeModal();
        this.showToast(added > 0 ? `Добавлено в очередь: ${added}` : 'Треки уже в очереди');
      });
      document.getElementById('remote-pl-save')?.addEventListener('click', async () => {
        try {
          await this.storage.mergePlaylist(remote.title || item.title, remote.description || '', tracks, item.id);
          this.closeModal();
          if (this.state.activeTab === 'library') this.renderMain();
          this.showToast('Плейлист сохранён в Медиатеку');
        } catch (err) {
          this.showToast(formatUserErrorRu(err, 'Не удалось сохранить плейлист'));
        }
      });
      document.getElementById('remote-pl-offline')?.addEventListener('click', () => {
        this.closeModal();
        this.downloadTracksBatchOffline(tracks);
      });
    } catch (err) {
      this.closeModal();
      this.showToast(formatUserErrorRu(err, 'Не удалось загрузить плейлист'));
    }
  }

  openCatalogSourcesModal() {
    const s = this.storage.settings;
    this.openModal(
      buildCatalogSourcesModalHtml({
        customApiBaseUrl: s.customApiBaseUrl,
        activeSourceLabel: this.api.activeSourceLabel,
        diagnosticsHtml: this.state.catalogDiagnosticsHtml
      })
    );
  }

  async testCatalogHealthFromModal() {
    this.state.catalogDiagnosticsHtml = '<div>Проверяем публичные источники…</div>';
    this.openCatalogSourcesModal();
    const health = await this.api.testCatalogHealth();
    const row = (title, res) =>
      res.ok
        ? `<div>${title}: <b>OK (${escapeHtml(res.label)}, ${res.latencyMs} мс)</b></div>`
        : `<div>${title}: <b>Недоступно (${escapeHtml(res.error || 'таймаут')})</b></div>`;
    this.state.catalogDiagnosticsHtml = [
      row('Piped', health.piped),
      row('Invidious', health.invidious),
      row('Audius', health.audius)
    ].join('');
    this.openCatalogSourcesModal();
  }

  openAccountModal() {
    this.openModal(
      buildAccountAuthModalHtml({
        activeAccount: this.storage.activeAccount,
        accounts: this.storage.accounts,
        tab: this.state.accountModalTab,
        showAddForm: this.state.accountShowAddForm,
        loading: this.state.accountLoading,
        statusMessage: this.state.accountStatusMsg
      })
    );
  }

  async signInWithYouTubeChannel(rawInput) {
    const clean = String(rawInput || '').trim();
    if (!clean) {
      this.showToast('Введите @никнейм или ссылку на канал YouTube');
      return;
    }

    this.state.accountLoading = true;
    this.state.accountStatusMsg = 'Подключаем канал YouTube…';
    this.openAccountModal();

    try {
      const resolved = await this.api.resolveYouTubeChannelAccount(clean);
      const playlists = Array.isArray(resolved.playlists) ? resolved.playlists : [];
      for (const pl of playlists) {
        await this.storage.mergePlaylist(pl.name, pl.description, pl.tracks, pl.id);
      }

      await this.storage.upsertAccount({
        id: resolved.account.id,
        name: resolved.account.name,
        handle: resolved.account.handle,
        avatarUrl: resolved.account.avatarUrl,
        channelUrl: resolved.account.channelUrl,
        authType: 'youtube_channel',
        lastSyncTimestamp: Date.now(),
        syncedPlaylistsCount: playlists.length
      });

      this.state.accountLoading = false;
      this.state.accountShowAddForm = false;
      this.state.accountStatusMsg = '';
      this.closeModal();
      this.render();
      this.showToast(
        playlists.length > 0
          ? `Вход выполнен: ${resolved.account.name} (${playlists.length} плейлистов)`
          : `Вход выполнен: ${resolved.account.name}`
      );
    } catch (err) {
      this.state.accountLoading = false;
      this.state.accountStatusMsg = formatUserErrorRu(err, 'Не удалось найти канал YouTube');
      this.openAccountModal();
      this.showToast(this.state.accountStatusMsg);
    }
  }

  async signInWithLocalProfile(rawName, rawEmail = '') {
    const name = String(rawName || '').trim().slice(0, 80);
    if (!name) {
      this.showToast('Введите имя или ник');
      return;
    }
    const email = String(rawEmail || '').trim().slice(0, 120);
    const slug = name.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, '_').slice(0, 32) || 'user';
    const id = email ? `profile_${email.toLowerCase()}` : `profile_${slug}_${Date.now()}`;

    await this.storage.upsertAccount({
      id,
      name,
      email,
      authType: 'local',
      lastSyncTimestamp: Date.now()
    });

    this.state.accountShowAddForm = false;
    this.state.accountStatusMsg = '';
    this.closeModal();
    this.render();
    this.showToast(`Добро пожаловать, ${name}!`);
  }

  async syncActiveAccount() {
    const acc = this.storage.activeAccount;
    if (!acc) return;

    if (acc.authType === 'google_oauth' && acc.accessToken) {
      await this.syncActiveGoogleOAuthAccount();
      return;
    }

    if (acc.authType === 'youtube_channel') {
      const target = acc.channelUrl || acc.handle || acc.name;
      if (target) {
        await this.signInWithYouTubeChannel(target);
      }
    }
  }

  async completeGoogleOAuthLogin(accessToken, expiresAt = Date.now() + 3600_000) {
    this.state.accountLoading = true;
    this.state.accountStatusMsg = 'Обновляем плейлисты из Google…';
    if (!document.getElementById('modal-backdrop')?.classList.contains('hidden')) {
      this.openAccountModal();
    } else {
      this.showToast('Загружаем плейлисты и лайки из Google…');
    }

    try {
      const synced = await syncYouTubeLibraryWithOAuth(accessToken);
      const merged = await this._mergeYouTubeSyncResult(synced);
      await this.storage.upsertAccount({
        id: synced.account.id,
        name: synced.account.name,
        handle: synced.account.handle,
        email: synced.account.email,
        avatarUrl: synced.account.avatarUrl,
        authType: 'google_oauth',
        accessToken,
        tokenExpiresAt: expiresAt,
        lastSyncTimestamp: Date.now(),
        syncedLikedCount: synced.likedTracks.length,
        syncedPlaylistsCount: synced.playlists.length
      });

      this.state.accountLoading = false;
      this.state.accountStatusMsg = '';
      this.closeModal();
      this.render();
      this.showToast(
        `Вход выполнен: ${synced.account.name} (+${merged.likedAdded} лайков, ${synced.playlists.length} плейлистов)`
      );
    } catch (err) {
      this.state.accountLoading = false;
      this.state.accountStatusMsg = formatUserErrorRu(err, 'Ошибка синхронизации аккаунта');
      this.openAccountModal();
      this.showToast(this.state.accountStatusMsg);
    }
  }

  async syncActiveGoogleOAuthAccount() {
    const acc = this.storage.activeAccount;
    if (!acc || acc.authType !== 'google_oauth' || !acc.accessToken) {
      return;
    }
    if (acc.tokenExpiresAt && acc.tokenExpiresAt <= Date.now() + 30_000) {
      this.state.accountStatusMsg = 'Срок сессии Google истёк — войдите повторно.';
      this.openAccountModal();
      return;
    }
    await this.completeGoogleOAuthLogin(acc.accessToken, acc.tokenExpiresAt);
  }

  async syncYouTubePlaylistById(playlistId) {
    const pl = this.storage.library.playlists.find((p) => p.id === playlistId);
    if (!pl || !pl.youtubePlaylistId) {
      this.showToast('У этого плейлиста нет привязки к YouTube');
      return;
    }
    this.showToast(`Обновляем «${pl.name}» из YouTube…`);
    try {
      let tracks = [];
      const acc = this.storage.activeAccount;
      if (
        acc?.authType === 'google_oauth' &&
        acc.accessToken &&
        (!acc.tokenExpiresAt || acc.tokenExpiresAt > Date.now() + 30_000)
      ) {
        try {
          tracks = await fetchYouTubePlaylistTracksWithOAuth(pl.youtubePlaylistId, acc.accessToken);
        } catch {
          tracks = [];
        }
      }
      if (tracks.length === 0) {
        const remote = await this.api.getPlaylist(pl.youtubePlaylistId);
        tracks = remote?.tracks || [];
      }
      if (tracks.length === 0) {
        this.showToast('Новых треков не найдено');
        return;
      }
      const { addedCount } = await this.storage.mergePlaylist(
        pl.name,
        pl.description,
        tracks,
        pl.youtubePlaylistId
      );
      this.renderMain();
      this.showToast(addedCount > 0 ? `Добавлено треков: ${addedCount}` : 'Плейлист уже актуален');
    } catch (err) {
      this.showToast(formatUserErrorRu(err, 'Не удалось обновить плейлист из YouTube'));
    }
  }

  async openArtistByName(artistName) {
    const cleanName = String(artistName || '').replace(/ - Topic$/i, '').trim();
    if (!cleanName || cleanName === 'YouTube Music' || cleanName === 'Неизвестный исполнитель') {
      this.showToast('Информация об исполнителе недоступна');
      return;
    }
    this.state.activeTab = 'search';
    this.state.selectedPlaylistId = null;
    this.state.searchFilter = 'ARTISTS';
    this.state.searchQuery = cleanName;
    this.state.artistLoading = true;
    this.state.selectedArtist = {
      title: cleanName,
      subtitle: 'Исполнитель',
      thumbnailUrl: '',
      tracks: []
    };
    this.renderHeader();
    this.renderTabBar();
    this.renderMain();

    try {
      const artists = await this.api.search(cleanName, 'ARTISTS').catch(() => []);
      const exact =
        artists.find((a) => a.title?.toLowerCase() === cleanName.toLowerCase()) ||
        artists[0] ||
        {
          id: cleanName,
          type: 'artist',
          title: cleanName,
          artist: 'Исполнитель',
          thumbnailUrl: ''
        };
      await this.openArtistView(exact);
    } catch {
      this.state.artistLoading = false;
      this.renderHeader();
      this.renderMain();
    }
  }



  async _mergeYouTubeSyncResult(result) {
    let likedAdded = 0;
    for (const t of result.likedTracks || []) {
      if (!this.storage.isFavorite(t.id)) {
        await this.storage.toggleFavorite(t);
        likedAdded++;
      }
    }
    for (const t of [...(result.historyTracks || [])].reverse()) {
      await this.storage.recordPlayback(t);
    }
    for (const pl of result.playlists || []) {
      await this.storage.mergePlaylist(pl.name, pl.description, pl.tracks, pl.id);
    }
    return { likedAdded };
  }

  handleBackupExport() {
    const payloadJson = JSON.stringify(this.storage.exportBackupObject(), null, 2);
    if (!this.storage.settings.encryptBackupsEnabled) {
      this._downloadTextFile(
        `sonora-backup-${new Date().toISOString().slice(0, 10)}.json`,
        payloadJson,
        'application/json'
      );
      this.showToast('Резервная копия JSON сохранена');
      return;
    }

    this.openModal(buildEncryptExportModalHtml());
    document.getElementById('encrypt-export-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const pwd = document.getElementById('export-password')?.value || '';
      try {
        const encrypted = await BackupCipher.encrypt(payloadJson, pwd);
        this._downloadTextFile(
          `sonora-backup-${new Date().toISOString().slice(0, 10)}.sonoraenc`,
          encrypted,
          'application/json'
        );
        this.closeModal();
        this.showToast('Зашифрованная копия сохранена');
      } catch (err) {
        this.showToast(err.message);
      }
    });
  }

  openDecryptBackupModal(encryptedText) {
    this.openModal(buildDecryptImportModalHtml());
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
