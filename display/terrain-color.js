/* Daytime ground-colour sampler — NASA Blue Marble (public domain) true-colour Earth,
   2048×1024 equirectangular. The daytime twin of the VIIRS night-lights map: we sample
   the real colour of the ground at (lat, lon) — forest greens, desert tans, alpine grey,
   ice white — and the terrain renderer adds procedural noise on top for shade variation.

   Like the night map it's ~15 km/pixel, so it supplies the *biome* (green vs desert vs
   mountain) while the per-quad noise supplies the close-up texture. */

let _W = 0, _H = 0, _d = null;

const _img = new Image();
_img.onload = () => {
  try {
    const c = document.createElement('canvas');
    c.width = _img.naturalWidth; c.height = _img.naturalHeight;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(_img, 0, 0);
    _d = g.getImageData(0, 0, c.width, c.height).data;   // RGBA
    _W = c.width; _H = c.height;
  } catch (e) {
    _d = null;
    console.warn('terrain-color: could not read Blue Marble map', e);
  }
};
_img.src = new URL('../assets/terrain-color.jpg', import.meta.url).href;

/* Bilinear [r,g,b] at a geographic point, or null until loaded. Longitude wraps. */
export function landColor(lat, lon) {
  if (!_d) return null;
  let x = ((lon + 180) / 360) * _W;
  let y = ((90 - lat) / 180) * _H;
  x = ((x % _W) + _W) % _W;
  if (y < 0) y = 0; else if (y > _H - 1) y = _H - 1;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = (x0 + 1) % _W, y1 = Math.min(_H - 1, y0 + 1);
  const fx = x - x0, fy = y - y0;
  const px = (xx, yy, ch) => _d[(yy * _W + xx) * 4 + ch];
  const ch = (k) => (px(x0, y0, k) * (1 - fx) + px(x1, y0, k) * fx) * (1 - fy)
                  + (px(x0, y1, k) * (1 - fx) + px(x1, y1, k) * fx) * fy;
  return [ch(0), ch(1), ch(2)];
}
