const FORMAT_V1 = 'sonora-enc:v1';
const KDF_PBKDF2_SHA256 = 'PBKDF2WithHmacSHA256';
const PBKDF2_ITERATIONS = 120000;
const MIN_ITERATIONS = 50000;
const MAX_ITERATIONS = 500000;

function getSubtle() {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('WebCrypto API недоступен в текущем контексте (требуется HTTPS)');
  }
  return subtle;
}

export function sanitizeHttpsUrl(rawUrl) {
  if (typeof rawUrl !== 'string') return null;
  let candidate = rawUrl.trim();
  if (!candidate) return null;
  if (candidate.startsWith('//')) {
    candidate = `https:${candidate}`;
  }
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'https:' || !parsed.hostname) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToBytes(b64) {
  const clean = String(b64 ?? '').trim();
  const binary = atob(clean);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

async function deriveBackupKey(password, saltBytes, iterations) {
  const subtle = getSubtle();
  const enc = new TextEncoder();
  const baseKey = await subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations,
      hash: 'SHA-256'
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export const BackupCipher = {
  FORMAT_V1,
  KDF_PBKDF2_SHA256,
  PBKDF2_ITERATIONS,

  isEncryptedBackup(rawContent) {
    if (typeof rawContent !== 'string') return false;
    const trimmed = rawContent.trim();
    if (!trimmed.startsWith('{')) return false;
    try {
      const env = JSON.parse(trimmed);
      return (
        env?.format === FORMAT_V1 &&
        typeof env.salt === 'string' && env.salt.length > 0 &&
        typeof env.iv === 'string' && env.iv.length > 0 &&
        typeof env.ciphertext === 'string' && env.ciphertext.length > 0
      );
    } catch {
      return false;
    }
  },

  async encrypt(plaintextJson, password) {
    if (typeof password !== 'string' || password.length < 6) {
      throw new Error('Пароль резервной копии должен содержать не менее 6 символов');
    }
    const subtle = getSubtle();
    const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const aesKey = await deriveBackupKey(password, salt, PBKDF2_ITERATIONS);
    const plainBytes = new TextEncoder().encode(plaintextJson);
    const cipherBuf = await subtle.encrypt(
      { name: 'AES-GCM', iv, tagLength: 128 },
      aesKey,
      plainBytes
    );
    const envelope = {
      format: FORMAT_V1,
      kdf: KDF_PBKDF2_SHA256,
      iterations: PBKDF2_ITERATIONS,
      salt: bytesToBase64(salt),
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(new Uint8Array(cipherBuf))
    };
    return JSON.stringify(envelope, null, 2);
  },

  async decrypt(encryptedPayload, password) {
    if (typeof password !== 'string' || password.length === 0) {
      throw new Error('Введите пароль для расшифровки');
    }
    let envelope;
    try {
      envelope = JSON.parse(String(encryptedPayload).trim());
    } catch {
      throw new Error('Некорректный формат зашифрованной резервной копии');
    }
    if (envelope?.format !== FORMAT_V1) {
      throw new Error('Неподдерживаемый формат зашифрованной копии');
    }
    if (envelope?.kdf !== KDF_PBKDF2_SHA256) {
      throw new Error('Неподдерживаемый алгоритм KDF');
    }
    const iterations = Number(envelope.iterations);
    if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) {
      throw new Error('Некорректные параметры шифрования');
    }

    const salt = base64ToBytes(envelope.salt);
    const iv = base64ToBytes(envelope.iv);
    const cipherBytes = base64ToBytes(envelope.ciphertext);
    const subtle = getSubtle();
    const aesKey = await deriveBackupKey(password, salt, iterations);
    try {
      const plainBuf = await subtle.decrypt(
        { name: 'AES-GCM', iv, tagLength: 128 },
        aesKey,
        cipherBytes
      );
      return new TextDecoder().decode(plainBuf);
    } catch {
      throw new Error('Неверный пароль или файл резервной копии повреждён');
    }
  }
};

export function sanitizeTrack(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id ?? '').trim().slice(0, 64);
  if (!id) return null;
  return {
    id,
    title: String(raw.title ?? '').trim().slice(0, 240) || 'Без названия',
    artist: String(raw.artist ?? '').trim().slice(0, 200) || 'Неизвестный исполнитель',
    durationSeconds: Math.max(0, Math.floor(Number(raw.durationSeconds) || 0)),
    thumbnailUrl: sanitizeHttpsUrl(raw.thumbnailUrl) || '',
    streamUrl: null
  };
}

