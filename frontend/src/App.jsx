import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import Player from './player/Player.jsx';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8080';
const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

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
  } catch {}
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
  const [track, setTrack] = useState(null);
  const [showDetails, setShowDetails] = useState(false);
  const audioRef = useRef(null);

  const qrRef = useRef(null);
  const qrInstance = useRef(null);

  // Login status
  useEffect(() => {
    async function afterAuth() {
      const loadProfile = async () => {
        const r = await fetch(`${BACKEND}/me`, { credentials: 'include' });
        if (!r.ok) throw new Error();
        const d = await r.json();
        setMe(d); setAuthStatus('ok');
      };
      try {
        await loadProfile();
        if (location.hash === '#/auth/success') {
          setStatusMsg('Zalogowano.');
          const saved = sessionStorage.getItem('qr_last_raw');
          if (saved) { onScan(saved); sessionStorage.removeItem('qr_last_raw'); }
        }
      } catch { /* not logged */ }
    }
    afterAuth();
  }, []);

  // QR start
  useEffect(() => {
    const start = async () => {
      if (!qrRef.current) return;
      const id = 'qr-reader';
      qrRef.current.innerHTML = `<div id="${id}" class="qr-box"></div>`;
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
    return () => { try { qrInstance.current?.stop(); } catch{} };
  }, []);

  function onScan(text) {
    const parsed = parseLink(text);
    setScanned({ raw: text, parsed });
    setError('');
    setTrack(null);
    setShowDetails(false);
    if (parsed.type === 'youtube') setYtId(parsed.id); else setYtId(null);

    // Auto-akcja po skanie
    if (parsed.type === 'spotify' && parsed.subtype === 'track') {
      fetchTrackDetails(parsed.id).then((t)=> {
        setTrack(t);
        autoPlay(t, parsed);
      });
    } else if (parsed.type === 'spotify') {
      // album/playlist – od razu otwieramy app/web
      openAppOrWeb(parsed);
    }
  }

  // Pobranie szczegółów utworu (okładka, artyści, preview)
  async function fetchTrackDetails(id){
    try{
      const tokRes = await fetch(`${BACKEND}/sdk-token`, { credentials: 'include' });
      if(!tokRes.ok) throw new Error('no token');
      const { access_token } = await tokRes.json();
      const r = await fetch(`https://api.spotify.com/v1/tracks/${id}`, {
        headers:{ Authorization: `Bearer ${access_token}` }
      });
      if(!r.ok) throw new Error('track fetch failed');
      return await r.json();
    }catch(e){
      console.warn(e);
      return null;
    }
  }

  // Sprytne odtwarzanie po skanie
  async function autoPlay(trackData, parsed){
    // Desktop + Premium + SDK ready => play pełny utwór
    if (!isMobile && authStatus==='ok' && me?.product==='premium' && deviceId && window.__qr_player){
      try{
        if (window.__qr_player.activateElement) await window.__qr_player.activateElement();
        await fetch(`${BACKEND}/transfer-playback`, {
          method:'POST', credentials:'include',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({ device_id: deviceId, play: true })
        });
        await new Promise(r=>setTimeout(r, 500));
        const uri = `spotify:track:${parsed.id}`;
        await fetch(`${BACKEND}/play`, {
          method:'POST', credentials:'include',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({ device_id: deviceId, uris:[uri] })
        });
        return;
      }catch(e){ console.warn('SDK play fallback:', e); }
    }

    // Mobile (lub brak Premium/SDK) => 30s preview lub app/web
    if (trackData?.preview_url){
      try{
        // zatrzymaj poprzedni podgląd (jeśli leciał)
        audioRef.current?.pause();
        const a = new Audio(trackData.preview_url);
        audioRef.current = a;
        await a.play();
      }catch(e){
        // jeśli przeglądarka blokuje autoplay: pokaż przycisk Odtwórz
        console.warn('Preview autoplay blocked:', e);
      }
    }else{
      openAppOrWeb(parsed);
    }
  }

  function loginSpotify() {
    if (scanned?.raw) sessionStorage.setItem('qr_last_raw', scanned.raw);
    window.location.href = `${BACKEND}/login`;
  }

  function openAppOrWeb(p) {
    const deep = `spotify:${p.subtype}:${p.id}`;
    const web  = `https://open.spotify.com/${p.subtype}/${p.id}`;
    let jumped=false; try{ window.location.href = deep; jumped=true; }catch{}
    setTimeout(()=>{ if(!jumped) window.open(web,'_blank'); }, 900);
  }

  // Ręczny przycisk „Odtwórz” (fallback)
  async function playSmart(){
    if(!scanned) return;
    onScan(scanned.raw); // powtórz autologikę na wypadek blokady autoplay
  }

  return (
    <div className="container">
      <div className="header">
        <div className="brand">
          <h1>🎵 QR Music App</h1>
          <p>Zeskanuj kod QR ze Spotify lub YouTube – aplikacja rozpozna serwis i pozwoli odtworzyć utwór.</p>
        </div>
        {me && (
          <div className="badge">
            {me.images?.[0]?.url && <img src={me.images[0].url} width="28" height="28" alt="avatar" />}
            <div>
              <div style={{fontWeight:600}}>{me.display_name || me.email}</div>
              <div style={{fontSize:12,opacity:.8}}>plan: {me.product}</div>
            </div>
          </div>
        )}
      </div>

      {statusMsg && <div style={{margin:'8px 0',opacity:.9}}>{statusMsg}</div>}

      <div className="grid">
        <div className="qr-wrap">
          <div ref={qrRef} className="qr-box" />
        </div>

        <div>
          <label>Lub wklej link:</label>
          <input
            className="input"
            type="text"
            placeholder="Wklej URL do utworu (Spotify / YouTube)"
            onKeyDown={(e)=>{ if(e.key==='Enter'){ const v=e.currentTarget.value.trim(); if(v){ sessionStorage.setItem('qr_last_raw', v); onScan(v); }}}}
          />
        </div>

        {error && <div className="card" style={{background:'#2b1d1d',borderColor:'#5c2b2b'}}>{error}</div>}

        {/* KARTA UTWORU */}
        {scanned?.parsed?.type === 'spotify' && scanned.parsed.subtype === 'track' && (
          <div className="card">
            <h3 style={{marginTop:0}}>Utwór</h3>

            <div className="track-head">
              <img
                src={track?.album?.images?.[1]?.url || track?.album?.images?.[0]?.url || 'https://via.placeholder.com/72'}
                alt="okładka"
              />
              <div className="track-meta">
                <b>{track?.name || '—'}</b>
                <small>
                  {track?.artists?.map(a=>a.name).join(', ') || '—'} • {track?.album?.name || '—'}
                </small>
                {/* Jeśli gramy preview – pokaż animację */}
                {audioRef.current && !audioRef.current.paused && (
                  <div className="vu" style={{marginTop:6}}>
                    <span></span><span></span><span></span><span></span><span></span>
                  </div>
                )}
              </div>
            </div>

            <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:12}}>
              {authStatus !== 'ok' ? (
                <button className="btn btn-accent" onClick={loginSpotify}>Zaloguj przez Spotify</button>
              ) : (
                <button className="btn btn-accent" onClick={playSmart}>▶ Odtwórz</button>
              )}
              <button className="btn btn-ghost" onClick={()=>setShowDetails(s=>!s)}>
                {showDetails ? 'Ukryj szczegóły' : 'Pokaż szczegóły'}
              </button>
            </div>

            {showDetails && (
              <div className="details">
                <pre>{JSON.stringify({
                  id: track?.id,
                  name: track?.name,
                  artists: track?.artists?.map(a=>a.name),
                  album: track?.album?.name,
                  release_date: track?.album?.release_date,
                  duration_ms: track?.duration_ms,
                  explicit: track?.explicit,
                  popularity: track?.popularity,
                  preview_url: track?.preview_url
                }, null, 2)}</pre>
              </div>
            )}
          </div>
        )}

        {/* YouTube (jak coś zeskanujesz YT) */}
        {ytId && (
          <div className="card">
            <div style={{ position:'relative', paddingTop:'56.25%', borderRadius:12, overflow:'hidden', border:'1px solid var(--muted)' }}>
              <iframe
                key={ytId}
                src={`https://www.youtube.com/embed/${ytId}?autoplay=1`}
                title="YouTube player"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                style={{ position:'absolute', inset:0, width:'100%', height:'100%', border:0 }}
              />
            </div>
          </div>
        )}

        {/* Odtwarzacz SDK (desktop premium) */}
        {authStatus==='ok' && me?.product==='premium' && (
          <div className="card">
            <h4 style={{margin:'0 0 8px'}}>Wbudowany odtwarzacz (Web Playback SDK)</h4>
            <Player backend={BACKEND} onReady={id=>setDeviceId(id)} />
            {!deviceId && <small style={{opacity:.7}}>Czekam na inicjalizację playera…</small>}
          </div>
        )}

        <footer style={{ opacity:.7, fontSize:12 }}>
          Tip: na iOS może być konieczne włączenie dostępu do kamery w Safari.
        </footer>
      </div>
    </div>
  );
}
