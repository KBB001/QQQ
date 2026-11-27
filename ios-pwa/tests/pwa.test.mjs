import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BackupCipher,
  buildBackupPayload,
  escapeHtml,
  normalizeBackupPayload,
  parseExternalYouTubeImport,
  sanitizeHttpsUrl
} from '../src/security.js';
import {
  extractPlaylistId,
  extractVideoId,
  parseLrcLines,
  selectBestIosAudioStream,
  SonoraApi
} from '../src/api.js';
import { SonoraOfflineManager, formatBytesRu } from '../src/offline.js';
import {
  ImplicitSignalType,
  MoodCategory,
  SmartRecommendationEngine,
  TrackMoodProfiler
} from '../src/recommendations.js';
import { SonoraStorage } from '../src/storage.js';

test('BackupCipher encrypts and decrypts with Android-compatible sonora-enc:v1 envelope', async () => {
  const sample = JSON.stringify({
    version: 2,
    exportedAt: 1730000000000,
    favorites: [{ id: 'dQw4w9WgXcQ', title: 'Test', artist: 'Artist', durationSeconds: 212 }],
    history: [],
    playlists: []
  });

  const encrypted = await BackupCipher.encrypt(sample, 'Secret123!');
  assert.equal(BackupCipher.isEncryptedBackup(encrypted), true);

  const parsed = JSON.parse(encrypted);
  assert.equal(parsed.format, 'sonora-enc:v1');
  assert.equal(parsed.kdf, 'PBKDF2WithHmacSHA256');
  assert.equal(parsed.iterations, 120000);

  const decrypted = await BackupCipher.decrypt(encrypted, 'Secret123!');
  assert.equal(decrypted, sample);

  await assert.rejects(() => BackupCipher.decrypt(encrypted, 'WrongPassword'));

  parsed.ciphertext = `${parsed.ciphertext.slice(0, -4)}AAAA`;
  await assert.rejects(() => BackupCipher.decrypt(JSON.stringify(parsed), 'Secret123!'));
});

test('sanitizeHttpsUrl blocks HTTP and dangerous URI schemes while normalizing HTTPS', () => {
  assert.equal(sanitizeHttpsUrl('https://music.youtube.com/watch?v=abc'), 'https://music.youtube.com/watch?v=abc');
  assert.equal(sanitizeHttpsUrl('//i.ytimg.com/vi/abc/hqdefault.jpg'), 'https://i.ytimg.com/vi/abc/hqdefault.jpg');
  assert.equal(sanitizeHttpsUrl('http://insecure.example.com/stream.m4a'), null);
  assert.equal(sanitizeHttpsUrl('javascript:alert(1)'), null);
  assert.equal(sanitizeHttpsUrl('data:text/html,<script>alert(1)</script>'), null);
  assert.equal(sanitizeHttpsUrl(''), null);
});

test('escapeHtml neutralizes HTML injection characters', () => {
  assert.equal(
    escapeHtml(`<img src=x onerror="alert('xss')">`),
    '&lt;img src=x onerror=&quot;alert(&#39;xss&#39;)&quot;&gt;'
  );
});

test('normalizeBackupPayload and SonoraStorage import/export round-trip Android backups', async () => {
  const androidV2 = {
    version: 2,
    exportedAt: 1730000000000,
    favorites: [
      {
        id: 'abc123def45',
        title: 'Track One',
        artist: 'Artist A',
        durationSeconds: 185,
        thumbnailUrl: 'http://bad.example.com/cover.jpg'
      }
    ],
    history: [],
    playlists: [
      {
        name: 'Roadtrip',
        description: 'Night drive',
        tracks: [{ id: 'xyz987uvw12', title: 'Track Two', artist: 'Artist B', durationSeconds: 200 }],
        youtubePlaylistId: 'PL1234567890'
      }
    ],
    searchHistory: ['lofi', '<script>']
  };

  const normalized = normalizeBackupPayload(androidV2);
  assert.equal(normalized.favorites[0].thumbnailUrl, '');
  assert.equal(normalized.playlists[0].youtubePlaylistId, 'PL1234567890');

  const storage = new SonoraStorage();
  await storage.init();
  const stats = await storage.importBackupObject(androidV2);
  assert.equal(stats.tracksRestored, 1);
  assert.equal(stats.playlistsRestored, 1);

  const exported = buildBackupPayload({
    favorites: storage.library.favorites,
    history: storage.library.history,
    playlists: storage.library.playlists,
    searchHistory: storage.library.searchHistory,
    settings: storage.settings,
    playback: null
  });
  assert.equal(exported.version, 2);
  assert.equal(exported.favorites.length, 1);
  assert.equal(exported.playlists[0].name, 'Roadtrip');
});

