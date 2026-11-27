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
const KEY_OFFLINE = 'offline_tracks_v1';
const KEY_DEVICE_KEY = 'device_aes_key_v1';

const DEFAULT_SETTINGS = {
  audioQuality: 'HIGH',
  themeMode: 'SYSTEM',
  autoplayEnabled: true,
  encryptBackupsEnabled: true,
  customApiBaseUrl: ''
};

const DEFAULT_LIBRARY = {
  favorites: [],
  history: [],
  playlists: [],
  searchHistory: []
};

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
    this.downloadedTracks = [];
  }

  get activeAccount() {
    return (
      this.accounts.find((a) => a.id === this.activeAccountId) ||
      this.accounts[0] ||
      null
    );
  }

  // Backwards-compatible getter for single account view
  get account() {
    const active = this.activeAccount;
    if (active) return active;
    return {
      id: '',
      name: '',
      handle: '',
      email: '',
      avatarUrl: '',
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

    const [savedLib, savedSettings, savedPlayback, savedAccountState, savedAffinities, savedOffline] =
      await Promise.all([
        this._read(KEY_LIBRARY),
        this._read(KEY_SETTINGS),
        this._read(KEY_PLAYBACK),
        this._read(KEY_ACCOUNT),
        this._read(KEY_AFFINITIES),
        this._read(KEY_OFFLINE)
      ]);

    if (savedLib && typeof savedLib === 'object') {
      this.library = {
        favorites: Array.isArray(savedLib.favorites) ? savedLib.favorites : [],
        history: Array.isArray(savedLib.history) ? savedLib.history : [],
        playlists: Array.isArray(savedLib.playlists) ? savedLib.playlists : [],
        searchHistory: Array.isArray(savedLib.searchHistory) ? savedLib.searchHistory : []
      };
    }

    if (savedSettings && typeof savedSettings === 'object') {
      this.settings = { ...DEFAULT_SETTINGS, ...savedSettings };
    }

    if (savedPlayback && typeof savedPlayback === 'object') {
      this.playback = { ...this.playback, ...savedPlayback };
    }

    if (Array.isArray(savedAffinities)) {
      this.affinities = savedAffinities;
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
        if (item.name || decryptedCookie) {
          hydratedAccounts.push({
            id: String(item.id || `yt_${hydratedAccounts.length + 1}`),
            name: String(item.name || 'YouTube Music'),
            handle: String(item.handle || ''),
            email: String(item.email || ''),
            avatarUrl: sanitizeHttpsUrl(item.avatarUrl) || '',
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

  async _saveAccounts() {
    if (this.accounts.length === 0) {
      await this._remove(KEY_ACCOUNT);
      return;
    }
    const serialized = this.accounts.map((acc) => ({
      id: acc.id,
      name: acc.name,
      handle: acc.handle || '',
      email: acc.email || '',
      avatarUrl: acc.avatarUrl || '',
      lastSyncTimestamp: Number(acc.lastSyncTimestamp) || 0,
      syncedLikedCount: Number(acc.syncedLikedCount) || 0,
      syncedPlaylistsCount: Number(acc.syncedPlaylistsCount) || 0
    }));
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

  async recordPlayback(track) {
    const clean = sanitizeTrack(track);
    if (!clean) return;
    this.library.history = [
      { ...clean, playedAt: Date.now() },
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

  async createPlaylist(name, description = '', tracks = [], youtubePlaylistId = null) {
    const cleanName = String(name ?? '').trim().slice(0, 120);
    if (!cleanName) throw new Error('Введите название плейлиста');
    const cleanTracks = tracks.map(sanitizeTrack).filter(Boolean);
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
    const additions = tracks.map(sanitizeTrack).filter((t) => t && !existingIds.has(t.id));
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
    const record = {
      id,
      name: String(config.name || 'YouTube Music').trim(),
      handle: String(config.handle || '').trim(),
      email: String(config.email || '').trim(),
      avatarUrl: sanitizeHttpsUrl(config.avatarUrl) || '',
      lastSyncTimestamp: Number(config.lastSyncTimestamp) || Date.now(),
      syncedLikedCount: Number(config.syncedLikedCount) || 0,
      syncedPlaylistsCount: Number(config.syncedPlaylistsCount) || 0
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
      }
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
      }
    }
    this.library.favorites = Array.from(favMap.values());

    const histMap = new Map(this.library.history.map((t) => [t.id, t]));
    for (const track of normalized.history) {
      if (!histMap.has(track.id)) {
        histMap.set(track.id, track);
        tracksRestored++;
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
