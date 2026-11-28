import {
  buildBackupPayload,
  decryptLocalSecret,
  encryptLocalSecret,
  generateDeviceAesKey,
  normalizeBackupPayload,
  sanitizeHttpsUrl,
  sanitizeTrack
} from './security.js';

const DB_NAME = 'sonora_ios_db';
const DB_VERSION = 1;
const STORE_KV = 'kv';
const KEY_LIBRARY = 'library_state_v1';
const KEY_SETTINGS = 'app_settings_v1';
const KEY_PLAYBACK = 'playback_state_v1';
const KEY_ACCOUNT = 'account_state_v1';
const KEY_AFFINITIES = 'taste_affinities_v1';
const KEY_TRACK_STATS = 'track_stats_v1';
const KEY_OFFLINE = 'offline_tracks_v1';
const KEY_DEVICE_KEY = 'device_aes_key_v1';
const KEY_HOME_CACHE = 'home_swr_cache_v1';
const KEY_FAST_NODES = 'fast_nodes_v1';

const DEFAULT_SETTINGS = {
  audioQuality: 'HIGH',
  themeMode: 'SYSTEM',
  autoplayEnabled: true,
  encryptBackupsEnabled: true,
  customApiBaseUrl: '',
  googleClientId: ''
};

const DEFAULT_LIBRARY = {
  favorites: [],
  history: [],
  playlists: [],
  searchHistory: []
};

export function getTimeOfDayBucket(timestampMs = Date.now()) {
  const hour = new Date(timestampMs).getHours();
  if (hour >= 5 && hour <= 11) return 'morning';
  if (hour >= 12 && hour <= 16) return 'day';
  if (hour >= 17 && hour <= 22) return 'evening';
  return 'night';
}

const TIME_OF_DAY_LABELS_RU = {
  morning: 'Утро (05:00–11:59)',
  day: 'День (12:00–16:59)',
  evening: 'Вечер (17:00–22:59)',
  night: 'Ночь (23:00–04:59)'
};

function dedupeTrackList(list = []) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const clean = sanitizeTrack(raw);
    if (!clean || seen.has(clean.id)) continue;
    seen.add(clean.id);
    if (raw?.addedAt) clean.addedAt = Number(raw.addedAt) || Date.now();
    if (raw?.playedAt) clean.playedAt = Number(raw.playedAt) || Date.now();
    out.push(clean);
  }
  return out;
}

function sanitizeTrackStatEntry(id, raw = {}) {
  const cleanId = String(id || raw?.id || '').trim().slice(0, 64);
  if (!cleanId) return null;
  const tod = raw?.timeOfDayCounts || {};
  return {
    id: cleanId,
    title: String(raw?.title || '').trim().slice(0, 240) || 'Без названия',
    artist: String(raw?.artist || '').trim().slice(0, 200) || 'Неизвестный исполнитель',
    album: String(raw?.album || '').trim().slice(0, 200),
    year: Number(raw?.year) || 0,
    genre: String(raw?.genre || '').trim().slice(0, 80),
    versionType: String(raw?.versionType || 'original'),
    canonicalKey: String(raw?.canonicalKey || '').trim().slice(0, 260),
    playCount: Math.max(0, Math.floor(Number(raw?.playCount) || 0)),
    completeCount: Math.max(0, Math.floor(Number(raw?.completeCount) || 0)),
    quickSkipCount: Math.max(0, Math.floor(Number(raw?.quickSkipCount) || 0)),
    partialSkipCount: Math.max(0, Math.floor(Number(raw?.partialSkipCount) || 0)),
    totalListenedSeconds: Math.max(0, Math.floor(Number(raw?.totalListenedSeconds) || 0)),
    lastPlayedAt: Math.max(0, Number(raw?.lastPlayedAt) || 0),
    timeOfDayCounts: {
      morning: Math.max(0, Math.floor(Number(tod.morning) || 0)),
      day: Math.max(0, Math.floor(Number(tod.day) || 0)),
      evening: Math.max(0, Math.floor(Number(tod.evening) || 0)),
      night: Math.max(0, Math.floor(Number(tod.night) || 0))
    }
  };
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_KV)) {
        db.createObjectStore(STORE_KV);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open IndexedDB'));
  });
}

async function idbGet(db, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_KV, 'readonly');
    const store = tx.objectStore(STORE_KV);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(db, key, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_KV, 'readwrite');
    const store = tx.objectStore(STORE_KV);
    const req = store.put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete(db, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_KV, 'readwrite');
    const store = tx.objectStore(STORE_KV);
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function sanitizeOptionalApiUrl(raw) {
  const safe = sanitizeHttpsUrl(raw);
  return safe ? safe.replace(/\/+$/, '') : '';
}

