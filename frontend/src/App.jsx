import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import Player from './player/Player.jsx';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8080';

function parseLink(raw) {
  try {
    const url = new URL(raw);
    const h = url.hostname;
    if (h.includes('spotify.com')) {
      if (url.pathname.startsWith('/track/')) return { type: 'spotify', subtype: 'track', id: url.pathname.split('/')[2] };
      if (url.pathname.startsWith('/album/')) return { type: 'spotify', subtype: 'album', id: url.pathname.split('/')[2] };
      if (url.pathname.startsWith('/playlist/')) return { type: 'spotify', subtype: 'playlist', id: url.pathname.split('/')[2] };
      return { type: 'spotify', subtype: 'unknown', url: raw };
    }
    if (h.includes('youtu.be')) return { type: 'youtube', id: url.pathname.slice(1) };
    if (h.includes('youtube.com')) {
      const id = url.searchParams.get('v');
      if (id) return { type: 'youtube', id };
    }
  } catch (_) {}
  if (raw.startsWith('spotify:track:')) return { type: 'spotify', subtype: 'track', id: raw.split(':')[2] };
  return { type: 'unknown', url: raw };
}

export default function App() {
  const [scanned, setScanned] = useState(null);
  const [me, setMe] = useState(null);
  const [authStatus, setAuthStatus] = useState('idle'); // idle | ok | failed
  const [ytId, setYtId] = useState(null);
  const [error, setError] = useState('');
  const [deviceId, setDeviceId] = useState(null);
  const [statusMsg, setStatusMsg] = useState('');
  const qrRef = useRef(null);
  const qrInstance = useRef(null);

  useEffect(() => {
    async function afterAuth() {
      if (location.hash === '#/auth/success') {
        try {
          const r = await fetch(`${BACKEND}/me`, { credentials: 'include' });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const data = await r.json();
          setMe(data);
          setAuthStatus('ok');
          setStatusMsg(`Zalogowano: ${data.display_name || data.email} (plan: ${data.product})`);

          const saved = sessionStorage.getItem('qr_last_raw');
          if (saved) {
            onScan(saved);
            sessionStorage.removeItem('qr_last_raw');
          }
        } catch {
          setAuthStatus('failed');
          setStatusMsg('Nie udało się pobrać profilu (/me).');
        }
      } else {
        try {
          const r = await fetch(`${BACKEND}/me`, { credentials: 'include' });
          if (r.ok) { const d = await r.json(); setMe(d); setAuthStatus('ok'); }
        } catch {}
      }
    }
    afterAuth();
  }, []);

  useEffect(() => {
    const start = async () => {
      if (!qrRef.current) return;
      const id = 'qr-reader';
      qrRef.current.innerHTML = `<div id="${id}" style="width:320px;margin:0 auto;"></div>`;
      const html5Qrcode = new Html5Qrcode(id);
      qrInstance.current = html5Qrcode;
      try {
        await html5Qrcode.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: 250 },
          (decoded) => onScan(decoded)
        );
      } catch {
        setError('Nie udało się uruchomić kamery. Pozwól na dostęp do kamery lub użyj wklejenia linku.');
      }
    };
    start();
    return () => { try { qrInstance.current?.stop(); } catch(_){} };
  }, []);

  function onScan(text) {
    const parsed = parseLink(text);
    setScanned({ raw: text, parsed });
    setError('');
    if (parsed.type === 'youtube') setYtId(parsed.id);
    else setYtId(null);
  }

  function loginSpotify() {
    if (scanned?.raw) sessionStorage.setItem('qr_last_raw', scanned.raw);
    window.location.href = `${BACKEND}/login`;
  }

  function openAppOrWeb(p) {
    const deep = `spotify:${p.subtype}:${p.id}`;
    const web  = `https://open.spotify.com/${p.subtype}/${p.id}`;
    let jumped = false;
    try { window.location.href = deep; jumped = true; } catch {}
    setTimeout(() => { if (!jumped) window.open(web, '_blank'); }, 1200);
  }

  async function playSmart() {
    if (!scanned) return;
    const p = scanned.parsed;
    if (p.type !== 'spotify' || p.subtype !== 'track') {
      // dla non-track i tak otwórz w Spotify
      return openAppOrWeb(p);
    }

    // 1) jeśli Premium + SDK gotowy → graj w przeglądarce
    if (authStatus === 'ok' && me?.product === 'premium' && deviceId && window.__qr_player) {
      try {
        if (window.__qr_player.activateElement) await window.__qr_player.activateElement();
        // upewnij się, że to urządzenie jest aktywne i ma auto-play
        await fetch(`${BACKEND}/transfer-playback`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ device_id: deviceId, play: true })
        });
        const uri = `spotify:track:${p.id}`;
        await fetch(`${BACKEND}/play`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ device_id: deviceId, uris: [uri] })
        });
        return;
      } catch (e) {
        console.warn('Falling back to app/web, reason:', e);
      }
    }

    // 2) fallback: aplikacja / web
    openAppOrWeb(p);
  }

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', color: '#fff', background:'#121212', minHeight:'100vh' }}>
      <div style={{ maxWidth: 900, margin: '0 auto', padding: 24 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, marginBottom:12 }}>
          <div>
            <h1 style={{ fontSize: 28, marginBottom: 4 }}>🎵 QR Music App</h1>
            <p style={{ opacity: .8, margin: 0 }}>Zeskanuj kod QR ze Spotify lub YouTube – aplikacja rozpozna serwis i pozwoli odtworzyć utwór.</p>
          </div>
          {me && (
            <div style={{ display:'flex', alignItems:'center', gap:10, background:'#1b1b1b', border:'1px solid #2a2a2a', padding:'6px 10px', borderRadius:12 }}>
              {me.images?.[0]?.url && (
                <img src={me.images[0].url} alt="avatar" width="28" height="28" style={{ borderRadius:'50%' }} />
              )}
              <div style={{ lineHeight:1.1 }}>
                <div style={{ fontWeight:600 }}>{me.display_name || me.email}</div>
                <div style={{ fontSize:12, opacity:.8 }}>plan: {me.product}</div>
              </div>
            </div>
          )}
        </div>

        {statusMsg && (
          <div style={{margin:'8px 0', fontSize:14, opacity:.9}}>
            {statusMsg}
            <button
              onClick={async () => {
                try {
                  const r = await fetch(`${BACKEND}/me`, { credentials: 'include' });
                  const d = await r.json();
                  if (r.ok) { setMe(d); setAuthStatus('ok'); setStatusMsg(`Zalogowano: ${d.display_name || d.email} (plan: ${d.product})`); }
                  else { setAuthStatus('failed'); setStatusMsg(`Nie zalogowano (HTTP ${r.status})`); }
                } catch { setStatusMsg('Błąd sprawdzania statusu'); }
              }}
              style={{marginLeft:8, padding:'6px 10px', borderRadius:10, border:'1px solid #333', background:'#1e1e1e', color:'#fff'}}
            >
              Sprawdź status
            </button>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16 }}>
          <div ref={qrRef} />

          <div>
            <label>Lub wklej link:</label>
            <input
              type="text"
              placeholder="Wklej URL do utworu (Spotify / YouTube)"
              onKeyDown={(e)=>{
                if(e.key==='Enter'){
                  const val = e.currentTarget.value.trim();
                  if (val) { sessionStorage.setItem('qr_last_raw', val); onScan(val); }
                }
              }}
              style={{ width:'100%', padding:12, borderRadius:12, border:'1px solid #333', background:'#1e1e1e', color:'#fff' }}
            />
          </div>

          {error && (
            <div style={{ background:'#2b1d1d', border:'1px solid #5c2b2b', padding:12, borderRadius:12 }}>
              {error}
            </div>
          )}

          {scanned && (
            <div style={{ background:'#1b1b1b', border:'1px solid #2a2a2a', padding:16, borderRadius:16 }}>
              <h3 style={{ marginTop:0 }}>Wynik skanowania</h3>
              <pre style={{ whiteSpace:'pre-wrap' }}>{JSON.stringify(scanned.parsed, null, 2)}</pre>

              {scanned.parsed.type === 'spotify' && (
                <div>
                  {authStatus !== 'ok' && <p>Do dalszego działania wymagane jest zalogowanie do Spotify.</p>}

                  {authStatus !== 'ok' ? (
                    <button
                      onClick={loginSpotify}
                      style={{ padding:'10px 16px', borderRadius:12, background:'#1DB954', border:'none', color:'#000', fontWeight:700 }}
                    >
                      Zaloguj przez Spotify
                    </button>
                  ) : (
                    <div style={{ marginTop:8 }}>
                      <button
                        onClick={playSmart}
                        style={{ padding:'10px 16px', borderRadius:12, background:'#1DB954', border:'none', color:'#000', fontWeight:700 }}
                      >
                        ▶ Odtwórz
                      </button>
                      <div style={{ marginTop:12, background:'#101010', border:'1px solid #303030', borderRadius:12, padding:12 }}>
                        <h4>Wbudowany odtwarzacz (Web Playback SDK)</h4>
                        <Player backend={BACKEND} onReady={id => setDeviceId(id)} />
                        {!deviceId && <small style={{opacity:.7}}>Czekam na inicjalizację playera…</small>}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {scanned.parsed.type === 'youtube' && (
                <div>
                  <div style={{ position:'relative', paddingTop:'56.25%', borderRadius:12, overflow:'hidden', border:'1px solid #2a2a2a' }}>
                    {ytId && (
                      <iframe
                        key={ytId}
                        src={`https://www.youtube.com/embed/${ytId}?autoplay=1`}
                        title="YouTube player"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                        allowFullScreen
                        style={{ position:'absolute', inset:0, width:'100%', height:'100%', border:0 }}
                      />
                    )}
                  </div>
                </div>
              )}

              {scanned.parsed.type === 'unknown' && (
                <div>Nie rozpoznano linku. Upewnij się, że to URL z Spotify lub YouTube.</div>
              )}
            </div>
          )}

          <footer style={{ opacity:.7, fontSize:12 }}>
            Tip: na iOS może być konieczne włączenie dostępu do kamery w Safari. 
          </footer>
        </div>
      </div>
    </div>
  );
}
