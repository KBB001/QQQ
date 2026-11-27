import http from 'node:http';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import {
  PasscodeAuthStore,
  createSignedAudioTicket,
  isAllowedAudioProxyUrl,
  issueAccessToken,
  resolveCorsOrigin,
  sanitizePipedUpstream,
  verifyAccessToken,
  verifySignedAudioTicket
} from './security.js';
import { YouTubeMusicClient, hasAuthCookies, normalizeCookieHeader } from './innertube.js';

const DEFAULT_PIPED_UPSTREAMS = [
  'https://api.piped.private.coffee',
  'https://pipedapi.ducks.party'
];

const MAX_JSON_BYTES = 1024 * 1024;

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_JSON_BYTES) {
        req.destroy();
        reject(new Error('Слишком большой размер запроса'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('Некорректный JSON'));
      }
    });
    req.on('error', reject);
  });
}

function getBaseCorsHeaders(req, env) {
  const allowedOrigin = resolveCorsOrigin(req.headers.origin, env);
  const headers = {
    Vary: 'Origin',
    'Cache-Control': 'no-store'
  };
  if (allowedOrigin) {
    headers['Access-Control-Allow-Origin'] = allowedOrigin;
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, Range';
    headers['Access-Control-Expose-Headers'] =
      'Content-Length, Content-Range, Accept-Ranges, Content-Type';
  }
  return headers;
}

function sendJson(res, req, env, status, payload) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    ...getBaseCorsHeaders(req, env)
  };
  res.writeHead(status, headers);
  res.end(JSON.stringify(payload));
}

function getBearerToken(req) {
  const auth = String(req.headers.authorization || '');
  if (!auth.startsWith('Bearer ')) return '';
  return auth.slice(7).trim();
}

function getPublicBaseUrl(req) {
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const safeProto = proto === 'http' ? 'http' : 'https';
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (!host || /[\s/\\]/.test(host)) return '';
  return `${safeProto}://${host}`;
}