export class SonoraStorage {
  constructor() {
    this.db = null;
    this.memoryFallback = new Map();
    this.library = structuredClone(DEFAULT_LIBRARY);
    this.settings = { ...DEFAULT_SETTINGS };
    this.playback = {
      queue: [],
      currentIndex: -1,
      positionSeconds: 0,
      shuffleEnabled: false,
      repeatMode: 'OFF',
      playbackSpeed: 1.0
    };
    this.accounts = [];
    this.activeAccountId = '';
    this.affinities = [];
    this.trackStats = {};
    this.downloadedTracks = [];
    this.homeCache = {};
    this.fastNodes = { piped: '', invidious: '', audius: '' };
  }

  get activeAccount() {
    return (
      this.accounts.find((a) => a.id === this.activeAccountId) ||
      this.accounts[0] ||
      null
    );
  }

  get account() {
    const active = this.activeAccount;
    if (active) return active;
    return {
      id: '',
      name: '',
      handle: '',
      email: '',
      avatarUrl: '',
      channelUrl: '',
      authType: 'local',
      accessToken: '',
      tokenExpiresAt: 0,
      lastSyncTimestamp: 0,
      syncedLikedCount: 0,
      syncedPlaylistsCount: 0
    };
  }

  async _read(key) {
    if (this.db) {
      return idbGet(this.db, key);
    }
    try {
      const raw = globalThis.localStorage?.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return this.memoryFallback.get(key) ?? null;
    }
  }

  async _write(key, value) {
    if (this.db) {
      await idbSet(this.db, key, value);
      return;
    }
    try {
      globalThis.localStorage?.setItem(key, JSON.stringify(value));
    } catch {
      this.memoryFallback.set(key, value);
    }
  }

