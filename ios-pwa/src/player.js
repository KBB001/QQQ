import { sanitizeTrack } from './security.js';

export class SonoraPlayer {
  constructor({ api, storage, onStateChange, onError }) {
    this.api = api;
    this.storage = storage;
    this.onStateChange = onStateChange;
    this.onError = onError;

    this.audio = new Audio();
    this.audio.setAttribute('playsinline', '');
    this.audio.setAttribute('webkit-playsinline', '');
    this.audio.preload = 'auto';

    this.queue = [];
    this.currentIndex = -1;
    this.shuffleEnabled = Boolean(storage.playback.shuffleEnabled);
    this.repeatMode = storage.playback.repeatMode || 'OFF';
    this.playbackSpeed = Number(storage.playback.playbackSpeed) || 1.0;
    this.isPlaying = false;
    this.isBuffering = false;
    this.duration = 0;
    this.currentTime = 0;

    this.streamCache = new Map();
    this.lyricsCache = new Map();
    this.activeLyrics = { synced: [], plain: '', source: '', loading: false };
    this.sleepTimerEndsAt = 0;
    this.sleepTimeoutId = null;
    this.sleepIntervalId = null;
    this._retriedCurrentStream = false;
    this._lastSaveAt = 0;

    this.audio.playbackRate = this.playbackSpeed;
    this._bindAudioEvents();
    this._bindMediaSession();

    if (Array.isArray(storage.playback.queue) && storage.playback.queue.length > 0) {
      this.queue = storage.playback.queue;
      this.currentIndex = Math.min(
        Math.max(0, Number(storage.playback.currentIndex) || 0),
        this.queue.length - 1
      );
      const restored = this.currentTrack;
      if (restored) {
        this.duration = restored.durationSeconds || 0;
        this.currentTime = Number(storage.playback.positionSeconds) || 0;
        this._updateMediaMetadata(restored);
      }
    }
  }

  get currentTrack() {
    if (this.currentIndex < 0 || this.currentIndex >= this.queue.length) return null;
    return this.queue[this.currentIndex];
  }

  getSnapshot() {
    return {
      queue: this.queue,
      currentIndex: this.currentIndex,
      currentTrack: this.currentTrack,
      isPlaying: this.isPlaying,
      isBuffering: this.isBuffering,
      duration: this.duration || this.currentTrack?.durationSeconds || 0,
      currentTime: this.currentTime,
      shuffleEnabled: this.shuffleEnabled,
      repeatMode: this.repeatMode,
      playbackSpeed: this.playbackSpeed,
      lyrics: this.activeLyrics,
      sleepRemainingMs:
        this.sleepTimerEndsAt > Date.now() ? this.sleepTimerEndsAt - Date.now() : 0
    };
  }

  _emit() {
    this.onStateChange?.(this.getSnapshot());
  }

  _bindAudioEvents() {
    this.audio.addEventListener('play', () => {
      this.isPlaying = true;
      this.isBuffering = false;
      this._setMediaPlaybackState('playing');
      this._updatePositionState();
      this._emit();
    });

    this.audio.addEventListener('pause', () => {
      this.isPlaying = false;
      this.isBuffering = false;
      this._setMediaPlaybackState('paused');
      this._persistPlayback(true);
      this._emit();
    });

    this.audio.addEventListener('waiting', () => {
      this.isBuffering = true;
      this._emit();
    });

    this.audio.addEventListener('canplay', () => {
      this.isBuffering = false;
      this._emit();
    });

    this.audio.addEventListener('loadedmetadata', () => {
      if (Number.isFinite(this.audio.duration) && this.audio.duration > 0) {
        this.duration = this.audio.duration;
      }
      this.audio.playbackRate = this.playbackSpeed;
      this._updatePositionState();
      this._emit();
    });

    this.audio.addEventListener('timeupdate', () => {
      this.currentTime = this.audio.currentTime || 0;
      if (Number.isFinite(this.audio.duration) && this.audio.duration > 0) {
        this.duration = this.audio.duration;
      }
      const now = Date.now();
      if (now - this._lastSaveAt > 5000) {
        this._lastSaveAt = now;
        this._persistPlayback(false);
        this._updatePositionState();
      }
      this._emit();
    });

    this.audio.addEventListener('ended', async () => {
      this.isPlaying = false;
      if (this.repeatMode === 'ONE') {
        this.seekTo(0);
        await this.audio.play().catch(() => {});
        return;
      }
      await this.next(true);
    });

    this.audio.addEventListener('error', async () => {
      const track = this.currentTrack;
      if (!track) return;
      if (!this._retriedCurrentStream) {
        this._retriedCurrentStream = true;
        this.streamCache.delete(track.id);
        await this._loadAndPlayTrack(track, this.currentTime, true);
      } else {
        this.isBuffering = false;
        this.isPlaying = false;
        this._emit();
        this.onError?.('Не удалось воспроизвести трек на iOS. Попробуйте сменить качество или источник API.');
      }
    });
  }

