// frontend/src/App.jsx
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

  // Po powrocie z logowania: sprawdź status + przywróć ostatni link
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
        } catch (e) {
          setAuthStatus('failed');
          setStatusMsg('Nie udało się pobrać profilu (/me).');
        }
      }
    }
    afterAuth();
  }, []);

  // Start skanera QR (jeśli dostęp do kamery jest pozwolony)
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
      } catch (e) {
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

  function openInSpotify() {
    if (!scanned) return;
    const p = scanned.parsed;
    if (p?.type === 'spotify') {
      const url = `https://open.spotify.com/${p.subtype}/${p.id}`;
      window.open(url, '_blank');
    }
  }

  async function playInSDK() {
    if (!scanned || !deviceId) return;
    const p = scanned.parsed;
    if (p.type === 'spotify' && p.subtype === 'track') {
      const uri = `spotify:track:${p.id}`;
      await fetch(`${BACKEND}/play`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_id: deviceId, uris: [uri] })
      });
    }
  }

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', color: '#fff', background:'#121212', minHeight:'100vh' }}>
      <div style={{ maxWidth: 900, margin: '0 auto', padding: 24 }}>
        <h1 style={{ fontSize: 28, marginBottom: 8 }}>🎵 QR Music App</h1>
        <p style={{ opacity: .8, marginBottom: 16 }}>Zeskanuj kod QR ze Spotify lub YouTube – aplikacja rozpozna serwis i pozwoli odtworzyć utwór.</p>

        {statusMsg && (
          <div style={{margin:'8px 0', fontSize:14, opacity:.9}}>
            {statusMsg}
            <button
              onClick={async () => {
                try {
                  const r = await fetch(`${BACKEND}/me`, { credentials: 'include' });
                  const d = await r.json();
                  if (r.ok) {
                    setMe(d); setAuthStatus('ok');
                    setStatusMsg(`Zalogowano: ${d.display_name || d.email} (plan: ${d.product})`);
                  } else {
                    setAuthStatus('failed');
                    setStatusMsg(`Nie zalogowano (HTTP ${r.status})`);
                  }
                } catch (_) { setStatusMsg('Błąd sprawdzania statusu'); }
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
                  if (val) {
                    sessionStorage.setItem('qr_last_raw', val);
                    onScan(val);
                  }
                }
              }}
              style={{ width:'100%', padding:12, borderRadius:12, border:'1px solid #333', background:'#1e1e1e', color:'#fff' }}
            />
          </div>

          {error && <div style={{ background:'#2b1d1d', border:'1px solid #5c2b2b', padding:12, borderRadius:12 }}>{error}</div>}

          {scanned && (
            <div style={{ background:'#1b1b1b', border:'1px solid #2a2a2a', padding:16, borderRadius:16 }}>
              <h3 style={{ marginTop:0 }}>Wynik skanowania</h3>
              <pre style={{ whiteSpace:'pre-wrap' }}>{JSON.stringify(scanned.parsed, null, 2)}</pre>

              {scanned.parsed.type === 'spotify' && (
                <div>
                  <p>Do dalszego działania wymagane jest zalogowanie do Spotify.</p>

                  {authStatus !== 'ok' && (
                    <button onClick={loginSpotify} style={{ padding:'10px 16px', borderRadius:12, background:'#1DB954', border:'none', color:'#000', fontWeight:700 }}>
                      Zaloguj przez Spotify
                    </button>
                  )}

                  {authStatus === 'ok' && me && (
                    <div style={{ marginTop:8 }}>
                      <p>Użytkownik: <strong>{me.display_name || me.email}</strong>, plan: <strong>{me.product}</strong></p>
                      {me.product === 'premium' ? (
                        <div style={{ display:'grid', gap:12 }}>
                          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                            <button onClick={openInSpotify} style={{ padding:'10px 16px', borderRadius:12, background:'#fff', border:'none', color:'#000', fontWeight:700 }}>Otwórz w Spotify</button>
                            {scanned.parsed.subtype === 'track' && (
                              <a href={`spotify:track:${scanned.parsed.id}`} style={{ padding:'10px 16px', borderRadius:12, background:'#fff', color:'#000', fontWeight:700, textDecoration:'none' }}>
                                Otwórz w aplikacji
                              </a>
                            )}
                          </div>
                          <div style={{ background:'#101010', border:'1px solid #303030', borderRadius:12, padding:12 }}>
                            <h4>Wbudowany odtwarzacz (Web Playback SDK)</h4>
                            <Player backend={BACKEND} onReady={(id)=>setDeviceId(id)} />
                            <div style={{ marginTop:8, display:'flex', gap:8, flexWrap:'wrap' }}>
                              {scanned.parsed.subtype === 'track' && (
                                <button onClick={playInSDK} style={{ padding:'10px 16px', borderRadius:12, background:'#1DB954', border:'none', color:'#000', fontWeight:700 }}>
                                  ▶ Zagraj w przeglądarce
                                </button>
                              )}
                            </div>
                            {!deviceId && <small style={{opacity:.7}}>Czekam na inicjalizację playera…</small>}
                          </div>
                        </div>
                      ) : (
                        <div style={{ background:'#2b1d1d', border:'1px solid #5c2b2b', padding:12, borderRadius:12 }}>
                          <b>Brak Premium</b> – pełne odtwarzanie w przeglądarce wymaga konta Premium. Nadal możesz otworzyć utwór w aplikacji.
                          <div style={{ marginTop:8 }}>
                            <button onClick={openInSpotify} style={{ padding:'10px 16px', borderRadius:12, background:'#fff', border:'none', color:'#000', fontWeight:700 }}>Otwórz w Spotify</button>
                          </div>
                        </div>
                      )}
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
