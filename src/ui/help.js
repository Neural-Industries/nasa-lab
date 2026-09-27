// Keys, credits and the honesty notes.
import { $, esc } from '../core/util.js';
import { SOURCES } from '../core/api.js';

const KEYS = [
  ['1 – 7', 'Earth, Moon, Sun, Asteroids, Mars, Vesta, Exoplanets'],
  ['Space', 'Pause or play time'], ['N', 'Back to now'], ['T', 'Begin the tour'], ['A', 'Open the archive'],
  ['/  or  ⌘K', 'Search everything'], ['S', 'Sound on or off'], ['P', 'Save a postcard'], ['R', 'Auto-rotate'],
  ['F', 'Full screen'], ['Esc', 'Close, deselect or end the tour'], ['?', 'This sheet'],
];

const LINKS = {
  apod: 'https://apod.nasa.gov/', neows: 'https://api.nasa.gov/', donki: 'https://kauai.ccmc.gsfc.nasa.gov/DONKI/', eonet: 'https://eonet.gsfc.nasa.gov/',
  epic: 'https://epic.gsfc.nasa.gov/', exoplanet: 'https://exoplanetarchive.ipac.caltech.edu/', gibs: 'https://nasa-gibs.github.io/gibs-api-docs/',
  insight: 'https://mars.nasa.gov/insight/weather/', library: 'https://images.nasa.gov/', osdr: 'https://osdr.nasa.gov/', ssc: 'https://sscweb.gsfc.nasa.gov/',
  ssd: 'https://ssd-api.jpl.nasa.gov/', techport: 'https://techport.nasa.gov/', techtransfer: 'https://technology.nasa.gov/', tle: 'https://tle.ivanstanojevic.me/', trek: 'https://trek.nasa.gov/',
};

export function openHelp() {
  const root = $('#help');
  const last = document.activeElement;
  root.innerHTML = `
    <div class="plate sheet__plate help">
      <div class="sheet__head"><h2 id="help-title">Keys & credits</h2><button class="icon-btn sheet__close" type="button" aria-label="Close (Esc)"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
      <div class="sheet__body">
        <div class="keys">${KEYS.map(([k, v]) => `<div><span>${esc(v)}</span><kbd>${esc(k)}</kbd></div>`).join('')}</div>
        <h3>Drag, scroll, click</h3>
        <p>Drag to orbit, scroll or pinch to zoom, and click anything that glows: satellites, storms, flares, CMEs, asteroids, landing sites, exoplanets. Drag along the scale in the time bar to travel through time.</p>
        <h3>Where everything comes from</h3>
        <div class="status-grid">${SOURCES.map((s) => `<div class="status-row"><span class="led" aria-hidden="true"></span><a class="n" href="${esc(LINKS[s.id])}" target="_blank" rel="noopener">${esc(s.name)}</a><span class="v"></span><span class="d">${esc(s.full)} · ${esc(s.where)}</span></div>`).join('')}</div>
        <h3 style="margin-top:24px">What is real and what is drawn</h3>
        <p>Real: Earth's surface and night lights (GIBS), satellite positions (SGP4 from TLEs), natural events (EONET), the photographs (EPIC, APOD, Image Library), flare locations and CME speeds, directions and widths (DONKI), planet, Moon and asteroid positions (JPL elements and published algorithms), surfaces of the Moon, Mars and Vesta (Trek), and every exoplanet's position and parameters (Exoplanet Archive).</p>
        <p>Drawn: the background star field (its Milky Way band follows the real galactic plane), the Sun's granulation, aurora curtains (placed at the latitude the latest DONKI storm implies, or a quiet level when there is none), exaggerated planet and asteroid sizes, and the exoplanet close-ups, which are generated from radius and temperature.</p>
        <h3>Built with</h3>
        <p>Three.js and custom GLSL shaders, satellite.js running SGP4 in a Web Worker, Web Audio for the generative score and sonification, Web Speech for narration and voice search, the Geolocation API for pass predictions, and a small Node gateway that keeps the NASA API key server-side.</p>
        <p class="src">NASA Lab is an independent project built on NASA's open data. It is not affiliated with or endorsed by NASA.</p>
      </div>
    </div>`;
  root.hidden = false;
  const close = () => { root.hidden = true; root.innerHTML = ''; last?.focus?.(); };
  root.querySelector('.sheet__close').addEventListener('click', close);
  root.querySelector('.sheet__close').focus();
  root.onclick = (e) => { if (e.target === root) close(); };
  root.onkeydown = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
}