  _bindMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const safeHandler = (action, fn) => {
      try {
        ms.setActionHandler(action, fn);
      } catch {
        // Unsupported action on current browser
      }
    };

    safeHandler('play', () => this.togglePlayPause(true));
    safeHandler('pause', () => this.togglePlayPause(false));
    safeHandler('previoustrack', () => this.previous());
    safeHandler('nexttrack', () => this.next(false));
    safeHandler('seekbackward', (details) => {
      const offset = Number(details?.seekOffset) || 10;
      this.seekBy(-offset);
    });
    safeHandler('seekforward', (details) => {
      const offset = Number(details?.seekOffset) || 10;
      this.seekBy(offset);
    });
    safeHandler('seekto', (details) => {
      if (typeof details?.seekTime === 'number') {
        this.seekTo(details.seekTime);
      }
    });
  }

  _updateMediaMetadata(track) {
    if (!('mediaSession' in navigator) || !track) return;
    try {
      const artwork = track.thumbnailUrl
        ? [
            { src: track.thumbnailUrl, sizes: '256x256', type: 'image/jpeg' },
            { src: track.thumbnailUrl, sizes: '512x512', type: 'image/jpeg' }
          ]
        : [{ src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }];
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: track.artist,
        album: 'Sonora',
        artwork
      });
    } catch {
      // Ignore metadata error
    }
  }

  _setMediaPlaybackState(state) {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.playbackState = state;
    } catch {
      // Ignore
    }
  }

  _updatePositionState() {
    if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
    const dur = Number.isFinite(this.audio.duration) ? this.audio.duration : this.duration;
    if (!dur || dur <= 0) return;
    const pos = Math.min(dur, Math.max(0, this.audio.currentTime || 0));
    try {
      navigator.mediaSession.setPositionState({
        duration: dur,
        playbackRate: this.playbackSpeed || 1.0,
        position: pos
      });
    } catch {
      // Safari rejects invalid values silently
    }
  }

  async _persistPlayback(immediate = false) {
    if (immediate) this._lastSaveAt = Date.now();
    await this.storage.savePlaybackState({
      queue: this.queue,
      currentIndex: this.currentIndex,
      positionSeconds: this.currentTime,
      shuffleEnabled: this.shuffleEnabled,
      repeatMode: this.repeatMode,
      playbackSpeed: this.playbackSpeed
    });
  }

  async playTrack(track, list = null) {
    const clean = sanitizeTrack(track);
    if (!clean) return;

    if (Array.isArray(list) && list.length > 0) {
      const normalized = list.map(sanitizeTrack).filter(Boolean);
      const idx = normalized.findIndex((t) => t.id === clean.id);
      this.queue = idx >= 0 ? normalized : [clean, ...normalized];
      this.currentIndex = idx >= 0 ? idx : 0;
    } else {
      const idx = this.queue.findIndex((t) => t.id === clean.id);
      if (idx >= 0) {
        this.currentIndex = idx;
      } else {
        this.queue = [clean, ...this.queue];
        this.currentIndex = 0;
      }
    }

    this._retriedCurrentStream = false;
    await this._loadAndPlayTrack(this.currentTrack, 0, true);
  }

  async _loadAndPlayTrack(track, resumeSeconds = 0, shouldPlay = true) {
    if (!track) return;
    this.isBuffering = true;
    this.currentTime = resumeSeconds;
    this.duration = track.durationSeconds || 0;
    this._updateMediaMetadata(track);
    this._emit();

    try {
      const cached = this.streamCache.get(track.id);
      let info;
      if (cached && Date.now() - cached.fetchedAt < 18 * 60 * 1000) {
        info = cached.info;
      } else {
        info = await this.api.getStreamInfo(track.id, this.storage.settings.audioQuality);
        this.streamCache.set(track.id, { fetchedAt: Date.now(), info });
      }

      if (this.currentTrack?.id !== track.id) return;

      this.audio.src = info.streamUrl;
      this.audio.playbackRate = this.playbackSpeed;
      if (resumeSeconds > 0) {
        this.audio.currentTime = resumeSeconds;
      }
      if (shouldPlay) {
        await this.audio.play();
      }

      await this.storage.recordPlayback(track);
      await this._persistPlayback(true);
      this.loadLyricsForCurrentTrack(track);
    } catch (err) {
      if (this.currentTrack?.id !== track.id) return;
      this.isBuffering = false;
      this.isPlaying = false;
      this._emit();
      this.onError?.(err?.message || 'Ошибка загрузки аудиопотока');
    }
  }

  async loadLyricsForCurrentTrack(track = this.currentTrack) {
    if (!track) return;
    const cached = this.lyricsCache.get(track.id);
    if (cached) {
      this.activeLyrics = { ...cached, loading: false };
      this._emit();
      return;
    }

    this.activeLyrics = { synced: [], plain: '', source: '', loading: true };
    this._emit();
    const res = await this.api.fetchLyrics(track);
    this.lyricsCache.set(track.id, res);
    if (this.currentTrack?.id === track.id) {
      this.activeLyrics = { ...res, loading: false };
      this._emit();
    }
  }

  async togglePlayPause(forcePlay = null) {
    const track = this.currentTrack;
    if (!track) return;

    const wantPlay = forcePlay !== null ? forcePlay : this.audio.paused;
    if (!wantPlay) {
      this.audio.pause();
      return;
    }

    if (!this.audio.src) {
      await this._loadAndPlayTrack(track, this.currentTime, true);
      return;
    }

    try {
      await this.audio.play();
    } catch {
      await this._loadAndPlayTrack(track, this.currentTime, true);
    }
  }

  seekTo(seconds) {
    const dur = this.duration || this.currentTrack?.durationSeconds || 0;
    const clamped = Math.max(0, dur > 0 ? Math.min(dur, seconds) : seconds);
    this.currentTime = clamped;
    if (this.audio.src) {
      try {
        this.audio.currentTime = clamped;
      } catch {
        // Ignore until metadata loads
      }
    }
    this._updatePositionState();
    this._emit();
  }

  seekBy(deltaSeconds) {
    this.seekTo((this.audio.currentTime || this.currentTime || 0) + deltaSeconds);
  }

  async next(fromEnded = false) {
    if (this.queue.length === 0) return;

    let nextIdx = -1;
    if (this.shuffleEnabled && this.queue.length > 1) {
      do {
        nextIdx = Math.floor(Math.random() * this.queue.length);
      } while (nextIdx === this.currentIndex);
    } else if (this.currentIndex + 1 < this.queue.length) {
      nextIdx = this.currentIndex + 1;
    } else if (this.repeatMode === 'ALL') {
      nextIdx = 0;
    }

    if (nextIdx >= 0) {
      this.currentIndex = nextIdx;
      this._retriedCurrentStream = false;
      await this._loadAndPlayTrack(this.currentTrack, 0, true);
      return;
    }

    // End of queue: trigger smart radio autoplay if enabled
    if (fromEnded && this.storage.settings.autoplayEnabled && this.currentTrack) {
      try {
        const related = await this.api.getRelatedTracks(this.currentTrack.id);
        const existingIds = new Set(this.queue.map((t) => t.id));
        const additions = related.filter((t) => !existingIds.has(t.id)).slice(0, 12);
        if (additions.length > 0) {
          this.queue = [...this.queue, ...additions];
          this.currentIndex += 1;
          this._retriedCurrentStream = false;
          await this._loadAndPlayTrack(this.currentTrack, 0, true);
          return;
        }
      } catch {
        // Ignore autoplay network errors at queue end
      }
    }

    this.isPlaying = false;
    this._emit();
  }

  async previous() {
    if (this.queue.length === 0) return;
    if ((this.audio.currentTime || 0) > 3) {
      this.seekTo(0);
      return;
    }
    if (this.currentIndex > 0) {
      this.currentIndex -= 1;
    } else if (this.repeatMode === 'ALL') {
      this.currentIndex = this.queue.length - 1;
    } else {
      this.seekTo(0);
      return;
    }
    this._retriedCurrentStream = false;
    await this._loadAndPlayTrack(this.currentTrack, 0, true);
  }

  async playNextInQueue(track) {
    const clean = sanitizeTrack(track);
    if (!clean) return;
    if (this.queue.length === 0) {
      await this.playTrack(clean);
      return;
    }
    const existingIdx = this.queue.findIndex((t) => t.id === clean.id);
    if (existingIdx === this.currentIndex) return;
    if (existingIdx >= 0) {
      this.queue.splice(existingIdx, 1);
      if (existingIdx < this.currentIndex) this.currentIndex -= 1;
    }
    this.queue.splice(this.currentIndex + 1, 0, clean);
    await this._persistPlayback(true);
    this._emit();
  }

  async startRadio(track) {
    await this.playTrack(track);
    try {
      const related = await this.api.getRelatedTracks(track.id);
      const unique = related.filter((t) => t.id !== track.id).slice(0, 20);
      if (unique.length > 0) {
        this.queue = [this.currentTrack, ...unique];
        this.currentIndex = 0;
        await this._persistPlayback(true);
        this._emit();
      }
    } catch {
      // Keep single track playing
    }
  }

  toggleShuffle() {
    this.shuffleEnabled = !this.shuffleEnabled;
    this._persistPlayback(true);
    this._emit();
  }

  cycleRepeat() {
    const order = ['OFF', 'ALL', 'ONE'];
    this.repeatMode = order[(order.indexOf(this.repeatMode) + 1) % order.length];
    this._persistPlayback(true);
    this._emit();
  }

  setPlaybackSpeed(speed) {
    const clamped = Math.min(2.0, Math.max(0.5, Number(speed) || 1.0));
    this.playbackSpeed = Math.round(clamped * 100) / 100;
    this.audio.playbackRate = this.playbackSpeed;
    this._updatePositionState();
    this._persistPlayback(true);
    this._emit();
  }

  setSleepTimer(minutes) {
    this.cancelSleepTimer();
    if (!minutes || minutes <= 0) return;

    const ms = minutes * 60 * 1000;
    this.sleepTimerEndsAt = Date.now() + ms;

    const fadeLeadMs = Math.min(5000, Math.floor(ms / 2));
    this.sleepTimeoutId = setTimeout(() => {
      const startVol = this.audio.volume || 1.0;
      const steps = 10;
      let step = 0;
      const fadeStepMs = Math.max(100, Math.floor(fadeLeadMs / steps));
      const fadeId = setInterval(() => {
        step++;
        this.audio.volume = Math.max(0, startVol * (1 - step / steps));
        if (step >= steps) {
          clearInterval(fadeId);
          this.audio.pause();
          this.audio.volume = 1.0;
          this.cancelSleepTimer();
        }
      }, fadeStepMs);
    }, Math.max(0, ms - fadeLeadMs));

    this.sleepIntervalId = setInterval(() => this._emit(), 1000);
    this._emit();
  }

  cancelSleepTimer() {
    if (this.sleepTimeoutId) clearTimeout(this.sleepTimeoutId);
    if (this.sleepIntervalId) clearInterval(this.sleepIntervalId);
    this.sleepTimeoutId = null;
    this.sleepIntervalId = null;
    this.sleepTimerEndsAt = 0;
    this.audio.volume = 1.0;
    this._emit();
  }
}
