import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BackupCipher,
  buildBackupPayload,
  escapeHtml,
  normalizeBackupPayload,
  sanitizeHttpsUrl
} from '../src/security.js';
import {
  extractPlaylistId,
  extractVideoId,
  parseLrcLines,
  selectBestIosAudioStream
} from '../src/api.js';
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

test('extractVideoId and extractPlaylistId parse YouTube & YouTube Music URLs', () => {
  assert.equal(extractVideoId('https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=RDAMVM'), 'dQw4w9WgXcQ');
  assert.equal(extractVideoId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractVideoId('not-a-video-url'), null);
  assert.equal(extractVideoId('not-a-video', { allowBareId: false }), null);

  assert.equal(
    extractPlaylistId('https://music.youtube.com/playlist?list=OLAK5uy_n9abcDEF12345'),
    'OLAK5uy_n9abcDEF12345'
  );
  assert.equal(extractPlaylistId('PLabcdefgh123456'), 'PLabcdefgh123456');
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
