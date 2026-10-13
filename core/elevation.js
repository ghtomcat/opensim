/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/elevation.js
   Terrain elevation from Mapbox Terrain-RGB tiles (zoom 12, ~30 m DEM).
   One tile cache for everyone: physics (CFIT), the EGPWS look-ahead,
   the ND terrain picture and the 3D outside view.

   No DOM work at import, so core/ modules that use it load in Node.
   Tiles are fetched on first use in a browser; elsewhere (Node) every
   sample is null. The token is read on first fetch:
   localStorage.setItem('mapboxToken','pk.eyJ1...')
   ═══════════════════════════════════════════════════════════════ */

import { S, setState } from './state.js';

const DEG = Math.PI / 180;
const _TZ = 12;
const _tcache = new Map();  /* 'x/y' → ImageData | 'loading' | 'error' */
let _token = null;

function _fetchTile(x, y) {
  const k = `${x}/${y}`;
  if (_tcache.has(k)) return;
  if (typeof Image === 'undefined' || typeof document === 'undefined') { _tcache.set(k, 'error'); return; }
  _token ??= globalThis.localStorage?.getItem('mapboxToken') ?? '';
  _tcache.set(k, 'loading');
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const tc = c.getContext('2d');
    tc.drawImage(img, 0, 0);
    _tcache.set(k, tc.getImageData(0, 0, 256, 256));
  };
  img.onerror = () => _tcache.set(k, 'error');
  img.src = `https://api.mapbox.com/v4/mapbox.terrain-rgb/${_TZ}/${x}/${y}.pngraw?access_token=${_token}`;
}

/* DEM elevation in metres at any lat/lon, or null if that tile isn't decoded
   yet (the call also queues the fetch). */
export function elevM(lat, lon) {
  const n  = 1 << _TZ;
  const lr = lat * DEG;
  const tx = (lon + 180) / 360 * n;
  const ty = (1 - Math.log(Math.tan(lr) + 1 / Math.cos(lr)) / Math.PI) / 2 * n;
  const xi = tx | 0, yi = ty | 0;
  if (xi < 0 || xi >= n || yi < 0 || yi >= n) return null;
  _fetchTile(xi, yi);
  const t = _tcache.get(`${xi}/${yi}`);
  if (!t || typeof t === 'string') return null;
  const px = Math.min(255, (tx - xi) * 256 | 0);
  const py = Math.min(255, (ty - yi) * 256 | 0);
  const i  = (py * 256 + px) * 4;
  return -10000 + (t.data[i] * 65536 + t.data[i + 1] * 256 + t.data[i + 2]) * 0.1;
}

/* Once per sim tick: DEM elevation under the aircraft → S.terrainElevFt
   (physics CFIT, GPWS radio altitude, black-box radio-altimeter trace). */
export function tickElevation() {
  const m  = elevM(S.lat ?? 47, S.lon ?? 8);
  const ft = m !== null ? m / 0.3048 : null;
  if (ft !== S.terrainElevFt) setState({ terrainElevFt: ft });
}
