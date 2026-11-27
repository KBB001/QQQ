import { sanitizeHttpsUrl, sanitizeTrack } from './security.js';

const DEFAULT_PIPED_INSTANCES = [
  'https://api.piped.private.coffee',
  'https://pipedapi.ducks.party',
  'https://pipedapi.adminforge.de',
  'https://pipedapi.kavin.rocks'
];

const AUDIUS_DISCOVERY_BASE = 'https://discoveryprovider.audius.co/v1';

export const MOOD_CHIPS = [
  { id: 'ALL', label: 'Для вас', query: 'popular music hits' },
  { id: 'RELAX', label: 'Расслабиться', query: 'chill acoustic ambient' },
  { id: 'ENERGIZE', label: 'Энергия', query: 'workout upbeat electronic' },
  { id: 'FOCUS', label: 'Фокус', query: 'focus instrumental study' },
  { id: 'NIGHT', label: 'Вечер', query: 'late night r&b chill' },
  { id: 'LOFI', label: 'Lo-Fi биты', query: 'lofi hip hop radio' }
];

export const CLOUDFLARE_WORKER_TEMPLATE = `// Личный Cloudflare Worker прокси для каталога Sonora (без рекламы)
const PIPED_UPSTREAMS = [
  'https://api.piped.private.coffee',
  'https://pipedapi.ducks.party',
  'https://pipedapi.adminforge.de',
  'https://pipedapi.kavin.rocks'
];

const INVIDIOUS_UPSTREAMS = [
  'https://invidious.nerdvpn.de',
  'https://invidious.privacyredirect.com',
  'https://iv.datura.network'
];

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '*';
  const allowedRaw = String(env?.ALLOWED_ORIGINS || '').trim();
  let allowOrigin = '*';
  if (allowedRaw) {
    const allowed = allowedRaw.split(',').map((s) => s.trim()).filter(Boolean);
    allowOrigin = allowed.includes(origin) ? origin : allowed[0] || '';
  }
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Range',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, Content-Type',
    'Vary': 'Origin'
  };
}

function jsonResponse(payload, status, request, env) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': status === 200 ? 'public, max-age=120' : 'no-store',
      ...corsHeaders(request, env)
    }
  });
}

function isAllowedMediaUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      /^(10\\.|192\\.168\\.|172\\.(1[6-9]|2\\d|3[01])\\.|169\\.254\\.)/.test(host) ||
      /^\\d+\\.\\d+\\.\\d+\\.\\d+$/.test(host)
    ) return false;
    return host === 'googlevideo.com' || host.endsWith('.googlevideo.com');
  } catch {
    return false;
  }
}

async function fetchJsonWithTimeout(url, timeoutMs = 6500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'SonoraWorker/2.0' }
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    if (data && data.error) throw new Error(data.message || data.error);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function tryPipedPath(pathAndQuery) {
  let lastErr = null;
  for (const base of PIPED_UPSTREAMS) {
    try {
      return await fetchJsonWithTimeout(base + pathAndQuery);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('All Piped upstreams unavailable');
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    if (request.method !== 'GET' && request.method !== 'HEAD') return jsonResponse({ error: 'Method Not Allowed' }, 405, request, env);
    const reqUrl = new URL(request.url);
    const path = reqUrl.pathname.replace(/\\/+$/, '') || '/';
    if (path === '/' || path === '/health') {
      return jsonResponse({ ok: true, service: 'sonora-cf-worker', version: '2.0.0' }, 200, request, env);
    }
    try {
      if (path === '/search') {
        const q = (reqUrl.searchParams.get('q') || '').trim();
        const filter = (reqUrl.searchParams.get('filter') || 'music_songs').trim();
        if (!q) return jsonResponse({ items: [] }, 200, request, env);
        return jsonResponse(await tryPipedPath('/search?q=' + encodeURIComponent(q) + '&filter=' + encodeURIComponent(filter)), 200, request, env);
      }
      if (path === '/suggestions') {
        const q = (reqUrl.searchParams.get('query') || '').trim();
        return jsonResponse(q ? await tryPipedPath('/suggestions?query=' + encodeURIComponent(q)) : [], 200, request, env);
      }
      if (path.startsWith('/playlists/') || path.startsWith('/channel/')) {
        return jsonResponse(await tryPipedPath(path), 200, request, env);
      }
      if (path.startsWith('/streams/')) {
        const vid = decodeURIComponent(path.slice('/streams/'.length)).trim();
        try {
          return jsonResponse(await tryPipedPath('/streams/' + encodeURIComponent(vid)), 200, request, env);
        } catch (pipedErr) {
          for (const invBase of INVIDIOUS_UPSTREAMS) {
            try {
              const inv = await fetchJsonWithTimeout(invBase + '/api/v1/videos/' + encodeURIComponent(vid));
              const audioStreams = (inv.adaptiveFormats || [])
                .filter((f) => String(f.type || '').startsWith('audio/') && f.url)
                .map((f) => ({ url: f.url, bitrate: Number(f.bitrate) || 0, mimeType: String(f.type || '').split(';')[0], codec: f.encoding || '' }));
              return jsonResponse({ title: inv.title, uploader: inv.author, duration: inv.lengthSeconds, hls: inv.hlsUrl || null, audioStreams, videoStreams: [], relatedStreams: [] }, 200, request, env);
            } catch {}
          }
          throw pipedErr;
        }
      }
      if (path === '/audio-proxy') {
        const target = reqUrl.searchParams.get('url') || '';
        if (!isAllowedMediaUrl(target)) return jsonResponse({ error: 'Blocked media host' }, 403, request, env);
        const h = new Headers();
        if (request.headers.get('Range')) h.set('Range', request.headers.get('Range'));
        const upstream = await fetch(target, { headers: h });
        const out = new Headers(corsHeaders(request, env));
        for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
          if (upstream.headers.get(k)) out.set(k, upstream.headers.get(k));
        }
        return new Response(upstream.body, { status: upstream.status, headers: out });
      }
      return jsonResponse({ error: 'Not Found' }, 404, request, env);
    } catch (err) {
      return jsonResponse({ error: err?.message || 'Upstream proxy error' }, 502, request, env);
    }
  }
};`;

