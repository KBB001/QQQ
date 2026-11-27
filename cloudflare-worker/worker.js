/**
 * Sonora Personal Cloudflare Worker Proxy
 * Приоритетный маршрутизатор каталога, подсказок, плейлистов и прямых аудиопотоков без рекламы.
 */

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
      /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(host) ||
      /^\d+\.\d+\.\d+\.\d+$/.test(host)
    ) {
      return false;
    }
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
      headers: {
        Accept: 'application/json',
        'User-Agent': 'SonoraWorker/2.0'
      }
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
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
      const data = await fetchJsonWithTimeout(`${base}${pathAndQuery}`);
      return { source: base, data };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('All Piped upstreams unavailable');
}

function mapInvidiousVideoToPiped(inv, videoId) {
  const adaptive = Array.isArray(inv?.adaptiveFormats) ? inv.adaptiveFormats : [];
  const audioStreams = adaptive
    .filter((f) => String(f?.type || '').startsWith('audio/') && typeof f?.url === 'string')
    .map((f) => ({
      url: f.url,
      bitrate: Number(f.bitrate) || 0,
      mimeType: String(f.type || '').split(';')[0].trim(),
      codec: String(f.encoding || ''),
      format: String(f.container || '').toUpperCase()
    }));

  const relatedStreams = (Array.isArray(inv?.recommendedVideos) ? inv.recommendedVideos : [])
    .filter((v) => v?.videoId)
    .map((v) => ({
      type: 'stream',
      url: `/watch?v=${v.videoId}`,
      title: v.title || 'Без названия',
      uploaderName: v.author || 'Исполнитель',
      duration: Number(v.lengthSeconds) || 0,
      thumbnail: v.videoThumbnails?.[0]?.url || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`
    }));

  return {
    title: inv?.title || 'Без названия',
    uploader: inv?.author || 'Исполнитель',
    duration: Number(inv?.lengthSeconds) || 0,
    thumbnailUrl: inv?.videoThumbnails?.[0]?.url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    hls: inv?.hlsUrl || null,
    audioStreams,
    videoStreams: [],
    relatedStreams
  };
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return jsonResponse({ error: 'Method Not Allowed' }, 405, request, env);
    }

    const reqUrl = new URL(request.url);
    const path = reqUrl.pathname.replace(/\/+$/, '') || '/';

    if (path === '/' || path === '/health') {
      return jsonResponse(
        {
          ok: true,
          service: 'sonora-cf-worker',
          version: '2.0.0',
          upstreams: PIPED_UPSTREAMS.length
        },
        200,
        request,
        env
      );
    }

    try {
      if (path === '/search') {
        const q = (reqUrl.searchParams.get('q') || '').trim();
        const filter = (reqUrl.searchParams.get('filter') || 'music_songs').trim();
        if (!q) return jsonResponse({ items: [] }, 200, request, env);
        const { data } = await tryPipedPath(
          `/search?q=${encodeURIComponent(q)}&filter=${encodeURIComponent(filter)}`
        );
        return jsonResponse(data, 200, request, env);
      }

      if (path === '/suggestions') {
        const query = (reqUrl.searchParams.get('query') || '').trim();
        if (!query) return jsonResponse([], 200, request, env);
        const { data } = await tryPipedPath(`/suggestions?query=${encodeURIComponent(query)}`);
        return jsonResponse(Array.isArray(data) ? data : [], 200, request, env);
      }

      if (path.startsWith('/playlists/')) {
        const pid = decodeURIComponent(path.slice('/playlists/'.length)).trim();
        if (!/^[A-Za-z0-9_-]{2,128}$/.test(pid)) {
          return jsonResponse({ error: 'Invalid playlist ID' }, 400, request, env);
        }
        const { data } = await tryPipedPath(`/playlists/${encodeURIComponent(pid)}`);
        return jsonResponse(data, 200, request, env);
      }

      if (path.startsWith('/channel/')) {
        const cid = decodeURIComponent(path.slice('/channel/'.length)).trim();
        if (!/^[A-Za-z0-9_-]{2,128}$/.test(cid)) {
          return jsonResponse({ error: 'Invalid channel ID' }, 400, request, env);
        }
        const { data } = await tryPipedPath(`/channel/${encodeURIComponent(cid)}`);
        return jsonResponse(data, 200, request, env);
      }

      if (path.startsWith('/streams/')) {
        const vid = decodeURIComponent(path.slice('/streams/'.length)).trim();
        if (!/^[A-Za-z0-9_-]{11}$/.test(vid)) {
          return jsonResponse({ error: 'Invalid video ID' }, 400, request, env);
        }
        try {
          const { data } = await tryPipedPath(`/streams/${encodeURIComponent(vid)}`);
          return jsonResponse(data, 200, request, env);
        } catch (pipedErr) {
          for (const invBase of INVIDIOUS_UPSTREAMS) {
            try {
              const inv = await fetchJsonWithTimeout(`${invBase}/api/v1/videos/${encodeURIComponent(vid)}`);
              return jsonResponse(mapInvidiousVideoToPiped(inv, vid), 200, request, env);
            } catch {
              // Continue fallback loop
            }
          }
          throw pipedErr;
        }
      }

      if (path === '/audio-proxy') {
        const target = reqUrl.searchParams.get('url') || '';
        if (!isAllowedMediaUrl(target)) {
          return jsonResponse({ error: 'Blocked or invalid media host' }, 403, request, env);
        }
        const forwardHeaders = new Headers();
        const range = request.headers.get('Range');
        if (range) forwardHeaders.set('Range', range);

        const upstream = await fetch(target, { headers: forwardHeaders });
        const outHeaders = new Headers(corsHeaders(request, env));
        for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
          const val = upstream.headers.get(h);
          if (val) outHeaders.set(h, val);
        }
        outHeaders.set('Cache-Control', 'private, max-age=1800');
        return new Response(upstream.body, {
          status: upstream.status,
          headers: outHeaders
        });
      }

      return jsonResponse({ error: 'Not Found' }, 404, request, env);
    } catch (err) {
      return jsonResponse(
        { error: err?.message || 'Upstream proxy error' },
        502,
        request,
        env
      );
    }
  }
};
