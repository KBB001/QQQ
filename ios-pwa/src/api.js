import { sanitizeHttpsUrl, sanitizeTrack } from './security.js';

export const DEFAULT_PIPED_INSTANCES = [
  'https://api.piped.private.coffee',
  'https://pipedapi.ducks.party',
  'https://pipedapi.adminforge.de',
  'https://pipedapi.kavin.rocks',
  'https://api.piped.projectsegfau.lt',
  'https://pipedapi.in.projectsegfau.lt',
  'https://pipedapi.r4fo.com',
  'https://pipedapi.moomoo.me',
  'https://pipedapi.ngn.tf'
];

export const DEFAULT_INVIDIOUS_INSTANCES = [
  'https://invidious.nerdvpn.de',
  'https://invidious.privacyredirect.com',
  'https://iv.datura.network',
  'https://inv.tux.pizza',
  'https://invidious.jing.rocks',
  'https://yewtu.be',
  'https://invidious.fdn.fr',
  'https://inv.nadeko.net'
];

export const DEFAULT_AUDIUS_NODES = [
  'https://discoveryprovider.audius.co',
  'https://discoveryprovider2.audius.co',
  'https://discoveryprovider3.audius.co'
];

export const MOOD_CHIPS = [
  { id: 'ALL', label: 'Для вас', query: 'popular music hits' },
  { id: 'RELAX', label: 'Расслабиться', query: 'chill acoustic ambient' },
  { id: 'ENERGIZE', label: 'Энергия', query: 'workout upbeat electronic' },
  { id: 'FOCUS', label: 'Фокус', query: 'focus instrumental study' },
  { id: 'NIGHT', label: 'Вечер', query: 'late night r&b chill' },
  { id: 'LOFI', label: 'Lo-Fi биты', query: 'lofi hip hop radio' }
];

const NODE_COOLDOWN_MS = 90 * 1000;
const POOL_CACHE_TTL_MS = 15 * 60 * 1000;
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const ARTIST_CACHE_TTL_MS = 15 * 60 * 1000;
const PLAYLIST_CACHE_TTL_MS = 10 * 60 * 1000;

function sanitizeCustomNodeUrl(rawUrl) {
  const safe = sanitizeHttpsUrl(rawUrl);
  return safe ? safe.replace(/\/+$/, '') : '';
}

