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
    this.account = {
      name: '',
      email: '',
      proxyUrl: '',
      cookieHeader: '',
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

    const [savedLib, savedSettings, savedPlayback, savedAccount] = await Promise.all([
      this._read(KEY_LIBRARY),
      this._read(KEY_SETTINGS),
      this._read(KEY_PLAYBACK),
      this._read(KEY_ACCOUNT)
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

    if (savedAccount && typeof savedAccount === 'object') {
      let decryptedCookie = '';
      if (savedAccount.encryptedCookie) {
        const key = await this._getOrCreateDeviceKey();
        if (key) {
          decryptedCookie = await decryptLocalSecret(savedAccount.encryptedCookie, key).catch(() => '');
        }
      }
      this.account = {
        name: savedAccount.name || '',
        email: savedAccount.email || '',
        proxyUrl: sanitizeHttpsUrl(savedAccount.proxyUrl) || '',
        cookieHeader: decryptedCookie,
        lastSyncTimestamp: Number(savedAccount.lastSyncTimestamp) || 0,
        syncedLikedCount: Number(savedAccount.syncedLikedCount) || 0,
        syncedPlaylistsCount: Number(savedAccount.syncedPlaylistsCount) || 0
      };
    }
  }

  async _saveLibrary() {
    await this._write(KEY_LIBRARY, this.library);
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
      createdAt: Date.now()
    };
    this.library.playlists = [playlist, ...this.library.playlists];
    await this._saveLibrary();
    return playlist;
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
    await this._saveLibrary();
    return { playlist: existing, addedCount: additions.length };
  }

  async addTrackToPlaylist(playlistId, track) {
    const pl = this.library.playlists.find((p) => p.id === playlistId);
    const clean = sanitizeTrack(track);
    if (!pl || !clean) return false;
    if (pl.tracks.some((t) => t.id === clean.id)) return false;
    pl.tracks = [...pl.tracks, clean];
    await this._saveLibrary();
    return true;
  }

  async removeTrackFromPlaylist(playlistId, trackId) {
    const pl = this.library.playlists.find((p) => p.id === playlistId);
    if (!pl) return;
    pl.tracks = pl.tracks.filter((t) => t.id !== trackId);
    await this._saveLibrary();
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
          ? sanitizeHttpsUrl(patch.customApiBaseUrl) || ''
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

  async saveAccountConfig(config) {
    this.account = {
      name: String(config.name ?? this.account.name ?? '').trim(),
      email: String(config.email ?? this.account.email ?? '').trim(),
      proxyUrl:
        config.proxyUrl !== undefined
          ? sanitizeHttpsUrl(config.proxyUrl) || ''
          : this.account.proxyUrl,
      cookieHeader:
        config.cookieHeader !== undefined
          ? String(config.cookieHeader).trim()
          : this.account.cookieHeader,
      lastSyncTimestamp: Number(config.lastSyncTimestamp ?? this.account.lastSyncTimestamp) || 0,
      syncedLikedCount: Number(config.syncedLikedCount ?? this.account.syncedLikedCount) || 0,
      syncedPlaylistsCount: Number(config.syncedPlaylistsCount ?? this.account.syncedPlaylistsCount) || 0
    };

    const key = await this._getOrCreateDeviceKey();
    const encryptedCookie =
      this.account.cookieHeader && key
        ? await encryptLocalSecret(this.account.cookieHeader, key)
        : '';

    await this._write(KEY_ACCOUNT, {
      name: this.account.name,
      email: this.account.email,
      proxyUrl: this.account.proxyUrl,
      encryptedCookie,
      lastSyncTimestamp: this.account.lastSyncTimestamp,
      syncedLikedCount: this.account.syncedLikedCount,
      syncedPlaylistsCount: this.account.syncedPlaylistsCount
    });
  }

  async signOutAccount() {
    this.account = {
      name: '',
      email: '',
      proxyUrl: '',
      cookieHeader: '',
      lastSyncTimestamp: 0,
      syncedLikedCount: 0,
      syncedPlaylistsCount: 0
    };
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
