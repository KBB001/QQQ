import { sanitizeTrack } from './security.js';

const OFFLINE_CACHE_NAME = 'sonora-offline-audio-v1';

function cacheKeyForTrack(trackId) {
  return `./offline-audio/${encodeURIComponent(String(trackId || '').trim())}`;
}

export function formatBytesRu(bytes) {
  const n = Number(bytes) || 0;
  if (n <= 0) return '0 КБ';
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} МБ`;
  return `${Math.max(1, Math.round(n / 1024))} КБ`;
}

export class SonoraOfflineManager {
  constructor(storage) {
    this.storage = storage;
    this.activeObjectUrls = new Map();
    this.downloadingIds = new Set();
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

  async getOfflinePlaybackUrl(trackId) {
    if (!this.isSupported() || !trackId) return null;
    try {
      const cache = await caches.open(OFFLINE_CACHE_NAME);
      const match = await cache.match(cacheKeyForTrack(trackId));
      if (!match) return null;
      const blob = await match.blob();
      if (!blob || blob.size === 0) return null;
      const prev = this.activeObjectUrls.get(trackId);
      if (prev) URL.revokeObjectURL(prev);
      const url = URL.createObjectURL(blob);
      this.activeObjectUrls.set(trackId, url);
      return url;
    } catch {
      return null;
    }
  }

  async downloadTrack(track, streamUrl) {
    const clean = sanitizeTrack(track);
    if (!clean) throw new Error('Некорректный трек для сохранения');
    if (!this.isSupported()) throw new Error('Оффлайн-кэш не поддерживается браузером');
    if (!streamUrl) throw new Error('Прямой аудиопоток недоступен для оффлайн-сохранения');

    this.downloadingIds.add(clean.id);
    try {
      const resp = await fetch(streamUrl);
      if (!resp.ok) {
        throw new Error(`Ошибка загрузки аудио (${resp.status})`);
      }
      const blob = await resp.blob();
      if (!blob || blob.size < 1024) {
        throw new Error('Получен пустой аудиофайл');
      }

      const contentType = resp.headers.get('content-type') || blob.type || 'audio/mp4';
      const cache = await caches.open(OFFLINE_CACHE_NAME);
      await cache.put(
        cacheKeyForTrack(clean.id),
        new Response(blob, {
          status: 200,
          headers: {
            'Content-Type': contentType,
            'Content-Length': String(blob.size)
          }
        })
      );

      await this.storage?.saveDownloadedTrack?.({
        ...clean,
        sizeBytes: blob.size,
        mimeType: contentType,
        downloadedAt: Date.now()
      });
      return blob.size;
    } finally {
      this.downloadingIds.delete(clean.id);
    }
  }

  async removeTrack(trackId) {
    if (!trackId) return;
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
