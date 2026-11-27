import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_ALLOWED_ORIGINS = ['https://kbb001.github.io'];
const EPHEMERAL_SIGNING_KEY = crypto.randomBytes(32);

export function getSigningSecret(env = process.env) {
  const configured = String(env?.SONORA_TOKEN_SECRET || '').trim();
  if (configured.length >= 16) {
    return crypto.createHash('sha256').update(configured, 'utf8').digest();
  }
  return EPHEMERAL_SIGNING_KEY;
}

export function parseAllowedOrigins(env = process.env) {
  const raw = String(env?.CORS_ALLOWED_ORIGINS || '').trim();
  const list = raw
    ? raw.split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean)
    : [...DEFAULT_ALLOWED_ORIGINS];
  return new Set(list);
}

export function resolveCorsOrigin(requestOrigin, env = process.env) {
  if (!requestOrigin || typeof requestOrigin !== 'string') return null;
  const normalized = requestOrigin.trim().replace(/\/+$/, '');
  const allowed = parseAllowedOrigins(env);
  if (allowed.has(normalized)) return normalized;

  // Allow localhost/127.0.0.1 only if explicitly enabled for local dev
  if (String(env?.ALLOW_LOCALHOST_CORS || '').toLowerCase() === 'true') {
    try {
      const u = new URL(normalized);
      if (
        (u.protocol === 'http:' || u.protocol === 'https:') &&
        (u.hostname === 'localhost' || u.hostname === '127.0.0.1')
      ) {
        return normalized;
      }
    } catch {
      return null;
    }
  }
  return null;
}

export function isPrivateOrLoopbackHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h.endsWith('.local') ||
    h === '::1' ||
    h === '0:0:0:0:0:0:0:1' ||
    h.startsWith('fe80:') ||
    h.startsWith('fc') ||
    h.startsWith('fd')
  ) {
    return true;
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const parts = h.split('.').map(Number);
    if (parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
    const [a, b] = parts;
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    ) {
      return true;
    }
    // Block raw IPv4 literals altogether for media/upstream allowlist defense
    return true;
  }
  return false;
}

export function validateAllowedHttpsUrl(rawUrl, allowedDomains) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return null;
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== 'https:') return null;
    const host = parsed.hostname.toLowerCase();
    if (isPrivateOrLoopbackHost(host)) return null;

    const ok = allowedDomains.some((domain) => {
      const d = domain.toLowerCase();
      return host === d || host.endsWith(`.${d}`);
    });
    return ok ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function isAllowedAudioProxyUrl(rawUrl) {
  return Boolean(
    validateAllowedHttpsUrl(rawUrl, ['googlevideo.com', 'c.youtube.com'])
  );
}

