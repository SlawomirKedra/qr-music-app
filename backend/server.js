// backend/server.js
import express from 'express';
import dotenv from 'dotenv';
import crypto from 'crypto';
import fetch from 'node-fetch';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import rateLimit from 'express-rate-limit';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI;

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN; // np. https://slawomirkedra.github.io
const FRONTEND_REDIRECT_URL = process.env.FRONTEND_REDIRECT_URL || FRONTEND_ORIGIN; // np. https://slawomirkedra.github.io/qr-music-app

if (!CLIENT_ID || !REDIRECT_URI || !FRONTEND_ORIGIN) {
  console.error('Brakuje SPOTIFY_CLIENT_ID / SPOTIFY_REDIRECT_URI / FRONTEND_ORIGIN');
  process.exit(1);
}

app.use(cookieParser());
app.use(express.json());

app.use(cors({
  origin: FRONTEND_ORIGIN,
  credentials: true,
}));

const authLimiter = rateLimit({ windowMs: 60_000, max: 60 });
app.use('/login', authLimiter);

function base64url(input) {
  return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest();
}

app.get('/health', (_, res) => res.json({ ok: true }));

// 1) Start PKCE
app.get('/login', (req, res) => {
  const state = base64url(crypto.randomBytes(16));
  const codeVerifier = base64url(crypto.randomBytes(64));
  const codeChallenge = base64url(sha256(codeVerifier));

  const cookieOpts = { httpOnly: true, secure: true, sameSite: 'none', maxAge: 10 * 60 * 1000 };
  res.cookie('pkce_verifier', codeVerifier, cookieOpts);
  res.cookie('oauth_state', state, cookieOpts);

  const scope = [
    'user-read-email',
    'user-read-private',
    'streaming',
    'user-modify-playback-state',
    'user-read-playback-state'
  ].join(' ');

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    scope,
    redirect_uri: REDIRECT_URI,
    code_challenge_method: 'S256',
    code_challenge: codeChallenge,
    state
  });

  res.redirect(`https://accounts.spotify.com/authorize?${params.toString()}`);
});

// 2) Callback: code -> token
app.get('/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    const savedState = req.cookies.oauth_state;
    const codeVerifier = req.cookies.pkce_verifier;

    if (!code || !state || !savedState || state !== savedState || !codeVerifier) {
      return res.status(400).send('Nieprawidłowy stan autoryzacji.');
    }

    const body = new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: codeVerifier
    });

    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });

    if (!tokenRes.ok) {
      const t = await tokenRes.text();
      console.error('Token error:', t);
      return res.status(500).send('Błąd wymiany tokenu.');
    }

    const tokens = await tokenRes.json();

    const httpOnlyLong = { httpOnly: true, secure: true, sameSite: 'none', maxAge: 30 * 24 * 3600 * 1000 };
    const httpOnlyShort = { httpOnly: true, secure: true, sameSite: 'none', maxAge: tokens.expires_in * 1000 };

    res.cookie('access_token', tokens.access_token, httpOnlyShort);
    if (tokens.refresh_token) res.cookie('refresh_token', tokens.refresh_token, httpOnlyLong);

    res.clearCookie('pkce_verifier');
    res.clearCookie('oauth_state');

    res.redirect(FRONTEND_REDIRECT_URL + '/#/auth/success');
  } catch (e) {
    console.error(e);
    res.status(500).send('Błąd callback.');
  }
});

// 3) Refresh tokena
app.post('/refresh', async (req, res) => {
  try {
    const refresh = req.cookies.refresh_token;
    if (!refresh) return res.status(401).json({ error: 'Brak refresh_token' });

    const body = new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: refresh
    });

    const r = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });

    const data = await r.json();
    if (!r.ok) return res.status(401).json(data);

    res.cookie('access_token', data.access_token, { httpOnly: true, secure: true, sameSite: 'none', maxAge: data.expires_in * 1000 });
    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'refresh_failed' });
  }
});

// 4) /me – profil
app.get('/me', async (req, res) => {
  const token = req.cookies.access_token;
  if (!token) return res.status(401).json({ error: 'unauthenticated' });

  const r = await fetch('https://api.spotify.com/v1/me', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await r.json();
  return res.status(r.status).json(data);
});

// 5) token dla Web Playback SDK
app.get('/sdk-token', (req, res) => {
  const token = req.cookies.access_token;
  if (!token) return res.status(401).json({ error: 'unauthenticated' });
  res.json({ access_token: token });
});

// 6) transfer playback (z opcją natychmiastowego startu)
app.post('/transfer-playback', async (req, res) => {
  const token = req.cookies.access_token;

  let bodyRaw = '';
  await new Promise(resolve => {
    req.on('data', c => (bodyRaw += c));
    req.on('end', resolve);
  });
  const { device_id, play } = JSON.parse(bodyRaw || '{}');

  if (!token) return res.status(401).json({ error: 'unauthenticated' });
  if (!device_id) return res.status(400).json({ error: 'device_id_required' });

  const r = await fetch('https://api.spotify.com/v1/me/player', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_ids: [device_id], play: !!play })
  });

  return res.status(r.status).send();
});

// 7) play na urządzeniu SDK
app.post('/play', async (req, res) => {
  const token = req.cookies.access_token;

  let bodyRaw = '';
  await new Promise(resolve => {
    req.on('data', c => (bodyRaw += c));
    req.on('end', resolve);
  });
  const { device_id, uris } = JSON.parse(bodyRaw || '{}');

  if (!token) return res.status(401).json({ error: 'unauthenticated' });
  if (!device_id || !Array.isArray(uris) || uris.length === 0) {
    return res.status(400).json({ error: 'device_id_and_uris_required' });
  }

  const r = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(device_id)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ uris })
  });

  if (!r.ok) {
    const txt = await r.text();
    console.error('Play error:', txt);
  }
  return res.status(r.status).send();
});

app.listen(PORT, () => console.log(`Backend running on :${PORT}`));
