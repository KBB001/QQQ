import { ImplicitSignalType } from './recommendations.js';
import { sanitizeTrack } from './security.js';

export class SonoraPlayer {
  constructor({
    api,
    storage,
    offline,
    recommendations,
    onStateChange,
    onError,
    audioElement = null
  }) {
    this.api = api;
    this.storage = storage;
    this.offline = offline;
    this.recommendations = recommendations;
    this.onStateChange = onStateChange;
    this.onError = onError;

    const domAudio =
      audioElement ||
      (typeof document !== 'undefined' ? document.getElementById('sonora-audio-engine') : null) ||
      new Audio();
    this.audio = domAudio;
    this.audio.setAttribute?.('playsinline', '');
    this.audio.setAttribute?.('webkit-playsinline', '');
    this.audio.preload = 'auto';
    this.audio.muted = false;

    this.engine = 'audio';
    this.sourceType = 'audio';
    this.isOfflineSource = false;

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
    this.recentSkippedTracks = [];
    this.sleepTimerEndsAt = 0;
    this.sleepTimeoutId = null;
    this.sleepIntervalId = null;

    this.activeStreamCandidates = [];
    this.candidateIndex = 0;
    this.activeSourceKey = null;
    this.failedGateways = new Set();
    this.extractorRetries = 0;
    this.maxExtractorRetries = 3;
    this._trackLoadSeq = 0;
    this._pendingSeekSeconds = 0;
    this._lastSaveAt = 0;

    this._silentWavUrl = '';
    this._primingSilentAudio = false;
    this._prefetchedOfflineUrls = new Map();
    this._prefetchSeq = 0;
    this._nextShuffleIndex = -1;

    this.audio.playbackRate = this.playbackSpeed;
    this._ensurePlaybackAudioSession();
    this._bindAudioEvents();
    this._bindMediaSession();
    this._bindVisibilityListener();

    if (Array.isArray(storage.playback.queue) && storage.playback.queue.length > 0) {
      this.queue = storage.playback.queue;
      this.currentIndex = Math.min(
        Math.max(0, Number(storage.playback.currentIndex) || 0),
        this.queue.length - 1
      );
      this._computeNextShuffleIndex();
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

  _computeNextShuffleIndex() {
    if (!this.shuffleEnabled || this.queue.length <= 1) {
      this._nextShuffleIndex = -1;
      return -1;
    }
    let idx;
    do {
      idx = Math.floor(Math.random() * this.queue.length);
    } while (idx === this.currentIndex);
    this._nextShuffleIndex = idx;
    return idx;
  }

  getUpcomingTrack() {
    if (this.queue.length === 0) return null;
    if (this.shuffleEnabled && this.queue.length > 1) {
      if (
        this._nextShuffleIndex < 0 ||
        this._nextShuffleIndex >= this.queue.length ||
        this._nextShuffleIndex === this.currentIndex
      ) {
        this._computeNextShuffleIndex();
      }
      return this.queue[this._nextShuffleIndex] || null;
    }
    if (this.currentIndex + 1 < this.queue.length) {
      return this.queue[this.currentIndex + 1];
    }
    if (this.repeatMode === 'ALL' && this.queue.length > 0) {
      return this.queue[0];
    }
    return null;
  }

  getSnapshot() {
    return {
      engine: 'audio',
      sourceType: this.isOfflineSource ? 'offline' : this.sourceType,
      isOfflineSource: this.isOfflineSource,
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

  _ensurePlaybackAudioSession() {
    try {
      if (typeof navigator !== 'undefined' && navigator.audioSession) {
        if (navigator.audioSession.type !== 'playback') {
          navigator.audioSession.type = 'playback';
        }
      }
    } catch {
      // Ignore if AudioSession API is unsupported
    }
  }

  _getSilentWavUrl() {
    if (this._silentWavUrl) return this._silentWavUrl;
    if (typeof Blob !== 'undefined' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
      // 44-byte PCM WAV header + 1 silent sample (8000 Hz mono 8-bit 0x80)
      const bytes = new Uint8Array([
        0x52, 0x49, 0x46, 0x46, 0x25, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
        0x66, 0x6d, 0x74, 0x20, 0x10, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
        0x40, 0x1f, 0x00, 0x00, 0x40, 0x1f, 0x00, 0x00, 0x01, 0x00, 0x08, 0x00,
        0x64, 0x61, 0x74, 0x61, 0x01, 0x00, 0x00, 0x00, 0x80
      ]);
      const blob = new Blob([bytes], { type: 'audio/wav' });
      this._silentWavUrl = URL.createObjectURL(blob);
      return this._silentWavUrl;
    }
    return '';
  }

  /** Must be called synchronously inside click/tap handler to unlock iOS Safari background audio */
  unlockGesture({ forcePrime = false } = {}) {
    this._ensurePlaybackAudioSession();
    try {
      if (this.audio.paused && (!this.audio.src || forcePrime)) {
        const silentUrl = this._getSilentWavUrl();
        if (silentUrl) {
          this._primingSilentAudio = true;
          this.audio.src = silentUrl;
          const p = this.audio.play?.();
          if (p && typeof p.catch === 'function') {
            p.catch(() => {
              this._primingSilentAudio = false;
            });
          }
        } else {
          this.audio.load?.();
        }
      }
    } catch {
      this._primingSilentAudio = false;
    }
  }

  _emit() {
    this.onStateChange?.(this.getSnapshot());
  }

  _resetFailoverState() {
    this.activeStreamCandidates = [];
    this.candidateIndex = 0;
    this.activeSourceKey = null;
    this.failedGateways = new Set();
    this.extractorRetries = 0;
    this._pendingSeekSeconds = 0;
  }

  _isSilentPrimerEvent() {
    return (
      this._primingSilentAudio ||
      (this._silentWavUrl && this.audio.src === this._silentWavUrl)
    );
  }

  _bindVisibilityListener() {
    if (typeof document === 'undefined' || !document.addEventListener) return;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && this.currentTrack) {
        this._ensurePlaybackAudioSession();
        this._updateMediaMetadata(this.currentTrack);
        this._setMediaPlaybackState(this.isPlaying ? 'playing' : 'paused');
        this._updatePositionState();
      }
    });
  }

  _bindAudioEvents() {
    const onActivePlay = () => {
      if (this._isSilentPrimerEvent()) return;
      this._ensurePlaybackAudioSession();
      this.isPlaying = true;
      this.isBuffering = false;
      this._updateMediaMetadata(this.currentTrack);
      this._setMediaPlaybackState('playing');
      this._updatePositionState();
      this._emit();
    };

    this.audio.addEventListener('play', onActivePlay);
    this.audio.addEventListener('playing', onActivePlay);

    this.audio.addEventListener('pause', () => {
      if (this._isSilentPrimerEvent()) return;
      this.isPlaying = false;
      this.isBuffering = false;
      this._setMediaPlaybackState('paused');
      this._persistPlayback(true);
      this._emit();
    });

    this.audio.addEventListener('waiting', () => {
      if (this._isSilentPrimerEvent()) return;
      this.isBuffering = true;
      this._emit();
    });

    this.audio.addEventListener('canplay', () => {
      if (this._isSilentPrimerEvent()) return;
      this.isBuffering = false;
      this._emit();
    });

    this.audio.addEventListener('durationchange', () => {
      if (this._isSilentPrimerEvent()) return;
      if (Number.isFinite(this.audio.duration) && this.audio.duration > 0) {
        this.duration = this.audio.duration;
        this._updatePositionState();
      }
    });

    this.audio.addEventListener('loadedmetadata', () => {
      if (this._isSilentPrimerEvent()) return;
      if (Number.isFinite(this.audio.duration) && this.audio.duration > 0) {
        this.duration = this.audio.duration;
      }
      if (this._pendingSeekSeconds > 0) {
        try {
          this.audio.currentTime = this._pendingSeekSeconds;
        } catch {
          // Ignore seek before ready
        }
        this._pendingSeekSeconds = 0;
      }
      this.audio.playbackRate = this.playbackSpeed;
      this._updatePositionState();
      this._emit();
    });

    this.audio.addEventListener('timeupdate', () => {
      if (this._isSilentPrimerEvent()) return;
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
      if (this._isSilentPrimerEvent()) {
        this._primingSilentAudio = false;
        return;
      }
      this.isPlaying = false;
      const finished = this.currentTrack;
      if (finished) {
        this.recommendations?.tasteTracker?.recordSignal(
          finished,
          this.repeatMode === 'ONE'
            ? ImplicitSignalType.REPEAT_PLAY
            : ImplicitSignalType.COMPLETE_PLAY
        );
      }
      if (this.repeatMode === 'ONE') {
        this.seekTo(0);
        await this.audio.play().catch(() => {});
        return;
      }
      await this.next(true);
    });

    this.audio.addEventListener('error', async () => {
      if (this._isSilentPrimerEvent()) {
        this._primingSilentAudio = false;
        return;
      }
      await this._handleAudioError();
    });
  }

  async _handleAudioError() {
    const track = this.currentTrack;
    if (!track || !this.audio.src || this.isOfflineSource) {
      this.isBuffering = false;
      this.isPlaying = false;
      this._emit();
      return;
    }

    const seq = this._trackLoadSeq;

    // 1. Try next URL candidate from the same extractor
    if (this.candidateIndex + 1 < this.activeStreamCandidates.length) {
      this.candidateIndex += 1;
      const nextUrl = this.activeStreamCandidates[this.candidateIndex];
      this.isBuffering = true;
      this._pendingSeekSeconds = this.currentTime > 0 ? this.currentTime : 0;
      this._emit();
      this._primingSilentAudio = false;
      this.audio.src = nextUrl;
      this.audio.playbackRate = this.playbackSpeed;
      try {
        await this.audio.play();
      } catch {
        // Wait for subsequent error or abort cleanly
      }
      return;
    }

    // 2. All candidates from this gateway failed: exclude sourceKey and try next extractor
    if (this.extractorRetries < this.maxExtractorRetries && !track.id.startsWith('aud:')) {
      if (this.activeSourceKey) {
        this.failedGateways.add(this.activeSourceKey);
      }
      this.extractorRetries += 1;
      this.streamCache.delete(track.id);
      this.isBuffering = true;
      this._emit();

      try {
        const freshInfo = await this.api.getStreamInfo(track.id, this.storage.settings.audioQuality, {
          excludeGateways: this.failedGateways
        });
        if (this._trackLoadSeq !== seq || this.currentTrack?.id !== track.id) return;

        const candidates =
          Array.isArray(freshInfo?.streamCandidates) && freshInfo.streamCandidates.length > 0
            ? freshInfo.streamCandidates
            : [freshInfo?.streamUrl].filter(Boolean);

        if (candidates.length > 0) {
          this.streamCache.set(track.id, { fetchedAt: Date.now(), info: freshInfo });
          this.activeStreamCandidates = candidates;
          this.candidateIndex = 0;
          this.activeSourceKey = freshInfo.sourceKey || null;
          this.sourceType = freshInfo.sourceType || 'audio';
          this._pendingSeekSeconds = this.currentTime > 0 ? this.currentTime : 0;
          this._primingSilentAudio = false;
          this.audio.src = candidates[0];
          this.audio.playbackRate = this.playbackSpeed;
          this._emit();
          await this.audio.play();
          return;
        }
      } catch {
        if (this._trackLoadSeq !== seq) return;
      }
    }

    this.isBuffering = false;
    this.isPlaying = false;
    this._emit();
    this.onError?.('Не удалось загрузить поток без рекламы. Попробуйте другой трек или проверьте источники в Настройках.');
  }

  _bindMediaSession() {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const safeHandler = (action, fn) => {
      try {
        ms.setActionHandler(action, fn);
      } catch {
        // Unsupported action
      }
    };

    // Keep previoustrack / nexttrack without seekbackward / seekforward so iOS Lock Screen shows track skip buttons
    safeHandler('play', () => this.togglePlayPause(true));
    safeHandler('pause', () => this.togglePlayPause(false));
    safeHandler('previoustrack', () => this.previous());
    safeHandler('nexttrack', () => this.next(false));
    safeHandler('seekto', (details) => {
      if (typeof details?.seekTime === 'number') {
        this.seekTo(details.seekTime);
      }
    });
  }

  _updateMediaMetadata(track) {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator) || !track) return;
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
      // Ignore
    }
  }

  _setMediaPlaybackState(state) {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.playbackState = state;
    } catch {
      // Ignore
    }
  }

  _updatePositionState() {
    if (
      typeof navigator === 'undefined' ||
      !('mediaSession' in navigator) ||
      !navigator.mediaSession.setPositionState
    ) {
      return;
    }
    const dur = this.duration;
    if (!dur || dur <= 0) return;
    const pos = Math.min(dur, Math.max(0, this.currentTime || 0));
    try {
      navigator.mediaSession.setPositionState({
        duration: dur,
        playbackRate: this.playbackSpeed || 1.0,
        position: pos
      });
    } catch {
      // Ignore
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

  async _prefetchNextTrack() {
    const upcoming = this.getUpcomingTrack();
    if (!upcoming || upcoming.id === this.currentTrack?.id) return;
    const seq = ++this._prefetchSeq;

    try {
      if (this.offline && !this._prefetchedOfflineUrls.has(upcoming.id)) {
        const offlineUrl = await this.offline.getOfflinePlaybackUrl(upcoming.id);
        if (this._prefetchSeq !== seq) return;
        if (offlineUrl) {
          this._prefetchedOfflineUrls.set(upcoming.id, offlineUrl);
          return;
        }
      }

      const cached = this.streamCache.get(upcoming.id);
      if (cached && Date.now() - cached.fetchedAt < 18 * 60 * 1000) return;

      const info = await this.api.getStreamInfo(upcoming.id, this.storage.settings.audioQuality);
      if (this._prefetchSeq !== seq || !info) return;
      this.streamCache.set(upcoming.id, { fetchedAt: Date.now(), info });
    } catch {
      // Best-effort background prefetch
    }
  }

  async playTrack(track, list = null) {
    const clean = sanitizeTrack(track);
    if (!clean) return;
    this.unlockGesture({ forcePrime: true });

    if (this.currentTrack?.id === clean.id && this.isPlaying) {
      this.recommendations?.tasteTracker?.recordSignal(clean, ImplicitSignalType.REPEAT_PLAY);
    }

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

    this._computeNextShuffleIndex();
    this._resetFailoverState();
    await this._loadAndPlayTrack(this.currentTrack, 0, true);
  }

  async _loadAndPlayTrack(track, resumeSeconds = 0, shouldPlay = true) {
    if (!track) return;
    const seq = ++this._trackLoadSeq;
    this._ensurePlaybackAudioSession();
    this.isBuffering = true;
    this.isOfflineSource = false;
    this.sourceType = 'audio';
    this.currentTime = resumeSeconds;
    this.duration = track.durationSeconds || 0;
    this._pendingSeekSeconds = resumeSeconds > 0 ? resumeSeconds : 0;
    this._updateMediaMetadata(track);
    this._emit();

    try {
      // Synchronous check for prefetched offline URL enables instant background track switch on lock screen
      let offlineUrl = this._prefetchedOfflineUrls.get(track.id) || null;
      if (!offlineUrl && this.offline) {
        offlineUrl = await this.offline.getOfflinePlaybackUrl(track.id);
      }
      if (this._trackLoadSeq !== seq || this.currentTrack?.id !== track.id) return;

      if (offlineUrl) {
        this.isOfflineSource = true;
        this.sourceType = 'offline';
        this.activeStreamCandidates = [offlineUrl];
        this.candidateIndex = 0;
        this.activeSourceKey = 'offline';
        this._primingSilentAudio = false;
        this.audio.src = offlineUrl;
        this.audio.playbackRate = this.playbackSpeed;
        if (shouldPlay) await this.audio.play();
        this.recommendations?.markHeardInSession(track.id);
        await this.storage.recordPlayback(track);
        await this._persistPlayback(true);
        this.loadLyricsForCurrentTrack(track);
        this._prefetchNextTrack();
        return;
      }

      const cached = this.streamCache.get(track.id);
      let info;
      if (cached && Date.now() - cached.fetchedAt < 18 * 60 * 1000) {
        info = cached.info;
      } else {
        info = await this.api.getStreamInfo(track.id, this.storage.settings.audioQuality, {
          excludeGateways: this.failedGateways
        });
        this.streamCache.set(track.id, { fetchedAt: Date.now(), info });
      }

      if (this._trackLoadSeq !== seq || this.currentTrack?.id !== track.id) return;

      const candidates =
        Array.isArray(info?.streamCandidates) && info.streamCandidates.length > 0
          ? info.streamCandidates
          : [info?.streamUrl].filter(Boolean);

      if (candidates.length === 0) {
        throw new Error('Прямой аудиопоток без рекламы временно недоступен');
      }

      this.isOfflineSource = false;
      this.sourceType = info.sourceType || 'audio';
      this.activeSourceKey = info.sourceKey || null;
      this.activeStreamCandidates = candidates;
      this.candidateIndex = 0;

      // Replace src cleanly without pause()/removeAttribute() to keep iOS AVAudioSession active
      this._primingSilentAudio = false;
      this.audio.src = candidates[0];
      this.audio.playbackRate = this.playbackSpeed;
      if (shouldPlay) {
        await this.audio.play();
      }

      this.recommendations?.markHeardInSession(track.id);
      await this.storage.recordPlayback(track);
      await this._persistPlayback(true);
      this.loadLyricsForCurrentTrack(track);
      this._prefetchNextTrack();
    } catch (err) {
      if (this._trackLoadSeq !== seq || this.currentTrack?.id !== track.id) return;
      this.isBuffering = false;
      this.isPlaying = false;
      this._emit();
      this.onError?.(err?.message || 'Ошибка загрузки аудиопотока без рекламы');
    }
  }

  async loadLyricsForCurrentTrack(track = this.currentTrack, { force = false, customQuery = '' } = {}) {
    if (!track) return;
    if (!force && !customQuery) {
      const cached = this.lyricsCache.get(track.id);
      if (cached) {
        this.activeLyrics = { ...cached, loading: false };
        this._emit();
        return;
      }
    }

    this.activeLyrics = { synced: [], plain: '', source: '', loading: true };
    this._emit();
    const res = await this.api.fetchLyrics(track, customQuery);
    this.lyricsCache.set(track.id, res);
    if (this.currentTrack?.id === track.id) {
      this.activeLyrics = { ...res, loading: false };
      this._emit();
    }
  }

  async togglePlayPause(forcePlay = null) {
    const track = this.currentTrack;
    if (!track) return;
    this._ensurePlaybackAudioSession();

    const wantPlay = forcePlay !== null ? forcePlay : this.audio.paused;
    if (!wantPlay) {
      this.audio.pause();
      return;
    }

    if (!this.audio.src || (this._silentWavUrl && this.audio.src === this._silentWavUrl)) {
      this.unlockGesture({ forcePrime: true });
      this._resetFailoverState();
      await this._loadAndPlayTrack(track, this.currentTime, true);
      return;
    }

    try {
      await this.audio.play();
    } catch {
      this.unlockGesture({ forcePrime: true });
      this._resetFailoverState();
      await this._loadAndPlayTrack(track, this.currentTime, true);
    }
  }

  seekTo(seconds) {
    const dur = this.duration || this.currentTrack?.durationSeconds || 0;
    const clamped = Math.max(0, dur > 0 ? Math.min(dur, seconds) : seconds);
    this.currentTime = clamped;
    if (this.audio.src && !this._isSilentPrimerEvent()) {
      try {
        this.audio.currentTime = clamped;
      } catch {
        this._pendingSeekSeconds = clamped;
      }
    }
    this._updatePositionState();
    this._emit();
  }

  seekBy(deltaSeconds) {
    this.seekTo((this.currentTime || 0) + deltaSeconds);
  }

  async next(fromEnded = false) {
    if (this.queue.length === 0) return;
    if (!fromEnded) {
      this.unlockGesture({ forcePrime: true });
    }

    const prevTrack = this.currentTrack;
    if (!fromEnded && prevTrack && this.recommendations) {
      const dur = this.duration || prevTrack.durationSeconds || 0;
      const pos = this.currentTime || 0;
      const ratio = dur > 0 ? pos / dur : 0;
      if (pos < 25 && ratio < 0.2) {
        this.recentSkippedTracks = [prevTrack, ...this.recentSkippedTracks].slice(0, 4);
        this.recommendations.tasteTracker.recordSignal(prevTrack, ImplicitSignalType.QUICK_SKIP);

        if (!this.shuffleEnabled && this.currentIndex + 2 < this.queue.length) {
          const head = this.queue.slice(0, this.currentIndex + 1);
          const tail = this.queue.slice(this.currentIndex + 1);
          const reranked = this.recommendations.softRerankUpcoming(
            tail,
            prevTrack,
            this.recentSkippedTracks
          );
          this.queue = [...head, ...reranked];
        }
      } else if (ratio < 0.65) {
        this.recommendations.tasteTracker.recordSignal(prevTrack, ImplicitSignalType.PARTIAL_SKIP);
      } else {
        this.recentSkippedTracks = [];
        this.recommendations.tasteTracker.recordSignal(prevTrack, ImplicitSignalType.COMPLETE_PLAY);
      }
    }

    let nextIdx = -1;
    if (this.shuffleEnabled && this.queue.length > 1) {
      nextIdx =
        this._nextShuffleIndex >= 0 &&
        this._nextShuffleIndex < this.queue.length &&
        this._nextShuffleIndex !== this.currentIndex
          ? this._nextShuffleIndex
          : this._computeNextShuffleIndex();
    } else if (this.currentIndex + 1 < this.queue.length) {
      nextIdx = this.currentIndex + 1;
    } else if (this.repeatMode === 'ALL') {
      nextIdx = 0;
    }

    if (nextIdx >= 0) {
      this.currentIndex = nextIdx;
      this._computeNextShuffleIndex();
      this._resetFailoverState();
      await this._loadAndPlayTrack(this.currentTrack, 0, true);
      return;
    }

    if (fromEnded && this.storage.settings.autoplayEnabled && this.currentTrack) {
      try {
        const excludeIds = new Set(this.queue.map((t) => t.id));
        const additions = this.recommendations
          ? await this.recommendations.generateNextQueueTracks(
              this.currentTrack,
              12,
              excludeIds,
              this.recentSkippedTracks
            )
          : (await this.api.getRelatedTracks(this.currentTrack))
              .filter((t) => !excludeIds.has(t.id))
              .slice(0, 12);

        if (additions.length > 0) {
          this.queue = [...this.queue, ...additions];
          this.currentIndex += 1;
          this._computeNextShuffleIndex();
          this._resetFailoverState();
          await this._loadAndPlayTrack(this.currentTrack, 0, true);
          return;
        }
      } catch {
        // Ignore
      }
    }

    this.isPlaying = false;
    this._setMediaPlaybackState('paused');
    this._emit();
  }

  async previous() {
    if (this.queue.length === 0) return;
    if ((this.currentTime || 0) > 3) {
      this.seekTo(0);
      return;
    }
    this.unlockGesture({ forcePrime: true });
    if (this.currentIndex > 0) {
      this.currentIndex -= 1;
    } else if (this.repeatMode === 'ALL') {
      this.currentIndex = this.queue.length - 1;
    } else {
      this.seekTo(0);
      return;
    }
    this._computeNextShuffleIndex();
    this._resetFailoverState();
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
    this._computeNextShuffleIndex();
    await this._persistPlayback(true);
    this._prefetchNextTrack();
    this._emit();
  }

  async addTracksToQueue(tracks = []) {
    const cleanList = tracks.map(sanitizeTrack).filter(Boolean);
    if (cleanList.length === 0) return 0;
    if (this.queue.length === 0) {
      await this.playTrack(cleanList[0], cleanList);
      return cleanList.length;
    }
    const existing = new Set(this.queue.map((t) => t.id));
    const additions = cleanList.filter((t) => !existing.has(t.id));
    if (additions.length === 0) return 0;
    this.queue = [...this.queue, ...additions];
    this._computeNextShuffleIndex();
    await this._persistPlayback(true);
    this._prefetchNextTrack();
    this._emit();
    return additions.length;
  }

  async removeFromQueue(index) {
    if (index < 0 || index >= this.queue.length) return;
    if (this.queue.length === 1) {
      await this.clearQueue();
      return;
    }
    const removingCurrent = index === this.currentIndex;
    this.queue.splice(index, 1);
    if (index < this.currentIndex) {
      this.currentIndex -= 1;
    } else if (removingCurrent) {
      this.currentIndex = Math.min(index, this.queue.length - 1);
    }
    this._computeNextShuffleIndex();
    if (removingCurrent && this.currentTrack) {
      this._resetFailoverState();
      await this._loadAndPlayTrack(this.currentTrack, 0, this.isPlaying);
      return;
    }
    await this._persistPlayback(true);
    this._prefetchNextTrack();
    this._emit();
  }

  async moveQueueTrack(fromIndex, toIndex) {
    if (
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= this.queue.length ||
      toIndex >= this.queue.length ||
      fromIndex === toIndex
    ) {
      return;
    }
    const currentId = this.currentTrack?.id;
    const [moved] = this.queue.splice(fromIndex, 1);
    this.queue.splice(toIndex, 0, moved);
    if (currentId) {
      this.currentIndex = this.queue.findIndex((t) => t.id === currentId);
    }
    this._computeNextShuffleIndex();
    await this._persistPlayback(true);
    this._prefetchNextTrack();
    this._emit();
  }

  async clearQueue() {
    this._trackLoadSeq += 1;
    this._primingSilentAudio = false;
    try {
      this.audio.pause();
      this.audio.removeAttribute?.('src');
      this.audio.src = '';
    } catch {
      // Ignore
    }
    this.queue = [];
    this.currentIndex = -1;
    this._nextShuffleIndex = -1;
    this.isPlaying = false;
    this.isBuffering = false;
    this.currentTime = 0;
    this.duration = 0;
    this._setMediaPlaybackState('none');
    await this._persistPlayback(true);
    this._emit();
  }

  async startRadio(track) {
    await this.playTrack(track);
    try {
      const unique = this.recommendations
        ? await this.recommendations.generateNextQueueTracks(track, 20, new Set([track.id]), [])
        : (await this.api.getRelatedTracks(track)).filter((t) => t.id !== track.id).slice(0, 20);
      if (unique.length > 0) {
        this.queue = [this.currentTrack, ...unique];
        this.currentIndex = 0;
        this._computeNextShuffleIndex();
        await this._persistPlayback(true);
        this._prefetchNextTrack();
        this._emit();
      }
    } catch {
      // Keep playing track
    }
  }

  toggleShuffle() {
    this.shuffleEnabled = !this.shuffleEnabled;
    this._computeNextShuffleIndex();
    this._persistPlayback(true);
    this._prefetchNextTrack();
    this._emit();
  }

  cycleRepeat() {
    const order = ['OFF', 'ALL', 'ONE'];
    this.repeatMode = order[(order.indexOf(this.repeatMode) + 1) % order.length];
    this._persistPlayback(true);
    this._prefetchNextTrack();
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
      const steps = 10;
      let step = 0;
      const fadeStepMs = Math.max(100, Math.floor(fadeLeadMs / steps));
      const fadeId = setInterval(() => {
        step++;
        const ratio = Math.max(0, 1 - step / steps);
        this.audio.volume = ratio;
        if (step >= steps) {
          clearInterval(fadeId);
          this.togglePlayPause(false);
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
