import crypto from 'node:crypto';
import { validateAllowedHttpsUrl } from './security.js';

export const YOUTUBE_MUSIC_ORIGIN = 'https://music.youtube.com';
export const YOUTUBE_WEB_ORIGIN = 'https://www.youtube.com';
export const DESKTOP_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';

const MAX_LIKED_PAGES = 6;
const MAX_PLAYLIST_PAGES = 5;
const MAX_CREATE_BATCH = 50;
const MAX_EDIT_BATCH = 50;
const MAX_JSON_DEPTH = 40;
const DURATION_TEXT_REGEX = /^\d{1,2}:\d{2}(?::\d{2})?$/;

export function parseCookieMap(cookieHeader) {
  const map = new Map();
  String(cookieHeader || '')
    .split(';')
    .forEach((pair) => {
      const idx = pair.indexOf('=');
      if (idx > 0) {
        const key = pair.slice(0, idx).trim();
        const value = pair.slice(idx + 1).trim();
        if (key && value) {
          map.set(key, value);
        }
      }
    });
  return map;
}

export function normalizeCookieHeader(rawInput) {
  const trimmed = String(rawInput || '').trim();
  if (!trimmed) return '';
  // Support Netscape cookies.txt export format
  if (trimmed.includes('\t')) {
    const map = new Map();
    trimmed.split(/\r?\n/).forEach((line) => {
      const clean = line.trim();
      if (clean && !clean.startsWith('#')) {
        const parts = clean.split('\t');
        if (parts.length >= 7) {
          const name = parts[5].trim();
          const value = parts[6].trim();
          if (name && value) map.set(name, value);
        }
      }
    });
    if (map.size > 0) {
      return Array.from(map.entries())
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');
    }
  }
  const parsed = parseCookieMap(trimmed);
  return Array.from(parsed.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

export function hasAuthCookies(cookieHeader) {
  const map = parseCookieMap(normalizeCookieHeader(cookieHeader));
  const hasSapisid =
    map.has('SAPISID') || map.has('__Secure-3PAPISID') || map.has('__Secure-1PAPISID');
  const hasSid =
    map.has('SID') ||
    map.has('__Secure-3PSID') ||
    map.has('__Secure-1PSID') ||
    map.has('HSID');
  return hasSapisid && hasSid;
}

export function buildSapisidHashHeader(
  sapisid,
  origin = YOUTUBE_MUSIC_ORIGIN,
  timestampSeconds = Math.floor(Date.now() / 1000),
  scheme = 'SAPISIDHASH'
) {
  const input = `${timestampSeconds} ${sapisid} ${origin}`;
  const hex = crypto.createHash('sha1').update(input, 'utf8').digest('hex');
  return `${scheme} ${timestampSeconds}_${hex}`;
}

export function buildSapisidAuthorizationHeader(
  cookieHeader,
  origin = YOUTUBE_MUSIC_ORIGIN,
  timestampSeconds = Math.floor(Date.now() / 1000)
) {
  const map = parseCookieMap(normalizeCookieHeader(cookieHeader));
  const sapisid = map.get('SAPISID');
  const p1 = map.get('__Secure-1PAPISID');
  const p3 = map.get('__Secure-3PAPISID');
  const primary = sapisid || p3 || p1;
  if (!primary) return null;

  const tokens = [buildSapisidHashHeader(primary, origin, timestampSeconds, 'SAPISIDHASH')];
  if (p1) tokens.push(buildSapisidHashHeader(p1, origin, timestampSeconds, 'SAPISID1PHASH'));
  if (p3) tokens.push(buildSapisidHashHeader(p3, origin, timestampSeconds, 'SAPISID3PHASH'));
  return tokens.join(' ');
}

export function extractDelegatedBrandPageId(dataSyncId) {
  const clean = String(dataSyncId || '').trim();
  if (!clean.includes('||')) return null;
  const [pageIdRaw, ownerIdRaw] = clean.split('||', 2);
  const pageId = (pageIdRaw || '').trim();
  const ownerId = (ownerIdRaw || '').trim();
  return pageId && ownerId && pageId !== ownerId ? pageId : null;
}

function readRunsText(obj) {
  if (!obj || typeof obj !== 'object') return '';
  if (typeof obj.simpleText === 'string' && obj.simpleText.trim()) {
    return obj.simpleText.trim();
  }
  if (!Array.isArray(obj.runs)) return '';
  return obj.runs
    .map((r) => (typeof r?.text === 'string' ? r.text : ''))
    .join('')
    .trim();
}

function pickLargestThumbnailUrl(thumbnails) {
  if (!Array.isArray(thumbnails)) return '';
  let bestUrl = '';
  let bestArea = -1;
  for (const t of thumbnails) {
    if (!t || typeof t.url !== 'string') continue;
    const raw = t.url.startsWith('//') ? `https:${t.url}` : t.url.trim();
    const safe = validateAllowedHttpsUrl(raw, ['ytimg.com', 'ggpht.com', 'googleusercontent.com']);
    if (!safe) continue;
    const area = (Number(t.width) || 0) * (Number(t.height) || 0);
    if (area >= bestArea) {
      bestArea = area;
      bestUrl = safe;
    }
  }
  return bestUrl;
}

function findFirstObjectByKey(node, targetKey, depth = 0) {
  if (depth > MAX_JSON_DEPTH || node == null || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findFirstObjectByKey(item, targetKey, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (node[targetKey] && typeof node[targetKey] === 'object' && !Array.isArray(node[targetKey])) {
    return node[targetKey];
  }
  for (const key of Object.keys(node)) {
    const found = findFirstObjectByKey(node[key], targetKey, depth + 1);
    if (found) return found;
  }
  return null;
}

function findFirstStringByKey(node, targetKey, depth = 0) {
  if (depth > MAX_JSON_DEPTH || node == null || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findFirstStringByKey(item, targetKey, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof node[targetKey] === 'string' && node[targetKey].trim()) {
    return node[targetKey].trim();
  }
  for (const key of Object.keys(node)) {
    const found = findFirstStringByKey(node[key], targetKey, depth + 1);
    if (found) return found;
  }
  return null;
}

function collectObjectsByKey(node, targetKey, output = [], depth = 0) {
  if (depth > MAX_JSON_DEPTH || node == null || typeof node !== 'object') return output;
  if (Array.isArray(node)) {
    for (const item of node) collectObjectsByKey(item, targetKey, output, depth + 1);
    return output;
  }
  if (node[targetKey] && typeof node[targetKey] === 'object' && !Array.isArray(node[targetKey])) {
    output.push(node[targetKey]);
  }
  for (const key of Object.keys(node)) {
    collectObjectsByKey(node[key], targetKey, output, depth + 1);
  }
  return output;
}

function parseDurationSeconds(raw) {
  const clean = String(raw || '').trim();
  if (!DURATION_TEXT_REGEX.test(clean)) return 0;
  const parts = clean.split(':').map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

export function parseAccountProfile(root) {
  const header =
    findFirstObjectByKey(root, 'activeAccountHeaderRenderer') ||
    findFirstObjectByKey(root, 'googleAccountHeaderRenderer');
  if (!header) return null;

  const name =
    readRunsText(header.accountName) || readRunsText(header.name) || 'YouTube Account';
  const handle = readRunsText(header.channelHandle);
  const email = readRunsText(header.email);
  const avatarUrl = pickLargestThumbnailUrl(header.accountPhoto?.thumbnails);

  const stableSeed = (handle || email || name)
    .toLowerCase()
    .replace(/[^a-z0-9@._-]/g, '_');

  return {
    id: `yt_${stableSeed}`,
    name,
    handle,
    email,
    avatarUrl
  };
}

function parseResponsiveListItemTrack(item) {
  const videoId =
    item?.playlistItemData?.videoId?.trim() ||
    item?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer
      ?.playNavigationEndpoint?.watchEndpoint?.videoId?.trim() ||
    findFirstStringByKey(item, 'videoId');
  if (!videoId) return null;

  const flex = item?.flexColumns || [];
  const title = readRunsText(flex[0]?.musicResponsiveListItemFlexColumnRenderer?.text);
  if (!title) return null;

  const rawArtist = readRunsText(flex[1]?.musicResponsiveListItemFlexColumnRenderer?.text);
  const artist =
    rawArtist
      .split('•')
      .map((p) => p.trim())
      .find((p) => p && !DURATION_TEXT_REGEX.test(p)) || 'YouTube Artist';

  let durationSeconds = 0;
  const fixed = item?.fixedColumns || [];
  if (fixed[0]) {
    const durText = readRunsText(fixed[0]?.musicResponsiveListItemFixedColumnRenderer?.text);
    durationSeconds = parseDurationSeconds(durText);
  }
  if (!durationSeconds && rawArtist.includes('•')) {
    durationSeconds = parseDurationSeconds(rawArtist.split('•').pop());
  }

  const thumbnailUrl =
    pickLargestThumbnailUrl(item?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails) ||
    `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

  return { id: videoId, title, artist, durationSeconds, thumbnailUrl };
}

function parseTwoRowTrack(item) {
  const videoId = item?.navigationEndpoint?.watchEndpoint?.videoId?.trim();
  if (!videoId) return null;
  const title = readRunsText(item?.title);
  if (!title) return null;
  const artist =
    readRunsText(item?.subtitle)
      .split('•')[0]
      ?.trim() || 'Исполнитель YouTube';
  const thumbnailUrl =
    pickLargestThumbnailUrl(
      item?.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails
    ) || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  return { id: videoId, title, artist, durationSeconds: 0, thumbnailUrl };
}

function parsePlaylistVideoRenderer(item) {
  const videoId = String(item?.videoId || '').trim();
  if (!videoId) return null;
  const title = readRunsText(item?.title);
  if (!title) return null;
  const artist = readRunsText(item?.shortBylineText) || 'Исполнитель YouTube';
  const durationSeconds =
    Number(item?.lengthSeconds) || parseDurationSeconds(readRunsText(item?.lengthText));
  const thumbnailUrl =
    pickLargestThumbnailUrl(item?.thumbnail?.thumbnails) ||
    `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  return { id: videoId, title, artist, durationSeconds, thumbnailUrl };
}

export function extractTracksRecursive(root) {
  const map = new Map();
  const listItems = collectObjectsByKey(root, 'musicResponsiveListItemRenderer');
  for (const it of listItems) {
    const tr = parseResponsiveListItemTrack(it);
    if (tr && !map.has(tr.id)) map.set(tr.id, tr);
  }
  if (map.size === 0) {
    for (const it of collectObjectsByKey(root, 'musicTwoRowItemRenderer')) {
      const tr = parseTwoRowTrack(it);
      if (tr && !map.has(tr.id)) map.set(tr.id, tr);
    }
  }
  if (map.size === 0) {
    for (const it of collectObjectsByKey(root, 'playlistVideoRenderer')) {
      const tr = parsePlaylistVideoRenderer(it);
      if (tr && !map.has(tr.id)) map.set(tr.id, tr);
    }
  }
  return Array.from(map.values());
}

export function parseUserPlaylists(root) {
  const map = new Map();
  for (const item of collectObjectsByKey(root, 'musicTwoRowItemRenderer')) {
    const browseId = item?.navigationEndpoint?.browseEndpoint?.browseId || '';
    if (browseId.startsWith('VL') && browseId !== 'VLLM' && browseId !== 'VLSE') {
      const playlistId = browseId.slice(2);
      const title = readRunsText(item?.title) || 'Плейлист YouTube';
      const subtitle = readRunsText(item?.subtitle);
      const countMatch = subtitle.match(/(\d+)/);
      const trackCount = countMatch ? Number(countMatch[1]) : 0;
      const thumbnailUrl = pickLargestThumbnailUrl(
        item?.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails
      );
      if (playlistId && title !== 'Liked music' && title !== 'Понравившиеся' && !map.has(playlistId)) {
        map.set(playlistId, { playlistId, title, thumbnailUrl, trackCount });
      }
    }
  }

  for (const item of collectObjectsByKey(root, 'musicResponsiveListItemRenderer')) {
    const browseId = item?.navigationEndpoint?.browseEndpoint?.browseId || '';
    if (browseId.startsWith('VL') && browseId !== 'VLLM' && browseId !== 'VLSE') {
      const playlistId = browseId.slice(2);
      const flex = item?.flexColumns || [];
      const title =
        readRunsText(flex[0]?.musicResponsiveListItemFlexColumnRenderer?.text) ||
        'Плейлист YouTube';
      const thumbnailUrl = pickLargestThumbnailUrl(
        item?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails
      );
      if (playlistId && !map.has(playlistId)) {
        map.set(playlistId, { playlistId, title, thumbnailUrl, trackCount: 0 });
      }
    }
  }
  return Array.from(map.values());
}

export function extractNextContinuation(root) {
  const direct = findFirstObjectByKey(root, 'nextContinuationData')?.continuation?.trim();
  if (direct) return direct;
  for (const r of collectObjectsByKey(root, 'continuationItemRenderer')) {
    const token = r?.continuationEndpoint?.continuationCommand?.token?.trim();
    if (token) return token;
  }
  return null;
}

class HttpStatusError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

async function executeInnerTubePostOnce({
  endpoint,
  cookieHeader,
  visitorData = '',
  dataSyncId = '',
  authUserIndex = 0,
  payload = {},
  useWebClient = false,
  fetchImpl = globalThis.fetch
}) {
  const origin = useWebClient ? YOUTUBE_WEB_ORIGIN : YOUTUBE_MUSIC_ORIGIN;
  const clientName = useWebClient ? 'WEB' : 'WEB_REMIX';
  const clientId = useWebClient ? '1' : '67';
  const clientVersion = useWebClient ? '2.20250310.01.00' : '1.20250310.01.00';

  const cleanVisitorData =
    visitorData && !visitorData.includes('%') && !visitorData.includes(' ')
      ? visitorData.trim()
      : '';

  const clientJson = {
    clientName,
    clientVersion,
    hl: 'ru',
    gl: 'RU'
  };
  if (cleanVisitorData && endpoint === 'player') {
    clientJson.visitorData = cleanVisitorData;
  }

  const contextJson = { client: clientJson };
  const delegatedPageId = extractDelegatedBrandPageId(dataSyncId);
  if (delegatedPageId) {
    contextJson.user = { onBehalfOfUser: delegatedPageId };
  }

  const normalizedCookie = normalizeCookieHeader(cookieHeader);
  const authHeader = buildSapisidAuthorizationHeader(normalizedCookie, origin);
  if (!authHeader) {
    throw new Error('В cookie отсутствует SAPISID');
  }

  const headers = {
    'User-Agent': DESKTOP_USER_AGENT,
    'Content-Type': 'application/json',
    Accept: '*/*',
    'Cache-Control': 'no-store',
    Cookie: normalizedCookie,
    Authorization: authHeader,
    Origin: origin,
    Referer: `${origin}/`,
    'X-Origin': origin,
    'X-Youtube-Client-Name': clientId,
    'X-Youtube-Client-Version': clientVersion,
    'X-Goog-AuthUser': String(Math.max(0, Number(authUserIndex) || 0))
  };
  if (cleanVisitorData && endpoint === 'player') {
    headers['X-Goog-Visitor-Id'] = cleanVisitorData;
  }
  if (delegatedPageId) {
    headers['X-Goog-PageId'] = delegatedPageId;
  }

  const body = JSON.stringify({ ...payload, context: contextJson });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 18000);
  try {
    const resp = await fetchImpl(`${origin}/youtubei/v1/${endpoint}?prettyPrint=false`, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal
    });
    const raw = await resp.text();
    if (!resp.ok) {
      if (resp.status === 401 || resp.status === 403) {
        throw new HttpStatusError(
          resp.status,
          `Сессия YouTube истекла или отклонена (HTTP ${resp.status}). Войдите заново.`
        );
      }
      let detail = '';
      try {
        detail = JSON.parse(raw)?.error?.message || '';
      } catch {
        detail = '';
      }
      throw new HttpStatusError(
        resp.status,
        detail ? `Ошибка YouTube API (${resp.status}): ${detail}` : `Ошибка YouTube API (${resp.status})`
      );
    }
    return raw ? JSON.parse(raw) : {};
  } finally {
    clearTimeout(timer);
  }
}

async function executeInnerTubePost(opts) {
  try {
    return await executeInnerTubePostOnce(opts);
  } catch (err) {
    if (err instanceof HttpStatusError && err.code === 400 && (opts.visitorData || opts.dataSyncId)) {
      return executeInnerTubePostOnce({ ...opts, visitorData: '', dataSyncId: '' });
    }
    throw err;
  }
}

async function browseTrackCollection(account, browseId, { maxPages = MAX_LIKED_PAGES, useWebClient = false, fetchImpl = globalThis.fetch } = {}) {
  const collected = new Map();
  const initial = await executeInnerTubePost({
    endpoint: 'browse',
    cookieHeader: account.cookieHeader,
    dataSyncId: account.dataSyncId,
    authUserIndex: account.authUserIndex,
    payload: { browseId },
    useWebClient,
    fetchImpl
  });
  for (const t of extractTracksRecursive(initial)) {
    if (!collected.has(t.id)) collected.set(t.id, t);
  }

  let continuation = extractNextContinuation(initial);
  let page = 0;
  while (continuation && page < maxPages) {
    let nextJson = null;
    try {
      nextJson = await executeInnerTubePost({
        endpoint: 'browse',
        cookieHeader: account.cookieHeader,
        dataSyncId: account.dataSyncId,
        authUserIndex: account.authUserIndex,
        payload: { continuation },
        useWebClient,
        fetchImpl
      });
    } catch {
      break;
    }
    const newTracks = extractTracksRecursive(nextJson);
    if (newTracks.length === 0) break;
    for (const t of newTracks) {
      if (!collected.has(t.id)) collected.set(t.id, t);
    }
    const upcoming = extractNextContinuation(nextJson);
    if (upcoming === continuation) break;
    continuation = upcoming;
    page++;
  }
  return Array.from(collected.values());
}

export class YouTubeMusicClient {
  constructor(fetchImpl = globalThis.fetch) {
    this.fetchImpl = fetchImpl;
  }

  async fetchAccountInfo(account) {
    const cookieHeader = normalizeCookieHeader(account.cookieHeader);
    if (!hasAuthCookies(cookieHeader)) {
      throw new Error('В cookie отсутствует SAPISID или SID. Войдите в аккаунт YouTube Music.');
    }
    let responseJson;
    try {
      responseJson = await executeInnerTubePost({
        endpoint: 'account/account_menu',
        cookieHeader,
        visitorData: account.visitorData,
        dataSyncId: account.dataSyncId,
        authUserIndex: account.authUserIndex,
        payload: { deviceTheme: 'DEVICE_THEME_SELECTED' },
        useWebClient: false,
        fetchImpl: this.fetchImpl
      });
    } catch (primaryErr) {
      try {
        responseJson = await executeInnerTubePost({
          endpoint: 'account/account_menu',
          cookieHeader,
          visitorData: account.visitorData,
          dataSyncId: '',
          authUserIndex: account.authUserIndex,
          payload: {},
          useWebClient: true,
          fetchImpl: this.fetchImpl
        });
      } catch {
        throw primaryErr;
      }
    }
    const profile = parseAccountProfile(responseJson);
    if (!profile) {
      throw new Error('Не удалось получить профиль YouTube. Проверьте авторизацию.');
    }
    return profile;
  }

  async fetchLikedTracks(account) {
    try {
      const primary = await browseTrackCollection(account, 'FEmusic_liked_videos', {
        fetchImpl: this.fetchImpl
      });
      if (primary.length > 0) return primary;
    } catch {
      // Fallback
    }
    try {
      const ytMusicLl = await browseTrackCollection(account, 'VLLM', { fetchImpl: this.fetchImpl });
      if (ytMusicLl.length > 0) return ytMusicLl;
    } catch {
      // Fallback
    }
    return browseTrackCollection(account, 'VLLM', {
      useWebClient: true,
      fetchImpl: this.fetchImpl
    });
  }

  async fetchHistoryTracks(account) {
    return browseTrackCollection(account, 'FEmusic_history', {
      maxPages: 2,
      fetchImpl: this.fetchImpl
    }).catch(() => []);
  }

  async fetchUserPlaylists(account) {
    let primary = null;
    try {
      const json = await executeInnerTubePost({
        endpoint: 'browse',
        cookieHeader: account.cookieHeader,
        dataSyncId: account.dataSyncId,
        authUserIndex: account.authUserIndex,
        payload: { browseId: 'FEmusic_liked_playlists' },
        fetchImpl: this.fetchImpl
      });
      primary = parseUserPlaylists(json);
      if (primary.length > 0) return primary;
    } catch {
      primary = null;
    }

    const fallbackJson = await executeInnerTubePost({
      endpoint: 'browse',
      cookieHeader: account.cookieHeader,
      dataSyncId: account.dataSyncId,
      authUserIndex: account.authUserIndex,
      payload: { browseId: 'FEmusic_library_landing' },
      fetchImpl: this.fetchImpl
    });
    const fallback = parseUserPlaylists(fallbackJson);
    return fallback.length > 0 || !primary ? fallback : primary;
  }

  async fetchPlaylistTracks(account, playlistId) {
    const cleanId = String(playlistId || '').replace(/^VL/, '').trim();
    if (!cleanId) return [];
    try {
      const remix = await browseTrackCollection(account, `VL${cleanId}`, {
        maxPages: MAX_PLAYLIST_PAGES,
        fetchImpl: this.fetchImpl
      });
      if (remix.length > 0) return remix;
    } catch {
      // Fallback
    }
    return browseTrackCollection(account, `VL${cleanId}`, {
      maxPages: MAX_PLAYLIST_PAGES,
      useWebClient: true,
      fetchImpl: this.fetchImpl
    });
  }

  async setLikeStatus(account, videoId, liked) {
    const cleanId = String(videoId || '').trim();
    if (!cleanId) return;
    await executeInnerTubePost({
      endpoint: liked ? 'like/like' : 'like/removelike',
      cookieHeader: account.cookieHeader,
      visitorData: account.visitorData,
      dataSyncId: account.dataSyncId,
      authUserIndex: account.authUserIndex,
      payload: { target: { videoId: cleanId } },
      fetchImpl: this.fetchImpl
    });
  }

  async createPlaylist(account, title, description = '', videoIds = []) {
    const cleanTitle = String(title || '').trim() || 'Sonora Playlist';
    const distinctIds = Array.from(new Set(videoIds.map((v) => String(v).trim()).filter(Boolean)));
    const payload = {
      title: cleanTitle,
      description: String(description || '').trim(),
      privacyStatus: 'PRIVATE'
    };
    if (distinctIds.length > 0) {
      payload.videoIds = distinctIds.slice(0, MAX_CREATE_BATCH);
    }
    const json = await executeInnerTubePost({
      endpoint: 'playlist/create',
      cookieHeader: account.cookieHeader,
      visitorData: account.visitorData,
      dataSyncId: account.dataSyncId,
      authUserIndex: account.authUserIndex,
      payload,
      fetchImpl: this.fetchImpl
    });
    const createdId = String(json?.playlistId || '').trim();
    if (!createdId) throw new Error('YouTube не вернул ID созданного плейлиста');

    const remaining = distinctIds.slice(MAX_CREATE_BATCH);
    if (remaining.length > 0) {
      await this.addTracksToPlaylist(account, createdId, remaining);
    }
    return createdId;
  }

  async addTracksToPlaylist(account, playlistId, videoIds = []) {
    const cleanPlaylistId = String(playlistId || '').replace(/^VL/, '').trim();
    const distinctIds = Array.from(new Set(videoIds.map((v) => String(v).trim()).filter(Boolean)));
    if (!cleanPlaylistId || distinctIds.length === 0) return;

    for (let i = 0; i < distinctIds.length; i += MAX_EDIT_BATCH) {
      const chunk = distinctIds.slice(i, i + MAX_EDIT_BATCH);
      await executeInnerTubePost({
        endpoint: 'browse/edit_playlist',
        cookieHeader: account.cookieHeader,
        visitorData: account.visitorData,
        dataSyncId: account.dataSyncId,
        authUserIndex: account.authUserIndex,
        payload: {
          playlistId: cleanPlaylistId,
          actions: chunk.map((vid) => ({
            action: 'ACTION_ADD_VIDEO',
            addedVideoId: vid
          }))
        },
        fetchImpl: this.fetchImpl
      });
    }
  }

  async removeTrackFromPlaylist(account, playlistId, videoId) {
    const cleanPlaylistId = String(playlistId || '').replace(/^VL/, '').trim();
    const cleanVid = String(videoId || '').trim();
    if (!cleanPlaylistId || !cleanVid) return;

    await executeInnerTubePost({
      endpoint: 'browse/edit_playlist',
      cookieHeader: account.cookieHeader,
      visitorData: account.visitorData,
      dataSyncId: account.dataSyncId,
      authUserIndex: account.authUserIndex,
      payload: {
        playlistId: cleanPlaylistId,
        actions: [
          {
            action: 'ACTION_REMOVE_VIDEO_BY_VIDEO_ID',
            removedVideoId: cleanVid
          }
        ]
      },
      fetchImpl: this.fetchImpl
    });
  }

  async resolveAuthenticatedStream(account, videoId, audioQuality = 'HIGH') {
    const cleanId = String(videoId || '').trim();
    if (!/^[A-Za-z0-9_-]{11}$/.test(cleanId)) return null;
    const json = await executeInnerTubePost({
      endpoint: 'player',
      cookieHeader: account.cookieHeader,
      visitorData: account.visitorData,
      dataSyncId: account.dataSyncId,
      authUserIndex: account.authUserIndex,
      payload: {
        videoId: cleanId,
        contentCheckOk: true,
        racyCheckOk: true
      },
      useWebClient: true,
      fetchImpl: this.fetchImpl
    });

    if (json?.playabilityStatus?.status !== 'OK') return null;
    const formats = Array.isArray(json?.streamingData?.adaptiveFormats)
      ? json.streamingData.adaptiveFormats
      : [];

    const maxKbps = audioQuality === 'LOW' ? 96 : audioQuality === 'MEDIUM' ? 160 : 320;
    const candidates = formats
      .filter((f) => String(f?.mimeType || '').startsWith('audio/') && String(f?.url || '').startsWith('https://'))
      .map((f) => ({
        url: f.url,
        mimeType: String(f.mimeType).split(';')[0].trim(),
        bitrate: Number(f.bitrate) || 0
      }));

    if (candidates.length === 0) return null;
    const maxBps = maxKbps * 1000;
    const pool = candidates.filter((c) => c.bitrate <= maxBps);
    const activePool = pool.length > 0 ? pool : candidates;
    activePool.sort((a, b) => {
      const aBonus = a.mimeType.includes('mp4') ? 1_000_000 : 0;
      const bBonus = b.mimeType.includes('mp4') ? 1_000_000 : 0;
      return bBonus + b.bitrate - (aBonus + a.bitrate);
    });
    const best = activePool[0];
    const vd = json?.videoDetails || {};
    return {
      url: best.url,
      mimeType: best.mimeType,
      bitrate: best.bitrate,
      title: vd.title || '',
      artist: vd.author || '',
      durationSeconds: Number(vd.lengthSeconds) || 0,
      thumbnailUrl: pickLargestThumbnailUrl(vd.thumbnail?.thumbnails) || `https://i.ytimg.com/vi/${cleanId}/hqdefault.jpg`
    };
  }
}
