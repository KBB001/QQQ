import { sanitizeHttpsUrl, sanitizeTrack } from './security.js';

const OAUTH_STATE_KEY = 'sonora_google_oauth_state_v1';
const OAUTH_PENDING_CLIENT_KEY = 'sonora_google_oauth_client_v1';
const YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email'
].join(' ');

export function getOAuthRedirectUri() {
  if (typeof window === 'undefined' || !window.location) return '';
  return `${window.location.origin}${window.location.pathname}`;
}

export function isValidGoogleClientId(clientId) {
  const clean = String(clientId ?? '').trim();
  return /^[0-9]+-[a-z0-9._-]+\.apps\.googleusercontent\.com$/i.test(clean);
}

export function parseIsoDurationSeconds(iso) {
  if (typeof iso !== 'string' || !iso) return 0;
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
  if (!m) return 0;
  const h = Number(m[1]) || 0;
  const min = Number(m[2]) || 0;
  const s = Number(m[3]) || 0;
  return h * 3600 + min * 60 + s;
}

export function buildGoogleOAuthUrl({ clientId, redirectUri = getOAuthRedirectUri(), state = '' } = {}) {
  const cleanId = String(clientId ?? '').trim();
  if (!isValidGoogleClientId(cleanId)) {
    throw new Error('Укажите корректный Google OAuth Client ID (вида 12345-xxx.apps.googleusercontent.com)');
  }
  const cleanRedirect = sanitizeHttpsUrl(redirectUri) || redirectUri;
  if (!cleanRedirect) {
    throw new Error('Не удалось определить Redirect URI');
  }

  const finalState = state || generateRandomState();
  try {
    globalThis.localStorage?.setItem(OAUTH_STATE_KEY, finalState);
    globalThis.localStorage?.setItem(OAUTH_PENDING_CLIENT_KEY, cleanId);
  } catch {
    // Ignore storage errors in restricted environments
  }

  const params = new URLSearchParams({
    client_id: cleanId,
    redirect_uri: cleanRedirect,
    response_type: 'token',
    scope: YOUTUBE_SCOPES,
    include_granted_scopes: 'true',
    prompt: 'select_account',
    state: finalState
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

function generateRandomState() {
  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

export function parseOAuthHashResponse(hashString = '') {
  const raw = String(hashString || '').replace(/^#/, '').trim();
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  const accessToken = params.get('access_token');
  const error = params.get('error');
  if (!accessToken && !error) return null;

  const state = params.get('state') || '';
  const expiresIn = Number(params.get('expires_in')) || 3600;
  return {
    accessToken: accessToken || '',
    error: error || '',
    errorDescription: params.get('error_description') || '',
    state,
    expiresIn,
    expiresAt: Date.now() + expiresIn * 1000
  };
}

export function consumeOAuthRedirectCallback() {
  if (typeof window === 'undefined' || !window.location?.hash) return null;
  const parsed = parseOAuthHashResponse(window.location.hash);
  if (!parsed) return null;

  let expectedState = '';
  try {
    expectedState = globalThis.localStorage?.getItem(OAUTH_STATE_KEY) || '';
    globalThis.localStorage?.removeItem(OAUTH_STATE_KEY);
  } catch {
    // Ignore
  }

  // Strip sensitive token from address bar immediately
  try {
    const cleanUrl = `${window.location.pathname}${window.location.search}`;
    window.history.replaceState(null, document.title, cleanUrl);
  } catch {
    // Ignore
  }

  if (parsed.error) {
    return { ok: false, error: parsed.errorDescription || parsed.error };
  }
  if (expectedState && parsed.state && expectedState !== parsed.state) {
    return { ok: false, error: 'Несоответствие параметра безопасности OAuth (state)' };
  }
  if (!parsed.accessToken) {
    return { ok: false, error: 'Токен авторизации Google не получен' };
  }

  // If running inside an OAuth popup window, relay token back to main window and close popup
  if (window.opener && window.opener !== window) {
    try {
      window.opener.postMessage(
        {
          type: 'SONORA_GOOGLE_OAUTH_TOKEN',
          accessToken: parsed.accessToken,
          expiresAt: parsed.expiresAt
        },
        window.location.origin
      );
      window.close();
      return { ok: true, relayedToOpener: true };
    } catch {
      // Fall through to handling in current window
    }
  }

  return {
    ok: true,
    relayedToOpener: false,
    accessToken: parsed.accessToken,
    expiresAt: parsed.expiresAt
  };
}

export async function revokeGoogleOAuthToken(accessToken) {
  const token = String(accessToken || '').trim();
  if (!token) return false;
  try {
    const resp = await fetch(
      `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }
    );
    return resp.ok;
  } catch {
    return false;
  }
}

async function fetchGoogleJson(url, accessToken) {
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json'
    }
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const rawMsg = data?.error?.message || `HTTP ${resp.status}`;
    const msg =
      resp.status === 401
        ? 'Сессия Google истекла (401). Войдите в аккаунт повторно.'
        : rawMsg;
    const err = new Error(msg);
    err.status = resp.status;
    throw err;
  }
  return data;
}

function normalizeYouTubeApiPlaylistItem(item) {
  const sn = item?.snippet || {};
  const videoId =
    sn?.resourceId?.videoId ||
    item?.contentDetails?.videoId ||
    (typeof item?.id === 'string' ? item.id : '');
  if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;
  const title = String(sn.title || '').trim();
  if (!title || title === 'Deleted video' || title === 'Private video') return null;

  const artistRaw =
    sn.videoOwnerChannelTitle ||
    sn.channelTitle ||
    'YouTube Music';
  const artist = String(artistRaw).replace(/ - Topic$/i, '').trim();
  const thumbs = sn.thumbnails || {};
  const thumb =
    thumbs.high?.url ||
    thumbs.medium?.url ||
    thumbs.default?.url ||
    `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

  return sanitizeTrack({
    id: videoId,
    title,
    artist,
    durationSeconds: parseIsoDurationSeconds(item?.contentDetails?.duration || ''),
    thumbnailUrl: thumb
  });
}

export async function fetchYouTubePlaylistTracksWithOAuth(playlistId, accessToken, maxPages = 4) {
  const tracks = [];
  const seen = new Set();
  let pageToken = '';

  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({
      part: 'snippet,contentDetails',
      playlistId,
      maxResults: '50'
    });
    if (pageToken) params.set('pageToken', pageToken);

    const data = await fetchGoogleJson(
      `https://www.googleapis.com/youtube/v3/playlistItems?${params.toString()}`,
      accessToken
    );
    for (const raw of data?.items || []) {
      const clean = normalizeYouTubeApiPlaylistItem(raw);
      if (clean && !seen.has(clean.id)) {
        seen.add(clean.id);
        tracks.push(clean);
      }
    }
    pageToken = data?.nextPageToken || '';
    if (!pageToken) break;
  }
  return tracks;
}

export async function syncYouTubeLibraryWithOAuth(accessToken) {
  if (!accessToken) throw new Error('Отсутствует OAuth-токен Google');

  const [userInfo, channelResp] = await Promise.all([
    fetchGoogleJson('https://www.googleapis.com/oauth2/v3/userinfo', accessToken),
    fetchGoogleJson('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', accessToken).catch(
      () => ({ items: [] })
    )
  ]);

  const channelSnippet = channelResp?.items?.[0]?.snippet || {};
  const account = {
    id: String(userInfo?.sub || userInfo?.email || channelResp?.items?.[0]?.id || 'google_yt'),
    name: String(channelSnippet.title || userInfo?.name || 'YouTube Account'),
    handle: String(channelSnippet.customUrl || ''),
    email: String(userInfo?.email || ''),
    avatarUrl: sanitizeHttpsUrl(channelSnippet?.thumbnails?.high?.url || userInfo?.picture) || ''
  };

  // Fetch user's YouTube / YouTube Music playlists (up to 100 playlists)
  const rawPlaylists = [];
  let plPageToken = '';
  for (let p = 0; p < 2; p++) {
    const params = new URLSearchParams({
      part: 'snippet,contentDetails',
      mine: 'true',
      maxResults: '50'
    });
    if (plPageToken) params.set('pageToken', plPageToken);
    const resp = await fetchGoogleJson(
      `https://www.googleapis.com/youtube/v3/playlists?${params.toString()}`,
      accessToken
    );
    rawPlaylists.push(...(resp?.items || []));
    plPageToken = resp?.nextPageToken || '';
    if (!plPageToken) break;
  }

  // Fetch Liked Music videos in parallel with playlists
  const likedPromise = (async () => {
    const liked = [];
    const seen = new Set();
    try {
      let pageToken = '';
      for (let i = 0; i < 3; i++) {
        const params = new URLSearchParams({
          part: 'snippet,contentDetails',
          myRating: 'like',
          maxResults: '50'
        });
        if (pageToken) params.set('pageToken', pageToken);
        const resp = await fetchGoogleJson(
          `https://www.googleapis.com/youtube/v3/videos?${params.toString()}`,
          accessToken
        );
        for (const v of resp?.items || []) {
          const clean = normalizeYouTubeApiPlaylistItem(v);
          if (clean && !seen.has(clean.id)) {
            seen.add(clean.id);
            liked.push(clean);
          }
        }
        pageToken = resp?.nextPageToken || '';
        if (!pageToken) break;
      }
    } catch {
      // Fallback: playlist LL
      const llTracks = await fetchYouTubePlaylistTracksWithOAuth('LL', accessToken, 2).catch(() => []);
      return llTracks;
    }
    return liked;
  })();

  const playlistsToSync = rawPlaylists.slice(0, 25);
  const playlistResults = await Promise.all(
    playlistsToSync.map(async (pl) => {
      const tracks = await fetchYouTubePlaylistTracksWithOAuth(pl.id, accessToken, 4).catch(() => []);
      return {
        id: String(pl.id),
        name: String(pl.snippet?.title || 'Плейлист YouTube').trim(),
        description: String(pl.snippet?.description || 'Синхронизировано через Google OAuth').trim(),
        tracks
      };
    })
  );

  const likedTracks = await likedPromise;

  return {
    kind: 'yt_sync',
    account,
    likedTracks,
    historyTracks: [],
    playlists: playlistResults.filter((p) => p.name)
  };
}