export function sanitizePipedUpstream(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return null;
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== 'https:') return null;
    if (isPrivateOrLoopbackHost(parsed.hostname)) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function b64UrlEncode(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function b64UrlDecode(str) {
  const clean = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = clean.length % 4 === 0 ? '' : '='.repeat(4 - (clean.length % 4));
  return Buffer.from(clean + pad, 'base64');
}

function sha256Digest(text) {
  return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest();
}

export class PasscodeAuthStore {
  constructor({ dataDir, env = process.env } = {}) {
    this.env = env;
    this.baseDir = path.resolve(dataDir || env?.SONORA_DATA_DIR || path.join(process.cwd(), '.sonora-data'));
    this.authFile = path.resolve(this.baseDir, 'auth-state.json');
    if (!this.authFile.startsWith(this.baseDir + path.sep)) {
      throw new Error('Invalid auth storage path');
    }
    this.cachedState = null;
  }

  _readClaimedRecord() {
    if (this.cachedState) return this.cachedState;
    try {
      if (!fs.existsSync(this.authFile)) return null;
      const raw = fs.readFileSync(this.authFile, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed?.salt && parsed?.hash) {
        this.cachedState = parsed;
        return parsed;
      }
    } catch {
      return null;
    }
    return null;
  }

  getEnvPasscode() {
    return String(this.env?.SONORA_SERVER_PASSCODE || '').trim();
  }

  getStatus() {
    const envPasscode = this.getEnvPasscode();
    if (envPasscode.length > 0) {
      return { needsClaim: false, mode: 'env_passcode' };
    }
    const claimed = this._readClaimedRecord();
    if (claimed) {
      return { needsClaim: false, mode: 'claimed_passcode' };
    }
    return { needsClaim: true, mode: 'unclaimed' };
  }

  claimInitialPasscode(passcode) {
    const status = this.getStatus();
    if (!status.needsClaim) {
      throw new Error('Пароль сервера уже настроен');
    }
    const clean = String(passcode || '');
    if (clean.length < 6 || clean.length > 128) {
      throw new Error('Пароль сервера должен содержать от 6 до 128 символов');
    }
    const salt = crypto.randomBytes(16).toString('hex');
    const derived = crypto.scryptSync(clean, salt, 64).toString('hex');
    const record = { salt, hash: derived, claimedAt: Date.now() };
    fs.mkdirSync(this.baseDir, { recursive: true });
    fs.writeFileSync(this.authFile, JSON.stringify(record), { mode: 0o600, flag: 'wx' });
    this.cachedState = record;
    return true;
  }

  verifyPasscode(passcode) {
    const clean = String(passcode || '');
    if (!clean) return false;
    const envPasscode = this.getEnvPasscode();
    if (envPasscode.length > 0) {
      return crypto.timingSafeEqual(sha256Digest(clean), sha256Digest(envPasscode));
    }
    const claimed = this._readClaimedRecord();
    if (!claimed) return false;
    const derived = crypto.scryptSync(clean, claimed.salt, 64);
    const expected = Buffer.from(claimed.hash, 'hex');
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  }
}

export function issueAccessToken(env = process.env, ttlSeconds = 7 * 24 * 3600) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    v: 1,
    iat: now,
    exp: now + ttlSeconds,
    jti: crypto.randomBytes(12).toString('hex')
  };
  const encodedPayload = b64UrlEncode(JSON.stringify(payload));
  const sig = crypto
    .createHmac('sha256', getSigningSecret(env))
    .update(encodedPayload)
    .digest();
  return {
    token: `${encodedPayload}.${b64UrlEncode(sig)}`,
    expiresAt: payload.exp * 1000
  };
}

export function verifyAccessToken(token, env = process.env) {
  if (typeof token !== 'string' || !token.includes('.')) return false;
  const parts = token.trim().split('.');
  if (parts.length !== 2) return false;
  const [encodedPayload, encodedSig] = parts;
  if (!encodedPayload || !encodedSig) return false;

  const expectedSig = crypto
    .createHmac('sha256', getSigningSecret(env))
    .update(encodedPayload)
    .digest();
  let actualSig;
  try {
    actualSig = b64UrlDecode(encodedSig);
  } catch {
    return false;
  }
  if (actualSig.length !== expectedSig.length) return false;
  if (!crypto.timingSafeEqual(actualSig, expectedSig)) return false;

  try {
    const payload = JSON.parse(b64UrlDecode(encodedPayload).toString('utf8'));
    if (!payload || typeof payload.exp !== 'number') return false;
    return payload.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export function createSignedAudioTicket(targetUrl, env = process.env, ttlSeconds = 4 * 3600) {
  if (!isAllowedAudioProxyUrl(targetUrl)) return null;
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const body = `${exp}.${targetUrl}`;
  const sig = crypto
    .createHmac('sha256', getSigningSecret(env))
    .update(body, 'utf8')
    .digest('hex');
  return { u: targetUrl, exp: String(exp), sig };
}

export function verifySignedAudioTicket(u, expRaw, sig, env = process.env) {
  if (!isAllowedAudioProxyUrl(u)) return false;
  const exp = Number(expRaw);
  if (!Number.isInteger(exp) || exp <= Math.floor(Date.now() / 1000)) return false;
  if (typeof sig !== 'string' || !/^[0-9a-f]{64}$/i.test(sig)) return false;

  const expected = crypto
    .createHmac('sha256', getSigningSecret(env))
    .update(`${exp}.${u}`, 'utf8')
    .digest();
  const actual = Buffer.from(sig, 'hex');
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}