function sanitizeEndpointUrl(rawUrl) {
  const safe = sanitizeHttpsUrl(rawUrl);
  if (safe) return safe.replace(/\/+$/, '');
  if (typeof rawUrl === 'string') {
    try {
      const u = new URL(rawUrl.trim());
      if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) {
        return u.origin + u.pathname.replace(/\/+$/, '');
      }
    } catch {
      return null;
    }
  }
  return null;
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

export function selectBestIosAudioStream(audioStreams = [], hlsUrl = null, quality = 'HIGH') {
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
    if (quality === 'LOW') {
      chosen = sorted[0];
    } else if (quality === 'MEDIUM') {
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
          workerCatalogUrl: '',
          serverUrl: '',
          customApiBaseUrl: typeof res === 'string' ? res : '',
          activeAccount: null
        };
      };
    } else {
      this.getConfig = () => configOrLegacyFn || {};
    }
    this.activeInstance = null;
    this.activeSourceLabel = 'Автоподбор';
    this.invidiousInstancesCache = { fetchedAt: 0, urls: [] };
    // Server Bearer session tokens stored strictly in JS memory (never localStorage)
    this.serverTokens = new Map();
  }

  getServerToken(serverUrl) {
    const clean = sanitizeEndpointUrl(serverUrl);
    if (!clean) return '';
    const rec = this.serverTokens.get(clean);
    if (!rec) return '';
    if (rec.expiresAt && rec.expiresAt <= Date.now()) {
      this.serverTokens.delete(clean);
      return '';
    }
    return rec.token;
  }

  setServerToken(serverUrl, token, expiresAt = Date.now() + 7 * 24 * 3600 * 1000) {
    const clean = sanitizeEndpointUrl(serverUrl);
    if (!clean || !token) return;
    this.serverTokens.set(clean, { token, expiresAt });
  }

  clearServerToken(serverUrl) {
    const clean = sanitizeEndpointUrl(serverUrl);
    if (clean) this.serverTokens.delete(clean);
  }

  _getConfig() {
    const cfg = this.getConfig?.() || {};
    return {
      workerCatalogUrl: sanitizeEndpointUrl(cfg.workerCatalogUrl) || '',
      serverUrl: sanitizeEndpointUrl(cfg.serverUrl) || '',
      customApiBaseUrl: sanitizeEndpointUrl(cfg.customApiBaseUrl) || '',
      activeAccount: cfg.activeAccount || null
    };
  }

  _getCatalogGateways() {
    const { workerCatalogUrl, serverUrl, customApiBaseUrl } = this._getConfig();
    const gateways = [];

    // 1. Personal Cloudflare Worker (Priority #1 per user choice)
    if (workerCatalogUrl) {
      gateways.push({
        kind: 'worker',
        base: workerCatalogUrl,
        label: 'Cloudflare Worker',
        prefix: '',
        headers: () => ({})
      });
    }

    // 2. Render / Node backend catalog proxy (if authenticated)
    if (serverUrl && this.getServerToken(serverUrl)) {
      gateways.push({
        kind: 'server',
        base: serverUrl,
        label: 'Сервер Node/Render',
        prefix: '/api/catalog',
        headers: () => ({ Authorization: `Bearer ${this.getServerToken(serverUrl)}` })
      });
    }

    // 3. Custom Piped URL
    if (customApiBaseUrl && !gateways.some((g) => g.base === customApiBaseUrl)) {
      gateways.push({
        kind: 'piped',
        base: customApiBaseUrl,
        label: new URL(customApiBaseUrl).hostname,
        prefix: '',
        headers: () => ({})
      });
    }

    // 4. Last fastest active Piped node
    if (this.activeInstance && !gateways.some((g) => g.base === this.activeInstance)) {
      gateways.push({
        kind: 'piped',
        base: this.activeInstance,
        label: new URL(this.activeInstance).hostname,
        prefix: '',
        headers: () => ({})
      });
    }

    // 5. Public Piped fallbacks
    for (const url of DEFAULT_PIPED_INSTANCES) {
      if (!gateways.some((g) => g.base === url)) {
        gateways.push({
          kind: 'piped',
          base: url,
          label: new URL(url).hostname,
          prefix: '',
          headers: () => ({})
        });
      }
    }
    return gateways;
  }

  async _fetchJson(url, options = {}, timeoutMs = 6500, { allowLocalhostHttp = false } = {}) {
    const safeUrl = allowLocalhostHttp ? sanitizeEndpointUrl(url) : sanitizeHttpsUrl(url);
    if (!safeUrl) throw new Error('Недопустимый URL запроса (разрешён только HTTPS)');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
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
      return json ?? {};
    } finally {
      clearTimeout(timer);
    }
  }

  async _tryCatalogGateway(path) {
    const errors = [];
    for (const gw of this._getCatalogGateways()) {
      try {
        const data = await this._fetchJson(
          `${gw.base}${gw.prefix}${path}`,
          { headers: gw.headers() },
          6000,
          { allowLocalhostHttp: true }
        );
        if (data?.error) {
          throw new Error(data.message || data.error);
        }
        if (gw.kind === 'piped') {
          this.activeInstance = gw.base;
        }
        this.activeSourceLabel = gw.label;
        return { gateway: gw, data };
      } catch (err) {
        errors.push(`${gw.label}: ${err.message}`);
      }
    }
    throw new Error(errors[0] || 'Каталог недоступен');
  }

  async _getInvidiousPool() {
    if (Date.now() - this.invidiousInstancesCache.fetchedAt < 10 * 60 * 1000) {
      return this.invidiousInstancesCache.urls;
    }
    try {
      const list = await this._fetchJson(
        'https://api.invidious.io/instances.json?sort_by=type,health,api',
        {},
        4500
      );
      const urls = Array.isArray(list)
        ? list
            .filter(([, meta]) => meta?.type === 'https' && meta?.api)
            .slice(0, 6)
            .map(([host]) => `https://${host}`)
        : [];
      this.invidiousInstancesCache = { fetchedAt: Date.now(), urls };
      return urls;
    } catch {
      return [];
    }
  }

  async _tryInvidious(path) {
    const pool = await this._getInvidiousPool();
    if (pool.length === 0) throw new Error('Нет доступных узлов Invidious');
    const errors = [];
    for (const base of pool) {
      try {
        const data = await this._fetchJson(`${base}${path}`, {}, 5000);
        return { base, data };
      } catch (err) {
        errors.push(`${base}: ${err.message}`);
      }
    }
    throw new Error(errors[0] || 'Серверы Invidious недоступны');
  }

  async _searchAudius(query = '', trending = false) {
    const url =
      trending || !query
        ? `${AUDIUS_DISCOVERY_BASE}/tracks/trending?app_name=Sonora&limit=25`
        : `${AUDIUS_DISCOVERY_BASE}/tracks/search?query=${encodeURIComponent(query)}&app_name=Sonora`;
    const json = await this._fetchJson(url, {}, 6500);
    const rows = Array.isArray(json?.data) ? json.data : [];
    const tracks = rows.map(normalizeAudiusTrack).filter(Boolean);
    if (tracks.length > 0) {
      this.activeSourceLabel = 'Audius (прямое аудио)';
    }
    return tracks.map((t) => ({ type: 'track', ...t }));
  }

  async testHealthEndpoint(baseUrl) {
    const safe = sanitizeEndpointUrl(baseUrl);
    if (!safe) throw new Error('Укажите корректный URL (https://...)');
    const started = performance.now();
    const data = await this._fetchJson(`${safe}/health`, {}, 6000, { allowLocalhostHttp: true });
    const latencyMs = Math.round(performance.now() - started);
    return { ...data, latencyMs };
  }

  async getServerAuthStatus(serverUrl) {
    const safe = sanitizeEndpointUrl(serverUrl);
    if (!safe) throw new Error('Укажите URL Node-сервера');
    const token = this.getServerToken(safe);
    return this._fetchJson(
      `${safe}/api/auth/status`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      6000,
      { allowLocalhostHttp: true }
    );
  }

  async claimServerPasscode(serverUrl, passcode) {
    const safe = sanitizeEndpointUrl(serverUrl);
    if (!safe) throw new Error('Укажите URL Node-сервера');
    const data = await this._fetchJson(
      `${safe}/api/auth/claim`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode })
      },
      8000,
      { allowLocalhostHttp: true }
    );
    if (data?.token) {
      this.setServerToken(safe, data.token, data.expiresAt);
    }
    return data;
  }

  async loginServerPasscode(serverUrl, passcode) {
    const safe = sanitizeEndpointUrl(serverUrl);
    if (!safe) throw new Error('Укажите URL Node-сервера');
    const data = await this._fetchJson(
      `${safe}/api/auth/login`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode })
      },
      8000,
      { allowLocalhostHttp: true }
    );
    if (data?.token) {
      this.setServerToken(safe, data.token, data.expiresAt);
    }
    return data;
  }

  async _serverPost(endpoint, payload = {}, overrideServerUrl = '', timeoutMs = 18000) {
    const cfg = this._getConfig();
    const base = sanitizeEndpointUrl(overrideServerUrl) || cfg.serverUrl;
    if (!base) throw new Error('Укажите адрес Node/Render-сервера в настройках');
    const token = this.getServerToken(base);
    if (!token) {
      const err = new Error('Требуется вход на Node/Render-сервер');
      err.needsServerAuth = true;
      throw err;
    }
    return this._fetchJson(
      `${base}${endpoint}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      },
      timeoutMs,
      { allowLocalhostHttp: true }
    );
  }

  async search(rawQuery, filter = 'TRACKS', { isMoodTrending = false } = {}) {
    const query = String(rawQuery ?? '').trim();
    if (!query) return [];

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

    try {
      const { data } = await this._tryCatalogGateway(
        `/search?q=${encodeURIComponent(query)}&filter=${encodeURIComponent(pipedFilter)}`
      );
      const items = Array.isArray(data?.items) ? data.items : [];
      if (filter === 'PLAYLISTS') {
        const playlists = items
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
        if (playlists.length > 0) return playlists;
      } else if (filter === 'ARTISTS') {
        const artists = items
          .map((it) => ({
            type: 'artist',
            id: String(it.url || it.name || ''),
            channelUrl: String(it.url || ''),
            title: it.name || it.uploaderName || 'Исполнитель',
            artist: formatSubscribersRu(it.subscribers),
            thumbnailUrl: sanitizeHttpsUrl(it.thumbnail) || ''
          }))
          .filter((it) => it.title);
        if (artists.length > 0) return artists;
      } else {
        const tracks = items.map(normalizePipedTrack).filter(Boolean);
        if (tracks.length > 0) {
          return tracks.map((t) => ({ type: 'track', ...t }));
        }
      }
    } catch (err) {
      lastError = err;
    }

    if (filter === 'TRACKS') {
      try {
        const { data } = await this._tryCatalogGateway(
          `/search?q=${encodeURIComponent(query)}&filter=all`
        );
        const tracks = (Array.isArray(data?.items) ? data.items : [])
          .filter((it) => it.type === 'stream')
          .map(normalizePipedTrack)
          .filter(Boolean);
        if (tracks.length > 0) {
          return tracks.map((t) => ({ type: 'track', ...t }));
        }
      } catch (err) {
        lastError = err;
      }
    }

    try {
      const invType = filter === 'PLAYLISTS' ? 'playlist' : filter === 'ARTISTS' ? 'channel' : 'video';
      const { data: invItems } = await this._tryInvidious(
        `/api/v1/search?q=${encodeURIComponent(query)}&type=${invType}`
      );
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
        if (playlists.length > 0) return playlists;
      } else if (filter === 'ARTISTS') {
        const artists = arr.map((it) => ({
          type: 'artist',
          id: String(it.authorId || it.author || ''),
          channelUrl: it.authorId ? `/channel/${it.authorId}` : '',
          title: it.author || 'Исполнитель',
          artist: formatSubscribersRu(it.subCount),
          thumbnailUrl: sanitizeHttpsUrl(it.authorThumbnails?.[0]?.url) || ''
        }));
        if (artists.length > 0) return artists;
      } else {
        const tracks = arr.map(normalizeInvidiousTrack).filter(Boolean);
        if (tracks.length > 0) return tracks.map((t) => ({ type: 'track', ...t }));
      }
    } catch (err) {
      lastError = err;
    }

    if (filter === 'TRACKS') {
      try {
        const audiusTracks = await this._searchAudius(query, isMoodTrending && query === 'popular music hits');
        if (audiusTracks.length > 0) return audiusTracks;
      } catch (err) {
        lastError = err;
      }
    }

    if (lastError) throw lastError;
    return [];
  }

  async getArtistDetails(artistItem) {
    const name = String(artistItem?.title || '').trim();
    const channelPath = String(artistItem?.channelUrl || '').trim();
    let avatar = sanitizeHttpsUrl(artistItem?.thumbnailUrl) || '';
    let subText = artistItem?.artist || 'Исполнитель';
    let tracks = [];

    if (channelPath.startsWith('/channel/')) {
      try {
        const { data } = await this._tryCatalogGateway(channelPath);
        avatar = sanitizeHttpsUrl(data.avatarUrl) || avatar;
        if (data.subscriberCount > 0) subText = formatSubscribersRu(data.subscriberCount);
        tracks = (Array.isArray(data.relatedStreams) ? data.relatedStreams : [])
          .map(normalizePipedTrack)
          .filter(Boolean);
      } catch {
        // Fallback to track search below
      }
    }

    if (tracks.length === 0 && name) {
      const results = await this.search(name, 'TRACKS');
      tracks = results.filter((r) => r.type === 'track');
    }

    return {
      title: name,
      subtitle: subText,
      thumbnailUrl: avatar,
      tracks
    };
  }

  async getSuggestions(query) {
    const clean = String(query ?? '').trim();
    if (clean.length < 2) return [];
    try {
      const { data } = await this._tryCatalogGateway(`/suggestions?query=${encodeURIComponent(clean)}`);
      return Array.isArray(data) ? data.slice(0, 6) : [];
    } catch {
      return [];
    }
  }

  buildWorkerAudioProxyUrl(directUrl) {
    const { workerCatalogUrl } = this._getConfig();
    if (!workerCatalogUrl || !directUrl) return null;
    try {
      const u = new URL(directUrl);
      if (u.protocol === 'https:' && u.hostname.endsWith('.googlevideo.com')) {
        return `${workerCatalogUrl}/audio-proxy?url=${encodeURIComponent(directUrl)}`;
      }
    } catch {
      return null;
    }
    return null;
  }

  async getStreamInfo(videoId, quality = 'HIGH') {
    const rawId = String(videoId ?? '').trim();
    if (rawId.startsWith('aud:')) {
      const audId = rawId.slice(4);
      if (!/^[A-Za-z0-9_-]{3,32}$/.test(audId)) {
        throw new Error('Некорректный идентификатор трека Audius');
      }
      const streamUrl = `${AUDIUS_DISCOVERY_BASE}/tracks/${encodeURIComponent(audId)}/stream?app_name=Sonora`;
      return {
        engine: 'audio',
        id: rawId,
        title: 'Audius Track',
        artist: 'Audius',
        durationSeconds: 0,
        thumbnailUrl: '',
        streamUrl,
        proxyCacheUrl: streamUrl,
        fallbackUrl: null,
        mimeType: 'audio/mpeg',
        relatedTracks: []
      };
    }

    const cleanId = extractVideoId(rawId);
    if (!cleanId) throw new Error('Неверный идентификатор трека');

    // Tier 0: Authenticated YouTube Music session via Render/Node server (ad-free direct M4A)
    const { serverUrl, activeAccount } = this._getConfig();
    if (serverUrl && this.getServerToken(serverUrl) && activeAccount?.cookieHeader) {
      try {
        const authStream = await this._serverPost(
          '/api/yt/stream',
          {
            cookie: activeAccount.cookieHeader,
            dataSyncId: activeAccount.dataSyncId || '',
            authUserIndex: activeAccount.authUserIndex || 0,
            videoId: cleanId,
            quality
          },
          serverUrl,
          10000
        );
        if (authStream?.streamUrl) {
          this.activeSourceLabel = 'YouTube Music (прямой поток)';
          return {
            engine: 'audio',
            id: cleanId,
            title: authStream.title || 'Без названия',
            artist: authStream.artist || 'Исполнитель',
            durationSeconds: Number(authStream.durationSeconds) || 0,
            thumbnailUrl: getPreferredThumbnail(cleanId, authStream.thumbnailUrl),
            streamUrl: authStream.streamUrl,
            proxyCacheUrl: authStream.streamUrl,
            fallbackUrl: authStream.directUrl || null,
            mimeType: authStream.mimeType || 'audio/mp4',
            relatedTracks: []
          };
        }
      } catch {
        // Fall through to Cloudflare Worker / Piped
      }
    }

    // Tier 1: Personal Cloudflare Worker -> Node Server catalog -> Piped pool
    try {
      const { data } = await this._tryCatalogGateway(`/streams/${encodeURIComponent(cleanId)}`);
      const audioCandidates =
        Array.isArray(data.audioStreams) && data.audioStreams.length > 0
          ? data.audioStreams
          : (Array.isArray(data.videoStreams) ? data.videoStreams : []).filter((v) => !v.videoOnly);

      const selected = selectBestIosAudioStream(audioCandidates, data.hls, quality);
      if (selected) {
        return {
          engine: 'audio',
          id: cleanId,
          title: data.title || 'Без названия',
          artist: data.uploader || 'Исполнитель',
          durationSeconds: Number(data.duration) || 0,
          thumbnailUrl: getPreferredThumbnail(cleanId, data.thumbnailUrl),
          streamUrl: selected.url,
          proxyCacheUrl: this.buildWorkerAudioProxyUrl(selected.url) || selected.url,
          fallbackUrl: selected.fallbackUrl,
          mimeType: selected.mimeType,
          relatedTracks: (Array.isArray(data.relatedStreams) ? data.relatedStreams : [])
            .map(normalizePipedTrack)
            .filter(Boolean)
        };
      }
    } catch {
      // Fall through to Invidious / YouTube IFrame Player API
    }

    // Tier 2: Dynamic Invidious
    try {
      const { data: inv } = await this._tryInvidious(`/api/v1/videos/${encodeURIComponent(cleanId)}`);
      const formats = Array.isArray(inv?.adaptiveFormats)
        ? inv.adaptiveFormats
            .filter((f) => String(f.type || '').startsWith('audio/'))
            .map((f) => ({
              url: f.url,
              bitrate: Number(f.bitrate) || 0,
              mimeType: f.type,
              codec: f.encoding || ''
            }))
        : [];
      const selected = selectBestIosAudioStream(formats, inv?.hlsUrl, quality);
      if (selected) {
        return {
          engine: 'audio',
          id: cleanId,
          title: inv.title || 'Без названия',
          artist: inv.author || 'Исполнитель',
          durationSeconds: Number(inv.lengthSeconds) || 0,
          thumbnailUrl: getPreferredThumbnail(cleanId, inv.videoThumbnails?.[0]?.url),
          streamUrl: selected.url,
          proxyCacheUrl: this.buildWorkerAudioProxyUrl(selected.url) || selected.url,
          fallbackUrl: selected.fallbackUrl,
          mimeType: selected.mimeType,
          relatedTracks: (Array.isArray(inv.recommendedVideos) ? inv.recommendedVideos : [])
            .map(normalizeInvidiousTrack)
            .filter(Boolean)
        };
      }
    } catch {
      // Fall through to Tier 3
    }

    // Tier 3: YouTube IFrame Player last-resort fallback
    return {
      engine: 'youtube_iframe',
      id: cleanId,
      youtubeId: cleanId,
      title: null,
      artist: null,
      durationSeconds: 0,
      thumbnailUrl: getPreferredThumbnail(cleanId, ''),
      streamUrl: null,
      proxyCacheUrl: null,
      fallbackUrl: null,
      mimeType: 'video/youtube',
      relatedTracks: []
    };
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

  async getPlaylist(rawPlaylistInput) {
    const playlistId = extractPlaylistId(rawPlaylistInput);
    if (!playlistId) throw new Error('Некорректная ссылка или ID плейлиста YouTube');

    try {
      const { data } = await this._tryCatalogGateway(`/playlists/${encodeURIComponent(playlistId)}`);
      return {
        id: playlistId,
        title: data.name || 'Плейлист YouTube',
        author: data.uploader || 'YouTube Music',
        description: data.description || '',
        thumbnailUrl: sanitizeHttpsUrl(data.thumbnailUrl) || '',
        tracks: (Array.isArray(data.relatedStreams) ? data.relatedStreams : [])
          .map(normalizePipedTrack)
          .filter(Boolean)
      };
    } catch {
      const { data: inv } = await this._tryInvidious(
        `/api/v1/playlists/${encodeURIComponent(playlistId)}`
      );
      return {
        id: playlistId,
        title: inv.title || 'Плейлист YouTube Music',
        author: inv.author || 'YouTube Music',
        description: inv.description || '',
        thumbnailUrl: sanitizeHttpsUrl(inv.playlistThumbnail) || '',
        tracks: (Array.isArray(inv.videos) ? inv.videos : [])
          .map(normalizeInvidiousTrack)
          .filter(Boolean)
      };
    }
  }

  async fetchLyrics(track) {
    if (!track?.title) return { synced: [], plain: '', source: '' };
    const cleanTitle = String(track.title)
      .replace(/\(official.*?\)|\[official.*?\]|\(lyrics\)|\[lyrics\]|\(audio\)/gi, '')
      .trim();
    const cleanArtist = String(track.artist || '')
      .replace(/ - Topic$/i, '')
      .trim();

    try {
      const params = new URLSearchParams({
        track_name: cleanTitle,
        artist_name: cleanArtist
      });
      if (track.durationSeconds > 0) {
        params.set('duration', String(Math.round(track.durationSeconds)));
      }
      const exact = await this._fetchJson(`https://lrclib.net/api/get?${params.toString()}`, {}, 6000);
      const synced = parseLrcLines(exact.syncedLyrics || '');
      if (synced.length > 0 || exact.plainLyrics) {
        return { synced, plain: exact.plainLyrics || '', source: 'LRCLIB' };
      }
    } catch {
      // Fallback to search endpoint
    }

    try {
      const q = `${cleanArtist} ${cleanTitle}`.trim();
      const results = await this._fetchJson(
        `https://lrclib.net/api/search?q=${encodeURIComponent(q)}`,
        {},
        6000
      );
      if (Array.isArray(results) && results.length > 0) {
        const best = results.find((r) => r.syncedLyrics) || results[0];
        return {
          synced: parseLrcLines(best.syncedLyrics || ''),
          plain: best.plainLyrics || '',
          source: 'LRCLIB'
        };
      }
    } catch {
      // No lyrics found
    }

    return { synced: [], plain: '', source: '' };
  }

  async syncYouTubeAccount(serverUrl, cookieHeader, { dataSyncId = '', authUserIndex = 0 } = {}) {
    const safeProxy = sanitizeEndpointUrl(serverUrl);
    if (!safeProxy) {
      throw new Error('Укажите корректный адрес Node/Render-сервера');
    }
    if (!cookieHeader || String(cookieHeader).trim().length < 10) {
      throw new Error('Вставьте строку Cookie из сессии music.youtube.com');
    }

    const data = await this._serverPost(
      '/api/yt/sync',
      {
        cookie: String(cookieHeader).trim(),
        dataSyncId,
        authUserIndex
      },
      safeProxy,
      25000
    );

    const likedTracks = Array.isArray(data?.likedTracks)
      ? data.likedTracks.map(sanitizeTrack).filter(Boolean)
      : [];
    const historyTracks = Array.isArray(data?.historyTracks)
      ? data.historyTracks.map(sanitizeTrack).filter(Boolean)
      : [];
    const playlists = Array.isArray(data?.playlists)
      ? data.playlists.map((pl) => ({
          id: pl.id || null,
          name: String(pl.name || 'Плейлист YouTube Music').trim(),
          description: String(pl.description || '').trim(),
          tracks: Array.isArray(pl.tracks) ? pl.tracks.map(sanitizeTrack).filter(Boolean) : []
        }))
      : [];

    return {
      accountId: String(data?.account?.id || '').trim(),
      accountName: String(data?.account?.name || 'YouTube Music').trim(),
      accountHandle: String(data?.account?.handle || '').trim(),
      accountEmail: String(data?.account?.email || '').trim(),
      avatarUrl: sanitizeHttpsUrl(data?.account?.avatarUrl) || '',
      likedTracks,
      historyTracks,
      playlists
    };
  }

  async ytSetLike(videoId, liked) {
    const { serverUrl, activeAccount } = this._getConfig();
    if (!serverUrl || !this.getServerToken(serverUrl) || !activeAccount?.cookieHeader) return false;
    await this._serverPost('/api/yt/like', {
      cookie: activeAccount.cookieHeader,
      dataSyncId: activeAccount.dataSyncId || '',
      authUserIndex: activeAccount.authUserIndex || 0,
      videoId,
      liked
    });
    return true;
  }

  async ytCreatePlaylist(title, description = '', videoIds = []) {
    const { serverUrl, activeAccount } = this._getConfig();
    if (!serverUrl || !this.getServerToken(serverUrl) || !activeAccount?.cookieHeader) return null;
    const res = await this._serverPost('/api/yt/playlist/create', {
      cookie: activeAccount.cookieHeader,
      dataSyncId: activeAccount.dataSyncId || '',
      authUserIndex: activeAccount.authUserIndex || 0,
      title,
      description,
      videoIds
    });
    return res?.playlistId || null;
  }

  async ytAddTracksToPlaylist(youtubePlaylistId, videoIds = []) {
    const { serverUrl, activeAccount } = this._getConfig();
    if (!youtubePlaylistId || !serverUrl || !this.getServerToken(serverUrl) || !activeAccount?.cookieHeader) {
      return false;
    }
    await this._serverPost('/api/yt/playlist/add', {
      cookie: activeAccount.cookieHeader,
      dataSyncId: activeAccount.dataSyncId || '',
      authUserIndex: activeAccount.authUserIndex || 0,
      playlistId: youtubePlaylistId,
      videoIds
    });
    return true;
  }

  async ytRemoveTrackFromPlaylist(youtubePlaylistId, videoId) {
    const { serverUrl, activeAccount } = this._getConfig();
    if (!youtubePlaylistId || !serverUrl || !this.getServerToken(serverUrl) || !activeAccount?.cookieHeader) {
      return false;
    }
    await this._serverPost('/api/yt/playlist/remove', {
      cookie: activeAccount.cookieHeader,
      dataSyncId: activeAccount.dataSyncId || '',
      authUserIndex: activeAccount.authUserIndex || 0,
      playlistId: youtubePlaylistId,
      videoId
    });
    return true;
  }
}
