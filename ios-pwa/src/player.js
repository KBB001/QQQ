import { ImplicitSignalType } from './recommendations.js';
import { formatUserErrorRu, sanitizeTrack } from './security.js';

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
    this.maxExtractorRetries = 5;
    this._consecutiveTrackErrors = 0;
    this._trackLoadSeq = 0;
    this._realSrcSeq = 0;
    this._ignoreErrorsForSeq = -1;
    this._lastErrorForSeq = -1;
    this._isRecoveringError = false;
    this._stallTimer = null;
    this._pendingSeekSeconds = 0;
    this._lastSaveAt = 0;

    this._activeSession = null;
    this._silentWavUrl = '';
    this._primingSilentAudio = false;
    this._audioUnlocked = false;
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

  _startListeningSession(track, seq) {
    if (!track) {
      this._activeSession = null;
      return;
    }
    this._activeSession = {
      seq,
      track,
      playCounted: false,
      outcomeRecorded: false,
      seeked: false,
      listenedMs: 0,
      lastActiveTickAt: 0
    };
  }

  async _commitSessionStart(track, seq) {
    const s = this._activeSession;
    if (!s || s.seq !== seq || s.track?.id !== track?.id || s.playCounted) return;
    s.playCounted = true;
    s.lastActiveTickAt = Date.now();
    this.recommendations?.markHeardInSession?.(track.id);
    await this.storage?.recordTrackPlayStart?.(track);
  }

  async _finalizeListeningSession(reason = 'switch') {
    const s = this._activeSession;
    if (!s || s.outcomeRecorded || !s.playCounted) return;
    s.outcomeRecorded = true;
    const track = s.track;
    const dur = this.duration || track.durationSeconds || 0;
    const pos = this.currentTime || 0;
    const effectiveListenedSec =
      s.listenedMs > 0 ? s.listenedMs / 1000 : s.seeked ? 0 : pos;

    if (reason === 'ended') {
      await this.recommendations?.tasteTracker?.recordSignal(
        track,
        this.repeatMode === 'ONE'
          ? ImplicitSignalType.REPEAT_PLAY
          : ImplicitSignalType.COMPLETE_PLAY
      );
      await this.storage?.recordTrackSessionOutcome?.(track, {
        listenedSeconds: Math.max(effectiveListenedSec, dur > 0 ? Math.min(dur, effectiveListenedSec || dur) : effectiveListenedSec),
        completed: true
      });
      return;
    }

    const ratio = dur > 0 ? effectiveListenedSec / dur : 0;
    const completed = effectiveListenedSec >= 25 && (ratio >= 0.65 || (dur <= 0 && effectiveListenedSec >= 45));
    const quickSkipped = !completed && effectiveListenedSec < 30 && (dur <= 0 || ratio < 0.25);

    if (quickSkipped) {
      this.recentSkippedTracks = [track, ...this.recentSkippedTracks].slice(0, 4);
      await this.recommendations?.tasteTracker?.recordSignal(track, ImplicitSignalType.QUICK_SKIP);
      await this.storage?.recordTrackSessionOutcome?.(track, {
        listenedSeconds: effectiveListenedSec,
        quickSkipped: true
      });
    } else if (!completed) {
      await this.recommendations?.tasteTracker?.recordSignal(track, ImplicitSignalType.PARTIAL_SKIP);
      await this.storage?.recordTrackSessionOutcome?.(track, {
        listenedSeconds: effectiveListenedSec,
        partialSkipped: true
      });
    } else {
      this.recentSkippedTracks = [];
      await this.recommendations?.tasteTracker?.recordSignal(track, ImplicitSignalType.COMPLETE_PLAY);
      await this.storage?.recordTrackSessionOutcome?.(track, {
        listenedSeconds: effectiveListenedSec,
        completed: true
      });
    }
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
    const silentUrl = this._getSilentWavUrl();
    if (this._audioUnlocked) return;
    try {
      if (this.audio.paused && !this.audio.src && (forcePrime || !this._audioUnlocked)) {
        if (silentUrl) {
          this._primingSilentAudio = true;
          this.audio.src = silentUrl;
          const p = this.audio.play?.();
          if (p && typeof p.then === 'function') {
            p.then(() => {
              this._audioUnlocked = true;
            }).catch(() => {
              this._primingSilentAudio = false;
            });
          } else {
            this._audioUnlocked = true;
          }
        } else {
          this.audio.load?.();
          this._audioUnlocked = true;
        }
      }
    } catch {
      this._primingSilentAudio = false;
    }
  }

  _emit() {
    this.onStateChange?.(this.getSnapshot());
  }

  _clearStallWatchdog() {
    if (this._stallTimer) {
      clearTimeout(this._stallTimer);
      this._stallTimer = null;
    }
  }

  _armStallWatchdog() {
    this._clearStallWatchdog();
    if (this.isOfflineSource || !this.currentTrack || !this.audio.src || this.audio.paused) return;
    const seq = this._trackLoadSeq;
    const srcSeq = this._realSrcSeq;
    const startPos = Number(this.audio.currentTime) || 0;
    this._stallTimer = setTimeout(() => {
      this._stallTimer = null;
      if (this._trackLoadSeq !== seq || this._realSrcSeq !== srcSeq) return;
      if (this.audio.paused || this.isOfflineSource || !this.currentTrack) return;
      const curPos = Number(this.audio.currentTime) || 0;
      if (Math.abs(curPos - startPos) < 0.25) {
        this._handleAudioError();
      }
    }, 8500);
    this._stallTimer.unref?.();
  }

  _resetFailoverState() {
    this._clearStallWatchdog();
    this.activeStreamCandidates = [];
    this.candidateIndex = 0;
    this.activeSourceKey = null;
    this.failedGateways = new Set();
    this.extractorRetries = 0;
    this._pendingSeekSeconds = 0;
    this._isRecoveringError = false;
  }

  _assignAudioSrc(url) {
    this._clearStallWatchdog();
    this._ignoreErrorsForSeq = this._realSrcSeq;
    try {
      if (this.audio.src && !this.audio.paused) {
        this.audio.pause();
      }
    } catch {
      // Ignore
    }
    this._realSrcSeq += 1;
    this._primingSilentAudio = false;
    this.audio.src = url;
    this.audio.playbackRate = this.playbackSpeed;
  }

  _isSilentPrimerEvent() {
    return (
      this._primingSilentAudio ||
      (this._silentWavUrl && this.audio.src === this._silentWavUrl)
    );
  }

  _bindVisibilityListener() {
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden' && this.currentTrack) {
          this._ensurePlaybackAudioSession();
          this._updateMediaMetadata(this.currentTrack);
          this._setMediaPlaybackState(this.isPlaying ? 'playing' : 'paused');
          this._updatePositionState();
          this._persistPlayback(true);
        }
      });
    }
    if (typeof window !== 'undefined' && window.addEventListener) {
      const saveNow = () => {
        if (this.currentTrack) this._persistPlayback(true);
      };
      window.addEventListener('pagehide', saveNow);
      window.addEventListener('beforeunload', saveNow);
    }
  }

  _bindAudioEvents() {
    const onActivePlay = () => {
      if (this._isSilentPrimerEvent()) return;
      this._ensurePlaybackAudioSession();
      this._audioUnlocked = true;
      this.isPlaying = true;
      this.isBuffering = false;
      if (this._activeSession && this.currentTrack?.id === this._activeSession.track?.id) {
        this._activeSession.lastActiveTickAt = Date.now();
        if (!this._activeSession.playCounted) {
          this._commitSessionStart(this._activeSession.track, this._activeSession.seq);
        }
      }
      this._updateMediaMetadata(this.currentTrack);
      this._setMediaPlaybackState('playing');
      this._updatePositionState();
      this._emit();
    };

    this.audio.addEventListener('play', onActivePlay);
    this.audio.addEventListener('playing', onActivePlay);

    this.audio.addEventListener('pause', () => {
      if (this._isSilentPrimerEvent()) return;
      this._clearStallWatchdog();
      this.isPlaying = false;
      this.isBuffering = false;
      if (this._activeSession) {
        this._activeSession.lastActiveTickAt = 0;
      }
      this._setMediaPlaybackState('paused');
      this._persistPlayback(true);
      this._emit();
    });

    this.audio.addEventListener('waiting', () => {
      if (this._isSilentPrimerEvent()) return;
      this.isBuffering = true;
      if (this._activeSession) {
        this._activeSession.lastActiveTickAt = 0;
      }
      this._armStallWatchdog();
      this._emit();
    });

    this.audio.addEventListener('stalled', () => {
      if (this._isSilentPrimerEvent()) return;
      this._armStallWatchdog();
    });

    this.audio.addEventListener('canplay', () => {
      if (this._isSilentPrimerEvent()) return;
      this._clearStallWatchdog();
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
      if (
        this._pendingSeekSeconds > 0 &&
        (!Number.isFinite(this.audio.duration) ||
          this.audio.duration <= 0 ||
          this._pendingSeekSeconds < this.audio.duration - 1)
      ) {
        try {
          this.audio.currentTime = this._pendingSeekSeconds;
        } catch {
          // Ignore seek before ready
        }
      }
      this._pendingSeekSeconds = 0;
      this.audio.playbackRate = this.playbackSpeed;
      this._updatePositionState();
      this._emit();
    });

    this.audio.addEventListener('timeupdate', () => {
      if (this._isSilentPrimerEvent()) return;
      this._clearStallWatchdog();
      this.currentTime = this.audio.currentTime || 0;
      if (Number.isFinite(this.audio.duration) && this.audio.duration > 0) {
        this.duration = this.audio.duration;
      }
      const now = Date.now();
      if (this._activeSession && this.isPlaying && !this.audio.paused) {
        if (this._activeSession.lastActiveTickAt > 0) {
          const delta = Math.max(0, Math.min(2500, now - this._activeSession.lastActiveTickAt));
          this._activeSession.listenedMs += delta;
        }
        this._activeSession.lastActiveTickAt = now;
        if (this._activeSession.listenedMs >= 5000 || this.currentTime >= 5) {
          this._consecutiveTrackErrors = 0;
        }
      }
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
      this._clearStallWatchdog();
      if (!this.currentTrack || !this.audio.src) return;

      // Guard against truncated/broken proxy streams ending after 1-8s on a full-length track
      const audioDur = Number(this.audio.duration);
      const expectedDur = Number(this.currentTrack?.durationSeconds) || 0;
      const effectiveDur = Number.isFinite(audioDur) && audioDur > 0 ? audioDur : expectedDur;
      const pos = Number(this.audio.currentTime) || 0;
      const listenedMs = this._activeSession?.listenedMs || 0;
      const isTruncatedChunk =
        effectiveDur > 15 &&
        pos > 0.2 &&
        pos < effectiveDur - 8 &&
        pos < effectiveDur * 0.85 &&
        listenedMs < Math.max(12000, effectiveDur * 500);
      if (
        isTruncatedChunk ||
        (Number.isFinite(audioDur) && audioDur > 0 && audioDur < 2.5 && expectedDur > 10 && listenedMs < 3000)
      ) {
        await this._handleAudioError();
        return;
      }

      this.isPlaying = false;
      const finished = this.currentTrack;
      await this._finalizeListeningSession('ended');
      if (this.repeatMode === 'ONE' && finished) {
        this._startListeningSession(finished, this._trackLoadSeq);
        this.seekTo(0);
        try {
          await this.audio.play();
          await this._commitSessionStart(finished, this._trackLoadSeq);
        } catch {
          // Ignore
        }
        return;
      }
      await this.next(true);
    });

    this.audio.addEventListener('error', async () => {
      if (this._isSilentPrimerEvent()) {
        this._primingSilentAudio = false;
        return;
      }
      if (!this.audio.src || this._ignoreErrorsForSeq === this._realSrcSeq) {
        return;
      }
      this._clearStallWatchdog();
      this._lastErrorForSeq = this._realSrcSeq;
      await this._handleAudioError();
    });
  }

  async _tryPlayCandidateUrl(url, seq, resumeFromSeconds = 0) {
    this.isBuffering = true;
    this._pendingSeekSeconds = resumeFromSeconds >= 8 ? resumeFromSeconds : 0;
    this._emit();
    this._assignAudioSrc(url);
    const assignedSeq = this._realSrcSeq;

    try {
      await this.audio.play();
      this._audioUnlocked = true;
      if (this._trackLoadSeq !== seq) return 'aborted';
      if (this._lastErrorForSeq === assignedSeq) return 'failed';
      return 'ok';
    } catch (err) {
      if (err?.name === 'NotAllowedError') {
        this.isPlaying = false;
        this.isBuffering = false;
        this._emit();
        return 'blocked';
      }
      if (err?.name === 'AbortError') {
        if (this._trackLoadSeq !== seq) return 'aborted';
        if (this._lastErrorForSeq === assignedSeq) return 'failed';
        return 'aborted';
      }
      return 'failed';
    }
  }

  async _handleAudioError() {
    if (this._isRecoveringError) return;
    const track = this.currentTrack;
    if (!track || !this.audio.src || this.isOfflineSource) {
      this.isBuffering = false;
      this.isPlaying = false;
      this._emit();
      return;
    }

    this._isRecoveringError = true;
    const seq = this._trackLoadSeq;
    const resumePos = Number(this.currentTime) || 0;

    try {
      while (this._trackLoadSeq === seq && this.currentTrack?.id === track.id) {
        // 1. Try remaining URL candidates from the current extractor
        while (this.candidateIndex + 1 < this.activeStreamCandidates.length) {
          this.candidateIndex += 1;
          const nextUrl = this.activeStreamCandidates[this.candidateIndex];
          const status = await this._tryPlayCandidateUrl(nextUrl, seq, resumePos);
          if (status === 'ok' || status === 'blocked' || status === 'aborted') {
            return;
          }
        }

        // 2. Exhausted candidates on this gateway -> report failure & rotate to next extractor
        if (this.activeSourceKey) {
          this.failedGateways.add(this.activeSourceKey);
          this.api.reportStreamFailure?.(this.activeSourceKey);
        }

        if (this.extractorRetries >= this.maxExtractorRetries || track.id.startsWith('aud:')) {
          break;
        }

        this.extractorRetries += 1;
        this.streamCache.delete(track.id);
        this.isBuffering = true;
        this._emit();

        let freshInfo = null;
        try {
          freshInfo = await this.api.getStreamInfo(track.id, this.storage.settings.audioQuality, {
            excludeGateways: this.failedGateways
          });
        } catch {
          if (this._trackLoadSeq !== seq) return;
          break;
        }

        if (this._trackLoadSeq !== seq || this.currentTrack?.id !== track.id) return;

        const candidates =
          Array.isArray(freshInfo?.streamCandidates) && freshInfo.streamCandidates.length > 0
            ? freshInfo.streamCandidates
            : [freshInfo?.streamUrl].filter(Boolean);

        if (candidates.length === 0) {
          break;
        }

        this.streamCache.set(track.id, { fetchedAt: Date.now(), info: freshInfo });
        this.activeStreamCandidates = candidates;
        this.candidateIndex = 0;
        this.activeSourceKey = freshInfo.sourceKey || null;
        this.sourceType = freshInfo.sourceType || 'audio';

        const status = await this._tryPlayCandidateUrl(candidates[0], seq, resumePos);
        if (status === 'ok' || status === 'blocked' || status === 'aborted') {
          return;
        }
      }

      if (this._trackLoadSeq !== seq || this.currentTrack?.id !== track.id) return;

      // 3. Dead track in a multi-track queue -> skip cleanly at most once before pausing with error
      this._consecutiveTrackErrors += 1;
      const hasNext =
        this.queue.length > 1 &&
        (this.currentIndex + 1 < this.queue.length || this.repeatMode === 'ALL' || this.shuffleEnabled);

      if (hasNext && this._consecutiveTrackErrors < 2) {
        this._isRecoveringError = false;
        this.onError?.(`Поток «${track.title}» недоступен — переключаем на следующий трек`);
        await this.next(true);
        return;
      }

      this.isBuffering = false;
      this.isPlaying = false;
      this._emit();
      this.onError?.(
        formatUserErrorRu(
          null,
          'Не удалось загрузить поток без рекламы. Попробуйте другой трек или проверьте источники в Настройках.'
        )
      );
    } finally {
      this._isRecoveringError = false;
    }
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
        album: track.album || 'Sonora',
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
    } else {
      await this._finalizeListeningSession('switch');
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

    this._consecutiveTrackErrors = 0;
    this._computeNextShuffleIndex();
    this._resetFailoverState();
    await this._loadAndPlayTrack(this.currentTrack, 0, true);
  }

  async _loadAndPlayTrack(track, resumeSeconds = 0, shouldPlay = true, { countSession = true } = {}) {
    if (!track) return;
    const seq = ++this._trackLoadSeq;
    this._ensurePlaybackAudioSession();
    this.isBuffering = true;
    this.isOfflineSource = false;
    this.sourceType = 'audio';
    this.currentTime = resumeSeconds;
    this.duration = track.durationSeconds || 0;
    this._pendingSeekSeconds = resumeSeconds > 0 ? resumeSeconds : 0;

    if (countSession) {
      this._startListeningSession(track, seq);
    }

    this._updateMediaMetadata(track);
    this._emit();

    try {
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
        this._assignAudioSrc(offlineUrl);
        if (shouldPlay) {
          try {
            await this.audio.play();
            this._audioUnlocked = true;
            if (this._trackLoadSeq !== seq || this.currentTrack?.id !== track.id) return;
            this._consecutiveTrackErrors = 0;
            await this._commitSessionStart(track, seq);
          } catch (playErr) {
            if (playErr?.name === 'AbortError') return;
            if (playErr?.name === 'NotAllowedError') {
              this.isPlaying = false;
              this.isBuffering = false;
              this._emit();
              await this._persistPlayback(true);
              return;
            }
            throw playErr;
          }
        }
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

      // Enrich active track metadata if stream probe returned album/year/genre/tags
      if (info && (info.album || info.year || info.genre || info.moodTags?.length)) {
        const enriched = sanitizeTrack({
          ...track,
          album: track.album || info.album,
          year: track.year || info.year,
          genre: track.genre || info.genre,
          moodTags: track.moodTags?.length ? track.moodTags : info.moodTags
        });
        if (enriched && this.queue[this.currentIndex]?.id === enriched.id) {
          this.queue[this.currentIndex] = enriched;
          if (this._activeSession?.track?.id === enriched.id) {
            this._activeSession.track = enriched;
          }
          this._updateMediaMetadata(enriched);
        }
      }

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

      this._assignAudioSrc(candidates[0]);
      if (shouldPlay) {
        try {
          await this.audio.play();
          this._audioUnlocked = true;
          if (this._trackLoadSeq !== seq || this.currentTrack?.id !== track.id) return;
          await this._commitSessionStart(this.currentTrack || track, seq);
        } catch (playErr) {
          if (playErr?.name === 'AbortError') return;
          if (playErr?.name === 'NotAllowedError') {
            this.isPlaying = false;
            this.isBuffering = false;
            this._emit();
            await this._persistPlayback(true);
            return;
          }
          // Try remaining stream candidates & backup gateways before failing this track
          await this._handleAudioError();
          return;
        }
      }

      await this._persistPlayback(true);
      this.loadLyricsForCurrentTrack(track);
      this._prefetchNextTrack();
    } catch (err) {
      if (err?.name === 'AbortError') return;
      if (this._trackLoadSeq !== seq || this.currentTrack?.id !== track.id) return;
      this._consecutiveTrackErrors += 1;
      const hasNext =
        this.queue.length > 1 &&
        (this.currentIndex + 1 < this.queue.length || this.repeatMode === 'ALL' || this.shuffleEnabled);
      if (shouldPlay && hasNext && this._consecutiveTrackErrors < 2) {
        this.onError?.(`Трек «${track.title}» недоступен — переходим к следующему`);
        await this.next(true);
        return;
      }
      this.isBuffering = false;
      this.isPlaying = false;
      this._emit();
      this.onError?.(formatUserErrorRu(err, 'Ошибка загрузки аудиопотока без рекламы'));
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

    // Resume an existing restored-after-reload or paused track cleanly without inflating playCount
    if (!this.audio.src || (this._silentWavUrl && this.audio.src === this._silentWavUrl)) {
      this.unlockGesture({ forcePrime: true });
      this._resetFailoverState();
      const hasExistingSession =
        this._activeSession && this._activeSession.track?.id === track.id;
      await this._loadAndPlayTrack(track, this.currentTime, true, {
        countSession: !hasExistingSession && (this.currentTime || 0) <= 0
      });
      return;
    }

    try {
      await this.audio.play();
    } catch {
      this.unlockGesture({ forcePrime: true });
      this._resetFailoverState();
      await this._loadAndPlayTrack(track, this.currentTime, true, { countSession: false });
    }
  }

  seekTo(seconds) {
    const dur = this.duration || this.currentTrack?.durationSeconds || 0;
    const clamped = Math.max(0, dur > 0 ? Math.min(dur, seconds) : seconds);
    if (this._activeSession && Math.abs(clamped - (this.currentTime || 0)) > 4) {
      this._activeSession.seeked = true;
    }
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
    if (!fromEnded) {
      await this._finalizeListeningSession('switch');
      if (
        prevTrack &&
        this.recommendations &&
        !this.shuffleEnabled &&
        this.currentIndex + 2 < this.queue.length &&
        this.recentSkippedTracks.length > 0
      ) {
        const head = this.queue.slice(0, this.currentIndex + 1);
        const tail = this.queue.slice(this.currentIndex + 1);
        const reranked = this.recommendations.softRerankUpcoming(
          tail,
          prevTrack,
          this.recentSkippedTracks
        );
        this.queue = [...head, ...reranked];
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
    await this._finalizeListeningSession('switch');
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
    if (removingCurrent) {
      await this._finalizeListeningSession('switch');
    }
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
    this._activeSession = null;
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
