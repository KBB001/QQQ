import { ImplicitSignalType } from './recommendations.js';
import { sanitizeTrack } from './security.js';

let ytApiPromise = null;

function loadYouTubeIframeApi() {
  if (globalThis.YT?.Player) return Promise.resolve(globalThis.YT);
  if (ytApiPromise) return ytApiPromise;

  ytApiPromise = new Promise((resolve, reject) => {
    const prevReady = globalThis.onYouTubeIframeAPIReady;
    const timeout = setTimeout(() => {
      reject(new Error('Не удалось загрузить плеер YouTube'));
    }, 10000);

    globalThis.onYouTubeIframeAPIReady = () => {
      clearTimeout(timeout);
      prevReady?.();
      resolve(globalThis.YT);
    };

    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => {
      clearTimeout(timeout);
      ytApiPromise = null;
      reject(new Error('Ошибка загрузки YouTube IFrame API'));
    };
    document.head.appendChild(script);
  });

  return ytApiPromise;
}

export class SonoraPlayer {
  constructor({ api, storage, offline, recommendations, onStateChange, onError }) {
    this.api = api;
    this.storage = storage;
    this.offline = offline;
    this.recommendations = recommendations;
    this.onStateChange = onStateChange;
    this.onError = onError;

    this.audio = new Audio();
    this.audio.setAttribute('playsinline', '');
    this.audio.setAttribute('webkit-playsinline', '');
    this.audio.preload = 'auto';

    this.engine = 'audio'; // 'audio' | 'youtube_iframe'
    this.isOfflineSource = false;
    this.ytPlayer = null;
    this.ytReady = false;
    this.ytPollId = null;

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
      engine: this.engine,
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

  /** Must be called synchronously inside click/tap handler to unlock iOS Safari audio */
  unlockGesture() {
    try {
      if (this.audio.paused && !this.audio.src) {
        this.audio.load();
      }
    } catch {
      // Ignore
    }
  }

  _emit() {
    this.onStateChange?.(this.getSnapshot());
  }

  _stopInactiveEngines(activeEngine) {
    if (activeEngine !== 'audio') {
      try {
        this.audio.pause();
        this.audio.removeAttribute('src');
        this.audio.load();
      } catch {
        // Ignore
      }
    }
    if (activeEngine !== 'youtube_iframe') {
      this._stopYtPolling();
      try {
        if (this.ytReady && this.ytPlayer?.pauseVideo) {
          this.ytPlayer.pauseVideo();
        }
      } catch {
        // Ignore
      }
    }
  }

  _bindAudioEvents() {
    this.audio.addEventListener('play', () => {
      if (this.engine !== 'audio') return;
      this.isPlaying = true;
      this.isBuffering = false;
      this._setMediaPlaybackState('playing');
      this._updatePositionState();
      this._emit();
    });

    this.audio.addEventListener('pause', () => {
      if (this.engine !== 'audio') return;
      this.isPlaying = false;
      this.isBuffering = false;
      this._setMediaPlaybackState('paused');
      this._persistPlayback(true);
      this._emit();
    });

    this.audio.addEventListener('waiting', () => {
      if (this.engine !== 'audio') return;
      this.isBuffering = true;
      this._emit();
    });

    this.audio.addEventListener('canplay', () => {
      if (this.engine !== 'audio') return;
      this.isBuffering = false;
      this._emit();
    });

    this.audio.addEventListener('loadedmetadata', () => {
      if (this.engine !== 'audio') return;
      if (Number.isFinite(this.audio.duration) && this.audio.duration > 0) {
        this.duration = this.audio.duration;
      }
      this.audio.playbackRate = this.playbackSpeed;
      this._updatePositionState();
      this._emit();
    });

    this.audio.addEventListener('timeupdate', () => {
      if (this.engine !== 'audio') return;
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
      if (this.engine !== 'audio') return;
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
      if (this.engine !== 'audio') return;
      const track = this.currentTrack;
      if (!track) return;
      if (!this._retriedCurrentStream && !track.id.startsWith('aud:')) {
        this._retriedCurrentStream = true;
        this.streamCache.delete(track.id);
        await this._startYouTubeIframe(track, this.currentTime, true);
      } else {
        this.isBuffering = false;
        this.isPlaying = false;
        this._emit();
        this.onError?.('Не удалось загрузить поток трека');
      }
    });
  }

  async _ensureYouTubePlayer(videoId, startSeconds = 0, shouldPlay = true) {
    const YT = await loadYouTubeIframeApi();
    if (this.ytPlayer && this.ytReady) {
      if (shouldPlay) {
        this.ytPlayer.loadVideoById({ videoId, startSeconds });
      } else {
        this.ytPlayer.cueVideoById({ videoId, startSeconds });
      }
      this.ytPlayer.setPlaybackRate?.(this.playbackSpeed);
      return;
    }

    await new Promise((resolve, reject) => {
      const host = document.getElementById('yt-player-host');
      if (!host) {
        reject(new Error('Контейнер YouTube плеера не найден'));
        return;
      }
      this.ytPlayer = new YT.Player('yt-player-host', {
        videoId,
        playerVars: {
          autoplay: shouldPlay ? 1 : 0,
          playsinline: 1,
          controls: 1,
          rel: 0,
          modestbranding: 1,
          start: Math.floor(startSeconds)
        },
        events: {
          onReady: (ev) => {
            this.ytReady = true;
            ev.target.setPlaybackRate?.(this.playbackSpeed);
            if (shouldPlay) ev.target.playVideo();
            resolve();
          },
          onStateChange: (ev) => {
            if (this.engine !== 'youtube_iframe') return;
            const state = ev.data;
            if (state === YT.PlayerState.PLAYING) {
              this.isPlaying = true;
              this.isBuffering = false;
              const d = ev.target.getDuration?.() || 0;
              if (d > 0) this.duration = d;
              this._setMediaPlaybackState('playing');
              this._startYtPolling();
              this._emit();
            } else if (state === YT.PlayerState.PAUSED) {
              this.isPlaying = false;
              this.isBuffering = false;
              this._setMediaPlaybackState('paused');
              this._stopYtPolling();
              this._persistPlayback(true);
              this._emit();
            } else if (state === YT.PlayerState.BUFFERING) {
              this.isBuffering = true;
              this._emit();
            } else if (state === YT.PlayerState.ENDED) {
              this.isPlaying = false;
              this._stopYtPolling();
              if (this.currentTrack) {
                this.recommendations?.tasteTracker?.recordSignal(
                  this.currentTrack,
                  ImplicitSignalType.COMPLETE_PLAY
                );
              }
              if (this.repeatMode === 'ONE') {
                this.seekTo(0);
                this.ytPlayer?.playVideo?.();
              } else {
                this.next(true);
              }
            }
          },
          onError: () => {
            if (this.engine !== 'youtube_iframe') return;
            this.isBuffering = false;
            this.isPlaying = false;
            this._emit();
            this.onError?.('Видео недоступно для воспроизведения в этом регионе');
          }
        }
      });
    });
  }

  _startYtPolling() {
    this._stopYtPolling();
    this.ytPollId = setInterval(() => {
      if (this.engine !== 'youtube_iframe' || !this.ytPlayer?.getCurrentTime) return;
      const cur = Number(this.ytPlayer.getCurrentTime()) || 0;
      const dur = Number(this.ytPlayer.getDuration?.()) || 0;
      this.currentTime = cur;
      if (dur > 0) this.duration = dur;
      this._updatePositionState();
      const now = Date.now();
      if (now - this._lastSaveAt > 5000) {
        this._lastSaveAt = now;
        this._persistPlayback(false);
      }
      this._emit();
    }, 300);
  }

  _stopYtPolling() {
    if (this.ytPollId) {
      clearInterval(this.ytPollId);
      this.ytPollId = null;
    }
  }

  async _startYouTubeIframe(track, resumeSeconds = 0, shouldPlay = true) {
    this.engine = 'youtube_iframe';
    this.isOfflineSource = false;
    this._stopInactiveEngines('youtube_iframe');
    this.isBuffering = true;
    this._updateMediaMetadata(track);
    this._emit();

    await this._ensureYouTubePlayer(track.id, resumeSeconds, shouldPlay);
    this.recommendations?.markHeardInSession(track.id);
    await this.storage.recordPlayback(track);
    await this._persistPlayback(true);
    this.loadLyricsForCurrentTrack(track);
  }

  _bindMediaSession() {
    if (!('mediaSession' in navigator)) return;
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
      // Ignore
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

  async playTrack(track, list = null) {
    const clean = sanitizeTrack(track);
    if (!clean) return;
    this.unlockGesture();

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

    this._retriedCurrentStream = false;
    await this._loadAndPlayTrack(this.currentTrack, 0, true);
  }

  async _loadAndPlayTrack(track, resumeSeconds = 0, shouldPlay = true) {
    if (!track) return;
    this.isBuffering = true;
    this.isOfflineSource = false;
    this.currentTime = resumeSeconds;
    this.duration = track.durationSeconds || 0;
    this._updateMediaMetadata(track);
    this._emit();

    try {
      // Check offline cache first so downloaded tracks play immediately without network
      const offlineUrl = await this.offline?.getOfflinePlaybackUrl(track.id);
      if (this.currentTrack?.id !== track.id) return;

      if (offlineUrl) {
        this.engine = 'audio';
        this.isOfflineSource = true;
        this._stopInactiveEngines('audio');
        this.audio.src = offlineUrl;
        this.audio.playbackRate = this.playbackSpeed;
        if (resumeSeconds > 0) this.audio.currentTime = resumeSeconds;
        if (shouldPlay) await this.audio.play();
        this.recommendations?.markHeardInSession(track.id);
        await this.storage.recordPlayback(track);
        await this._persistPlayback(true);
        this.loadLyricsForCurrentTrack(track);
        return;
      }

      const cached = this.streamCache.get(track.id);
      let info;
      if (cached && Date.now() - cached.fetchedAt < 18 * 60 * 1000) {
        info = cached.info;
      } else {
        info = await this.api.getStreamInfo(track.id, this.storage.settings.audioQuality);
        this.streamCache.set(track.id, { fetchedAt: Date.now(), info });
      }

      if (this.currentTrack?.id !== track.id) return;

      if (info.engine === 'youtube_iframe' || !info.streamUrl) {
        await this._startYouTubeIframe(track, resumeSeconds, shouldPlay);
        return;
      }

      this.engine = 'audio';
      this.isOfflineSource = false;
      this._stopInactiveEngines('audio');
      this.audio.src = info.streamUrl;
      this.audio.playbackRate = this.playbackSpeed;
      if (resumeSeconds > 0) {
        this.audio.currentTime = resumeSeconds;
      }
      if (shouldPlay) {
        await this.audio.play();
      }

      this.recommendations?.markHeardInSession(track.id);
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

    if (this.engine === 'youtube_iframe' && this.ytPlayer && this.ytReady) {
      const wantPlay = forcePlay !== null ? forcePlay : !this.isPlaying;
      if (wantPlay) this.ytPlayer.playVideo();
      else this.ytPlayer.pauseVideo();
      return;
    }

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
    if (this.engine === 'youtube_iframe' && this.ytPlayer?.seekTo) {
      this.ytPlayer.seekTo(clamped, true);
    } else if (this.audio.src) {
      try {
        this.audio.currentTime = clamped;
      } catch {
        // Ignore
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

    // Record skip feedback and dynamically adapt upcoming queue
    const prevTrack = this.currentTrack;
    if (!fromEnded && prevTrack && this.recommendations) {
      const dur = this.duration || prevTrack.durationSeconds || 0;
      const pos = this.currentTime || 0;
      const ratio = dur > 0 ? pos / dur : 0;
      if (pos < 25 && ratio < 0.2) {
        this.recentSkippedTracks = [prevTrack, ...this.recentSkippedTracks].slice(0, 4);
        this.recommendations.tasteTracker.recordSignal(prevTrack, ImplicitSignalType.QUICK_SKIP);

        // Soft-rerank upcoming tracks after current index
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
          this._retriedCurrentStream = false;
          await this._loadAndPlayTrack(this.currentTrack, 0, true);
          return;
        }
      } catch {
        // Ignore
      }
    }

    this.isPlaying = false;
    this._emit();
  }

  async previous() {
    if (this.queue.length === 0) return;
    if ((this.currentTime || 0) > 3) {
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
    await this._persistPlayback(true);
    this._emit();
    return additions.length;
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
        await this._persistPlayback(true);
        this._emit();
      }
    } catch {
      // Keep playing track
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
    if (this.engine === 'youtube_iframe' && this.ytPlayer?.setPlaybackRate) {
      this.ytPlayer.setPlaybackRate(this.playbackSpeed);
    }
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
        if (this.ytPlayer?.setVolume) {
          this.ytPlayer.setVolume(Math.round(ratio * 100));
        }
        if (step >= steps) {
          clearInterval(fadeId);
          this.togglePlayPause(false);
          this.audio.volume = 1.0;
          this.ytPlayer?.setVolume?.(100);
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
    this.ytPlayer?.setVolume?.(100);
    this._emit();
  }
}
