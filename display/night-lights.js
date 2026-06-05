/* Night-light density sampler — VIIRS / NASA Black Marble 2016 (public domain),
   downsampled to a 2048×1024 8-bit grayscale equirectangular map. We don't care
   where any individual light is, only how bright the ground is at (lat, lon) —
   so this just bilinearly samples the radiance map into a 0..1 density that the
   city-light carpet renderer turns into a procedural point field.

   A black-point FLOOR removes the faint terrain base in the imagery (so empty
   countryside reads as dark), and oceans are already black in VIIRS, so water
   suppression is automatic. */

let _W = 0, _H = 0, _lum = null;

/* Black-point sits on the histogram cliff: in this map ~14% of pixels fall in the
   faint 10–40 "terrain base", and only ~1% (real towns/cities) exceed 40. Floor at
   40 erases the base (dark countryside) while keeping small towns in the 40–90 band. */
const FLOOR = 40;     // luminance below this = dark (drops the terrain base glow)
const GAMMA = 0.80;   // <1 lifts mid cities a touch without blowing out cores

const _img = new Image();
_img.onload = () => {
  try {
    const c = document.createElement('canvas');
    c.width = _img.naturalWidth; c.height = _img.naturalHeight;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(_img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    _W = c.width; _H = c.height;
    _lum = new Uint8Array(_W * _H);
    for (let i = 0, j = 0; i < _lum.length; i++, j += 4) _lum[i] = d[j];
  } catch (e) {
    _lum = null;   // tainted canvas / decode failure → sampler stays inert
    console.warn('night-lights: could not read radiance map', e);
  }
};
_img.src = new URL('../assets/night-lights.png', import.meta.url).href;

export function nightLightsReady() { return _lum !== null; }

/* Density 0..1 at a geographic point (bilinear, longitude wraps). */
export function nightDensity(lat, lon) {
  if (!_lum) return 0;
  let x = ((lon + 180) / 360) * _W;
  let y = ((90 - lat) / 180) * _H;
  x = ((x % _W) + _W) % _W;
  if (y < 0) y = 0; else if (y > _H - 1) y = _H - 1;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = (x0 + 1) % _W, y1 = Math.min(_H - 1, y0 + 1);
  const fx = x - x0, fy = y - y0;
  const s = (xx, yy) => _lum[yy * _W + xx];
  const v = s(x0, y0) * (1 - fx) * (1 - fy) + s(x1, y0) * fx * (1 - fy)
          + s(x0, y1) * (1 - fx) * fy + s(x1, y1) * fx * fy;
  let d = (v - FLOOR) / (255 - FLOOR);
  if (d <= 0) return 0;
  return Math.pow(d < 1 ? d : 1, GAMMA);
}