export function extractVideoId(input, { allowBareId = true } = {}) {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  if (allowBareId && /^[A-Za-z0-9_-]{11}$/.test(raw)) return raw;
  const isRelativePath = raw.startsWith('/');
  if (!allowBareId && isRelativePath) return null;

  try {
    const url = isRelativePath ? new URL(raw, 'https://www.youtube.com') : new URL(raw);
    const host = url.hostname.replace(/^www\.|^m\.|^music\./, '');
    if (host === 'youtu.be') {
      const id = url.pathname.split('/').filter(Boolean)[0];
      return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
    }
    if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      const v = url.searchParams.get('v');
      if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length >= 2 && (parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'live')) {
        return /^[A-Za-z0-9_-]{11}$/.test(parts[1]) ? parts[1] : null;
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function extractPlaylistId(input, { allowBareId = true } = {}) {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  if (allowBareId && /^(PL|OLAK5uy_|RD|UU|FL|LP)[A-Za-z0-9_-]{6,}$/.test(raw)) return raw;
  const isRelativePath = raw.startsWith('/');
  if (!allowBareId && isRelativePath) return null;

  try {
    const url = isRelativePath ? new URL(raw, 'https://www.youtube.com') : new URL(raw);
    const list = url.searchParams.get('list');
    if (list && /^[A-Za-z0-9_-]{2,}$/.test(list)) return list;
  } catch {
    return null;
  }
  return null;
}

export function isDirectAudioOrM4a(stream) {
  const mime = String(stream?.mimeType ?? stream?.type ?? '').toLowerCase();
  const codec = String(stream?.codec ?? '').toLowerCase();
  const format = String(stream?.format ?? '').toLowerCase();
  return (
    mime.includes('audio/mp4') ||
    mime.includes('m4a') ||
    mime.includes('aac') ||
    codec.includes('mp4a') ||
    format.includes('m4a')
  );
}

export function resolveEffectiveQuality(quality = 'HIGH') {
  if (quality !== 'AUTO') return quality || 'HIGH';
  try {
    const conn = globalThis.navigator?.connection;
    if (conn?.saveData) return 'LOW';
    const eff = String(conn?.effectiveType || '').toLowerCase();
    if (eff === 'slow-2g' || eff === '2g') return 'LOW';
    if (eff === '3g') return 'MEDIUM';
  } catch {
    // Ignore
  }
  return 'HIGH';
}

export function selectBestIosAudioStream(audioStreams = [], hlsUrl = null, quality = 'HIGH') {
  const effectiveQuality = resolveEffectiveQuality(quality);
  const safeStreams = (Array.isArray(audioStreams) ? audioStreams : [])
    .map((s) => ({
      url: sanitizeHttpsUrl(s?.url),
      bitrate: Number(s?.bitrate) || 0,
      mimeType: String(s?.mimeType || s?.type || ''),
      codec: String(s?.codec || ''),
      format: String(s?.format || '')
    }))
    .filter((s) => Boolean(s.url));

  const safeHls = sanitizeHttpsUrl(hlsUrl);
  const m4aStreams = safeStreams.filter(isDirectAudioOrM4a);
  const pool = m4aStreams.length > 0 ? m4aStreams : safeStreams;

  let chosen = null;
  if (pool.length > 0) {
    const sorted = [...pool].sort((a, b) => a.bitrate - b.bitrate);
    if (effectiveQuality === 'LOW') {
      chosen = sorted[0];
    } else if (effectiveQuality === 'MEDIUM') {
      const target = 128000;
      chosen = sorted.reduce((best, cur) =>
        Math.abs(cur.bitrate - target) < Math.abs(best.bitrate - target) ? cur : best
      );
    } else {
      chosen = sorted[sorted.length - 1];
    }
  }

  if (m4aStreams.length === 0 && safeHls) {
    return {
      url: safeHls,
      fallbackUrl: chosen?.url || null,
      mimeType: 'application/x-mpegURL',
      bitrate: chosen?.bitrate || 0,
      isM4aCompatible: true
    };
  }

  if (!chosen && safeHls) {
    return {
      url: safeHls,
      fallbackUrl: null,
      mimeType: 'application/x-mpegURL',
      bitrate: 0,
      isM4aCompatible: true
    };
  }

  if (!chosen) return null;

  return {
    url: chosen.url,
    fallbackUrl: safeHls || null,
    mimeType: chosen.mimeType,
    bitrate: chosen.bitrate,
    isM4aCompatible: m4aStreams.length > 0
  };
}

export function parseLrcLines(lrcText) {
  if (typeof lrcText !== 'string' || !lrcText.trim()) return [];
  const rows = [];
  const lineRegex = /\[(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?\]/g;

  for (const rawLine of lrcText.split(/\r?\n/)) {
    const timestamps = [];
    let match;
    lineRegex.lastIndex = 0;
    while ((match = lineRegex.exec(rawLine)) !== null) {
      const mins = Number(match[1]);
      const secs = Number(match[2]);
      const msRaw = match[3] || '0';
      const fraction = msRaw.length === 3 ? Number(msRaw) / 1000 : Number(msRaw) / 100;
      timestamps.push(mins * 60 + secs + fraction);
    }
    if (timestamps.length === 0) continue;
    const text = rawLine.replace(/\[[^\]]+\]/g, '').trim();
    if (!text) continue;
    for (const timeSeconds of timestamps) {
      rows.push({ timeSeconds, text });
    }
  }
  return rows.sort((a, b) => a.timeSeconds - b.timeSeconds);
}

export function parseLyricsTrackQuery(rawTitle, rawArtist = '') {
  const stripNoise = (str) =>
    String(str || '')
      .replace(/\(official.*?\)|\[official.*?\]|\(lyrics.*?\)|\[lyrics.*?\]|\(audio.*?\)|\[audio.*?\]|\(visualizer.*?\)|\[hd\]|\[4k\]|\(feat\.?.*?\)/gi, '')
      .replace(/\s+\|\s+.*$/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  const cleanArtist = stripNoise(String(rawArtist || '').replace(/ - Topic$/i, '').replace(/VEVO$/i, ''));
  const cleanTitle = stripNoise(rawTitle);

  const dashMatch = cleanTitle.match(/^(.{2,60}?)\s+[–—-]\s+(.{2,120})$/);
  if (dashMatch) {
    return {
      artist: dashMatch[1].trim(),
      title: dashMatch[2].trim(),
      fallbackArtist: cleanArtist,
      fallbackTitle: cleanTitle
    };
  }

  return {
    artist: cleanArtist,
    title: cleanTitle,
    fallbackArtist: cleanArtist,
    fallbackTitle: cleanTitle
  };
}

export function formatSubscribersRu(count) {
  const n = Number(count) || 0;
  if (n <= 0) return 'Исполнитель';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.0', '')} млн подписчиков`;
  if (n >= 1_000) return `${Math.round(n / 1_000)} тыс. подписчиков`;
  return `${n} подписчиков`;
}

function getPreferredThumbnail(videoId, candidate) {
  const safe = sanitizeHttpsUrl(candidate);
  if (safe) return safe;
  if (videoId && /^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  }
  return '';
}

function normalizePipedTrack(item) {
  const id = extractVideoId(item?.url || item?.id || '');
  if (!id) return null;
  return sanitizeTrack({
    id,
    title: item.title || 'Без названия',
    artist: item.uploaderName || item.author || item.uploader || 'Исполнитель',
    durationSeconds: Number(item.duration) || 0,
    thumbnailUrl: getPreferredThumbnail(id, item.thumbnail)
  });
}

function normalizeInvidiousTrack(item) {
  const id = extractVideoId(item?.videoId || '');
  if (!id) return null;
  const thumbs = Array.isArray(item.videoThumbnails) ? item.videoThumbnails : [];
  const bestThumb = thumbs.find((t) => t.quality === 'high')?.url || thumbs[0]?.url;
  return sanitizeTrack({
    id,
    title: item.title || 'Без названия',
    artist: item.author || 'Исполнитель',
    durationSeconds: Number(item.lengthSeconds) || 0,
    thumbnailUrl: getPreferredThumbnail(id, bestThumb)
  });
}

function normalizeAudiusTrack(item) {
  if (!item?.id) return null;
  const thumb =
    sanitizeHttpsUrl(item.artwork?.['480x480']) ||
    sanitizeHttpsUrl(item.artwork?.['150x150']) ||
    '';
  return sanitizeTrack({
    id: `aud:${item.id}`,
    title: item.title || 'Без названия',
    artist: item.user?.name || item.user?.handle || 'Исполнитель',
    durationSeconds: Number(item.duration) || 0,
    thumbnailUrl: thumb
  });
}

export class SonoraApi {
  constructor(configOrLegacyFn = () => '') {
    if (typeof configOrLegacyFn === 'function') {
      this.getConfig = () => {
        const res = configOrLegacyFn();
        if (res && typeof res === 'object') return res;
        return {
          customApiBaseUrl: typeof res === 'string' ? res : ''
        };
      };
    } else {
      this.getConfig = () => configOrLegacyFn || {};
    }
    this.activeInstance = null;
    this.activeSourceLabel = 'Мульти-каталог (без рекламы)';
    this.pipedInstancesCache = { fetchedAt: 0, urls: [] };
    this.invidiousInstancesCache = { fetchedAt: 0, urls: [] };
    this.audiusNodesCache = { fetchedAt: 0, urls: [] };
    this.lastFastNodes = { piped: '', invidious: '', audius: '' };
    this.unhealthyUntil = new Map();

    // Performance caches & in-flight deduplication
    this.inflightStreams = new Map();
    this.inflightSearches = new Map();
    this.searchCache = new Map();
    this.artistCache = new Map();
    this.playlistCache = new Map();
  }

  _getConfig() {
    const cfg = this.getConfig?.() || {};
    return {
      customApiBaseUrl: sanitizeCustomNodeUrl(cfg.customApiBaseUrl),
      fastNodes: cfg.fastNodes || {},
      onFastNode: typeof cfg.onFastNode === 'function' ? cfg.onFastNode : null
    };
  }

  _isHealthy(base) {
    const until = this.unhealthyUntil.get(base);
    if (!until) return true;
    if (Date.now() >= until) {
      this.unhealthyUntil.delete(base);
      return true;
    }
    return false;
  }

  _markUnhealthy(base) {
    if (base) {
      this.unhealthyUntil.set(base, Date.now() + NODE_COOLDOWN_MS);
    }
  }

  _markHealthy(base, kind = null) {
    if (!base) return;
    this.unhealthyUntil.delete(base);
    if (kind && ['piped', 'invidious', 'audius'].includes(kind)) {
      this.lastFastNodes[kind] = base;
      this._getConfig().onFastNode?.(kind, base);
    }
  }

  _prioritizePool(basePool, excludeGateways = new Set()) {
    const unique = Array.from(new Set(basePool.map(sanitizeCustomNodeUrl).filter(Boolean))).filter(
      (base) => !excludeGateways?.has(base)
    );
    const healthy = unique.filter((base) => this._isHealthy(base));
    const cooling = unique.filter((base) => !this._isHealthy(base));
    return [...healthy, ...cooling];
  }

  async _fetchJson(url, options = {}, timeoutMs = 3600) {
    const safeUrl = sanitizeHttpsUrl(url);
    if (!safeUrl) throw new Error('Разрешены только HTTPS-запросы');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    try {
      const resp = await fetch(safeUrl, {
        ...options,
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          ...(options.headers || {})
        }
      });
      const text = await resp.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        json = null;
      }
      if (!resp.ok) {
        const err = new Error(json?.error || `HTTP ${resp.status}`);
        err.status = resp.status;
        err.payload = json;
        throw err;
      }
      if (json && json.error) {
        throw new Error(json.message || json.error);
      }
      return json ?? {};
    } finally {
      clearTimeout(timer);
    }
  }

  async warmUpPools() {
    const now = Date.now();
    const tasks = [];
    if (now - this.pipedInstancesCache.fetchedAt > POOL_CACHE_TTL_MS) {
      tasks.push(
        this._fetchJson('https://piped-instances.kavin.rocks/', {}, 3200)
          .then((list) => {
            const urls = Array.isArray(list)
              ? list
                  .filter((item) => item?.api_url)
                  .slice(0, 8)
                  .map((item) => sanitizeCustomNodeUrl(item.api_url))
                  .filter(Boolean)
              : [];
            if (urls.length > 0) {
              this.pipedInstancesCache = { fetchedAt: Date.now(), urls };
            }
          })
          .catch(() => {})
      );
    }
    if (now - this.invidiousInstancesCache.fetchedAt > POOL_CACHE_TTL_MS) {
      tasks.push(
        this._fetchJson('https://api.invidious.io/instances.json?sort_by=type,health,api', {}, 3200)
          .then((list) => {
            const urls = Array.isArray(list)
              ? list
                  .filter(([, meta]) => meta?.type === 'https' && meta?.api)
                  .slice(0, 8)
                  .map(([host]) => `https://${host}`)
              : [];
            if (urls.length > 0) {
              this.invidiousInstancesCache = { fetchedAt: Date.now(), urls };
            }
          })
          .catch(() => {})
      );
    }
    if (now - this.audiusNodesCache.fetchedAt > POOL_CACHE_TTL_MS) {
      tasks.push(
        this._fetchJson('https://api.audius.co', {}, 3200)
          .then((res) => {
            const urls = Array.isArray(res?.data)
              ? res.data.slice(0, 5).map(sanitizeCustomNodeUrl).filter(Boolean)
              : [];
            if (urls.length > 0) {
              this.audiusNodesCache = { fetchedAt: Date.now(), urls };
            }
          })
          .catch(() => {})
      );
    }
    await Promise.allSettled(tasks);
  }

  _getPipedPool() {
    const { customApiBaseUrl, fastNodes } = this._getConfig();
    return Array.from(
      new Set(
        [
          customApiBaseUrl,
          this.activeInstance,
          this.lastFastNodes.piped,
          fastNodes.piped,
          ...DEFAULT_PIPED_INSTANCES,
          ...this.pipedInstancesCache.urls
        ].filter(Boolean)
      )
    );
  }

  _getInvidiousPool() {
    const { fastNodes } = this._getConfig();
    return Array.from(
      new Set(
        [
          this.lastFastNodes.invidious,
          fastNodes.invidious,
          ...DEFAULT_INVIDIOUS_INSTANCES,
          ...this.invidiousInstancesCache.urls
        ].filter(Boolean)
      )
    );
  }

  _getAudiusPool() {
    const { fastNodes } = this._getConfig();
    return Array.from(
      new Set(
        [
          this.lastFastNodes.audius,
          fastNodes.audius,
          ...this.audiusNodesCache.urls,
          ...DEFAULT_AUDIUS_NODES
        ].filter(Boolean)
      )
    );
  }

  async _raceNodesInBatches(nodes, fetcher, batchSize = 3, kind = null) {
    if (!Array.isArray(nodes) || nodes.length === 0) {
      throw new Error('Нет доступных узлов каталога');
    }

    let lastError = null;
    for (let i = 0; i < nodes.length; i += batchSize) {
      const batch = nodes.slice(i, i + batchSize);
      try {
        const winner = await Promise.any(
          batch.map(async (node) => {
            try {
              const result = await fetcher(node);
              this._markHealthy(node, kind);
              return { node, data: result };
            } catch (err) {
              this._markUnhealthy(node);
              throw err;
            }
          })
        );
        return winner;
      } catch (aggErr) {
        const errs = aggErr?.errors || [aggErr];
        lastError = errs[0] || lastError;
      }
    }
    throw lastError || new Error('Каталог временно недоступен');
  }

  async _tryPipedPool(path, { excludeGateways = new Set(), validate = null, timeoutMs = 3600 } = {}) {
    const rawPool = this._getPipedPool();
    const ordered = this._prioritizePool(rawPool, excludeGateways);
    const { node, data } = await this._raceNodesInBatches(
      ordered,
      async (base) => {
        const json = await this._fetchJson(`${base}${path}`, {}, timeoutMs);
        if (validate) return validate(json, base);
        return json;
      },
      3,
      'piped'
    );
    this.activeInstance = node;
    this.activeSourceLabel = `${new URL(node).hostname} (без рекламы)`;
    return { base: node, data };
  }

  async _tryInvidiousPool(path, { excludeGateways = new Set(), validate = null, timeoutMs = 3600 } = {}) {
    const rawPool = this._getInvidiousPool();
    const ordered = this._prioritizePool(rawPool, excludeGateways);
    const { node, data } = await this._raceNodesInBatches(
      ordered,
      async (base) => {
        const json = await this._fetchJson(`${base}${path}`, {}, timeoutMs);
        if (validate) return validate(json, base);
        return json;
      },
      3,
      'invidious'
    );
    this.activeSourceLabel = `${new URL(node).hostname} (без рекламы)`;
    return { base: node, data };
  }

  async _searchAudius(query = '', trending = false) {
    const pool = this._prioritizePool(this._getAudiusPool());
    const suffix =
      trending || !query
        ? '/v1/tracks/trending?app_name=Sonora&limit=25'
        : `/v1/tracks/search?query=${encodeURIComponent(query)}&app_name=Sonora`;

    const { data: tracks } = await this._raceNodesInBatches(
      pool,
      async (base) => {
        const json = await this._fetchJson(`${base}${suffix}`, {}, 3600);
        const rows = Array.isArray(json?.data) ? json.data : [];
        const normalized = rows.map(normalizeAudiusTrack).filter(Boolean);
        if (normalized.length === 0) throw new Error('Audius: пустой результат');
        return normalized;
      },
      3,
      'audius'
    );

    this.activeSourceLabel = 'Audius Audio (без рекламы)';
    return tracks.map((t) => ({ type: 'track', ...t }));
  }

  async testCatalogHealth() {
    const { customApiBaseUrl } = this._getConfig();

    const probePiped = async () => {
      const t0 = performance.now();
      try {
        const pool = customApiBaseUrl
          ? [customApiBaseUrl, ...DEFAULT_PIPED_INSTANCES.slice(0, 5)]
          : DEFAULT_PIPED_INSTANCES.slice(0, 6);
        const { node } = await this._raceNodesInBatches(
          pool,
          (base) => this._fetchJson(`${base}/suggestions?query=music`, {}, 3600),
          3,
          'piped'
        );
        return {
          ok: true,
          label: new URL(node).hostname,
          latencyMs: Math.round(performance.now() - t0)
        };
      } catch (err) {
        return { ok: false, label: 'Piped', latencyMs: 0, error: err.message };
      }
    };

    const probeInvidious = async () => {
      const t0 = performance.now();
      try {
        const { node } = await this._raceNodesInBatches(
          DEFAULT_INVIDIOUS_INSTANCES.slice(0, 6),
          (base) => this._fetchJson(`${base}/api/v1/stats`, {}, 3600),
          3,
          'invidious'
        );
        return {
          ok: true,
          label: new URL(node).hostname,
          latencyMs: Math.round(performance.now() - t0)
        };
      } catch (err) {
        return { ok: false, label: 'Invidious', latencyMs: 0, error: err.message };
      }
    };

    const probeAudius = async () => {
      const t0 = performance.now();
      try {
        const { node } = await this._raceNodesInBatches(
          DEFAULT_AUDIUS_NODES,
          (base) => this._fetchJson(`${base}/v1/tracks/trending?app_name=Sonora&limit=1`, {}, 3600),
          3,
          'audius'
        );
        return {
          ok: true,
          label: new URL(node).hostname,
          latencyMs: Math.round(performance.now() - t0)
        };
      } catch (err) {
        return { ok: false, label: 'Audius', latencyMs: 0, error: err.message };
      }
    };

    const [piped, invidious, audius] = await Promise.all([
      probePiped(),
      probeInvidious(),
      probeAudius()
    ]);

    return { piped, invidious, audius };
  }

  async search(rawQuery, filter = 'TRACKS', { isMoodTrending = false, forceFresh = false } = {}) {
    const query = String(rawQuery ?? '').trim();
    if (!query) return [];

    const cacheKey = `${filter}:${query.toLowerCase()}`;
    if (!forceFresh) {
      const cached = this.searchCache.get(cacheKey);
      if (cached && Date.now() - cached.fetchedAt < SEARCH_CACHE_TTL_MS) {
        return cached.results;
      }
    }

    if (this.inflightSearches.has(cacheKey)) {
      return this.inflightSearches.get(cacheKey);
    }

    const promise = this._performSearch(query, filter, { isMoodTrending }).then((results) => {
      if (Array.isArray(results) && results.length > 0) {
        this.searchCache.set(cacheKey, { fetchedAt: Date.now(), results });
        if (this.searchCache.size > 40) {
          const oldestKey = this.searchCache.keys().next().value;
          this.searchCache.delete(oldestKey);
        }
      }
      return results;
    });

    this.inflightSearches.set(cacheKey, promise);
    try {
      return await promise;
    } finally {
      this.inflightSearches.delete(cacheKey);
    }
  }

  async _performSearch(query, filter, { isMoodTrending = false } = {}) {
    const directPlaylistId = extractPlaylistId(query, { allowBareId: false });
    if (directPlaylistId) {
      const playlist = await this.getPlaylist(directPlaylistId);
      return [
        {
          type: 'playlist',
          id: playlist.id,
          title: playlist.title,
          artist: playlist.author || 'YouTube Плейлист',
          thumbnailUrl: playlist.thumbnailUrl,
          trackCount: playlist.tracks.length,
          tracks: playlist.tracks
        }
      ];
    }

    const directVideoId = extractVideoId(query, { allowBareId: false });
    if (directVideoId) {
      const info = await this.getStreamInfo(directVideoId, 'HIGH').catch(() => null);
      return [
        {
          type: 'track',
          ...sanitizeTrack({
            id: directVideoId,
            title: info?.title || `YouTube трек (${directVideoId})`,
            artist: info?.artist || 'YouTube',
            durationSeconds: info?.durationSeconds || 0,
            thumbnailUrl: getPreferredThumbnail(directVideoId, info?.thumbnailUrl)
          })
        }
      ];
    }

    const pipedFilter =
      filter === 'PLAYLISTS'
        ? 'music_playlists'
        : filter === 'ARTISTS'
          ? 'music_artists'
          : 'music_songs';

    let lastError = null;

    const parsePipedResults = (data) => {
      const items = Array.isArray(data?.items) ? data.items : [];
      if (filter === 'PLAYLISTS') {
        return items
          .map((it) => {
            const pid = extractPlaylistId(it.url || '');
            if (!pid) return null;
            return {
              type: 'playlist',
              id: pid,
              title: it.name || it.title || 'Плейлист',
              artist: it.uploaderName || 'YouTube Music',
              thumbnailUrl: sanitizeHttpsUrl(it.thumbnail) || '',
              trackCount: Number(it.videos) > 0 ? Number(it.videos) : 0
            };
          })
          .filter(Boolean);
      }
      if (filter === 'ARTISTS') {
        return items
          .map((it) => ({
            type: 'artist',
            id: String(it.url || it.name || ''),
            channelUrl: String(it.url || ''),
            title: it.name || it.uploaderName || 'Исполнитель',
            artist: formatSubscribersRu(it.subscribers),
            thumbnailUrl: sanitizeHttpsUrl(it.thumbnail) || ''
          }))
          .filter((it) => it.title);
      }
      return items.map(normalizePipedTrack).filter(Boolean).map((t) => ({ type: 'track', ...t }));
    };

    try {
      const { data: parsed } = await this._tryPipedPool(
        `/search?q=${encodeURIComponent(query)}&filter=${encodeURIComponent(pipedFilter)}`,
        {
          validate: (json) => {
            const out = parsePipedResults(json);
            if (out.length === 0) throw new Error('Пустой ответ Piped');
            return out;
          }
        }
      );
      if (parsed.length > 0) return parsed;
    } catch (err) {
      lastError = err;
    }

    if (filter === 'TRACKS') {
      try {
        const { data: parsedAll } = await this._tryPipedPool(
          `/search?q=${encodeURIComponent(query)}&filter=all`,
          {
            validate: (json) => {
              const tracks = (Array.isArray(json?.items) ? json.items : [])
                .filter((it) => it.type === 'stream')
                .map(normalizePipedTrack)
                .filter(Boolean)
                .map((t) => ({ type: 'track', ...t }));
              if (tracks.length === 0) throw new Error('Пустой ответ Piped (all)');
              return tracks;
            }
          }
        );
        if (parsedAll.length > 0) return parsedAll;
      } catch (err) {
        lastError = err;
      }
    }

    try {
      const invType = filter === 'PLAYLISTS' ? 'playlist' : filter === 'ARTISTS' ? 'channel' : 'video';
      const { data: invParsed } = await this._tryInvidiousPool(
        `/api/v1/search?q=${encodeURIComponent(query)}&type=${invType}`,
        {
          validate: (invItems) => {
            const arr = Array.isArray(invItems) ? invItems : [];
            if (filter === 'PLAYLISTS') {
              const playlists = arr
                .map((it) => ({
                  type: 'playlist',
                  id: String(it.playlistId || ''),
                  title: it.title || 'Плейлист',
                  artist: it.author || 'YouTube',
                  thumbnailUrl: sanitizeHttpsUrl(it.playlistThumbnail) || '',
                  trackCount: Number(it.videoCount) || 0
                }))
                .filter((p) => p.id);
              if (playlists.length === 0) throw new Error('Пусто');
              return playlists;
            }
            if (filter === 'ARTISTS') {
              const artists = arr
                .map((it) => ({
                  type: 'artist',
                  id: String(it.authorId || it.author || ''),
                  channelUrl: it.authorId ? `/channel/${it.authorId}` : '',
                  title: it.author || 'Исполнитель',
                  artist: formatSubscribersRu(it.subCount),
                  thumbnailUrl: sanitizeHttpsUrl(it.authorThumbnails?.[0]?.url) || ''
                }))
                .filter((a) => a.title);
              if (artists.length === 0) throw new Error('Пусто');
              return artists;
            }
            const tracks = arr.map(normalizeInvidiousTrack).filter(Boolean).map((t) => ({ type: 'track', ...t }));
            if (tracks.length === 0) throw new Error('Пусто');
            return tracks;
          }
        }
      );
      if (invParsed.length > 0) return invParsed;
    } catch (err) {
      lastError = err;
    }

    if (filter === 'TRACKS') {
      try {
        const audiusTracks = await this._searchAudius(
          query,
          isMoodTrending && query === 'popular music hits'
        );
        if (audiusTracks.length > 0) return audiusTracks;
      } catch (err) {
        lastError = err;
      }
    }

    if (lastError) throw lastError;
    return [];
  }

  async getArtistDetails(artistItem) {
    const cacheKey = String(artistItem?.channelUrl || artistItem?.id || artistItem?.title || '').trim();
    const cached = this.artistCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < ARTIST_CACHE_TTL_MS) {
      return cached.details;
    }

    const name = String(artistItem?.title || '').trim();
    const channelPath = String(artistItem?.channelUrl || '').trim();
    let avatar = sanitizeHttpsUrl(artistItem?.thumbnailUrl) || '';
    let subText = artistItem?.artist || 'Исполнитель';
    let tracks = [];

    if (channelPath.startsWith('/channel/')) {
      try {
        const { data } = await this._tryPipedPool(channelPath);
        avatar = sanitizeHttpsUrl(data.avatarUrl) || avatar;
        if (data.subscriberCount > 0) subText = formatSubscribersRu(data.subscriberCount);
        tracks = (Array.isArray(data.relatedStreams) ? data.relatedStreams : [])
          .map(normalizePipedTrack)
          .filter(Boolean);
      } catch {
        // Fallback to Invidious channel endpoint below
      }

      if (tracks.length === 0) {
        const channelId = channelPath.slice('/channel/'.length).split('/')[0];
        if (channelId) {
          try {
            const { data: inv } = await this._tryInvidiousPool(
              `/api/v1/channels/${encodeURIComponent(channelId)}`
            );
            const thumbs = Array.isArray(inv?.authorThumbnails) ? inv.authorThumbnails : [];
            avatar = sanitizeHttpsUrl(thumbs[thumbs.length - 1]?.url || thumbs[0]?.url) || avatar;
            if (inv?.subCount > 0) subText = formatSubscribersRu(inv.subCount);
            const rawVideos = Array.isArray(inv?.latestVideos)
              ? inv.latestVideos
              : Array.isArray(inv?.topVideos)
                ? inv.topVideos
                : [];
            tracks = rawVideos.map(normalizeInvidiousTrack).filter(Boolean);
          } catch {
            // Fallback to search by name below
          }
        }
      }
    }

    if (tracks.length === 0 && name) {
      const results = await this.search(name, 'TRACKS').catch(() => []);
      tracks = results.filter((r) => r.type === 'track');
    }

    const details = {
      title: name,
      subtitle: subText,
      thumbnailUrl: avatar,
      tracks
    };
    if (cacheKey && tracks.length > 0) {
      this.artistCache.set(cacheKey, { fetchedAt: Date.now(), details });
    }
    return details;
  }

  async getSuggestions(query) {
    const clean = String(query ?? '').trim();
    if (clean.length < 2) return [];
    try {
      const { data } = await this._tryPipedPool(`/suggestions?query=${encodeURIComponent(clean)}`, {
        timeoutMs: 2600
      });
      return Array.isArray(data) ? data.slice(0, 6) : [];
    } catch {
      return [];
    }
  }

  _buildStreamCandidates(urls = []) {
    const seen = new Set();
    const out = [];
    for (const raw of urls) {
      const clean = sanitizeHttpsUrl(raw);
      if (clean && !seen.has(clean)) {
        seen.add(clean);
        out.push(clean);
      }
    }
    return out;
  }

  async getStreamInfo(videoId, quality = 'HIGH', { excludeGateways = new Set() } = {}) {
    const excludeKey = Array.from(excludeGateways || []).sort().join(',');
    const dedupeKey = `${String(videoId || '').trim()}:${quality}:${excludeKey}`;

    if (this.inflightStreams.has(dedupeKey)) {
      return this.inflightStreams.get(dedupeKey);
    }

    const promise = this._resolveStreamInfo(videoId, quality, { excludeGateways });
    this.inflightStreams.set(dedupeKey, promise);
    try {
      return await promise;
    } finally {
      this.inflightStreams.delete(dedupeKey);
    }
  }

  async getOfflineStreamCandidates(videoId, quality = 'HIGH', existingCandidates = []) {
    const rawId = String(videoId ?? '').trim();
    const baseList = Array.isArray(existingCandidates) ? existingCandidates.filter(Boolean) : [];
    const hasCorsFriendly = baseList.some((u) => u.includes('local=true') || u.includes('audius'));
    if (hasCorsFriendly || rawId.startsWith('aud:')) {
      return baseList;
    }

    const cleanId = extractVideoId(rawId);
    if (!cleanId) return baseList;

    const healthyInvidious = this._prioritizePool(this._getInvidiousPool()).slice(0, 5);
    const invProxiedUrls = healthyInvidious.map(
      (base) => `${base}/latest_version?id=${encodeURIComponent(cleanId)}&itag=140&local=true`
    );

    try {
      const invInfo = await this._tryInvidiousPool(
        `/api/v1/videos/${encodeURIComponent(cleanId)}`,
        {
          validate: (inv, invBase) => ({
            proxyUrl: `${invBase}/latest_version?id=${encodeURIComponent(cleanId)}&itag=140&local=true`,
            fallbackUrls: this._buildStreamCandidates(
              (Array.isArray(inv?.adaptiveFormats) ? inv.adaptiveFormats : [])
                .filter((f) => String(f.type || '').startsWith('audio/') && f.url)
                .map((f) => f.url)
            )
          })
        }
      );
      return this._buildStreamCandidates([
        invInfo?.data?.proxyUrl,
        ...invProxiedUrls,
        ...baseList,
        ...(invInfo?.data?.fallbackUrls || [])
      ]);
    } catch {
      return this._buildStreamCandidates([...invProxiedUrls, ...baseList]);
    }
  }

  async _resolveStreamInfo(videoId, quality = 'HIGH', { excludeGateways = new Set() } = {}) {
    const rawId = String(videoId ?? '').trim();
    if (rawId.startsWith('aud:')) {
      const audId = rawId.slice(4);
      if (!/^[A-Za-z0-9_-]{3,32}$/.test(audId)) {
        throw new Error('Некорректный идентификатор трека Audius');
      }
      const pool = this._prioritizePool(this._getAudiusPool());
      const candidates = this._buildStreamCandidates(
        pool.map((base) => `${base}/v1/tracks/${encodeURIComponent(audId)}/stream?app_name=Sonora`)
      );
      return {
        engine: 'audio',
        sourceType: 'audius',
        sourceKey: 'audius',
        id: rawId,
        title: 'Audius Track',
        artist: 'Audius',
        durationSeconds: 0,
        thumbnailUrl: '',
        streamUrl: candidates[0],
        streamCandidates: candidates,
        proxyCacheUrl: candidates[0],
        fallbackUrl: candidates[1] || null,
        mimeType: 'audio/mpeg',
        relatedTracks: []
      };
    }

    const cleanId = extractVideoId(rawId);
    if (!cleanId) throw new Error('Неверный идентификатор трека');

    // Tier 1: Parallel Piped Federation (direct ad-free M4A/HLS audio)
    try {
      const { base, data: result } = await this._tryPipedPool(
        `/streams/${encodeURIComponent(cleanId)}`,
        {
          excludeGateways,
          validate: (data, nodeBase) => {
            const audioCandidates =
              Array.isArray(data?.audioStreams) && data.audioStreams.length > 0
                ? data.audioStreams
                : (Array.isArray(data?.videoStreams) ? data.videoStreams : []).filter((v) => !v.videoOnly);

            const selected = selectBestIosAudioStream(audioCandidates, data?.hls, quality);
            if (!selected) throw new Error('Нет аудиопотоков');

            const chosenMatch = audioCandidates.find((c) => c?.url === selected.url);
            const extraM4aUrls = audioCandidates
              .filter(isDirectAudioOrM4a)
              .flatMap((c) => [c.url, c.directUrl]);

            const streamCandidates = this._buildStreamCandidates([
              selected.url,
              chosenMatch?.directUrl,
              selected.fallbackUrl,
              ...extraM4aUrls
            ]);
            if (streamCandidates.length === 0) throw new Error('Пустой список аудиопотоков');

            return {
              engine: 'audio',
              sourceType: 'piped',
              sourceKey: nodeBase,
              id: cleanId,
              title: data.title || 'Без названия',
              artist: data.uploader || 'Исполнитель',
              durationSeconds: Number(data.duration) || 0,
              thumbnailUrl: getPreferredThumbnail(cleanId, data.thumbnailUrl),
              streamUrl: streamCandidates[0],
              streamCandidates,
              proxyCacheUrl: streamCandidates[0],
              fallbackUrl: streamCandidates[1] || null,
              mimeType: selected.mimeType,
              relatedTracks: (Array.isArray(data.relatedStreams) ? data.relatedStreams : [])
                .map(normalizePipedTrack)
                .filter(Boolean)
            };
          }
        }
      );
      if (result) {
        this.activeInstance = base;
        return result;
      }
    } catch {
      // Fall through to Invidious parallel federation
    }

    // Tier 2: Parallel Invidious Federation (includes CORS/Range local=true AAC M4A fallback)
    try {
      const { data: invResult } = await this._tryInvidiousPool(
        `/api/v1/videos/${encodeURIComponent(cleanId)}`,
        {
          excludeGateways,
          validate: (inv, invBase) => {
            const formats = Array.isArray(inv?.adaptiveFormats)
              ? inv.adaptiveFormats
                  .filter((f) => String(f.type || '').startsWith('audio/') && f.url)
                  .map((f) => ({
                    url: f.url,
                    bitrate: Number(f.bitrate) || 0,
                    mimeType: f.type,
                    codec: f.encoding || ''
                  }))
              : [];
            const invProxiedM4a = `${invBase}/latest_version?id=${encodeURIComponent(cleanId)}&itag=140&local=true`;
            const selected = selectBestIosAudioStream(formats, inv?.hlsUrl, quality);
            const streamCandidates = this._buildStreamCandidates([
              selected?.url,
              invProxiedM4a,
              selected?.fallbackUrl
            ]);
            if (streamCandidates.length === 0) throw new Error('Нет аудиопотоков Invidious');

            return {
              engine: 'audio',
              sourceType: 'invidious',
              sourceKey: invBase,
              id: cleanId,
              title: inv.title || 'Без названия',
              artist: inv.author || 'Исполнитель',
              durationSeconds: Number(inv.lengthSeconds) || 0,
              thumbnailUrl: getPreferredThumbnail(cleanId, inv.videoThumbnails?.[0]?.url),
              streamUrl: streamCandidates[0],
              streamCandidates,
              proxyCacheUrl: invProxiedM4a,
              fallbackUrl: streamCandidates[1] || null,
              mimeType: selected?.mimeType || 'audio/mp4',
              relatedTracks: (Array.isArray(inv.recommendedVideos) ? inv.recommendedVideos : [])
                .map(normalizeInvidiousTrack)
                .filter(Boolean)
            };
          }
        }
      );
      if (invResult) return invResult;
    } catch {
      // Throw clean error below (never fall back to ad-serving YouTube IFrame)
    }

    throw new Error(
      'Не удалось загрузить аудио без рекламы. Проверьте интернет или обновите источники в Настройках.'
    );
  }

  async getRelatedTracks(track) {
    const id = typeof track === 'string' ? track : track?.id;
    const title = typeof track === 'object' ? track?.title : '';
    const artist = typeof track === 'object' ? track?.artist : '';

    if (id && !String(id).startsWith('aud:')) {
      try {
        const info = await this.getStreamInfo(id, 'HIGH');
        if (info.relatedTracks?.length > 0) return info.relatedTracks;
      } catch {
        // Fallback to search-based radio recommendations
      }
    }

    const radioQuery = `${artist || ''} ${title || ''}`.trim() || 'popular music hits';
    const items = await this.search(radioQuery, 'TRACKS').catch(() => []);
    return items.filter((it) => it.type === 'track' && it.id !== id);
  }

  async getPlaylist(rawPlaylistInput, { maxPages = 5 } = {}) {
    const playlistId = extractPlaylistId(rawPlaylistInput);
    if (!playlistId) throw new Error('Некорректная ссылка или ID плейлиста YouTube');

    const cached = this.playlistCache.get(playlistId);
    if (cached && Date.now() - cached.fetchedAt < PLAYLIST_CACHE_TTL_MS) {
      return cached.playlist;
    }

    const dedupeTracks = (list) => {
      const seen = new Set();
      const out = [];
      for (const t of list) {
        if (t?.id && !seen.has(t.id)) {
          seen.add(t.id);
          out.push(t);
        }
      }
      return out;
    };

    let playlist = null;
    try {
      const { base, data } = await this._tryPipedPool(`/playlists/${encodeURIComponent(playlistId)}`);
      const collected = (Array.isArray(data.relatedStreams) ? data.relatedStreams : [])
        .map(normalizePipedTrack)
        .filter(Boolean);

      let nextpage = data.nextpage || null;
      for (let page = 1; page < maxPages && nextpage; page++) {
        try {
          const nextData = await this._fetchJson(
            `${base}/nextpage/playlists/${encodeURIComponent(playlistId)}?nextpage=${encodeURIComponent(nextpage)}`,
            {},
            3600
          );
          const more = (Array.isArray(nextData.relatedStreams) ? nextData.relatedStreams : [])
            .map(normalizePipedTrack)
            .filter(Boolean);
          if (more.length === 0) break;
          collected.push(...more);
          nextpage = nextData.nextpage || null;
        } catch {
          break;
        }
      }

      playlist = {
        id: playlistId,
        title: data.name || 'Плейлист YouTube',
        author: data.uploader || 'YouTube Music',
        description: data.description || '',
        thumbnailUrl: sanitizeHttpsUrl(data.thumbnailUrl) || '',
        tracks: dedupeTracks(collected)
      };
    } catch {
      const { base, data: inv } = await this._tryInvidiousPool(
        `/api/v1/playlists/${encodeURIComponent(playlistId)}`
      );
      const collected = (Array.isArray(inv.videos) ? inv.videos : [])
        .map(normalizeInvidiousTrack)
        .filter(Boolean);

      if (collected.length >= 90) {
        for (let page = 2; page <= maxPages; page++) {
          try {
            const pageData = await this._fetchJson(
              `${base}/api/v1/playlists/${encodeURIComponent(playlistId)}?page=${page}`,
              {},
              3600
            );
            const more = (Array.isArray(pageData.videos) ? pageData.videos : [])
              .map(normalizeInvidiousTrack)
              .filter(Boolean);
            if (more.length === 0) break;
            collected.push(...more);
            if (more.length < 90) break;
          } catch {
            break;
          }
        }
      }

      playlist = {
        id: playlistId,
        title: inv.title || 'Плейлист YouTube Music',
        author: inv.author || 'YouTube Music',
        description: inv.description || '',
        thumbnailUrl: sanitizeHttpsUrl(inv.playlistThumbnail) || '',
        tracks: dedupeTracks(collected)
      };
    }

    if (playlist && playlist.tracks.length > 0) {
      this.playlistCache.set(playlistId, { fetchedAt: Date.now(), playlist });
    }
    return playlist;
  }

  async fetchLyrics(track, customQuery = '') {
    const manual = String(customQuery || '').trim();
    if (!track?.title && !manual) return { synced: [], plain: '', source: '' };

    const parsed = parseLyricsTrackQuery(track?.title || '', track?.artist || '');
    const exactAttempts = [];

    if (!manual) {
      if (parsed.artist && parsed.title) {
        exactAttempts.push({ artist: parsed.artist, title: parsed.title });
      }
      if (
        parsed.fallbackTitle &&
        (parsed.fallbackTitle !== parsed.title || parsed.fallbackArtist !== parsed.artist)
      ) {
        exactAttempts.push({ artist: parsed.fallbackArtist, title: parsed.fallbackTitle });
      }
    }

    for (const pair of exactAttempts) {
      if (!pair.title || !pair.artist) continue;
      try {
        const params = new URLSearchParams({
          track_name: pair.title,
          artist_name: pair.artist
        });
        if (track?.durationSeconds > 0) {
          params.set('duration', String(Math.round(track.durationSeconds)));
        }
        const exact = await this._fetchJson(`https://lrclib.net/api/get?${params.toString()}`, {}, 4500);
        const synced = parseLrcLines(exact.syncedLyrics || '');
        if (synced.length > 0 || exact.plainLyrics) {
          return { synced, plain: exact.plainLyrics || '', source: 'LRCLIB' };
        }
      } catch {
        // Try next pair or search endpoint
      }
    }

    const searchQueries = manual
      ? [manual]
      : Array.from(
          new Set(
            [
              `${parsed.artist} ${parsed.title}`.trim(),
              parsed.title,
              `${parsed.fallbackArtist} ${parsed.fallbackTitle}`.trim()
            ].filter(Boolean)
          )
        );

    for (const q of searchQueries) {
      try {
        const results = await this._fetchJson(
          `https://lrclib.net/api/search?q=${encodeURIComponent(q)}`,
          {},
          4500
        );
        if (Array.isArray(results) && results.length > 0) {
          const best = results.find((r) => r.syncedLyrics) || results[0];
          const synced = parseLrcLines(best.syncedLyrics || '');
          if (synced.length > 0 || best.plainLyrics) {
            return {
              synced,
              plain: best.plainLyrics || '',
              source: 'LRCLIB'
            };
          }
        }
      } catch {
        // Try next query
      }
    }

    return { synced: [], plain: '', source: '' };
  }
}
