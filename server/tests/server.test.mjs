import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  buildSapisidAuthorizationHeader,
  hasAuthCookies,
  normalizeCookieHeader,
  parseAccountProfile,
  parseUserPlaylists,
  extractTracksRecursive
} from '../src/innertube.js';
import {
  isAllowedAudioProxyUrl,
  isPrivateOrLoopbackHost,
  resolveCorsOrigin
} from '../src/security.js';
import { createSonoraServer } from '../src/server.js';

test('InnerTube helpers normalize Netscape cookies, compute SAPISIDHASH, and parse YouTube responses', () => {
  const netscape = [
    '# Netscape HTTP Cookie File',
    '.youtube.com\tTRUE\t/\tTRUE\t1999999999\tSAPISID\tabcdef12345',
    '.youtube.com\tTRUE\t/\tTRUE\t1999999999\tSID\tsid_token_xyz'
  ].join('\n');

  const normalized = normalizeCookieHeader(netscape);
  assert.equal(normalized, 'SAPISID=abcdef12345; SID=sid_token_xyz');
  assert.equal(hasAuthCookies(normalized), true);
  assert.equal(hasAuthCookies('PREF=f4=4000000'), false);

  const auth = buildSapisidAuthorizationHeader(normalized, 'https://music.youtube.com', 1700000000);
  assert.match(auth, /^SAPISIDHASH 1700000000_[0-9a-f]{40}$/);

  const profile = parseAccountProfile({
    actions: [
      {
        openPopupAction: {
          popup: {
            multiPageMenuRenderer: {
              header: {
                activeAccountHeaderRenderer: {
                  accountName: { runs: [{ text: 'Bekzhan' }] },
                  channelHandle: { simpleText: '@kbb001' },
                  email: { simpleText: 'user@example.com' },
                  accountPhoto: {
                    thumbnails: [{ url: 'https://yt3.ggpht.com/avatar.jpg', width: 88, height: 88 }]
                  }
                }
              }
            }
          }
        }
      }
    ]
  });
  assert.equal(profile?.name, 'Bekzhan');
  assert.equal(profile?.handle, '@kbb001');

  const tracks = extractTracksRecursive({
    items: [
      {
        musicResponsiveListItemRenderer: {
          playlistItemData: { videoId: 'dQw4w9WgXcQ' },
          flexColumns: [
            { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Never Gonna' }] } } },
            { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Rick Astley • 3:32' }] } } }
          ]
        }
      }
    ]
  });
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].durationSeconds, 212);

  const playlists = parseUserPlaylists({
    items: [
      {
        musicTwoRowItemRenderer: {
          title: { runs: [{ text: 'Night Mix' }] },
          subtitle: { runs: [{ text: '12 tracks' }] },
          navigationEndpoint: { browseEndpoint: { browseId: 'VLPLabc123456' } }
        }
      }
    ]
  });
  assert.equal(playlists.length, 1);
  assert.equal(playlists[0].playlistId, 'PLabc123456');
});

test('Security validators enforce strict CORS, block loopback/private hosts, and restrict audio proxy hosts', () => {
  const env = { CORS_ALLOWED_ORIGINS: 'https://kbb001.github.io' };
  assert.equal(resolveCorsOrigin('https://kbb001.github.io', env), 'https://kbb001.github.io');
  assert.equal(resolveCorsOrigin('https://evil.example.com', env), null);

  assert.equal(isPrivateOrLoopbackHost('127.0.0.1'), true);
  assert.equal(isPrivateOrLoopbackHost('169.254.169.254'), true);
  assert.equal(isPrivateOrLoopbackHost('localhost'), true);
  assert.equal(isAllowedAudioProxyUrl('https://rr3---sn-abc.googlevideo.com/videoplayback'), true);
  assert.equal(isAllowedAudioProxyUrl('http://rr3---sn-abc.googlevideo.com/videoplayback'), false);
  assert.equal(isAllowedAudioProxyUrl('https://127.0.0.1/secret'), false);
  assert.equal(isAllowedAudioProxyUrl('https://evil.example.com/audio.m4a'), false);
});

test('Server claim/login flow issues Bearer token and enforces origin & auth checks', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sonora-srv-'));
  const env = {
    CORS_ALLOWED_ORIGINS: 'https://kbb001.github.io',
    SONORA_TOKEN_SECRET: 'test_signing_secret_at_least_16_chars'
  };

  const mockFetch = async (url) => {
    if (String(url).includes('account/account_menu')) {
      return new Response(
        JSON.stringify({
          header: {
            activeAccountHeaderRenderer: {
              accountName: { simpleText: 'Test Listener' },
              channelHandle: { simpleText: '@listener' }
            }
          }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };

  const server = createSonoraServer({ env, dataDir: tmpDir, fetchImpl: mockFetch });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    // Disallowed origin gets 403
    const badOrigin = await fetch(`${baseUrl}/api/auth/status`, {
      headers: { Origin: 'https://untrusted.example' }
    });
    assert.equal(badOrigin.status, 403);

    // Protected route before auth gets 401
    const unauth = await fetch(`${baseUrl}/api/yt/account-info`, {
      method: 'POST',
      headers: { Origin: 'https://kbb001.github.io', 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.equal(unauth.status, 401);

    // Claim initial passcode
    const claimResp = await fetch(`${baseUrl}/api/auth/claim`, {
      method: 'POST',
      headers: { Origin: 'https://kbb001.github.io', 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode: 'mySecretPass99' })
    });
    assert.equal(claimResp.status, 200);
    assert.equal(claimResp.headers.get('access-control-allow-origin'), 'https://kbb001.github.io');
    const { token } = await claimResp.json();
    assert.ok(token);

    // Second claim attempt fails
    const secondClaim = await fetch(`${baseUrl}/api/auth/claim`, {
      method: 'POST',
      headers: { Origin: 'https://kbb001.github.io', 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode: 'otherPass99' })
    });
    assert.equal(secondClaim.status, 500);

    // Login with wrong password fails, right password succeeds
    const badLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { Origin: 'https://kbb001.github.io', 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode: 'wrong' })
    });
    assert.equal(badLogin.status, 401);

    const goodLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { Origin: 'https://kbb001.github.io', 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode: 'mySecretPass99' })
    });
    assert.equal(goodLogin.status, 200);

    // Authenticated YouTube account info call works
    const accResp = await fetch(`${baseUrl}/api/yt/account-info`, {
      method: 'POST',
      headers: {
        Origin: 'https://kbb001.github.io',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ cookie: 'SAPISID=abc; SID=def' })
    });
    assert.equal(accResp.status, 200);
    const accJson = await accResp.json();
    assert.equal(accJson.account.name, 'Test Listener');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