test('parseExternalYouTubeImport parses sonora-yt-sync:v1, Takeout watch-history.json, and Takeout CSV', () => {
  const syncJson = JSON.stringify({
    format: 'sonora-yt-sync:v1',
    account: { id: '@test', name: 'Test User', avatarUrl: 'https://lh3.googleusercontent.com/a.jpg' },
    likedTracks: [{ id: 'dQw4w9WgXcQ', title: 'Liked Song', artist: 'Artist' }],
    historyTracks: [{ id: '1N8hOpMqvYs', title: 'Recent Song', artist: 'Artist 2' }],
    playlists: [{ id: 'PL12345678', name: 'Workout', tracks: [{ id: 'dQw4w9WgXcQ', title: 'Liked Song', artist: 'Artist' }] }]
  });
  const syncParsed = parseExternalYouTubeImport(syncJson);
  assert.equal(syncParsed.kind, 'yt_sync');
  assert.equal(syncParsed.account.name, 'Test User');
  assert.equal(syncParsed.likedTracks.length, 1);
  assert.equal(syncParsed.playlists[0].name, 'Workout');

  const takeoutJson = JSON.stringify([
    { title: 'Watched Midnight City', titleUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', subtitles: [{ name: 'M83 - Topic' }] }
  ]);
  const takeoutParsed = parseExternalYouTubeImport(takeoutJson);
  assert.equal(takeoutParsed.historyTracks.length, 1);
  assert.equal(takeoutParsed.historyTracks[0].title, 'Midnight City');
  assert.equal(takeoutParsed.historyTracks[0].artist, 'M83');

  const csvText = [
    'Video ID,Playlist Video Creation Timestamp,Title,Channel',
    'dQw4w9WgXcQ,2026-01-01T00:00:00Z,"Song, Quoted",Artist X',
    '1N8hOpMqvYs,2026-01-02T00:00:00Z,Another Song,Artist Y'
  ].join('\n');
  const csvParsed = parseExternalYouTubeImport(csvText, 'My Takeout Mix');
  assert.equal(csvParsed.playlists[0].name, 'My Takeout Mix');
  assert.equal(csvParsed.playlists[0].tracks.length, 2);
  assert.equal(csvParsed.playlists[0].tracks[0].title, 'Song, Quoted');
});

test('extractVideoId and extractPlaylistId parse YouTube, YouTube Music, and relative Piped URLs', () => {
  assert.equal(extractVideoId('https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=RDAMVM'), 'dQw4w9WgXcQ');
  assert.equal(extractVideoId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractVideoId('/watch?v=1N8hOpMqvYs'), '1N8hOpMqvYs');
  assert.equal(extractVideoId('/watch?v=1N8hOpMqvYs', { allowBareId: false }), null);
  assert.equal(extractVideoId('not-a-video-url'), null);
  assert.equal(extractVideoId('not-a-video', { allowBareId: false }), null);

  assert.equal(
    extractPlaylistId('https://music.youtube.com/playlist?list=OLAK5uy_n9abcDEF12345'),
    'OLAK5uy_n9abcDEF12345'
  );
  assert.equal(
    extractPlaylistId('/playlist?list=PLXIclLvfETS0GFbNbRpwCgh1CGwO6hLrv'),
    'PLXIclLvfETS0GFbNbRpwCgh1CGwO6hLrv'
  );
  assert.equal(extractPlaylistId('PLabcdefgh123456'), 'PLabcdefgh123456');
});

test('SonoraStorage supports creating/renaming playlists and local profile switching without cookies', async () => {
  const storage = new SonoraStorage();
  await storage.init();
  const pl = await storage.createPlaylist('Favorites Mix', 'Chill');
  await storage.renamePlaylist(pl.id, 'Night Drive', 'Late night vibes');
  const updated = storage.library.playlists.find((p) => p.id === pl.id);
  assert.equal(updated.name, 'Night Drive');
  assert.equal(updated.description, 'Late night vibes');

  await storage.upsertAccount({ id: 'acc1', name: 'Main YT' });
  await storage.upsertAccount({ id: 'acc2', name: 'Brand YT' });
  assert.equal(storage.accounts.length, 2);
  assert.equal(storage.activeAccount.id, 'acc2');

  await storage.switchAccount('acc1');
  assert.equal(storage.activeAccount.id, 'acc1');
  await storage.removeAccount('acc1');
  assert.equal(storage.accounts.length, 1);
  assert.equal(storage.activeAccount.id, 'acc2');
});

test('selectBestIosAudioStream prioritizes M4A/AAC over WebM and respects HTTPS', () => {
  const streams = [
    { url: 'http://cdn.example.com/audio.m4a', mimeType: 'audio/mp4', codec: 'mp4a.40.2', bitrate: 256000 },
    { url: 'https://cdn.example.com/high.webm', mimeType: 'audio/webm', codec: 'opus', bitrate: 160000 },
    { url: 'https://cdn.example.com/med.m4a', mimeType: 'audio/mp4', codec: 'mp4a.40.2', bitrate: 128000 },
    { url: 'https://cdn.example.com/low.m4a', mimeType: 'audio/mp4', codec: 'mp4a.40.2', bitrate: 48000 }
  ];

  const high = selectBestIosAudioStream(streams, null, 'HIGH');
  assert.equal(high?.url, 'https://cdn.example.com/med.m4a');
  assert.equal(high?.isM4aCompatible, true);

  const low = selectBestIosAudioStream(streams, null, 'LOW');
  assert.equal(low?.url, 'https://cdn.example.com/low.m4a');

  const hlsFallback = selectBestIosAudioStream(
    [{ url: 'https://cdn.example.com/opus.webm', mimeType: 'audio/webm', codec: 'opus', bitrate: 128000 }],
    'https://cdn.example.com/playlist.m3u8',
    'HIGH'
  );
  assert.equal(hlsFallback?.url, 'https://cdn.example.com/playlist.m3u8');
});

test('parseLrcLines parses timestamps and sorts lyrics chronologically', () => {
  const lines = parseLrcLines('[01:12.50]Second line\n[00:05.25]First line\n[invalid]Ignored');
  assert.equal(lines.length, 2);
  assert.equal(lines[0].text, 'First line');
  assert.ok(Math.abs(lines[0].timeSeconds - 5.25) < 0.01);
  assert.equal(lines[1].text, 'Second line');
});

test('SmartRecommendationEngine builds personalized mixes and demotes quick-skipped moods', async () => {
  const storage = new SonoraStorage();
  await storage.init();
  const profiler = new TrackMoodProfiler();
  assert.equal(profiler.profile({ title: 'Midnight Synthwave Drive', artist: 'Kavinsky', durationSeconds: 210 }).mood, MoodCategory.NIGHT_SYNTH);
  assert.equal(profiler.profile({ title: 'Lo-Fi Study Beats', artist: 'ChilledCow', durationSeconds: 180 }).mood, MoodCategory.CHILL_FOCUS);

  const engine = new SmartRecommendationEngine({ api: null, storage });
  const lofi1 = { id: 'lofi0000001', title: 'Lo-Fi Rain Study', artist: 'Chill', durationSeconds: 190 };
  const lofi2 = { id: 'lofi0000002', title: 'Lofi Coffee Ambient', artist: 'Chill', durationSeconds: 200 };
  const phonk1 = { id: 'phonk000001', title: 'Gym Phonk Drift', artist: 'Aggressive', durationSeconds: 140 };
  const phonk2 = { id: 'phonk000002', title: 'Workout Hardstyle Bass', artist: 'Aggressive', durationSeconds: 145 };

  await engine.tasteTracker.recordSignal(lofi1, ImplicitSignalType.COMPLETE_PLAY);
  await engine.tasteTracker.recordSignal(phonk1, ImplicitSignalType.QUICK_SKIP);
  await engine.tasteTracker.recordSignal(phonk2, ImplicitSignalType.QUICK_SKIP);

  const reranked = engine.softRerankUpcoming(
    [phonk2, lofi2],
    lofi1,
    [phonk1, phonk2]
  );
  assert.equal(reranked[0].id, lofi2.id);

  const mixes = engine.buildPersonalizedMixes([lofi1, lofi2, phonk1, phonk2]);
  assert.ok(mixes.dailyMixTracks.length >= 2);
  assert.ok(mixes.madeForYou.length >= 1);
});

test('SonoraOfflineManager.downloadTrackWithCandidates prioritizes CORS-friendly URLs without a server', async () => {
  const storage = new SonoraStorage();
  await storage.init();
  const mgr = new SonoraOfflineManager(storage);
  const triedUrls = [];
  mgr.downloadTrack = async (_track, url) => {
    triedUrls.push(url);
    return 4096;
  };
  const bytes = await mgr.downloadTrackWithCandidates(
    { id: 'dQw4w9WgXcQ', title: 'Track', artist: 'Artist' },
    [
      'https://rr1.googlevideo.com/videoplayback',
      'https://invidious.nerdvpn.de/latest_version?id=dQw4w9WgXcQ&itag=140&local=true'
    ]
  );
  assert.equal(bytes, 4096);
  assert.ok(triedUrls[0].includes('local=true'));
  assert.equal(formatBytesRu(0), '0 КБ');
  assert.equal(formatBytesRu(5242880), '5.0 МБ');
});

test('SonoraApi uses zero-server parallel Piped/Invidious/Audius pools and never falls back to youtube_iframe', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      const s = String(url);
      if (s.includes('piped-instances.kavin.rocks') || s.includes('api.invidious.io')) {
        throw new Error('directory timeout');
      }
      if (s.startsWith('https://custom-piped.example.com/streams/')) {
        return new Response(
          JSON.stringify({
            title: 'Ad-Free Piped Song',
            uploader: 'Artist',
            duration: 180,
            audioStreams: [
              {
                url: 'https://rr1.googlevideo.com/audio.m4a',
                bitrate: 128000,
                mimeType: 'audio/mp4',
                codec: 'mp4a.40.2'
              }
            ]
          }),
          { status: 200 }
        );
      }
      if (s.startsWith('https://invidious.nerdvpn.de/api/v1/videos/')) {
        return new Response(
          JSON.stringify({
            title: 'Invidious Song',
            author: 'Inv Artist',
            lengthSeconds: 200,
            adaptiveFormats: [
              {
                url: 'https://rr2---sn.googlevideo.com/videoplayback?mime=audio/mp4',
                bitrate: '130000',
                type: 'audio/mp4; codecs="mp4a.40.2"',
                encoding: 'aac'
              }
            ]
          }),
          { status: 200 }
        );
      }
      if (s.includes('/suggestions?query=music') || s.includes('/api/v1/stats') || s.includes('/v1/tracks/trending')) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: 'unavailable' }), { status: 502 });
    };

    const api = new SonoraApi(() => ({
      customApiBaseUrl: 'https://custom-piped.example.com'
    }));

    const pipedInfo = await api.getStreamInfo('dQw4w9WgXcQ', 'HIGH');
    assert.equal(pipedInfo.engine, 'audio');
    assert.equal(pipedInfo.sourceType, 'piped');
    assert.equal(pipedInfo.sourceKey, 'https://custom-piped.example.com');
    assert.ok(pipedInfo.streamCandidates.includes('https://rr1.googlevideo.com/audio.m4a'));

    // Exclude Piped pool -> uses parallel Invidious fallback including local=true M4A route
    const excludePiped = new Set([
      'https://custom-piped.example.com',
      'https://api.piped.private.coffee',
      'https://pipedapi.ducks.party',
      'https://pipedapi.adminforge.de',
      'https://pipedapi.kavin.rocks',
      'https://api.piped.projectsegfau.lt',
      'https://pipedapi.in.projectsegfau.lt',
      'https://pipedapi.r4fo.com',
      'https://pipedapi.moomoo.me',
      'https://pipedapi.ngn.tf'
    ]);
    const invInfo = await api.getStreamInfo('dQw4w9WgXcQ', 'HIGH', { excludeGateways: excludePiped });
    assert.equal(invInfo.engine, 'audio');
    assert.equal(invInfo.sourceType, 'invidious');
    assert.ok(
      invInfo.streamCandidates.some((u) => u.includes('/latest_version?id=dQw4w9WgXcQ&itag=140&local=true'))
    );

    const health = await api.testCatalogHealth();
    assert.equal(health.piped.ok, true);
    assert.equal(health.invidious.ok, true);
    assert.equal(health.audius.ok, true);

    // If all extractors fail, reject instead of falling back to ad-serving YouTube IFrame
    globalThis.fetch = async () => new Response('fail', { status: 502 });
    await assert.rejects(() => api.getStreamInfo('dQw4w9WgXcQ', 'HIGH'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('SonoraPlayer primes iOS AudioSession playback, prefetches next track, omits seek skip buttons, and rotates failovers', async () => {
  const { SonoraPlayer } = await import('../src/player.js');
  const storage = new SonoraStorage();
  await storage.init();

  const origNavDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const registeredActions = [];
  const fakeAudioSession = { type: 'auto' };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      audioSession: fakeAudioSession,
      mediaSession: {
        metadata: null,
        playbackState: 'none',
        setActionHandler(action) {
          registeredActions.push(action);
        },
        setPositionState() {}
      }
    }
  });

  try {
    const listeners = new Map();
    const mockAudio = {
      src: '',
      paused: true,
      currentTime: 0,
      duration: 180,
      playbackRate: 1,
      volume: 1,
      muted: false,
      setAttribute() {},
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      },
      async emit(type) {
        for (const fn of listeners.get(type) || []) {
          await fn();
        }
      },
      async play() {
        this.paused = false;
      },
      pause() {
        this.paused = true;
      },
      load() {}
    };

    const calls = [];
    const prefetchCalls = [];
    const fakeApi = {
      async getStreamInfo(id, _q, { excludeGateways = new Set() } = {}) {
        if (id === 'trackNext002') {
          prefetchCalls.push(id);
          return {
            engine: 'audio',
            sourceType: 'piped',
            sourceKey: 'gw1',
            streamUrl: 'https://cdn.example/next.m4a',
            streamCandidates: ['https://cdn.example/next.m4a'],
            mimeType: 'audio/mp4'
          };
        }
        calls.push(Array.from(excludeGateways));
        if (!excludeGateways.has('gw1')) {
          return {
            engine: 'audio',
            sourceType: 'piped',
            sourceKey: 'gw1',
            streamUrl: 'https://cdn.example/c1.m4a',
            streamCandidates: ['https://cdn.example/c1.m4a', 'https://cdn.example/c2.m4a'],
            mimeType: 'audio/mp4'
          };
        }
        return {
          engine: 'audio',
          sourceType: 'invidious',
          sourceKey: 'gw2',
          streamUrl: 'https://inv.example/backup.m4a',
          streamCandidates: ['https://inv.example/backup.m4a'],
          mimeType: 'audio/mp4'
        };
      },
      async fetchLyrics() {
        return { synced: [], plain: '', source: '' };
      }
    };

    const player = new SonoraPlayer({
      api: fakeApi,
      storage,
      offline: null,
      recommendations: null,
      audioElement: mockAudio
    });

    assert.equal(fakeAudioSession.type, 'playback');
    assert.ok(registeredActions.includes('previoustrack'));
    assert.ok(registeredActions.includes('nexttrack'));
    assert.equal(registeredActions.includes('seekbackward'), false);
    assert.equal(registeredActions.includes('seekforward'), false);

    const t1 = { id: 'dQw4w9WgXcQ', title: 'Track 1', artist: 'Artist', durationSeconds: 180 };
    const t2 = { id: 'trackNext002', title: 'Track 2', artist: 'Artist', durationSeconds: 200 };
    await player.playTrack(t1, [t1, t2]);
    assert.equal(mockAudio.src, 'https://cdn.example/c1.m4a');
    assert.ok(player._silentWavUrl.startsWith('blob:'));
    assert.ok(prefetchCalls.includes('trackNext002'));

    // First audio error advances to second candidate of gw1
    await mockAudio.emit('error');
    assert.equal(mockAudio.src, 'https://cdn.example/c2.m4a');

    // Second audio error excludes gw1 and loads gw2 cleanly on <audio>
    await mockAudio.emit('error');
    assert.equal(mockAudio.src, 'https://inv.example/backup.m4a');
    assert.equal(player.getSnapshot().engine, 'audio');
    assert.equal(player.getSnapshot().sourceType, 'invidious');
    assert.deepEqual(calls[1], ['gw1']);

    // Track ends on Lock Screen -> switches immediately using prefetched streamCache without refetching
    const countBeforeEnd = prefetchCalls.length;
    await mockAudio.emit('ended');
    assert.equal(player.currentTrack.id, 'trackNext002');
    assert.equal(mockAudio.src, 'https://cdn.example/next.m4a');
    assert.equal(prefetchCalls.length, countBeforeEnd);
  } finally {
    if (origNavDescriptor) {
      Object.defineProperty(globalThis, 'navigator', origNavDescriptor);
    }
  }
});
