import React, { useEffect, useRef, useState } from 'react';

export default function Player({ backend, onReady }) {
  const [status, setStatus] = useState('init'); // init | loading | ready | error
  const [deviceId, setDeviceId] = useState(null);
  const [playerState, setPlayerState] = useState(null);
  const playerRef = useRef(null);
  const initedRef = useRef(false);

  useEffect(() => {
    async function initSDK() {
      if (initedRef.current) return;
      initedRef.current = true;
      setStatus('loading');

      async function createPlayer() {
        try {
          const tokenRes = await fetch(`${backend}/sdk-token`, { credentials: 'include' });
          if (!tokenRes.ok) throw new Error(`Brak tokenu SDK (HTTP ${tokenRes.status}) — zaloguj się do Spotify`);
          const { access_token } = await tokenRes.json();

          const player = new window.Spotify.Player({
            name: 'QR Music App Player',
            getOAuthToken: cb => cb(access_token),
            volume: 0.8
          });
          playerRef.current = player;
          // udostępnij globalnie do aktywacji dźwięku z przycisku
          window.__qr_player = player;

          player.addListener('ready', ({ device_id }) => {
            setDeviceId(device_id);
            setStatus('ready');
            onReady && onReady(device_id);
            // przenieś odtwarzanie na to urządzenie (bez startu)
            fetch(`${backend}/transfer-playback`, {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ device_id })
            });
          });

          player.addListener('not_ready', ({ device_id }) => {
            console.warn('Device went offline', device_id);
            setStatus('error');
          });

          player.addListener('player_state_changed', state => setPlayerState(state));
          player.addListener('initialization_error', ({ message }) => { console.error('SDK init error:', message); setStatus('error'); });
          player.addListener('authentication_error', ({ message }) => { console.error('SDK auth error:', message); setStatus('error'); });
          player.addListener('account_error', ({ message }) => { console.error('SDK account error (Premium?):', message); setStatus('error'); });

          await player.connect();
        } catch (e) {
          console.error(e);
          setStatus('error');
        }
      }

      if (window.Spotify && window.Spotify.Player) {
        createPlayer();
        return;
      }

      window.onSpotifyWebPlaybackSDKReady = () => createPlayer();

      let script = document.getElementById('spotify-sdk');
      if (!script) {
        script = document.createElement('script');
        script.id = 'spotify-sdk';
        script.src = 'https://sdk.scdn.co/spotify-player.js';
        script.async = true;
        document.body.appendChild(script);
      }

      let tries = 0;
      const poll = setInterval(() => {
        if (window.Spotify && window.Spotify.Player) {
          clearInterval(poll);
          createPlayer();
        }
        if (++tries > 25) clearInterval(poll);
      }, 200);
    }

    initSDK();
  }, [backend, onReady]);

  return (
    <div>
      <div style={{ display:'flex', gap:8, alignItems:'center' }}>
        <span>Status SDK: <b>{status}</b></span>
        {deviceId && <span> • Device: <code>{deviceId}</code></span>}
      </div>
      {playerState && (
        <div style={{ marginTop:6, fontSize:12, opacity:.8 }}>
          {playerState?.track_window?.current_track?.name ? (
            <div>🎧 {playerState.track_window.current_track.name}</div>
          ) : null}
        </div>
      )}
    </div>
  );
}