  async _remove(key) {
    if (this.db) {
      await idbDelete(this.db, key);
      return;
    }
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      this.memoryFallback.delete(key);
    }
  }

  async _getOrCreateDeviceKey() {
    if (!this.db || !globalThis.crypto?.subtle) return null;
    let key = await idbGet(this.db, KEY_DEVICE_KEY);
    if (!key) {
      key = await generateDeviceAesKey();
      await idbSet(this.db, KEY_DEVICE_KEY, key);
    }
    return key;
  }

  async init() {
    try {
      this.db = await openDatabase();
    } catch {
      this.db = null;
    }

    const [
      savedLib,
      savedSettings,
      savedPlayback,
      savedAccountState,
      savedAffinities,
      savedTrackStats,
      savedOffline,
      savedHomeCache,
      savedFastNodes
    ] = await Promise.all([
      this._read(KEY_LIBRARY),
      this._read(KEY_SETTINGS),
      this._read(KEY_PLAYBACK),
      this._read(KEY_ACCOUNT),
      this._read(KEY_AFFINITIES),
      this._read(KEY_TRACK_STATS),
      this._read(KEY_OFFLINE),
      this._read(KEY_HOME_CACHE),
      this._read(KEY_FAST_NODES)
    ]);

    if (savedHomeCache && typeof savedHomeCache === 'object') {
      this.homeCache = savedHomeCache;
    }

    if (savedFastNodes && typeof savedFastNodes === 'object') {
      this.fastNodes = {
        piped: sanitizeOptionalApiUrl(savedFastNodes.piped),
        invidious: sanitizeOptionalApiUrl(savedFastNodes.invidious),
        audius: sanitizeOptionalApiUrl(savedFastNodes.audius)
      };
    }

    if (savedLib && typeof savedLib === 'object') {
      this.library = {
        favorites: dedupeTrackList(savedLib.favorites),
        history: dedupeTrackList(savedLib.history).slice(0, 120),
        playlists: Array.isArray(savedLib.playlists)
          ? savedLib.playlists
              .filter((pl) => pl && typeof pl === 'object' && pl.name)
              .map((pl) => ({
                ...pl,
                id: pl.id || Date.now() + Math.floor(Math.random() * 1000),
                name: String(pl.name).trim().slice(0, 120),
                description: String(pl.description || '').trim().slice(0, 500),
                tracks: dedupeTrackList(pl.tracks)
              }))
          : [],
        searchHistory: Array.isArray(savedLib.searchHistory) ? savedLib.searchHistory : []
      };
    }

    if (savedSettings && typeof savedSettings === 'object') {
      this.settings = { ...DEFAULT_SETTINGS, ...savedSettings };
    }

    if (savedPlayback && typeof savedPlayback === 'object') {
      this.playback = {
        ...this.playback,
        ...savedPlayback,
        queue: Array.isArray(savedPlayback.queue)
          ? savedPlayback.queue.map(sanitizeTrack).filter(Boolean).slice(0, 300)
          : []
      };
    }

    if (Array.isArray(savedAffinities)) {
      this.affinities = savedAffinities;
    }

    if (savedTrackStats && typeof savedTrackStats === 'object') {
      const hydratedStats = {};
      for (const [id, entry] of Object.entries(savedTrackStats)) {
        const cleanEntry = sanitizeTrackStatEntry(id, entry);
        if (cleanEntry) hydratedStats[cleanEntry.id] = cleanEntry;
      }
      this.trackStats = hydratedStats;
    }

    if (Array.isArray(savedOffline)) {
      this.downloadedTracks = savedOffline.filter((t) => t?.id);
    }

    if (savedAccountState && typeof savedAccountState === 'object') {
      const key = await this._getOrCreateDeviceKey();
      const rawList = Array.isArray(savedAccountState.accounts)
        ? savedAccountState.accounts
        : savedAccountState.name || savedAccountState.encryptedCookie || savedAccountState.proxyUrl
          ? [{ id: 'yt_legacy', ...savedAccountState }]
          : [];

      const hydratedAccounts = [];
      for (const item of rawList) {
        let decryptedCookie = '';
        if (item.encryptedCookie && key) {
          decryptedCookie = await decryptLocalSecret(item.encryptedCookie, key).catch(() => '');
        }
        let decryptedToken = '';
        if (item.encryptedAccessToken && key) {
          decryptedToken = await decryptLocalSecret(item.encryptedAccessToken, key).catch(() => '');
        }
        if (item.name || decryptedCookie || decryptedToken) {
          hydratedAccounts.push({
            id: String(item.id || `yt_${hydratedAccounts.length + 1}`),
            name: String(item.name || 'YouTube Music'),
            handle: String(item.handle || ''),
            email: String(item.email || ''),
            avatarUrl: sanitizeHttpsUrl(item.avatarUrl) || '',
            channelUrl: String(item.channelUrl || '').trim().slice(0, 240),
            authType: String(item.authType || (decryptedToken ? 'google_oauth' : 'local')),
            accessToken: decryptedToken || '',
            tokenExpiresAt: Number(item.tokenExpiresAt) || 0,
            lastSyncTimestamp: Number(item.lastSyncTimestamp) || 0,
            syncedLikedCount: Number(item.syncedLikedCount) || 0,
            syncedPlaylistsCount: Number(item.syncedPlaylistsCount) || 0
          });
        }
      }
      this.accounts = hydratedAccounts;
      this.activeAccountId =
        savedAccountState.activeAccountId ||
        hydratedAccounts[0]?.id ||
        '';
    }
  }

  async _saveLibrary() {
    await this._write(KEY_LIBRARY, this.library);
  }

  async _saveTrackStats() {
    const entries = Object.values(this.trackStats);
    if (entries.length > 600) {
      entries.sort((a, b) => (b.lastPlayedAt || 0) - (a.lastPlayedAt || 0));
      const trimmed = {};
      for (const item of entries.slice(0, 600)) {
        trimmed[item.id] = item;
      }
      this.trackStats = trimmed;
    }
    await this._write(KEY_TRACK_STATS, this.trackStats);
  }

  async _saveAccounts() {
    if (this.accounts.length === 0) {
      await this._remove(KEY_ACCOUNT);
      return;
    }
    const key = await this._getOrCreateDeviceKey().catch(() => null);
    const serialized = [];
    for (const acc of this.accounts) {
      let encryptedAccessToken = '';
      if (acc.accessToken && key) {
        encryptedAccessToken = await encryptLocalSecret(acc.accessToken, key).catch(() => '');
      }
      serialized.push({
        id: acc.id,
        name: acc.name,
        handle: acc.handle || '',
        email: acc.email || '',
        avatarUrl: acc.avatarUrl || '',
        channelUrl: acc.channelUrl || '',
        authType: acc.authType || 'local',
        encryptedAccessToken,
        tokenExpiresAt: Number(acc.tokenExpiresAt) || 0,
        lastSyncTimestamp: Number(acc.lastSyncTimestamp) || 0,
        syncedLikedCount: Number(acc.syncedLikedCount) || 0,
        syncedPlaylistsCount: Number(acc.syncedPlaylistsCount) || 0
      });
    }
    await this._write(KEY_ACCOUNT, {
      activeAccountId: this.activeAccountId,
      accounts: serialized
    });
  }

  async saveAffinityEntity(entity) {
    if (!entity?.trackId) return;
    const idx = this.affinities.findIndex((a) => a.trackId === entity.trackId);
    if (idx >= 0) {
      this.affinities[idx] = entity;
    } else {
      this.affinities.push(entity);
    }
    if (this.affinities.length > 500) {
      this.affinities.sort((a, b) => (b.lastInteractedAt || 0) - (a.lastInteractedAt || 0));
      this.affinities = this.affinities.slice(0, 500);
    }
    await this._write(KEY_AFFINITIES, this.affinities);
  }

  async recordTrackPlayStart(track, timestampMs = Date.now()) {
    const clean = sanitizeTrack(track);
    if (!clean) return null;

    const bucket = getTimeOfDayBucket(timestampMs);
    const existing =
      sanitizeTrackStatEntry(clean.id, this.trackStats[clean.id]) ||
      sanitizeTrackStatEntry(clean.id, clean);

    existing.title = clean.title;
    existing.artist = clean.artist;
    if (clean.album) existing.album = clean.album;
    if (clean.year) existing.year = clean.year;
    if (clean.genre) existing.genre = clean.genre;
    existing.versionType = clean.versionType || existing.versionType || 'original';
    existing.canonicalKey = clean.canonicalKey || existing.canonicalKey || '';
    existing.playCount += 1;
    existing.lastPlayedAt = timestampMs;
    existing.timeOfDayCounts[bucket] = (existing.timeOfDayCounts[bucket] || 0) + 1;

    this.trackStats[clean.id] = existing;

    this.library.history = [
      { ...clean, playedAt: timestampMs },
      ...this.library.history.filter((t) => t.id !== clean.id)
    ].slice(0, 120);

    await Promise.all([this._saveTrackStats(), this._saveLibrary()]);
    return existing;
  }

  async recordTrackSessionOutcome(
    track,
    {
      listenedSeconds = 0,
      completed = false,
      quickSkipped = false,
      partialSkipped = false
    } = {}
  ) {
    const clean = sanitizeTrack(track);
    if (!clean) return null;

    const existing =
      sanitizeTrackStatEntry(clean.id, this.trackStats[clean.id]) ||
      sanitizeTrackStatEntry(clean.id, clean);

    existing.title = clean.title;
    existing.artist = clean.artist;
    if (clean.album) existing.album = clean.album;
    if (clean.year) existing.year = clean.year;
    if (clean.genre) existing.genre = clean.genre;
    existing.versionType = clean.versionType || existing.versionType || 'original';
    existing.canonicalKey = clean.canonicalKey || existing.canonicalKey || '';

    const safeListened = Math.max(0, Math.round(Number(listenedSeconds) || 0));
    existing.totalListenedSeconds += safeListened;
    if (completed) existing.completeCount += 1;
    else if (quickSkipped) existing.quickSkipCount += 1;
    else if (partialSkipped) existing.partialSkipCount += 1;

    this.trackStats[clean.id] = existing;
    await this._saveTrackStats();
    return existing;
  }

  async saveDownloadedTrack(trackMeta) {
    if (!trackMeta?.id) return;
    this.downloadedTracks = [
      trackMeta,
      ...this.downloadedTracks.filter((t) => t.id !== trackMeta.id)
    ];
    await this._write(KEY_OFFLINE, this.downloadedTracks);
  }

  async removeDownloadedTrack(trackId) {
    this.downloadedTracks = this.downloadedTracks.filter((t) => t.id !== trackId);
    await this._write(KEY_OFFLINE, this.downloadedTracks);
  }

  async clearDownloadedTracks() {
    this.downloadedTracks = [];
    await this._remove(KEY_OFFLINE);
  }

  isFavorite(trackId) {
    return this.library.favorites.some((t) => t.id === trackId);
  }

  async toggleFavorite(track) {
    const clean = sanitizeTrack(track);
    if (!clean) return false;
    const exists = this.isFavorite(clean.id);
    if (exists) {
      this.library.favorites = this.library.favorites.filter((t) => t.id !== clean.id);
    } else {
      this.library.favorites = [{ ...clean, addedAt: Date.now() }, ...this.library.favorites];
    }
    await this._saveLibrary();
    return !exists;
  }

  async recordPlayback(track, timestampMs = Date.now()) {
    const clean = sanitizeTrack(track);
    if (!clean) return;
    this.library.history = [
      { ...clean, playedAt: timestampMs },
      ...this.library.history.filter((t) => t.id !== clean.id)
    ].slice(0, 120);
    await this._saveLibrary();
  }

  async clearHistory() {
    this.library.history = [];
    await this._saveLibrary();
  }

  async recordSearchQuery(query) {
    const clean = String(query ?? '').trim().slice(0, 160);
    if (!clean) return;
    this.library.searchHistory = [
      clean,
      ...this.library.searchHistory.filter((q) => q.toLowerCase() !== clean.toLowerCase())
    ].slice(0, 20);
    await this._saveLibrary();
  }

  async clearSearchHistory() {
    this.library.searchHistory = [];
    await this._saveLibrary();
  }

  async removeSearchHistoryItem(query) {
    const clean = String(query ?? '').trim().toLowerCase();
    if (!clean) return;
    this.library.searchHistory = this.library.searchHistory.filter(
      (q) => q.toLowerCase() !== clean
    );
    await this._saveLibrary();
  }

  getCachedHomeMood(moodId) {
    const entry = this.homeCache?.[moodId];
    if (!entry || !Array.isArray(entry.tracks)) return null;
    return {
      updatedAt: Number(entry.updatedAt) || 0,
      tracks: entry.tracks
    };
  }

  async saveCachedHomeMood(moodId, tracks = []) {
    if (!moodId || !Array.isArray(tracks) || tracks.length === 0) return;
    const clean = tracks.map(sanitizeTrack).filter(Boolean).slice(0, 60);
    if (clean.length === 0) return;
    this.homeCache = {
      ...this.homeCache,
      [moodId]: { updatedAt: Date.now(), tracks: clean }
    };
    await this._write(KEY_HOME_CACHE, this.homeCache);
  }

  async saveFastNode(kind, baseUrl) {
    if (!kind || !['piped', 'invidious', 'audius'].includes(kind)) return;
    const clean = sanitizeOptionalApiUrl(baseUrl);
    if (!clean || this.fastNodes[kind] === clean) return;
    this.fastNodes = { ...this.fastNodes, [kind]: clean };
    await this._write(KEY_FAST_NODES, this.fastNodes);
  }

  async createPlaylist(name, description = '', tracks = [], youtubePlaylistId = null) {
    const cleanName = String(name ?? '').trim().slice(0, 120);
    if (!cleanName) throw new Error('Введите название плейлиста');
    const cleanTracks = dedupeTrackList(tracks);
    const playlist = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      name: cleanName,
      description: String(description ?? '').trim().slice(0, 500),
      tracks: cleanTracks,
      youtubePlaylistId: youtubePlaylistId || null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    this.library.playlists = [playlist, ...this.library.playlists];
    await this._saveLibrary();
    return playlist;
  }

  async setPlaylistYoutubeId(playlistId, youtubePlaylistId) {
    const pl = this.library.playlists.find((p) => p.id === playlistId);
    if (!pl || !youtubePlaylistId) return;
    pl.youtubePlaylistId = youtubePlaylistId;
    pl.updatedAt = Date.now();
    await this._saveLibrary();
  }

  async mergePlaylist(name, description = '', tracks = [], youtubePlaylistId = null) {
    const normalized = String(name ?? '').trim().toLowerCase();
    const existing = this.library.playlists.find(
      (pl) =>
        (youtubePlaylistId && pl.youtubePlaylistId === youtubePlaylistId) ||
        pl.name.trim().toLowerCase() === normalized
    );
    if (!existing) {
      const created = await this.createPlaylist(name, description, tracks, youtubePlaylistId);
      return { playlist: created, addedCount: created.tracks.length };
    }
    const existingIds = new Set(existing.tracks.map((t) => t.id));
    const additions = dedupeTrackList(tracks).filter((t) => !existingIds.has(t.id));
    existing.tracks = [...existing.tracks, ...additions];
    if (youtubePlaylistId && !existing.youtubePlaylistId) {
      existing.youtubePlaylistId = youtubePlaylistId;
    }
    if (description && !existing.description) {
      existing.description = description;
    }
    existing.updatedAt = Date.now();
    await this._saveLibrary();
    return { playlist: existing, addedCount: additions.length };
  }

  async addTrackToPlaylist(playlistId, track) {
    const pl = this.library.playlists.find((p) => p.id === playlistId);
    const clean = sanitizeTrack(track);
    if (!pl || !clean) return false;
    if (pl.tracks.some((t) => t.id === clean.id)) return false;
    pl.tracks = [...pl.tracks, clean];
    pl.updatedAt = Date.now();
    await this._saveLibrary();
    return true;
  }

  async removeTrackFromPlaylist(playlistId, trackId) {
    const pl = this.library.playlists.find((p) => p.id === playlistId);
    if (!pl) return;
    pl.tracks = pl.tracks.filter((t) => t.id !== trackId);
    pl.updatedAt = Date.now();
    await this._saveLibrary();
  }

  async moveTrackInPlaylist(playlistId, fromIndex, toIndex) {
    const pl = this.library.playlists.find((p) => p.id === playlistId);
    if (!pl || !Array.isArray(pl.tracks)) return false;
    if (
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= pl.tracks.length ||
      toIndex >= pl.tracks.length ||
      fromIndex === toIndex
    ) {
      return false;
    }
    const next = [...pl.tracks];
    const [item] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, item);
    pl.tracks = next;
    pl.updatedAt = Date.now();
    await this._saveLibrary();
    return true;
  }

  async sortPlaylistTracks(playlistId, mode = 'TITLE') {
    const pl = this.library.playlists.find((p) => p.id === playlistId);
    if (!pl || !Array.isArray(pl.tracks) || pl.tracks.length < 2) return false;
    const copy = [...pl.tracks];
    if (mode === 'TITLE') {
      copy.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'ru'));
    } else if (mode === 'ARTIST') {
      copy.sort(
        (a, b) =>
          (a.artist || '').localeCompare(b.artist || '', 'ru') ||
          (a.title || '').localeCompare(b.title || '', 'ru')
      );
    } else if (mode === 'DURATION') {
      copy.sort((a, b) => (Number(a.durationSeconds) || 0) - (Number(b.durationSeconds) || 0));
    } else if (mode === 'REVERSE') {
      copy.reverse();
    } else {
      return false;
    }
    pl.tracks = copy;
    pl.updatedAt = Date.now();
    await this._saveLibrary();
    return true;
  }

  async deduplicatePlaylistTracks(playlistId) {
    const pl = this.library.playlists.find((p) => p.id === playlistId);
    if (!pl || !Array.isArray(pl.tracks) || pl.tracks.length < 2) return 0;
    const seen = new Set();
    const unique = [];
    for (const t of pl.tracks) {
      if (t?.id && !seen.has(t.id)) {
        seen.add(t.id);
        unique.push(t);
      }
    }
    const removed = pl.tracks.length - unique.length;
    if (removed > 0) {
      pl.tracks = unique;
      pl.updatedAt = Date.now();
      await this._saveLibrary();
    }
    return removed;
  }

  getListeningStats() {
    const artistCounts = new Map();
    const genreCounts = new Map();
    const countArtist = (t, weight = 1) => {
      const a = String(t?.artist || '').trim();
      if (!a || a === 'YouTube Music' || a === 'Неизвестный исполнитель') return;
      artistCounts.set(a, (artistCounts.get(a) || 0) + weight);
      const g = String(t?.genre || '').trim();
      if (g) genreCounts.set(g, (genreCounts.get(g) || 0) + weight);
    };

    for (const t of this.library.history) countArtist(t, 2);
    for (const t of this.library.favorites) countArtist(t, 3);
    for (const pl of this.library.playlists) {
      for (const t of pl.tracks || []) countArtist(t, 1);
    }

    let totalPlays = 0;
    let totalCompletes = 0;
    let totalQuickSkips = 0;
    let totalListenedSeconds = 0;
    const timeOfDayCounts = { morning: 0, day: 0, evening: 0, night: 0 };
    const statEntries = Object.values(this.trackStats || {});

    for (const st of statEntries) {
      totalPlays += st.playCount || 0;
      totalCompletes += st.completeCount || 0;
      totalQuickSkips += st.quickSkipCount || 0;
      totalListenedSeconds += st.totalListenedSeconds || 0;
      const tod = st.timeOfDayCounts || {};
      timeOfDayCounts.morning += tod.morning || 0;
      timeOfDayCounts.day += tod.day || 0;
      timeOfDayCounts.evening += tod.evening || 0;
      timeOfDayCounts.night += tod.night || 0;
      countArtist(st, (st.completeCount || 0) * 3 + (st.playCount || 0));
    }

    const topArtists = Array.from(artistCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name]) => name);

    const topGenres = Array.from(genreCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([name]) => name);

    const moodScores = new Map();
    for (const aff of this.affinities || []) {
      if (aff?.moodName && (Number(aff.affinityScore) || 0) > 0) {
        moodScores.set(
          aff.moodName,
          (moodScores.get(aff.moodName) || 0) + Number(aff.affinityScore)
        );
      }
    }
    const topMoods = Array.from(moodScores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([mood]) => mood);

    const topTracks = statEntries
      .filter((s) => (s.playCount || 0) > 0 || (s.completeCount || 0) > 0)
      .sort(
        (a, b) =>
          (b.completeCount * 2 + b.playCount - b.quickSkipCount) -
            (a.completeCount * 2 + a.playCount - a.quickSkipCount) ||
          (b.lastPlayedAt || 0) - (a.lastPlayedAt || 0)
      )
      .slice(0, 8);

    const todOrder = Object.entries(timeOfDayCounts).sort((a, b) => b[1] - a[1]);
    const peakTimeOfDay = todOrder[0] && todOrder[0][1] > 0 ? todOrder[0][0] : 'evening';
    const outcomes = totalCompletes + totalQuickSkips;
    const completionRatePct = outcomes > 0 ? Math.round((totalCompletes / outcomes) * 100) : 0;

    const totalPlaylistTracks = this.library.playlists.reduce(
      (sum, pl) => sum + (pl.tracks?.length || 0),
      0
    );

    return {
      favoritesCount: this.library.favorites.length,
      historyCount: this.library.history.length,
      playlistsCount: this.library.playlists.length,
      totalPlaylistTracks,
      topArtists,
      topGenres,
      topMoods,
      topTracks,
      totalPlays,
      totalCompletes,
      totalQuickSkips,
      completionRatePct,
      totalListenedMinutes: Math.round(totalListenedSeconds / 60),
      timeOfDayCounts,
      peakTimeOfDay,
      peakTimeOfDayRu: TIME_OF_DAY_LABELS_RU[peakTimeOfDay] || TIME_OF_DAY_LABELS_RU.evening
    };
  }

  async renamePlaylist(playlistId, name, description = '') {
    const pl = this.library.playlists.find((p) => p.id === playlistId);
    const cleanName = String(name ?? '').trim().slice(0, 120);
    if (!pl || !cleanName) throw new Error('Введите название плейлиста');
    pl.name = cleanName;
    pl.description = String(description ?? '').trim().slice(0, 500);
    pl.updatedAt = Date.now();
    await this._saveLibrary();
    return pl;
  }

  async deletePlaylist(playlistId) {
    this.library.playlists = this.library.playlists.filter((p) => p.id !== playlistId);
    await this._saveLibrary();
  }

  async updateSettings(patch) {
    this.settings = {
      ...this.settings,
      ...patch,
      customApiBaseUrl:
        patch.customApiBaseUrl !== undefined
          ? sanitizeOptionalApiUrl(patch.customApiBaseUrl)
          : this.settings.customApiBaseUrl
    };
    await this._write(KEY_SETTINGS, this.settings);
    return this.settings;
  }

  async savePlaybackState(patch) {
    this.playback = {
      ...this.playback,
      ...patch,
      queue: Array.isArray(patch.queue)
        ? patch.queue.map(sanitizeTrack).filter(Boolean).slice(0, 300)
        : this.playback.queue
    };
    await this._write(KEY_PLAYBACK, this.playback);
  }

  async upsertAccount(config) {
    const id = String(config.id || config.email || config.handle || `yt_${Date.now()}`).trim();
    const existing = this.accounts.find((a) => a.id === id);
    const record = {
      id,
      name: String(config.name || existing?.name || 'YouTube Music').trim(),
      handle: String(config.handle ?? existing?.handle ?? '').trim(),
      email: String(config.email ?? existing?.email ?? '').trim(),
      avatarUrl: sanitizeHttpsUrl(config.avatarUrl) || existing?.avatarUrl || '',
      channelUrl: String(config.channelUrl ?? existing?.channelUrl ?? '').trim().slice(0, 240),
      authType: String(config.authType || existing?.authType || 'local'),
      accessToken: config.accessToken !== undefined ? String(config.accessToken || '') : (existing?.accessToken || ''),
      tokenExpiresAt: config.tokenExpiresAt !== undefined ? (Number(config.tokenExpiresAt) || 0) : (existing?.tokenExpiresAt || 0),
      lastSyncTimestamp: Number(config.lastSyncTimestamp) || Date.now(),
      syncedLikedCount: Number(config.syncedLikedCount) ?? existing?.syncedLikedCount ?? 0,
      syncedPlaylistsCount: Number(config.syncedPlaylistsCount) ?? existing?.syncedPlaylistsCount ?? 0
    };

    const idx = this.accounts.findIndex((a) => a.id === id);
    if (idx >= 0) {
      this.accounts[idx] = { ...this.accounts[idx], ...record };
    } else {
      this.accounts = [...this.accounts, record];
    }
    this.activeAccountId = id;
    await this._saveAccounts();
    return record;
  }

  async switchAccount(accountId) {
    if (!this.accounts.some((a) => a.id === accountId)) return null;
    this.activeAccountId = accountId;
    await this._saveAccounts();
    return this.activeAccount;
  }

  async removeAccount(accountId) {
    this.accounts = this.accounts.filter((a) => a.id !== accountId);
    if (this.activeAccountId === accountId) {
      this.activeAccountId = this.accounts[0]?.id || '';
    }
    await this._saveAccounts();
  }

  async saveAccountConfig(config) {
    return this.upsertAccount(config);
  }

  async signOutAccount() {
    this.accounts = [];
    this.activeAccountId = '';
    await this._remove(KEY_ACCOUNT);
  }

  exportBackupObject() {
    return buildBackupPayload({
      favorites: this.library.favorites,
      history: this.library.history,
      playlists: this.library.playlists,
      searchHistory: this.library.searchHistory,
      settings: {
        audioQuality: this.settings.audioQuality,
        themeMode: this.settings.themeMode,
        autoplayEnabled: this.settings.autoplayEnabled,
        encryptBackupsEnabled: this.settings.encryptBackupsEnabled
      },
      playback: {
        queue: this.playback.queue,
        currentIndex: this.playback.currentIndex,
        positionMs: Math.round((this.playback.positionSeconds || 0) * 1000),
        shuffleEnabled: this.playback.shuffleEnabled,
        repeatMode: this.playback.repeatMode,
        playbackSpeed: this.playback.playbackSpeed
      },
      trackStats: this.trackStats,
      affinities: this.affinities
    });
  }

  async importBackupObject(rawJson) {
    const normalized = normalizeBackupPayload(rawJson);
    const favMap = new Map(this.library.favorites.map((t) => [t.id, t]));
    let tracksRestored = 0;
    for (const track of normalized.favorites) {
      if (!favMap.has(track.id)) {
        favMap.set(track.id, track);
        tracksRestored++;
      } else {
        favMap.set(track.id, { ...favMap.get(track.id), ...track });
      }
    }
    this.library.favorites = Array.from(favMap.values());

    const histMap = new Map(this.library.history.map((t) => [t.id, t]));
    for (const track of normalized.history) {
      if (!histMap.has(track.id)) {
        histMap.set(track.id, track);
        tracksRestored++;
      } else {
        histMap.set(track.id, { ...histMap.get(track.id), ...track });
      }
    }
    this.library.history = Array.from(histMap.values()).slice(0, 120);

    let playlistsRestored = 0;
    for (const pl of normalized.playlists) {
      const { addedCount } = await this.mergePlaylist(
        pl.name,
        pl.description,
        pl.tracks,
        pl.youtubePlaylistId
      );
      if (addedCount > 0) playlistsRestored++;
    }

    let searchQueriesRestored = 0;
    const existingQueries = new Set(this.library.searchHistory.map((q) => q.toLowerCase()));
    for (const q of normalized.searchHistory) {
      if (!existingQueries.has(q.toLowerCase())) {
        existingQueries.add(q.toLowerCase());
        this.library.searchHistory.push(q);
        searchQueriesRestored++;
      }
    }
    this.library.searchHistory = this.library.searchHistory.slice(0, 20);

    if (normalized.trackStats && typeof normalized.trackStats === 'object') {
      for (const [id, entry] of Object.entries(normalized.trackStats)) {
        const cleanEntry = sanitizeTrackStatEntry(id, entry);
        if (!cleanEntry) continue;
        const cur = this.trackStats[cleanEntry.id];
        if (!cur) {
          this.trackStats[cleanEntry.id] = cleanEntry;
        } else {
          this.trackStats[cleanEntry.id] = {
            ...cur,
            ...cleanEntry,
            playCount: Math.max(cur.playCount || 0, cleanEntry.playCount),
            completeCount: Math.max(cur.completeCount || 0, cleanEntry.completeCount),
            quickSkipCount: Math.max(cur.quickSkipCount || 0, cleanEntry.quickSkipCount),
            partialSkipCount: Math.max(cur.partialSkipCount || 0, cleanEntry.partialSkipCount),
            totalListenedSeconds: Math.max(cur.totalListenedSeconds || 0, cleanEntry.totalListenedSeconds),
            lastPlayedAt: Math.max(cur.lastPlayedAt || 0, cleanEntry.lastPlayedAt),
            timeOfDayCounts: {
              morning: Math.max(cur.timeOfDayCounts?.morning || 0, cleanEntry.timeOfDayCounts.morning),
              day: Math.max(cur.timeOfDayCounts?.day || 0, cleanEntry.timeOfDayCounts.day),
              evening: Math.max(cur.timeOfDayCounts?.evening || 0, cleanEntry.timeOfDayCounts.evening),
              night: Math.max(cur.timeOfDayCounts?.night || 0, cleanEntry.timeOfDayCounts.night)
            }
          };
        }
      }
      await this._saveTrackStats();
    }

    if (Array.isArray(normalized.affinities)) {
      const affMap = new Map(this.affinities.map((a) => [a.trackId, a]));
      for (const entity of normalized.affinities) {
        if (!entity?.trackId) continue;
        const cur = affMap.get(entity.trackId);
        if (!cur || (Number(entity.lastInteractedAt) || 0) > (Number(cur.lastInteractedAt) || 0)) {
          affMap.set(entity.trackId, entity);
        }
      }
      this.affinities = Array.from(affMap.values()).slice(0, 500);
      await this._write(KEY_AFFINITIES, this.affinities);
    }

    if (normalized.settings) {
      await this.updateSettings({
        audioQuality: normalized.settings.audioQuality || this.settings.audioQuality,
        themeMode: normalized.settings.themeMode || this.settings.themeMode,
        autoplayEnabled:
          typeof normalized.settings.autoplayEnabled === 'boolean'
            ? normalized.settings.autoplayEnabled
            : this.settings.autoplayEnabled,
        encryptBackupsEnabled:
          typeof normalized.settings.encryptBackupsEnabled === 'boolean'
            ? normalized.settings.encryptBackupsEnabled
            : this.settings.encryptBackupsEnabled
      });
    }

    await this._saveLibrary();
    return { tracksRestored, playlistsRestored, searchQueriesRestored };
  }
}