async function fetchPipedUpstream(pathAndQuery, env, fetchImpl) {
  const configured = String(env?.PIPED_UPSTREAMS || '')
    .split(',')
    .map(sanitizePipedUpstream)
    .filter(Boolean);
  const pool = configured.length > 0 ? configured : DEFAULT_PIPED_UPSTREAMS;

  let lastErr = null;
  for (const base of pool) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    try {
      const resp = await fetchImpl(`${base}${pathAndQuery}`, {
        signal: controller.signal,
        headers: { Accept: 'application/json', 'User-Agent': 'SonoraBackend/2.0' }
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      if (json?.error) throw new Error(json.message || json.error);
      return json;
    } catch (err) {
      lastErr = err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr || new Error('Каталог временно недоступен');
}

function buildAccountInput(body) {
  const cookieHeader = normalizeCookieHeader(body?.cookie || body?.cookieHeader || '');
  return {
    cookieHeader,
    visitorData: String(body?.visitorData || '').trim(),
    dataSyncId: String(body?.dataSyncId || '').trim(),
    authUserIndex: Math.max(0, Number(body?.authUserIndex) || 0)
  };
}

export function createSonoraServer({
  env = process.env,
  dataDir,
  fetchImpl = globalThis.fetch
} = {}) {
  const authStore = new PasscodeAuthStore({ dataDir, env });
  const ytClient = new YouTubeMusicClient(fetchImpl);

  return http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url || '/', 'http://localhost');
    const path = reqUrl.pathname.replace(/\/+$/, '') || '/';

    if (req.method === 'OPTIONS') {
      const origin = resolveCorsOrigin(req.headers.origin, env);
      if (!origin && req.headers.origin) {
        res.writeHead(403, { Vary: 'Origin' });
        res.end();
        return;
      }
      res.writeHead(204, getBaseCorsHeaders(req, env));
      res.end();
      return;
    }

    try {
      if (path === '/' || path === '/health') {
        const origin = req.headers.origin ? resolveCorsOrigin(req.headers.origin, env) : null;
        const healthHeaders = {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store'
        };
        if (origin) {
          healthHeaders['Access-Control-Allow-Origin'] = origin;
          healthHeaders.Vary = 'Origin';
        }
        const status = authStore.getStatus();
        res.writeHead(200, healthHeaders);
        res.end(
          JSON.stringify({
            ok: true,
            service: 'sonora-backend',
            version: '2.0.0',
            needsClaim: status.needsClaim
          })
        );
        return;
      }

      // Reject unknown browser origins on all /api/* routes
      if (req.headers.origin && !resolveCorsOrigin(req.headers.origin, env)) {
        sendJson(res, req, env, 403, { error: 'Origin not allowed by CORS policy' });
        return;
      }

      if (path === '/api/auth/status' && req.method === 'GET') {
        const status = authStore.getStatus();
        const token = getBearerToken(req);
        const authenticated = token ? verifyAccessToken(token, env) : false;
        sendJson(res, req, env, 200, {
          needsClaim: status.needsClaim,
          authenticated
        });
        return;
      }

      if (path === '/api/auth/claim' && req.method === 'POST') {
        const body = await readJsonBody(req);
        authStore.claimInitialPasscode(body?.passcode);
        const session = issueAccessToken(env);
        sendJson(res, req, env, 200, session);
        return;
      }

      if (path === '/api/auth/login' && req.method === 'POST') {
        const status = authStore.getStatus();
        if (status.needsClaim) {
          sendJson(res, req, env, 409, {
            error: 'Сначала задайте пароль доступа сервера',
            needsClaim: true
          });
          return;
        }
        const body = await readJsonBody(req);
        if (!authStore.verifyPasscode(body?.passcode)) {
          sendJson(res, req, env, 401, { error: 'Неверный пароль сервера' });
          return;
        }
        const session = issueAccessToken(env);
        sendJson(res, req, env, 200, session);
        return;
      }

      // Signed audio stream relay (verified via HMAC ticket, supports Safari Range requests)
      if (path === '/api/audio-proxy' && (req.method === 'GET' || req.method === 'HEAD')) {
        const target = reqUrl.searchParams.get('u') || '';
        const exp = reqUrl.searchParams.get('exp') || '';
        const sig = reqUrl.searchParams.get('sig') || '';
        if (!verifySignedAudioTicket(target, exp, sig, env) || !isAllowedAudioProxyUrl(target)) {
          sendJson(res, req, env, 403, { error: 'Invalid or expired stream signature' });
          return;
        }

        const forwardHeaders = {
          'User-Agent': 'Mozilla/5.0'
        };
        if (req.headers.range) forwardHeaders.Range = req.headers.range;

        const upstream = await fetchImpl(target, {
          method: req.method,
          headers: forwardHeaders
        });

        const outHeaders = {
          ...getBaseCorsHeaders(req, env),
          'Cache-Control': 'private, max-age=1800'
        };
        for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
          const val = upstream.headers.get(h);
          if (val) outHeaders[h] = val;
        }
        res.writeHead(upstream.status, outHeaders);
        if (req.method === 'HEAD' || !upstream.body) {
          res.end();
          return;
        }
        Readable.fromWeb(upstream.body).pipe(res);
        return;
      }

      // All remaining /api/* routes require valid Bearer session token
      if (path.startsWith('/api/')) {
        const token = getBearerToken(req);
        if (!verifyAccessToken(token, env)) {
          const status = authStore.getStatus();
          sendJson(res, req, env, 401, {
            error: status.needsClaim
              ? 'Настройте первичный пароль доступа к серверу'
              : 'Требуется авторизация на сервере',
            needsClaim: status.needsClaim
          });
          return;
        }
      }

      if (path === '/api/yt/account-info' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const account = buildAccountInput(body);
        if (!hasAuthCookies(account.cookieHeader)) {
          sendJson(res, req, env, 400, {
            error: 'В cookie отсутствует SAPISID или SID. Скопируйте cookie из music.youtube.com.'
          });
          return;
        }
        const profile = await ytClient.fetchAccountInfo(account);
        sendJson(res, req, env, 200, { account: profile });
        return;
      }

      if (path === '/api/yt/sync' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const account = buildAccountInput(body);
        if (!hasAuthCookies(account.cookieHeader)) {
          sendJson(res, req, env, 400, {
            error: 'В cookie отсутствует SAPISID или SID. Скопируйте cookie из music.youtube.com.'
          });
          return;
        }

        const profile = await ytClient.fetchAccountInfo(account);
        const [likedTracks, historyTracks, userPlaylists] = await Promise.all([
          ytClient.fetchLikedTracks(account).catch(() => []),
          ytClient.fetchHistoryTracks(account).catch(() => []),
          ytClient.fetchUserPlaylists(account).catch(() => [])
        ]);

        // Hydrate up to 15 playlists in small batches
        const playlistsToHydrate = userPlaylists.slice(0, 15);
        const playlists = [];
        for (let i = 0; i < playlistsToHydrate.length; i += 4) {
          const batch = playlistsToHydrate.slice(i, i + 4);
          const resolvedBatch = await Promise.all(
            batch.map(async (pl) => {
              const tracks = await ytClient
                .fetchPlaylistTracks(account, pl.playlistId)
                .catch(() => []);
              return {
                id: pl.playlistId,
                name: pl.title,
                description: '',
                thumbnailUrl: pl.thumbnailUrl || '',
                trackCount: pl.trackCount || tracks.length,
                tracks
              };
            })
          );
          playlists.push(...resolvedBatch);
        }

        sendJson(res, req, env, 200, {
          account: profile,
          likedTracks,
          historyTracks,
          playlists
        });
        return;
      }

      if (path === '/api/yt/like' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const account = buildAccountInput(body);
        await ytClient.setLikeStatus(account, body?.videoId, Boolean(body?.liked));
        sendJson(res, req, env, 200, { ok: true });
        return;
      }

      if (path === '/api/yt/playlist/create' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const account = buildAccountInput(body);
        const playlistId = await ytClient.createPlaylist(
          account,
          body?.title,
          body?.description,
          Array.isArray(body?.videoIds) ? body.videoIds : []
        );
        sendJson(res, req, env, 200, { ok: true, playlistId });
        return;
      }

      if (path === '/api/yt/playlist/add' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const account = buildAccountInput(body);
        await ytClient.addTracksToPlaylist(
          account,
          body?.playlistId,
          Array.isArray(body?.videoIds) ? body.videoIds : []
        );
        sendJson(res, req, env, 200, { ok: true });
        return;
      }

      if (path === '/api/yt/playlist/remove' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const account = buildAccountInput(body);
        await ytClient.removeTrackFromPlaylist(account, body?.playlistId, body?.videoId);
        sendJson(res, req, env, 200, { ok: true });
        return;
      }

      if (path === '/api/yt/stream' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const account = buildAccountInput(body);
        const videoId = String(body?.videoId || '').trim();
        const quality = String(body?.quality || 'HIGH').toUpperCase();
        if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
          sendJson(res, req, env, 400, { error: 'Некорректный ID трека' });
          return;
        }
        const resolved = hasAuthCookies(account.cookieHeader)
          ? await ytClient.resolveAuthenticatedStream(account, videoId, quality).catch(() => null)
          : null;

        if (!resolved?.url) {
          sendJson(res, req, env, 404, { error: 'Прямой поток через сессию недоступен' });
          return;
        }

        const ticket = createSignedAudioTicket(resolved.url, env);
        const base = getPublicBaseUrl(req);
        const proxyStreamUrl =
          ticket && base
            ? `${base}/api/audio-proxy?exp=${encodeURIComponent(ticket.exp)}&sig=${encodeURIComponent(ticket.sig)}&u=${encodeURIComponent(ticket.u)}`
            : null;

        sendJson(res, req, env, 200, {
          engine: 'audio',
          id: videoId,
          title: resolved.title,
          artist: resolved.artist,
          durationSeconds: resolved.durationSeconds,
          thumbnailUrl: resolved.thumbnailUrl,
          streamUrl: proxyStreamUrl || resolved.url,
          directUrl: resolved.url,
          mimeType: resolved.mimeType,
          bitrate: resolved.bitrate
        });
        return;
      }

      if (path === '/api/catalog/search' && req.method === 'GET') {
        const q = (reqUrl.searchParams.get('q') || '').trim();
        const filter = (reqUrl.searchParams.get('filter') || 'music_songs').trim();
        const data = await fetchPipedUpstream(
          `/search?q=${encodeURIComponent(q)}&filter=${encodeURIComponent(filter)}`,
          env,
          fetchImpl
        );
        sendJson(res, req, env, 200, data);
        return;
      }

      if (path === '/api/catalog/suggestions' && req.method === 'GET') {
        const query = (reqUrl.searchParams.get('query') || '').trim();
        const data = await fetchPipedUpstream(
          `/suggestions?query=${encodeURIComponent(query)}`,
          env,
          fetchImpl
        );
        sendJson(res, req, env, 200, Array.isArray(data) ? data : []);
        return;
      }

      if (path.startsWith('/api/catalog/playlists/') && req.method === 'GET') {
        const pid = decodeURIComponent(path.slice('/api/catalog/playlists/'.length)).trim();
        if (!/^[A-Za-z0-9_-]{2,128}$/.test(pid)) {
          sendJson(res, req, env, 400, { error: 'Некорректный ID плейлиста' });
          return;
        }
        const data = await fetchPipedUpstream(`/playlists/${encodeURIComponent(pid)}`, env, fetchImpl);
        sendJson(res, req, env, 200, data);
        return;
      }

      if (path.startsWith('/api/catalog/channel/') && req.method === 'GET') {
        const cid = decodeURIComponent(path.slice('/api/catalog/channel/'.length)).trim();
        if (!/^[A-Za-z0-9_-]{2,128}$/.test(cid)) {
          sendJson(res, req, env, 400, { error: 'Некорректный ID канала' });
          return;
        }
        const data = await fetchPipedUpstream(`/channel/${encodeURIComponent(cid)}`, env, fetchImpl);
        sendJson(res, req, env, 200, data);
        return;
      }

      if (path.startsWith('/api/catalog/streams/') && req.method === 'GET') {
        const vid = decodeURIComponent(path.slice('/api/catalog/streams/'.length)).trim();
        if (!/^[A-Za-z0-9_-]{11}$/.test(vid)) {
          sendJson(res, req, env, 400, { error: 'Некорректный ID видео' });
          return;
        }
        const data = await fetchPipedUpstream(`/streams/${encodeURIComponent(vid)}`, env, fetchImpl);
        sendJson(res, req, env, 200, data);
        return;
      }

      sendJson(res, req, env, 404, { error: 'Маршрут не найден' });
    } catch (err) {
      const code = err?.code && err.code >= 400 && err.code < 600 ? err.code : 500;
      sendJson(res, req, env, code, { error: err?.message || 'Внутренняя ошибка сервера' });
    }
  });
}

const isEntrypoint =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isEntrypoint) {
  const port = Number(process.env.PORT) || 3000;
  const server = createSonoraServer();
  server.listen(port, () => {
    console.log(`Sonora backend listening on port ${port}`);
  });
}
