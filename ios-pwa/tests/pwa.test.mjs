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
  parseLyricsTrackQuery,
  resolveEffectiveQuality,
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
import {
  buildGoogleOAuthUrl,
  isValidGoogleClientId,
  parseIsoDurationSeconds,
  parseOAuthHashResponse,
  syncYouTubeLibraryWithOAuth
} from '../src/youtube-oauth.js';

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

test('SonoraStorage supports SWR home cache, fast nodes, search item deletion, and playlist sort/reorder', async () => {
  const storage = new SonoraStorage();
  await storage.init();

  await storage.saveCachedHomeMood('ALL', [
    { id: 'dQw4w9WgXcQ', title: 'Track A', artist: 'Artist Z', durationSeconds: 210 },
    { id: '1N8hOpMqvYs', title: 'Track B', artist: 'Artist A', durationSeconds: 120 }
  ]);
  const cached = storage.getCachedHomeMood('ALL');
  assert.equal(cached?.tracks?.length, 2);
  assert.ok(cached.updatedAt > 0);

  await storage.saveFastNode('piped', 'https://fast-piped.example.com/');
  assert.equal(storage.fastNodes.piped, 'https://fast-piped.example.com');

  await storage.recordSearchQuery('Chill Mix');
  await storage.recordSearchQuery('Synthwave');
  await storage.removeSearchHistoryItem('chill mix');
  assert.deepEqual(storage.library.searchHistory, ['Synthwave']);

  const pl = await storage.createPlaylist('Sort Test', '', [
    { id: 'trk00000001', title: 'Beta', artist: 'Zed', durationSeconds: 300 },
    { id: 'trk00000002', title: 'Alpha', artist: 'Amy', durationSeconds: 150 },
    { id: 'trk00000003', title: 'Gamma', artist: 'Mid', durationSeconds: 220 }
  ]);

  assert.equal(await storage.sortPlaylistTracks(pl.id, 'TITLE'), true);
  assert.deepEqual(
    storage.library.playlists[0].tracks.map((t) => t.title),
    ['Alpha', 'Beta', 'Gamma']
  );

  assert.equal(await storage.sortPlaylistTracks(pl.id, 'DURATION'), true);
  assert.deepEqual(
    storage.library.playlists[0].tracks.map((t) => t.durationSeconds),
    [150, 220, 300]
  );

  assert.equal(await storage.moveTrackInPlaylist(pl.id, 2, 0), true);
  assert.equal(storage.library.playlists[0].tracks[0].title, 'Beta');
});