export function normalizeBackupPayload(rawJson) {
  const parsed = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Некорректный JSON резервной копии');
  }
  const sanitizeList = (list) =>
    Array.isArray(list) ? list.map(sanitizeTrack).filter(Boolean) : [];

  const playlists = Array.isArray(parsed.playlists)
    ? parsed.playlists
        .map((pl) => {
          const name = String(pl?.name ?? '').trim().slice(0, 120);
          if (!name) return null;
          return {
            name,
            description: String(pl?.description ?? '').trim().slice(0, 500),
            tracks: sanitizeList(pl?.tracks),
            youtubePlaylistId: pl?.youtubePlaylistId ? String(pl.youtubePlaylistId).trim() : null,
            createdAt: Number(pl?.createdAt) || Date.now()
          };
        })
        .filter(Boolean)
    : [];

  const searchHistory = Array.isArray(parsed.searchHistory)
    ? parsed.searchHistory
        .map((q) => String(q ?? '').trim().slice(0, 160))
        .filter(Boolean)
    : [];

  return {
    version: Number(parsed.version) || 2,
    exportedAt: Number(parsed.exportedAt) || Date.now(),
    favorites: sanitizeList(parsed.favorites),
    history: sanitizeList(parsed.history),
    playlists,
    searchHistory,
    settings: parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : null,
    playback: parsed.playback && typeof parsed.playback === 'object' ? parsed.playback : null,
    equalizer: parsed.equalizer && typeof parsed.equalizer === 'object' ? parsed.equalizer : null
  };
}

export function buildBackupPayload(state) {
  return {
    version: 2,
    exportedAt: Date.now(),
    favorites: (state.favorites || []).map(sanitizeTrack).filter(Boolean),
    history: (state.history || []).map(sanitizeTrack).filter(Boolean),
    playlists: (state.playlists || []).map((pl) => ({
      name: String(pl.name || '').trim(),
      description: String(pl.description || '').trim(),
      tracks: (pl.tracks || []).map(sanitizeTrack).filter(Boolean),
      youtubePlaylistId: pl.youtubePlaylistId || null,
      createdAt: Number(pl.createdAt) || Date.now()
    })),
    searchHistory: (state.searchHistory || []).slice(0, 30),
    settings: state.settings || null,
    playback: state.playback || null,
    equalizer: null
  };
}

export async function generateDeviceAesKey() {
  const subtle = getSubtle();
  return subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encryptLocalSecret(plaintext, aesKey) {
  if (!plaintext) return '';
  const subtle = getSubtle();
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const encrypted = await subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, encoded);
  return `loc:v1:${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(encrypted))}`;
}

export async function decryptLocalSecret(payload, aesKey) {
  if (!payload || !payload.startsWith('loc:v1:')) return payload || '';
  const rest = payload.slice('loc:v1:'.length);
  const sep = rest.indexOf(':');
  if (sep <= 0) return '';
  const iv = base64ToBytes(rest.slice(0, sep));
  const data = base64ToBytes(rest.slice(sep + 1));
  const subtle = getSubtle();
  const plain = await subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, data);
  return new TextDecoder().decode(plain);
}

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

