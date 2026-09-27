// Stitch NASA Trek WMTS tiles (equirectangular, 256 px, 2^(z+1) × 2^z tiles)
// into one canvas that can wrap a sphere.
import { loadImage } from './api.js';

export const TREK = {
  moon: {
    color: { layer: 'LRO_WAC_Mosaic_Global_303ppd_v02', ext: 'jpg', title: 'LRO Wide Angle Camera mosaic' },
    relief: { layer: 'LRO_LOLA_ClrShade_Global_128ppd_v04', ext: 'png', title: 'LOLA colour-shaded elevation' },
    body: 'Moon',
  },
  mars: {
    color: { layer: 'Mars_Viking_MDIM21_ClrMosaic_global_232m', ext: 'jpg', title: 'Viking MDIM 2.1 colour mosaic' },
    relief: { layer: 'Mars_MGS_MOLA_ClrShade_merge_global_463m', ext: 'jpg', title: 'MOLA colour-shaded elevation' },
    body: 'Mars',
  },
  vesta: {
    color: { layer: 'Vesta_Dawn_FC_HAMO_Mosaic_Global_74ppd', ext: 'jpg', title: 'Dawn Framing Camera HAMO mosaic' },
    relief: { layer: 'Vesta_Dawn_HAMO_ClrShade_DLR_Global_48ppd', ext: 'png', title: 'Dawn HAMO colour-shaded elevation (DLR)' },
    body: 'Vesta',
  },
};

export const trekTileUrl = (body, layer, ext, z, row, col) =>
  `https://trek.nasa.gov/tiles/${body}/EQ/${layer}/1.0.0/default/default028mm/${z}/${row}/${col}.${ext}`;

/**
 * @returns {Promise<{ canvas: HTMLCanvasElement, failed: number }>}
 */
export async function stitchTrek(body, { layer, ext }, z = 2, onProgress = () => {}, concurrency = 10) {
  const cols = 2 ** (z + 1), rows = 2 ** z;
  const canvas = document.createElement('canvas');
  canvas.width = cols * 256;
  canvas.height = rows * 256;
  const g = canvas.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, canvas.width, canvas.height);
  const jobs = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) jobs.push([r, c]);
  let done = 0, failed = 0;
  async function worker() {
    while (jobs.length) {
      const [r, c] = jobs.shift();
      try {
        const img = await loadImage(trekTileUrl(body, layer, ext, z, r, c), 'trek', { timeout: 30000 });
        g.drawImage(img, c * 256, r * 256, 256, 256);
      } catch {
        failed++;
      }
      done++;
      onProgress(done / (rows * cols));
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { canvas, failed };
}
