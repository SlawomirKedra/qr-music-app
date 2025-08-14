// frontend/src/player/Player.jsx
import React, { useEffect, useRef, useState } from 'react';

/**
 * Stabilny init Spotify Web Playback SDK:
 * - wstrzykuje skrypt tylko raz,
 * - jeśli window.Spotify już jest, inicjuje natychmiast,
 * - fallback: czeka na globalny callback i dodatkowo polluje,
 * - pokazuje konkretne błędy w konsoli (auth/account/init).
 */
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

      // Jeśli SDK już jest załadowane — od razu inicjuj
      if (window.Spotify && window.Spotify.Player) {
        createPlayer();
        return;
      }

      // Ustaw callback
      window.onSpotifyWebPlaybackSDKReady = () => {
        createPlayer();
      };

      // Wstrzyknij skrypt tylko raz
      let script = document.getElementById('spotify-sdk');
      if (!script) {
        script = document.createElement('script');
        script.id = 'spotify-sdk';
        script.src = 'https://sdk.scdn.co/spotify-player.js';
        script.async = true;
        document.body.appendChild(script);
      }

      // Fallback: jeśli callback by nie zadziałał, sprawdzaj co 200ms przez 5s
      let tries = 0;
      const poll = setInterval(() => {
        if (window.Spotify && window.Spotify.Player) {
          clearInterval(poll);
          if (status !== 'ready') createPlayer();
        }
        if (++tries > 25) clearInterval(poll);
      }, 200);
    }

    initSDK();
  }, [backend, onReady]); // eslint-disable-line

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