test('SonoraApi coalesces concurrent streams, parses lyrics queries, falls back to Invidious channels, and resolves offline CORS candidates', async () => {
  const parsedDash = parseLyricsTrackQuery('Kavinsky - Nightcall (Official Audio) [HD]', 'Kavinsky - Topic');
  assert.equal(parsedDash.artist, 'Kavinsky');
  assert.equal(parsedDash.title, 'Nightcall');

  const originalFetch = globalThis.fetch;
  let streamHits = 0;
  try {
    globalThis.fetch = async (url) => {
      const s = String(url);
      if (s.startsWith('https://priority-piped.example.com/streams/dQw4w9WgXcQ')) {
        streamHits++;
        await new Promise((r) => setTimeout(r, 25));
        return new Response(
          JSON.stringify({
            title: 'Song',
            uploader: 'Artist',
            duration: 180,
            audioStreams: [
              { url: 'https://rr1.googlevideo.com/audio.m4a', bitrate: 128000, mimeType: 'audio/mp4', codec: 'mp4a.40.2' }
            ]
          }),
          { status: 200 }
        );
      }
      if (s.startsWith('https://invidious.nerdvpn.de/api/v1/channels/UCtest123')) {
        return new Response(
          JSON.stringify({
            author: 'Fallback Artist',
            subCount: 150000,
            authorThumbnails: [{ url: 'https://yt3.googleusercontent.com/avatar.jpg' }],
            latestVideos: [{ videoId: '1N8hOpMqvYs', title: 'Channel Hit', author: 'Fallback Artist', lengthSeconds: 195 }]
          }),
          { status: 200 }
        );
      }
      if (s.startsWith('https://invidious.nerdvpn.de/api/v1/videos/dQw4w9WgXcQ')) {
        return new Response(
          JSON.stringify({
            adaptiveFormats: [{ url: 'https://rr5.googlevideo.com/raw.m4a', type: 'audio/mp4', bitrate: '128000' }]
          }),
          { status: 200 }
        );
      }
      return new Response('err', { status: 502 });
    };

    const api = new SonoraApi(() => ({
      fastNodes: { piped: 'https://priority-piped.example.com' }
    }));

    // Concurrent calls for the same stream should coalesce into a single fetch
    const [r1, r2] = await Promise.all([
      api.getStreamInfo('dQw4w9WgXcQ', 'HIGH'),
      api.getStreamInfo('dQw4w9WgXcQ', 'HIGH')
    ]);
    assert.equal(streamHits, 1);
    assert.equal(r1.streamUrl, r2.streamUrl);

    // Artist page falls back cleanly to Invidious /api/v1/channels/ when Piped fails
    const artist = await api.getArtistDetails({
      id: '/channel/UCtest123',
      channelUrl: '/channel/UCtest123',
      title: 'Fallback Artist',
      artist: ''
    });
    assert.equal(artist.tracks.length, 1);
    assert.equal(artist.tracks[0].id, '1N8hOpMqvYs');

    // Offline candidates elevate Invidious local=true CORS-safe route over raw googlevideo
    const offlineCandidates = await api.getOfflineStreamCandidates('dQw4w9WgXcQ', 'HIGH', [
      'https://rr1.googlevideo.com/audio.m4a'
    ]);
    assert.ok(offlineCandidates.some((u) => u.includes('local=true')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('SonoraPlayer keeps deterministic shuffle prefetch and supports queue reordering/removal/clear', async () => {
  const { SonoraPlayer } = await import('../src/player.js');
  const storage = new SonoraStorage();
  await storage.init();

  const mockAudio = {
    src: '',
    paused: true,
    currentTime: 0,
    duration: 180,
    playbackRate: 1,
    volume: 1,
    muted: false,
    setAttribute() {},
    removeAttribute() {},
    addEventListener() {},
    async play() { this.paused = false; },
    pause() { this.paused = true; },
    load() {}
  };

  const fakeApi = {
    async getStreamInfo(id) {
      return {
        engine: 'audio',
        sourceType: 'piped',
        sourceKey: 'gw1',
        streamUrl: `https://cdn.example/${id}.m4a`,
        streamCandidates: [`https://cdn.example/${id}.m4a`],
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

  const tracks = [
    { id: 't0000000001', title: 'Track 1', artist: 'A', durationSeconds: 180 },
    { id: 't0000000002', title: 'Track 2', artist: 'A', durationSeconds: 180 },
    { id: 't0000000003', title: 'Track 3', artist: 'A', durationSeconds: 180 }
  ];

  player.shuffleEnabled = true;
  await player.playTrack(tracks[0], tracks);
  const predictedNext = player.getUpcomingTrack();
  assert.ok(predictedNext && predictedNext.id !== tracks[0].id);

  await player.next(true);
  assert.equal(player.currentTrack.id, predictedNext.id);

  // Move and remove queue items
  player.shuffleEnabled = false;
  await player.playTrack(tracks[0], tracks);
  await player.moveQueueTrack(2, 1);
  assert.equal(player.queue[1].id, 't0000000003');
  await player.removeFromQueue(1);
  assert.equal(player.queue.length, 2);

  await player.clearQueue();
  assert.equal(player.queue.length, 0);
  assert.equal(player.currentIndex, -1);
});

test('SonoraOfflineManager reuses cached ObjectURLs across repeated playback lookups', async () => {
  const storage = new SonoraStorage();
  await storage.init();
  const mgr = new SonoraOfflineManager(storage);

  const origCaches = globalThis.caches;
  const origCreateObjectURL = URL.createObjectURL;
  let blobReads = 0;
  let urlCreates = 0;

  try {
    globalThis.caches = {
      async open() {
        return {
          async match() {
            blobReads++;
            return {
              async blob() {
                return new Blob([new Uint8Array(2048)], { type: 'audio/mp4' });
              }
            };
          }
        };
      }
    };
    URL.createObjectURL = () => {
      urlCreates++;
      return `blob:offline-${urlCreates}`;
    };

    const u1 = await mgr.getOfflinePlaybackUrl('dQw4w9WgXcQ');
    const u2 = await mgr.getOfflinePlaybackUrl('dQw4w9WgXcQ');
    assert.equal(u1, 'blob:offline-1');
    assert.equal(u2, 'blob:offline-1');
    assert.equal(blobReads, 1);
    assert.equal(urlCreates, 1);
  } finally {
    globalThis.caches = origCaches;
    URL.createObjectURL = origCreateObjectURL;
  }
});

test('youtube-oauth helpers validate Client IDs, build/parse OAuth URLs, and sync library via mocked Google APIs', async () => {
  assert.equal(isValidGoogleClientId('1234567890-abcdef.apps.googleusercontent.com'), true);
  assert.equal(isValidGoogleClientId('not-a-client-id'), false);
  assert.equal(parseIsoDurationSeconds('PT3M45S'), 225);
  assert.equal(parseIsoDurationSeconds('PT1H02M05S'), 3725);

  const authUrl = buildGoogleOAuthUrl({
    clientId: '1234567890-abcdef.apps.googleusercontent.com',
    redirectUri: 'https://kbb001.github.io/QQQ/',
    state: 'state_xyz'
  });
  assert.ok(authUrl.startsWith('https://accounts.google.com/o/oauth2/v2/auth?'));
  assert.ok(authUrl.includes('youtube.readonly'));
  assert.ok(authUrl.includes('response_type=token'));

  const parsedHash = parseOAuthHashResponse('#access_token=ya29.testtoken&expires_in=3600&state=state_xyz');
  assert.equal(parsedHash?.accessToken, 'ya29.testtoken');
  assert.equal(parsedHash?.state, 'state_xyz');

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      const s = String(url);
      if (s.includes('oauth2/v3/userinfo')) {
        return new Response(
          JSON.stringify({ sub: 'u1', name: 'Test User', email: 'u@example.com', picture: 'https://lh3.googleusercontent.com/pic.jpg' }),
          { status: 200 }
        );
      }
      if (s.includes('youtube/v3/channels')) {
        return new Response(
          JSON.stringify({ items: [{ id: 'UC1', snippet: { title: 'YT Music Channel', customUrl: '@ytm' } }] }),
          { status: 200 }
        );
      }
      if (s.includes('youtube/v3/playlists')) {
        return new Response(
          JSON.stringify({ items: [{ id: 'PLoauth1', snippet: { title: 'My Google Mix', description: 'Synced' } }] }),
          { status: 200 }
        );
      }
      if (s.includes('youtube/v3/playlistItems')) {
        return new Response(
          JSON.stringify({
            items: [
              {
                snippet: {
                  title: 'Track OAuth',
                  videoOwnerChannelTitle: 'Artist OAuth - Topic',
                  resourceId: { videoId: 'dQw4w9WgXcQ' },
                  thumbnails: { high: { url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg' } }
                },
                contentDetails: { videoId: 'dQw4w9WgXcQ' }
              }
            ]
          }),
          { status: 200 }
        );
      }
      if (s.includes('youtube/v3/videos')) {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: '1N8hOpMqvYs',
                snippet: {
                  title: 'Liked Track',
                  channelTitle: 'Cool Band - Topic',
                  thumbnails: { high: { url: 'https://i.ytimg.com/vi/1N8hOpMqvYs/hqdefault.jpg' } }
                },
                contentDetails: { duration: 'PT3M10S' }
              }
            ]
          }),
          { status: 200 }
        );
      }
      return new Response('{}', { status: 404 });
    };

    const synced = await syncYouTubeLibraryWithOAuth('ya29.testtoken');
    assert.equal(synced.account.name, 'YT Music Channel');
    assert.equal(synced.playlists.length, 1);
    assert.equal(synced.playlists[0].tracks[0].artist, 'Artist OAuth');
    assert.equal(synced.likedTracks.length, 1);
    assert.equal(synced.likedTracks[0].durationSeconds, 190);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('SonoraStorage deduplicates playlists, computes listening stats, and persists encrypted OAuth tokens', async () => {
  const storage = new SonoraStorage();
  await storage.init();

  const pl = await storage.createPlaylist('Dupes', '', [
    { id: 'dQw4w9WgXcQ', title: 'Track 1', artist: 'Artist A', durationSeconds: 200 },
    { id: '1N8hOpMqvYs', title: 'Track 2', artist: 'Artist B', durationSeconds: 180 },
    { id: 'dQw4w9WgXcQ', title: 'Track 1 Duplicate', artist: 'Artist A', durationSeconds: 200 }
  ]);
  const removed = await storage.deduplicatePlaylistTracks(pl.id);
  assert.equal(removed, 1);
  assert.equal(storage.library.playlists[0].tracks.length, 2);

  await storage.toggleFavorite({ id: 'dQw4w9WgXcQ', title: 'Track 1', artist: 'Artist A', durationSeconds: 200 });
  await storage.recordPlayback({ id: '1N8hOpMqvYs', title: 'Track 2', artist: 'Artist A', durationSeconds: 180 });
  const stats = storage.getListeningStats();
  assert.equal(stats.favoritesCount, 1);
  assert.equal(stats.historyCount, 1);
  assert.equal(stats.playlistsCount, 1);
  assert.equal(stats.topArtists[0], 'Artist A');

  await storage.upsertAccount({
    id: 'google_1',
    name: 'Google User',
    authType: 'google_oauth',
    accessToken: 'secret-token-value',
    tokenExpiresAt: Date.now() + 3600_000
  });
  assert.equal(storage.activeAccount.accessToken, 'secret-token-value');
  assert.equal(storage.activeAccount.authType, 'google_oauth');
});

test('SonoraApi resolves AUTO quality and paginates Piped playlists across nextpage tokens', async () => {
  assert.equal(resolveEffectiveQuality('HIGH'), 'HIGH');
  assert.ok(['LOW', 'MEDIUM', 'HIGH'].includes(resolveEffectiveQuality('AUTO')));

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      const s = String(url);
      if (s.startsWith('https://fast-pl.example.com/playlists/PLmulti123')) {
        return new Response(
          JSON.stringify({
            name: 'Big Mix',
            uploader: 'Curator',
            nextpage: 'page_2_token',
            relatedStreams: [
              { url: '/watch?v=dQw4w9WgXcQ', title: 'Track 1', uploaderName: 'Artist 1', duration: 180 }
            ]
          }),
          { status: 200 }
        );
      }
      if (s.startsWith('https://fast-pl.example.com/nextpage/playlists/PLmulti123')) {
        return new Response(
          JSON.stringify({
            nextpage: null,
            relatedStreams: [
              { url: '/watch?v=1N8hOpMqvYs', title: 'Track 2', uploaderName: 'Artist 2', duration: 210 }
            ]
          }),
          { status: 200 }
        );
      }
      return new Response('err', { status: 502 });
    };

    const api = new SonoraApi(() => ({
      fastNodes: { piped: 'https://fast-pl.example.com' }
    }));
    const pl = await api.getPlaylist('PLmulti123');
    assert.equal(pl.tracks.length, 2);
    assert.equal(pl.tracks[0].id, 'dQw4w9WgXcQ');
    assert.equal(pl.tracks[1].id, '1N8hOpMqvYs');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

