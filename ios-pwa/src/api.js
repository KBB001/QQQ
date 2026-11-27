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

export const CLOUDFLARE_WORKER_TEMPLATE = `// Cloudflare Worker: HTTPS-прокси для синхронизации личного YouTube Music
export default {
  async fetch(request) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: cors });

    const { cookie } = await request.json().catch(() => ({}));
    if (!cookie) {
      return Response.json({ error: 'Cookie is required' }, { status: 400, headers: cors });
    }

    const ytHeaders = {
      'Cookie': cookie,
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      'Origin': 'https://music.youtube.com',
      'Referer': 'https://music.youtube.com/',
      'Content-Type': 'application/json'
    };

    const body = JSON.stringify({
      context: { client: { clientName: 'WEB_REMIX', clientVersion: '1.20240724.01.00' } },
      browseId: 'FEmusic_liked_videos'
    });

    const resp = await fetch('https://music.youtube.com/youtubei/v1/browse?prettyPrint=false', {
      method: 'POST',
      headers: ytHeaders,
      body
    });
    const data = await resp.json();
    return Response.json({ account: { name: 'YouTube Music' }, raw: data }, { headers: cors });
  }
};`;

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
  constructor(getCustomBaseUrl = () => '') {
    this.getCustomBaseUrl = getCustomBaseUrl;
    this.activeInstance = null;
    this.activeSourceLabel = 'Автоподбор';
    this.invidiousInstancesCache = { fetchedAt: 0, urls: [] };
  }

  _getPipedPool() {
    const custom = sanitizeHttpsUrl(this.getCustomBaseUrl?.());
    const pool = [];
    if (custom) pool.push(custom.replace(/\/$/, ''));
    if (this.activeInstance && !pool.includes(this.activeInstance)) {
      pool.push(this.activeInstance);
    }
    for (const url of DEFAULT_PIPED_INSTANCES) {
      if (!pool.includes(url)) pool.push(url);
    }
    return pool;
  }

  async _fetchJson(url, options = {}, timeoutMs = 6000) {
    const safeUrl = sanitizeHttpsUrl(url);
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
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      return await resp.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async _tryPiped(path) {
    const errors = [];
    for (const base of this._getPipedPool()) {
      try {
        const data = await this._fetchJson(`${base}${path}`, {}, 5500);
        if (data?.error) {
          throw new Error(data.message || data.error);
        }
        this.activeInstance = base;
        this.activeSourceLabel = new URL(base).hostname;
        return { base, data };
      } catch (err) {
        errors.push(`${base}: ${err.message}`);
      }
    }
    throw new Error(errors[0] || 'Серверы Piped недоступны');
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
    const url = trending || !query
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

  async search(rawQuery, filter = 'TRACKS', { isMoodTrending = false } = {}) {
    const query = String(rawQuery ?? '').trim();
    if (!query) return [];

    // Direct YouTube Playlist URL support
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

    // Direct YouTube Track URL support
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
      const { data } = await this._tryPiped(
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

    // Secondary Piped general 'all' search for tracks if music_songs returned empty
    if (filter === 'TRACKS') {
      try {
        const { data } = await this._tryPiped(
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

    // Dynamic Invidious fallback
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

    // Audius full-audio catalog fallback for Tracks / Home
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
        const { data } = await this._tryPiped(channelPath);
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
      const { data } = await this._tryPiped(`/suggestions?query=${encodeURIComponent(clean)}`);
      return Array.isArray(data) ? data.slice(0, 6) : [];
    } catch {
      return [];
    }
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
        fallbackUrl: null,
        mimeType: 'audio/mpeg',
        relatedTracks: []
      };
    }

    const cleanId = extractVideoId(rawId);
    if (!cleanId) throw new Error('Неверный идентификатор трека');

    // Tier 1: Direct Piped Audio / Muxed Video / HLS
    try {
      const { data } = await this._tryPiped(`/streams/${encodeURIComponent(cleanId)}`);
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

    // Tier 3: Official YouTube IFrame Player fallback (bypasses datacenter IP bot walls)
    return {
      engine: 'youtube_iframe',
      id: cleanId,
      youtubeId: cleanId,
      title: null,
      artist: null,
      durationSeconds: 0,
      thumbnailUrl: getPreferredThumbnail(cleanId, ''),
      streamUrl: null,
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
      const { data } = await this._tryPiped(`/playlists/${encodeURIComponent(playlistId)}`);
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

  async syncYouTubeAccount(proxyUrl, cookieHeader) {
    const safeProxy = sanitizeHttpsUrl(proxyUrl);
    if (!safeProxy) {
      throw new Error('Укажите корректный HTTPS-адрес вашего прокси-сервера');
    }
    if (!cookieHeader || String(cookieHeader).trim().length < 10) {
      throw new Error('Вставьте строку Cookie из сессии music.youtube.com');
    }

    const endpoint = safeProxy.endsWith('/sync') ? safeProxy : `${safeProxy.replace(/\/$/, '')}/sync`;
    const data = await this._fetchJson(
      endpoint,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookie: String(cookieHeader).trim() })
      },
      15000
    );

    const likedTracks = Array.isArray(data?.likedTracks)
      ? data.likedTracks.map(sanitizeTrack).filter(Boolean)
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
      accountName: String(data?.account?.name || 'YouTube Music').trim(),
      accountEmail: String(data?.account?.email || '').trim(),
      likedTracks,
      playlists
    };
  }
}