export function parseExternalYouTubeImport(rawText, defaultPlaylistName = 'Импорт YouTube Music') {
  const text = String(rawText ?? '').trim();
  if (!text) throw new Error('Вставьте данные или выберите файл для импорта');

  if (text.startsWith('{') || text.startsWith('[')) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('Некорректный JSON-формат данных');
    }

    if (parsed?.format === 'sonora-yt-sync:v1') {
      return {
        kind: 'yt_sync',
        account: {
          id: String(parsed.account?.id || parsed.account?.name || 'yt_local').trim(),
          name: String(parsed.account?.name || 'YouTube Music').trim(),
          handle: String(parsed.account?.handle || '').trim(),
          email: String(parsed.account?.email || '').trim(),
          avatarUrl: sanitizeHttpsUrl(parsed.account?.avatarUrl) || ''
        },
        likedTracks: Array.isArray(parsed.likedTracks) ? parsed.likedTracks.map(sanitizeTrack).filter(Boolean) : [],
        historyTracks: Array.isArray(parsed.historyTracks) ? parsed.historyTracks.map(sanitizeTrack).filter(Boolean) : [],
        playlists: Array.isArray(parsed.playlists)
          ? parsed.playlists
              .map((pl) => ({
                id: pl?.id ? String(pl.id).trim() : null,
                name: String(pl?.name || 'Плейлист YouTube Music').trim(),
                description: String(pl?.description || '').trim(),
                tracks: Array.isArray(pl?.tracks) ? pl.tracks.map(sanitizeTrack).filter(Boolean) : []
              }))
              .filter((p) => p.name)
          : []
      };
    }

    // Google Takeout watch-history.json / array format
    if (Array.isArray(parsed)) {
      const tracks = [];
      const seen = new Set();
      for (const item of parsed) {
        const urlStr = String(item?.titleUrl || '');
        const match = urlStr.match(/[?&]v=([A-Za-z0-9_-]{11})/);
        if (!match) continue;
        const id = match[1];
        if (seen.has(id)) continue;
        seen.add(id);
        const rawTitle = String(item?.title || '').replace(/^(Watched|Просмотрено|Listened to)\s+/i, '').trim();
        const artist = String(item?.subtitles?.[0]?.name || 'YouTube Music').replace(/ - Topic$/i, '').trim();
        const clean = sanitizeTrack({
          id,
          title: rawTitle || `Трек ${id}`,
          artist,
          durationSeconds: 0,
          thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
        });
        if (clean) tracks.push(clean);
      }
      if (tracks.length === 0) throw new Error('В JSON Google Takeout не найдено треков YouTube');
      return {
        kind: 'yt_sync',
        account: null,
        likedTracks: [],
        historyTracks: tracks,
        playlists: []
      };
    }

    // Standard Sonora backup JSON
    const norm = normalizeBackupPayload(parsed);
    return { kind: 'sonora_backup', backup: norm };
  }

  // Google Takeout CSV playlist / liked-videos.csv format
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) throw new Error('Файл пуст');

  const firstCols = splitCsvLine(lines[0]).map((c) => c.toLowerCase());
  const vidColIdx = firstCols.findIndex(
    (c) => c.includes('video id') || c.includes('видео') || c === 'id'
  );
  const titleColIdx = firstCols.findIndex((c) => c.includes('title') || c.includes('название'));
  const artistColIdx = firstCols.findIndex((c) => c.includes('artist') || c.includes('channel') || c.includes('автор'));
  const hasHeader = vidColIdx >= 0;
  const startRow = hasHeader ? 1 : 0;

  const tracks = [];
  const seen = new Set();
  for (let i = startRow; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const rawVid = hasHeader ? cols[vidColIdx] : cols.find((c) => /^[A-Za-z0-9_-]{11}$/.test(c));
    const vidMatch = String(rawVid || '').match(/([A-Za-z0-9_-]{11})/);
    if (!vidMatch) continue;
    const id = vidMatch[1];
    if (seen.has(id)) continue;
    seen.add(id);
    const title = (titleColIdx >= 0 ? cols[titleColIdx] : '') || `YouTube Music (${id})`;
    const artist = (artistColIdx >= 0 ? cols[artistColIdx] : '') || 'YouTube Music';
    const clean = sanitizeTrack({
      id,
      title,
      artist,
      durationSeconds: 0,
      thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
    });
    if (clean) tracks.push(clean);
  }

  if (tracks.length === 0) {
    throw new Error('Не удалось распознать треки. Поддерживаются JSON, CSV Google Takeout и копии Sonora.');
  }

  return {
    kind: 'yt_sync',
    account: null,
    likedTracks: [],
    historyTracks: [],
    playlists: [{ id: null, name: defaultPlaylistName, description: 'Импорт Google Takeout', tracks }]
  };
}

