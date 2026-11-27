import { sanitizeHttpsUrl, sanitizeTrack } from './security.js';

const DEFAULT_PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.adminforge.de',
  'https://api.piped.private.coffee',
  'https://pipedapi.in.projectsegfau.lt'
];

const DEFAULT_INVIDIOUS_INSTANCES = [
  'https://inv.nadeko.net',
  'https://iv.ggtyler.dev',
  'https://yt.artemislena.eu',
  'https://invidious.nerdvpn.de'
];

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
    // Возвращаем нормализованные данные для Sonora iOS PWA
    return Response.json({ account: { name: 'YouTube Music' }, raw: data }, { headers: cors });
  }
};`;

export function extractVideoId(input, { allowBareId = true } = {}) {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  if (allowBareId && /^[A-Za-z0-9_-]{11}$/.test(raw)) return raw;
  try {
    const url = new URL(raw);
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
  try {
    const url = new URL(raw);
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

  // If only WebM/Opus direct streams exist and HLS is present, prefer HLS on iOS Safari
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

export class SonoraApi {
  constructor(getCustomBaseUrl = () => '') {
    this.getCustomBaseUrl = getCustomBaseUrl;
    this.activeInstance = null;
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

  async _fetchJson(url, options = {}, timeoutMs = 8500) {
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
        const data = await this._fetchJson(`${base}${path}`);
        this.activeInstance = base;
        return { base, data };
      } catch (err) {
        errors.push(`${base}: ${err.message}`);
      }
    }
    throw new Error(errors[0] || 'Серверы Piped недоступны');
  }

  async _tryInvidious(path) {
    const errors = [];
    for (const base of DEFAULT_INVIDIOUS_INSTANCES) {
      try {
        const data = await this._fetchJson(`${base}${path}`);
        return { base, data };
      } catch (err) {
        errors.push(`${base}: ${err.message}`);
      }
    }
    throw new Error(errors[0] || 'Серверы Invidious недоступны');
  }

  async search(rawQuery, filter = 'TRACKS') {
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
      const info = await this.getStreamInfo(directVideoId, 'HIGH');
      return [
        {
          type: 'track',
          ...sanitizeTrack({
            id: directVideoId,
            title: info.title,
            artist: info.artist,
            durationSeconds: info.durationSeconds,
            thumbnailUrl: info.thumbnailUrl
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

    try {
      const { data } = await this._tryPiped(
        `/search?q=${encodeURIComponent(query)}&filter=${encodeURIComponent(pipedFilter)}`
      );
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
              trackCount: Number(it.videos) || 0
            };
          })
          .filter(Boolean);
      }
      if (filter === 'ARTISTS') {
        return items
          .map((it) => ({
            type: 'artist',
            id: String(it.url || it.name || ''),
            title: it.name || it.uploaderName || 'Исполнитель',
            artist: it.subscribers ? `${it.subscribers} подписчиков` : 'Исполнитель',
            thumbnailUrl: sanitizeHttpsUrl(it.thumbnail) || ''
          }))
          .filter((it) => it.title);
      }

      const tracks = items.map(normalizePipedTrack).filter(Boolean);
      if (tracks.length > 0) {
        return tracks.map((t) => ({ type: 'track', ...t }));
      }
    } catch {
      // Fall through to Invidious below
    }

    // Invidious fallback
    const invType = filter === 'PLAYLISTS' ? 'playlist' : filter === 'ARTISTS' ? 'channel' : 'video';
    const { data: invItems } = await this._tryInvidious(
      `/api/v1/search?q=${encodeURIComponent(query)}&type=${invType}`
    );
    const arr = Array.isArray(invItems) ? invItems : [];
    if (filter === 'PLAYLISTS') {
      return arr
        .map((it) => ({
          type: 'playlist',
          id: String(it.playlistId || ''),
          title: it.title || 'Плейлист',
          artist: it.author || 'YouTube',
          thumbnailUrl: sanitizeHttpsUrl(it.playlistThumbnail) || '',
          trackCount: Number(it.videoCount) || 0
        }))
        .filter((p) => p.id);
    }
    if (filter === 'ARTISTS') {
      return arr.map((it) => ({
        type: 'artist',
        id: String(it.authorId || it.author || ''),
        title: it.author || 'Исполнитель',
        artist: it.subCount ? `${it.subCount} подписчиков` : 'Исполнитель',
        thumbnailUrl: sanitizeHttpsUrl(it.authorThumbnails?.[0]?.url) || ''
      }));
    }
    return arr
      .map(normalizeInvidiousTrack)
      .filter(Boolean)
      .map((t) => ({ type: 'track', ...t }));
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
    const cleanId = extractVideoId(videoId);
    if (!cleanId) throw new Error('Неверный идентификатор трека');

    try {
      const { data } = await this._tryPiped(`/streams/${encodeURIComponent(cleanId)}`);
      const selected = selectBestIosAudioStream(data.audioStreams, data.hls, quality);
      if (selected) {
        return {
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
      // Fall through to Invidious
    }

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
    if (!selected) {
      throw new Error('Не удалось получить совместимый аудиопоток для iOS');
    }

    return {
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

  async getRelatedTracks(videoId) {
    const info = await this.getStreamInfo(videoId, 'HIGH');
    return info.relatedTracks || [];
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
        title: inv.title || 'Плейлист YouTube',
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
