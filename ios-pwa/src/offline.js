import { formatUserErrorRu, sanitizeTrack } from './security.js';

const OFFLINE_CACHE_NAME = 'sonora-offline-audio-v1';
const CHUNK_READ_TIMEOUT_MS = 25000;

function cacheKeyForTrack(trackId) {
  return `./offline-audio/${encodeURIComponent(String(trackId || '').trim())}`;
}

export function formatBytesRu(bytes) {
  const n = Number(bytes) || 0;
  if (n <= 0) return '0 КБ';
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} МБ`;
  return `${Math.max(1, Math.round(n / 1024))} КБ`;
}

export function buildSafeAudioFilename(track, mimeType = 'audio/mp4') {
  const cleanPart = (val, fallback) => {
    const cleaned = String(val ?? '')
      .replace(/[\\/:*?"<>|\u0000-\u001F]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 70);
    return cleaned || fallback;
  };
  const artist = cleanPart(track?.artist, 'Sonora');
  const title = cleanPart(track?.title, 'Track');
  const mt = String(mimeType || '').toLowerCase();
  let ext = 'm4a';
  if (mt.includes('mpeg') || mt.includes('mp3')) ext = 'mp3';
  else if (mt.includes('webm')) ext = 'webm';
  else if (mt.includes('ogg') || mt.includes('opus')) ext = 'ogg';
  else if (mt.includes('wav')) ext = 'wav';
  return `${artist} - ${title}.${ext}`;
}

async function readChunkWithTimeout(reader, timeoutMs) {
  let timerId = null;
  try {
    return await Promise.race([
      reader.read(),
      new Promise((_, reject) => {
        timerId = setTimeout(() => reject(new Error('Время ожидания загрузки истекло')), timeoutMs);
        timerId.unref?.();
      })
    ]);
  } finally {
    if (timerId) clearTimeout(timerId);
  }
}

export class SonoraOfflineManager {
  constructor(storage) {
    this.storage = storage;
    this.activeObjectUrls = new Map();
    this.downloadingIds = new Set();
    this.downloadProgress = new Map();
    this.activeControllers = new Map();
  }

  isSupported() {
    return typeof caches !== 'undefined';
  }

  isDownloaded(trackId) {
    return Boolean(this.storage?.downloadedTracks?.some((t) => t.id === trackId));
  }

  isDownloading(trackId) {
    return this.downloadingIds.has(trackId);
  }

  getProgress(trackId) {
    return this.downloadProgress.get(trackId) || null;
  }

  cancelDownload(trackId) {
    const controller = this.activeControllers.get(trackId);
    if (controller) {
      controller.abort();
      this.activeControllers.delete(trackId);
    }
    this.downloadingIds.delete(trackId);
    this.downloadProgress.delete(trackId);
  }

  async getOfflinePlaybackUrl(trackId) {
    if (!this.isSupported() || !trackId) return null;
    const cachedUrl = this.activeObjectUrls.get(trackId);
    if (cachedUrl) return cachedUrl;
    try {
      const cache = await caches.open(OFFLINE_CACHE_NAME);
      const match = await cache.match(cacheKeyForTrack(trackId));
      if (!match) return null;
      const blob = await match.blob();
      if (!blob || blob.size === 0) return null;
      const url = URL.createObjectURL(blob);
      this.activeObjectUrls.set(trackId, url);
      return url;
    } catch {
      return null;
    }
  }

  async getOfflineBlobForExport(trackId) {
    if (!this.isSupported() || !trackId) {
      throw new Error('Оффлайн-кэш не поддерживается браузером');
    }
    const cache = await caches.open(OFFLINE_CACHE_NAME);
    const match = await cache.match(cacheKeyForTrack(trackId));
    if (!match) {
      throw new Error('Файл не найден в оффлайн-кэше');
    }
    const blob = await match.blob();
    if (!blob || blob.size === 0) {
      throw new Error('Сохранённый аудиофайл повреждён');
    }
    const meta = this.storage?.downloadedTracks?.find((t) => t.id === trackId);
    const mimeType = meta?.mimeType || blob.type || 'audio/mp4';
    const filename = meta?.filename || buildSafeAudioFilename(meta || { id: trackId }, mimeType);
    return { blob, filename, mimeType };
  }

  async downloadTrack(track, streamUrl, { onProgress = null, signal = null } = {}) {
    const clean = sanitizeTrack(track);
    if (!clean) throw new Error('Некорректный трек для сохранения');
    if (!this.isSupported()) throw new Error('Оффлайн-кэш не поддерживается браузером');
    if (!streamUrl) throw new Error('Прямой аудиопоток недоступен для оффлайн-сохранения');

    this.downloadingIds.add(clean.id);
    const localController = new AbortController();
    this.activeControllers.set(clean.id, localController);

    const onExternalAbort = () => localController.abort();
    if (signal) {
      if (signal.aborted) localController.abort();
      else signal.addEventListener('abort', onExternalAbort, { once: true });
    }

    this.downloadProgress.set(clean.id, { receivedBytes: 0, totalBytes: 0, percent: 0 });
    onProgress?.({ trackId: clean.id, receivedBytes: 0, totalBytes: 0, percent: 0 });

    const key = cacheKeyForTrack(clean.id);

    try {
      const resp = await fetch(streamUrl, { signal: localController.signal });
      if (!resp.ok) {
        throw new Error(`Ошибка загрузки аудио (HTTP ${resp.status})`);
      }

      const contentType = resp.headers.get('content-type') || 'audio/mp4';
      const totalBytes = Number(resp.headers.get('content-length')) || 0;
      let blob = null;

      if (resp.body && typeof resp.body.getReader === 'function') {
        const reader = resp.body.getReader();
        const chunks = [];
        let receivedBytes = 0;
        let lastNotifyAt = 0;

        while (true) {
          const { done, value } = await readChunkWithTimeout(reader, CHUNK_READ_TIMEOUT_MS);
          if (done) break;
          if (value) {
            chunks.push(value);
            receivedBytes += value.byteLength;
            const now = Date.now();
            if (now - lastNotifyAt > 120) {
              lastNotifyAt = now;
              const percent = totalBytes > 0 ? Math.min(99, Math.round((receivedBytes / totalBytes) * 100)) : 0;
              const info = { receivedBytes, totalBytes, percent };
              this.downloadProgress.set(clean.id, info);
              onProgress?.({ trackId: clean.id, ...info });
            }
          }
        }
        blob = new Blob(chunks, { type: contentType });
      } else {
        blob = await resp.blob();
      }

      if (!blob || blob.size < 1024) {
        throw new Error('Получен пустой или неполный аудиофайл');
      }

      const finalType = contentType || blob.type || 'audio/mp4';
      const filename = buildSafeAudioFilename(clean, finalType);
      const cache = await caches.open(OFFLINE_CACHE_NAME);
      await cache.put(
        key,
        new Response(blob, {
          status: 200,
          headers: {
            'Content-Type': finalType,
            'Content-Length': String(blob.size)
          }
        })
      );

      const prev = this.activeObjectUrls.get(clean.id);
      if (prev) {
        URL.revokeObjectURL(prev);
        this.activeObjectUrls.delete(clean.id);
      }

      await this.storage?.saveDownloadedTrack?.({
        ...clean,
        filename,
        sizeBytes: blob.size,
        mimeType: finalType,
        downloadedAt: Date.now()
      });

      this.downloadProgress.set(clean.id, {
        receivedBytes: blob.size,
        totalBytes: blob.size,
        percent: 100
      });
      onProgress?.({ trackId: clean.id, receivedBytes: blob.size, totalBytes: blob.size, percent: 100 });
      return blob.size;
    } catch (err) {
      // Remove any partial/stale cache entry so aborted or broken downloads don't leave junk
      try {
        const cache = await caches.open(OFFLINE_CACHE_NAME);
        await cache.delete(key);
      } catch {
        // Ignore cleanup failure
      }
      if (err?.name === 'AbortError' || localController.signal.aborted) {
        throw err;
      }
      throw new Error(formatUserErrorRu(err, 'Ошибка оффлайн-загрузки'));
    } finally {
      if (signal) signal.removeEventListener('abort', onExternalAbort);
      this.activeControllers.delete(clean.id);
      this.downloadingIds.delete(clean.id);
      this.downloadProgress.delete(clean.id);
    }
  }

  async downloadTrackWithCandidates(track, candidates = [], options = {}) {
    const list = Array.isArray(candidates) ? candidates.filter(Boolean) : [];
    if (list.length === 0) {
      throw new Error('Нет доступного потока для оффлайн-сохранения');
    }
    const prioritized = [...list].sort((a, b) => {
      const aScore = a.includes('local=true') || a.includes('audius') ? 0 : 1;
      const bScore = b.includes('local=true') || b.includes('audius') ? 0 : 1;
      return aScore - bScore;
    });

    let lastErr = null;
    for (const url of prioritized) {
      if (options?.signal?.aborted) {
        throw new Error('Загрузка отменена');
      }
      try {
        return await this.downloadTrack(track, url, options);
      } catch (err) {
        if (err?.name === 'AbortError' || options?.signal?.aborted) {
          throw err;
        }
        lastErr = err;
      }
    }
    throw lastErr || new Error('Браузер заблокировал скачивание потока (нет CORS)');
  }

  async removeTrack(trackId) {
    if (!trackId) return;
    this.cancelDownload(trackId);
    const prevUrl = this.activeObjectUrls.get(trackId);
    if (prevUrl) {
      URL.revokeObjectURL(prevUrl);
      this.activeObjectUrls.delete(trackId);
    }
    if (this.isSupported()) {
      try {
        const cache = await caches.open(OFFLINE_CACHE_NAME);
        await cache.delete(cacheKeyForTrack(trackId));
      } catch {
        // Ignore
      }
    }
    await this.storage?.removeDownloadedTrack?.(trackId);
  }

  async clearAll() {
    for (const id of Array.from(this.activeControllers.keys())) {
      this.cancelDownload(id);
    }
    for (const url of this.activeObjectUrls.values()) {
      URL.revokeObjectURL(url);
    }
    this.activeObjectUrls.clear();
    if (this.isSupported()) {
      await caches.delete(OFFLINE_CACHE_NAME).catch(() => {});
    }
    await this.storage?.clearDownloadedTracks?.();
  }

  getStats() {
    const list = this.storage?.downloadedTracks || [];
    const totalBytes = list.reduce((sum, item) => sum + (Number(item.sizeBytes) || 0), 0);
    return {
      count: list.length,
      totalBytes,
      formattedSize: formatBytesRu(totalBytes)
    };
  }
}
