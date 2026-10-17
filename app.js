/* SCALA Workshop Registration System
 * Reads a participant's address from a Thai ID card photo, places the home on a map,
 * calculates the travel distance to the workshop venue for the selected day and
 * produces a cash receipt (PDF) per participant.
 * Everything runs in the browser; data is kept on this device (localStorage + IndexedDB).
 */

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.131.0/+esm';
const JSPDF_URL = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const OSRM_URL = 'https://router.project-osrm.org/route/v1/driving/';
const TILE_URL = 'https://tile.openstreetmap.org/';

const RECEIPT_DEFAULTS = {
  receiptTitle: 'Participant transportation for NbS field consultation workshop under UNFA/GLO/092/UND: “Scaling up Climate Ambition on Land Use and Agriculture through Nationally Determined Contributions and National Adaptation Plans”',
  receiptFrom: 'Food and Agriculture Organization of the United Nations\nRegional Office for Asia and the Pacific\n39 Maliwan Mansion, Phra Atit Road, Bangkok 10200, Thailand\nPhone: (+66 2) 697 4000   Fax: (+66 2) 697 4445   E-mail: FAO-RAP@fao.org',
  rate: 5.58,
  regTitle: 'Workshop – SCALA field consultation',
};

const PROVINCES = [
  'กรุงเทพมหานคร', 'กระบี่', 'กาญจนบุรี', 'กาฬสินธุ์', 'กำแพงเพชร', 'ขอนแก่น', 'จันทบุรี', 'ฉะเชิงเทรา',
  'ชลบุรี', 'ชัยนาท', 'ชัยภูมิ', 'ชุมพร', 'เชียงราย', 'เชียงใหม่', 'ตรัง', 'ตราด', 'ตาก', 'นครนายก',
  'นครปฐม', 'นครพนม', 'นครราชสีมา', 'นครศรีธรรมราช', 'นครสวรรค์', 'นนทบุรี', 'นราธิวาส', 'น่าน',
  'บึงกาฬ', 'บุรีรัมย์', 'ปทุมธานี', 'ประจวบคีรีขันธ์', 'ปราจีนบุรี', 'ปัตตานี', 'พระนครศรีอยุธยา',
  'พะเยา', 'พังงา', 'พัทลุง', 'พิจิตร', 'พิษณุโลก', 'เพชรบุรี', 'เพชรบูรณ์', 'แพร่', 'ภูเก็ต',
  'มหาสารคาม', 'มุกดาหาร', 'แม่ฮ่องสอน', 'ยโสธร', 'ยะลา', 'ร้อยเอ็ด', 'ระนอง', 'ระยอง', 'ราชบุรี',
  'ลพบุรี', 'ลำปาง', 'ลำพูน', 'เลย', 'ศรีสะเกษ', 'สกลนคร', 'สงขลา', 'สตูล', 'สมุทรปราการ',
  'สมุทรสงคราม', 'สมุทรสาคร', 'สระแก้ว', 'สระบุรี', 'สิงห์บุรี', 'สุโขทัย', 'สุพรรณบุรี',
  'สุราษฎร์ธานี', 'สุรินทร์', 'หนองคาย', 'หนองบัวลำภู', 'อ่างทอง', 'อำนาจเจริญ', 'อุดรธานี',
  'อุตรดิตถ์', 'อุทัยธานี', 'อุบลราชธานี',
];
const PROVINCE_ALIASES = { 'กทม': 'กรุงเทพมหานคร', 'กรุงเทพ': 'กรุงเทพมหานคร', 'กรุงเทพฯ': 'กรุงเทพมหานคร', 'อยุธยา': 'พระนครศรีอยุธยา' };

const LEVELS = {
  village: { text: 'Matched the village on the map.', tone: 'ok' },
  subdistrict: { text: 'Placed at the subdistrict (ตำบล), usually within a few km. Drag the pin if you know the exact home.', tone: 'ok' },
  district: { text: 'Only the district (อำเภอ) was found. Check the pin, or search a nearby place below.', tone: 'warn' },
  province: { text: 'Only the province was found. Please move the pin to the home.', tone: 'warn' },
  search: { text: 'Placed from the place search.', tone: 'ok' },
  manual: { text: 'Pin placed by hand.', tone: 'ok' },
};

const ID_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'name_en', 'house', 'subdistrict', 'district', 'province', 'full_address'],
  properties: {
    name: { type: 'string' },
    name_en: { type: 'string' },
    house: { type: 'string' },
    subdistrict: { type: 'string' },
    district: { type: 'string' },
    province: { type: 'string' },
    full_address: { type: 'string' },
  },
};

const ID_PROMPT = `This is a photo of the front of a Thai national ID card. Read the holder's names and the registered address (ที่อยู่) exactly as printed.
- name: the Thai full name with title (นาย / นาง / นางสาว ...) from the ชื่อตัวและชื่อสกุล line.
- name_en: the English name: the "Name" line (title and first name) followed by the "Last name" line, e.g. "Mr. Somchai Jaidee".
- house: everything in the address before the subdistrict: house number, หมู่, village, soi, road.
- subdistrict: the ตำบล or แขวง name without the prefix.
- district: the อำเภอ or เขต name without the prefix.
- province: the จังหวัด name without the prefix; use กรุงเทพมหานคร for Bangkok.
- full_address: the whole address as printed.
Return an empty string for anything you cannot read. Do not include the ID number or any other data.`;

/* ---------- helpers ---------- */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const todayISO = () => new Date().toLocaleDateString('en-CA');
const fmtKm = km => (km == null || Number.isNaN(km) ? '–' : km.toFixed(1));
const fmtTHB = n => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function fmtDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

// Fixes common OCR quirks in Thai text: decomposed sara am, zero-width characters.
function cleanThai(s) {
  return String(s ?? '').normalize('NFC').replace(/ํา/g, 'ำ').replace(/[​-‍﻿]/g, '');
}
const oneLine = s => cleanThai(s).replace(/\s+/g, ' ').trim();

// Name without admin prefixes, spaces or dots, for comparing place names.
function bare(s) {
  return oneLine(s).replace(/^(?:จังหวัด|กิ่งอำเภอ|อำเภอ|ตำบล|แขวง|เขต|จ\.|อ\.|ต\.)\s*/, '').replace(/[\s.]/g, '');
}

function levenshtein(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

function canonicalProvince(p) {
  const b = bare(p);
  if (!b) return '';
  if (PROVINCE_ALIASES[b]) return PROVINCE_ALIASES[b];
  if (b.startsWith('กรุงเทพ')) return 'กรุงเทพมหานคร';
  if (PROVINCES.includes(b)) return b;
  let best = b, bestD = Infinity;
  for (const name of PROVINCES) {
    const d = levenshtein(b, name);
    if (d < bestD) { best = name; bestD = d; }
  }
  return bestD <= Math.max(1, Math.floor(b.length / 4)) ? best : b;
}

function haversineKm(a, b) {
  const R = 6371.0088, rad = d => d * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function loadImg(src, cors) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (cors) img.crossOrigin = 'anonymous';
    const timer = setTimeout(() => reject(new Error('image timed out')), 10000);
    img.onload = () => { clearTimeout(timer); resolve(img); };
    img.onerror = () => { clearTimeout(timer); reject(new Error('image failed to load')); };
    img.src = src;
  });
}

/* ---------- storage ---------- */

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem('wd.' + key);
      return v ? JSON.parse(v) : fallback;
    } catch { return fallback; }
  },
  set(key, value) {
    try {
      localStorage.setItem('wd.' + key, JSON.stringify(value));
      return true;
    } catch (err) {
      toast('Could not save on this device: ' + err.message, 'error');
      return false;
    }
  },
};

// ID photos, signatures and routes are too big for localStorage, so they live in IndexedDB,
// one entry per participant record: { id, photo, signature, route }.
let idbPromise = null;
function idbOpen() {
  if (!idbPromise) {
    idbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('workshop-distance', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('files', { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    idbPromise.catch(() => { idbPromise = null; });
  }
  return idbPromise;
}
async function idbRun(mode, fn) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('files', mode);
    const req = fn(tx.objectStore('files'));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
const files = {
  get: id => idbRun('readonly', s => s.get(id)).catch(() => null),
  put: rec => idbRun('readwrite', s => s.put(rec)),
  del: id => idbRun('readwrite', s => s.delete(id)).catch(() => {}),
  all: () => idbRun('readonly', s => s.getAll()),
  clear: () => idbRun('readwrite', s => s.clear()).catch(() => {}),
};

const state = {
  venues: store.get('venues', []),
  people: store.get('people', []),
  settings: Object.assign({ reader: 'ocr', apiKey: '', model: 'claude-opus-5-5' }, RECEIPT_DEFAULTS, store.get('settings', {})),
  activeVenueId: store.get('activeVenue', null),
};
const geoCache = store.get('geocache', {});

const savePeople = () => store.set('people', state.people);
const saveSettings = () => store.set('settings', state.settings);

/* ---------- UI basics ---------- */

let toastTimer;
function toast(msg, tone = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show ' + tone;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, tone === 'error' ? 6000 : 3000);
}

function busy(btn, on, label) {
  if (on) {
    btn.dataset.label = btn.textContent;
    btn.textContent = label;
    btn.disabled = true;
  } else {
    btn.textContent = btn.dataset.label || btn.textContent;
    btn.disabled = false;
  }
}

function showTab(name) {
  $$('.tab').forEach(s => s.classList.toggle('active', s.id === 'tab-' + name));
  $$('.tabbar button').forEach(b => b.setAttribute('aria-current', b.dataset.goto === name ? 'page' : 'false'));
  if (name === 'people') renderPeople();
  if (name === 'venues') renderVenues();
  if (name === 'scan' && scanMap) setTimeout(() => scanMap.invalidateSize(), 30);
  window.scrollTo(0, 0);
}

function download(filename, content, type) {
  const url = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ---------- maps ---------- */

function makeMap(id) {
  const map = L.map(id).setView([13.0, 101.0], 6);
  L.tileLayer(TILE_URL + '{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  return map;
}

function pinIcon(kind) {
  return L.divIcon({
    className: 'pin pin-' + kind,
    html: kind === 'home' ? '🏠' : '★',
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

/* ---------- geocoding (OpenStreetMap Nominatim) ---------- */

let nextNominatimAt = 0;

// Nominatim allows at most one request per second, so calls are queued.
async function nominatim(params) {
  const url = NOMINATIM_URL + '?' + new URLSearchParams({ format: 'jsonv2', addressdetails: '1', 'accept-language': 'th', ...params });
  if (geoCache[url]) return geoCache[url];
  const wait = Math.max(0, nextNominatimAt - Date.now());
  nextNominatimAt = Date.now() + wait + 1100;
  if (wait) await sleep(wait);
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`map search returned ${res.status}`);
  const data = await res.json();
  geoCache[url] = data;
  const keys = Object.keys(geoCache);
  if (keys.length > 400) keys.slice(0, keys.length - 400).forEach(k => delete geoCache[k]);
  store.set('geocache', geoCache);
  return data;
}

function placeValues(r) {
  return [r.name, ...Object.values(r.address || {})].filter(Boolean).map(bare);
}

// Picks the result that really is in the expected subdistrict/district/province.
function pickResult(results, level, { village, T, A, P }) {
  let best = null, bestScore = 0;
  for (const r of results) {
    const vals = placeValues(r);
    const has = x => !!x && vals.includes(x);
    if (P && !has(P)) continue;
    const name = bare(r.name);
    const isArea = r.category === 'boundary' || r.category === 'place';
    let score = 0;
    if (level === 'village') {
      if (A && !has(A)) continue;
      if (name === village || name === village.replace(/^หมู่บ้าน/, '')) score = isArea ? 10 : 5;
    } else if (level === 'subdistrict') {
      if (A && !has(A)) continue;
      if (name === T) score = isArea ? 10 : 7;
      else if (has(T)) score = isArea ? 6 : 4;
      else if (name === 'บ้าน' + T) score = 3;
    } else if (level === 'district') {
      if (!has(A)) continue;
      score = name === A ? (isArea ? 10 : 6) : 1;
    } else {
      score = name === P ? 10 : 1;
    }
    if (score > bestScore) { best = r; bestScore = score; }
  }
  return best;
}

async function geocodeThai(f) {
  const P = canonicalProvince(f.province);
  const T = bare(f.tambon);
  let A = bare(f.amphoe);
  if (A === 'เมือง' && P) A = 'เมือง' + P;
  const bkk = P === 'กรุงเทพมหานคร';
  const pName = bkk ? P : P && 'จังหวัด' + P;
  const vm = oneLine(f.house).match(/(หมู่บ้าน[ก-๙]+|บ้าน(?!เลขที่)[ก-๙]{2,})/);
  const village = vm ? bare(vm[1]) : '';
  const ctx = { village, T, A, P };

  const attempts = [];
  if (village && (A || P)) attempts.push({ level: 'village', q: [village, A, P].filter(Boolean).join(' ') });
  if (T && (A || P)) {
    attempts.push({ level: 'subdistrict', q: [T, A, P].filter(Boolean).join(' ') });
    attempts.push({ level: 'subdistrict', q: [(bkk ? 'แขวง' : 'ตำบล') + T, A && (bkk ? 'เขต' : 'อำเภอ') + A, pName].filter(Boolean).join(' ') });
  }
  if (A) attempts.push({ level: 'district', q: [(bkk ? 'เขต' : 'อำเภอ') + A, pName].filter(Boolean).join(' ') });
  if (P) attempts.push({ level: 'province', q: pName });

  for (const at of attempts) {
    const results = await nominatim({ q: at.q, countrycodes: 'th', limit: '10' });
    const r = pickResult(results, at.level, ctx);
    if (r) return { lat: +r.lat, lng: +r.lon, level: at.level, label: r.display_name };
  }
  return null;
}

async function searchPlaces(q, countryOnly) {
  const params = { q, limit: '6' };
  if (countryOnly) params.countrycodes = 'th';
  return nominatim(params);
}

function renderResults(ul, results, onPick) {
  ul.innerHTML = results.length
    ? results.map((r, i) => `<li><button type="button" data-i="${i}">${esc(r.display_name)}</button></li>`).join('')
    : '<li class="none">No places found. Try a shorter or different name.</li>';
  ul.onclick = e => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    const r = results[+b.dataset.i];
    ul.innerHTML = '';
    onPick({ lat: +r.lat, lng: +r.lon }, r.display_name);
  };
}

/* ---------- routing (OSRM) ---------- */

// Full geometry so the line follows the roads; the simplified one cuts straight across on long trips.
async function routeOSRM(a, b) {
  const url = `${OSRM_URL}${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`routing returned ${res.status}`);
  const j = await res.json();
  if (j.code !== 'Ok' || !j.routes?.length) throw new Error(j.message || 'no route found');
  const r = j.routes[0];
  const coords = r.geometry.coordinates.map(([x, y]) => [+y.toFixed(5), +x.toFixed(5)]);
  return { km: r.distance / 1000, min: r.duration / 60, coords };
}

function googleMapsUrl(home, venue) {
  return `https://www.google.com/maps/dir/?api=1&origin=${home.lat.toFixed(6)},${home.lng.toFixed(6)}`
    + `&destination=${venue.lat.toFixed(6)},${venue.lng.toFixed(6)}&travelmode=driving`;
}

/* ---------- reading the ID card ---------- */

function toCanvas(img, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c;
}

// Grayscale + contrast stretch helps the OCR with the card's patterned background.
function prepareForOcr(img) {
  const c = toCanvas(img, 2000);
  const ctx = c.getContext('2d');
  const im = ctx.getImageData(0, 0, c.width, c.height);
  const d = im.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) {
    const y = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    d[i] = y;
    hist[y]++;
  }
  const total = d.length / 4;
  let lo = 0, hi = 255, acc = 0;
  while (lo < 255 && (acc += hist[lo]) < total * 0.02) lo++;
  acc = 0;
  while (hi > 0 && (acc += hist[hi]) < total * 0.02) hi--;
  const span = Math.max(1, hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.max(0, Math.min(255, ((d[i] - lo) * 255) / span));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(im, 0, 0);
  return c;
}

const ocrWorkers = {};
let ocrProgress = null;

function getOcrWorker(langs) {
  const key = langs.join('+');
  if (!ocrWorkers[key]) {
    ocrWorkers[key] = Tesseract.createWorker(langs, 1, { logger: m => ocrProgress && ocrProgress(m) });
    ocrWorkers[key].catch(() => { delete ocrWorkers[key]; });
  }
  return ocrWorkers[key];
}

async function readWithOcr(img) {
  if (!window.Tesseract) throw new Error('The text reader did not load. Check the internet connection and reload the page.');
  let stage = 'Reading the card…';
  ocrProgress = m => {
    if (m.status === 'recognizing text') setProgress(stage, m.progress);
    else if (/load/.test(m.status)) setProgress('Downloading the reader (first time only)…', m.progress);
  };
  try {
    const prepared = prepareForOcr(img);
    const thai = await getOcrWorker(['tha', 'eng']);
    setProgress(stage, 0);
    const { data } = await thai.recognize(prepared);
    const result = parseThaiId(data.text);
    // The Thai model often misreads the English name lines, so read them again in English only.
    stage = 'Reading the English name…';
    try {
      const eng = await getOcrWorker(['eng']);
      const { data: en } = await eng.recognize(prepared);
      result.nameEn = parseEnglishName(en.text) || result.nameEn;
      result.raw += '\n\n— English pass —\n' + en.text.trim();
    } catch (err) {
      console.warn('English pass failed', err);
    }
    return result;
  } finally {
    ocrProgress = null;
  }
}

async function readWithClaude(img) {
  setProgress('Loading Claude…', 0.1);
  const sdk = await import(SDK_URL);
  const Anthropic = sdk.default;
  const client = new Anthropic({ apiKey: state.settings.apiKey, dangerouslyAllowBrowser: true });
  const data = toCanvas(img, 1568).toDataURL('image/jpeg', 0.85).split(',')[1];
  const model = state.settings.model;
  const params = {
    model,
    max_tokens: 8000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: ID_SCHEMA } },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } },
        { type: 'text', text: ID_PROMPT },
      ],
    }],
  };
  setProgress('Claude is reading the card…', 0.5);
  let msg;
  try {
    // Haiku has no server-side fallback; the other models retry a declined request on a fallback model.
    msg = model.startsWith('claude-haiku')
      ? await client.messages.create(params)
      : await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
  } catch (err) {
    if (err instanceof sdk.AuthenticationError) throw new Error('The Anthropic API key was rejected. Check it in Settings.');
    if (err instanceof sdk.RateLimitError) throw new Error('Too many requests to Claude. Wait a moment and try again.');
    if (err instanceof sdk.APIConnectionError) throw new Error('Could not reach Claude. Check the internet connection.');
    if (err instanceof sdk.APIError) throw new Error(`Claude error (${err.status ?? 'unknown'}): ${err.message}`);
    throw err;
  }
  if (msg.stop_reason === 'refusal') throw new Error('Claude declined to read this photo. Switch to the on-device reader or type the address.');
  const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const out = JSON.parse(text);
  return {
    name: out.name,
    nameEn: out.name_en,
    house: out.house,
    tambon: out.subdistrict,
    amphoe: out.district,
    province: canonicalProvince(out.province) || out.province,
    raw: out.full_address,
  };
}

const PROVINCE_MARK = /(?:จ\.|จังหวัด)\s*[ก-๙]|กรุงเทพ/;

// "Name Mr. Somchai" + "Last name Jaidee" -> "Mr. Somchai Jaidee"
function parseEnglishName(text) {
  const lines = String(text).split('\n').map(l => l.trim()).filter(Boolean);
  const latin = s => s.replace(/[^A-Za-z.\-' ]/g, ' ').replace(/\s+/g, ' ').trim();
  const last = lines.map(l => l.match(/Last\s*name\s*[:.]?\s*(.+)/i)).find(Boolean);
  const first = lines.filter(l => !/last\s*name/i.test(l)).map(l => l.match(/(?:^|[^a-z])Name\s*[:.]?\s*(.+)/i)).find(Boolean);
  return [first && latin(first[1]), last && latin(last[1])].filter(Boolean).join(' ');
}

function parseThaiId(text) {
  const lines = cleanThai(text).split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean);

  let name = '';
  for (const l of lines) {
    const m = l.match(/ชื่อ\s*ตัว\s*และ\s*ชื่อ\s*สกุล\s*[:.]?\s*(.+)/);
    if (m) { name = m[1]; break; }
  }
  if (!name) name = lines.find(l => /^(?:นาย|นางสาว|นาง|เด็กชาย|เด็กหญิง|ด\.ช\.|ด\.ญ\.)\s*[ก-๙]/.test(l)) || '';
  name = name.replace(/[^ก-๙\s.]/g, ' ').replace(/\s+/g, ' ').trim();

  let addr = '';
  const idx = lines.findIndex(l => /ที่\s*อยู่|ที่อยู/.test(l));
  if (idx >= 0) {
    addr = lines[idx].replace(/^.*?ที่\s*อยู่?\s*/, '');
    for (let k = idx + 1; k <= idx + 2 && k < lines.length && !PROVINCE_MARK.test(addr); k++) {
      if (/วันออกบัตร|Date of Issue|เจ้าพนักงาน|บัตรหมดอายุ/i.test(lines[k])) break;
      addr += ' ' + lines[k];
    }
  } else {
    const k = lines.findIndex(l => /(?:ตำบล|แขวง|ต\.|อำเภอ|เขต|อ\.)\s*[ก-๙]/.test(l));
    if (k >= 0) addr = lines[k] + (PROVINCE_MARK.test(lines[k]) ? '' : ' ' + (lines[k + 1] || ''));
  }
  const pm = addr.match(/(?:จ\.|จังหวัด)\s*[ก-๙]+|กรุงเทพ[ก-๙ฯ]*/);
  if (pm) addr = addr.slice(0, pm.index + pm[0].length);
  addr = addr.replace(/[^ก-๙0-9a-zA-Z./\-,\s]/g, ' ').replace(/\s+/g, ' ').trim();

  return { name, nameEn: parseEnglishName(text), ...splitThaiAddress(addr), raw: text.trim() };
}

function splitThaiAddress(addr) {
  const s = ' ' + addr + ' ';
  const t = s.match(/(?:ตำบล|แขวง|ต\.)\s*([ก-๙]+?)(?=\s|อ\.|อำเภอ|เขต|จ\.|จังหวัด|กรุงเทพ)/);
  const a = s.match(/(?:อำเภอ|เขต|อ\.)\s*([ก-๙]+?)(?=\s|จ\.|จังหวัด|กรุงเทพ)/);
  const p = s.match(/(?:จังหวัด|จ\.)\s*([ก-๙]+)/);
  let province = p ? p[1] : '';
  if (!province) {
    if (/กรุงเทพ/.test(addr)) province = 'กรุงเทพมหานคร';
    else province = PROVINCES.filter(n => addr.includes(n)).sort((x, y) => y.length - x.length)[0] || '';
  }
  const firstMark = [t, a, p].filter(Boolean).map(m => m.index).sort((x, y) => x - y)[0];
  const house = (firstMark != null ? s.slice(0, firstMark) : s).replace(/^\s*บ้านเลขที่\s*/, '').trim();
  return {
    house,
    tambon: t ? t[1] : '',
    amphoe: a ? a[1] : '',
    province: canonicalProvince(province),
  };
}

/* ---------- venues ---------- */

function sortedVenues() {
  return [...state.venues].sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || a.name.localeCompare(b.name));
}
const activeVenue = () => state.venues.find(v => v.id === state.activeVenueId) || null;
const venueLabel = v => (v.date ? fmtDate(v.date) + ' · ' : '') + v.name;

function setActiveVenue(id) {
  state.activeVenueId = id || null;
  store.set('activeVenue', state.activeVenueId);
  renderVenueSelect();
  renderVenues();
  if (scanMap) {
    updateVenueMarker();
    if (scan.home) computeDistances(true);
  }
}

function saveVenues() {
  store.set('venues', state.venues);
  renderVenueSelect();
  renderVenues();
}

function renderVenueSelect() {
  const sel = $('#venueSelect');
  const vs = sortedVenues();
  if (!vs.some(v => v.id === state.activeVenueId)) {
    state.activeVenueId = (vs.find(v => v.date === todayISO()) || vs[0] || {}).id || null;
    store.set('activeVenue', state.activeVenueId);
  }
  sel.innerHTML = vs.length
    ? vs.map(v => `<option value="${v.id}">${esc(venueLabel(v))}</option>`).join('')
    : '<option value="">No venue yet</option>';
  sel.value = state.activeVenueId || '';
  $('#noVenueNote').hidden = vs.length > 0;
}

function renderVenues() {
  const vs = sortedVenues();
  const today = todayISO();
  $('#venueEmpty').hidden = vs.length > 0;
  $('#venueList').innerHTML = vs.map(v => {
    const n = state.people.filter(p => p.venueId === v.id).length;
    const active = v.id === state.activeVenueId;
    return `<li class="item ${active ? 'is-active' : ''}">
      <div>
        <div class="item-title">${esc(v.name)}
          ${v.date === today ? '<span class="badge ok">Today</span>' : ''}
          ${active ? '<span class="badge">Current venue</span>' : ''}</div>
        <div class="item-sub">${v.date ? esc(fmtDate(v.date)) : 'No date'} · ${n} participant${n === 1 ? '' : 's'}</div>
        <div class="item-sub muted">${esc(v.address || `${v.lat.toFixed(5)}, ${v.lng.toFixed(5)}`)}</div>
      </div>
      <div></div>
      <div class="item-actions">
        ${active ? '' : `<button class="btn small" data-use="${v.id}">Use for input</button>`}
        <button class="btn small" data-edit="${v.id}">Edit</button>
        <button class="btn small ghost danger" data-del="${v.id}">Delete</button>
      </div>
    </li>`;
  }).join('');
}

$('#venueList').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.use) { setActiveVenue(b.dataset.use); toast('New entries will use this venue'); }
  if (b.dataset.edit) openVenueDialog(state.venues.find(v => v.id === b.dataset.edit));
  if (b.dataset.del) {
    const v = state.venues.find(x => x.id === b.dataset.del);
    const n = state.people.filter(p => p.venueId === v.id).length;
    if (!confirm(`Delete the venue “${v.name}”?` + (n ? `\nThe ${n} participant record(s) for it are kept.` : ''))) return;
    state.venues = state.venues.filter(x => x.id !== v.id);
    saveVenues();
  }
});

/* venue dialog */

const vd = { id: null, pos: null, label: '', map: null, marker: null };

function suggestNextDate() {
  const dates = state.venues.map(v => v.date).filter(Boolean).sort();
  if (!dates.length) return todayISO();
  const [y, m, d] = dates[dates.length - 1].split('-').map(Number);
  return new Date(y, m - 1, d + 1).toLocaleDateString('en-CA');
}

function openVenueDialog(v) {
  vd.id = v?.id || null;
  vd.pos = v ? { lat: v.lat, lng: v.lng } : null;
  vd.label = v?.address || '';
  $('#venueDialogTitle').textContent = v ? 'Edit venue' : 'Add venue';
  $('#vName').value = v?.name || '';
  $('#vDate').value = v ? v.date || '' : suggestNextDate();
  $('#vSearch').value = '';
  $('#vCoords').value = '';
  $('#vResults').innerHTML = '';
  $('#venueDialog').showModal();
  if (!vd.map) {
    vd.map = makeMap('venueMap');
    vd.map.on('click', e => setVenuePos(e.latlng, 'Pin placed on the map'));
  }
  if (vd.marker) { vd.marker.remove(); vd.marker = null; }
  setTimeout(() => {
    vd.map.invalidateSize();
    if (vd.pos) setVenuePos(vd.pos, vd.label);
    else {
      const a = activeVenue();
      if (a) vd.map.setView([a.lat, a.lng], 11); else vd.map.setView([13.0, 101.0], 6);
    }
    updateVenueCoordText();
  }, 60);
}

function setVenuePos(ll, label) {
  vd.pos = { lat: +ll.lat, lng: +ll.lng };
  vd.label = label || '';
  if (!vd.marker) {
    vd.marker = L.marker(vd.pos, { draggable: true, icon: pinIcon('venue') }).addTo(vd.map);
    vd.marker.on('dragend', () => {
      const p = vd.marker.getLatLng();
      vd.pos = { lat: p.lat, lng: p.lng };
      updateVenueCoordText();
    });
  } else {
    vd.marker.setLatLng(vd.pos);
  }
  vd.map.setView(vd.pos, Math.max(vd.map.getZoom(), 15));
  updateVenueCoordText();
}

function updateVenueCoordText() {
  $('#vCoordText').textContent = vd.pos
    ? `Venue at ${vd.pos.lat.toFixed(5)}, ${vd.pos.lng.toFixed(5)}. Drag the ★ or tap the map to adjust.`
    : 'Tap the map to place the venue.';
}

function parseCoords(s) {
  const patterns = [
    /@(-?\d+\.\d+),\s*(-?\d+\.\d+)/,
    /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/,
    /[?&](?:q|query|ll|destination|center)=(-?\d+\.\d+)(?:,|%2C)\s*(-?\d+\.\d+)/i,
    /^\s*(-?\d{1,2}\.\d+)\s*[, ]\s*(-?\d{1,3}\.\d+)\s*$/,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m) {
      const lat = +m[1], lng = +m[2];
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
    }
  }
  return null;
}

$('#addVenue').addEventListener('click', () => openVenueDialog(null));
$('#vCancel').addEventListener('click', () => $('#venueDialog').close());

$('#vHere').addEventListener('click', () => {
  const btn = $('#vHere');
  if (!navigator.geolocation) return toast('Location is not available on this device.', 'error');
  busy(btn, true, 'Getting your location…');
  navigator.geolocation.getCurrentPosition(
    p => {
      busy(btn, false);
      setVenuePos({ lat: p.coords.latitude, lng: p.coords.longitude }, `Current location (±${Math.round(p.coords.accuracy)} m)`);
    },
    err => {
      busy(btn, false);
      toast('Could not get your location: ' + err.message, 'error');
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
  );
});

async function venueSearch() {
  const q = $('#vSearch').value.trim();
  if (!q) return;
  const btn = $('#vSearchBtn');
  busy(btn, true, '…');
  try {
    renderResults($('#vResults'), await searchPlaces(q, false), (ll, label) => {
      setVenuePos(ll, label);
      if (!$('#vName').value.trim()) $('#vName').value = label.split(',')[0];
    });
  } catch (err) {
    toast('Search failed: ' + err.message, 'error');
  } finally {
    busy(btn, false);
  }
}
$('#vSearchBtn').addEventListener('click', venueSearch);
$('#vSearch').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); venueSearch(); } });

$('#vCoords').addEventListener('input', e => {
  const s = e.target.value.trim();
  if (!s) return;
  const ll = parseCoords(s);
  if (ll) setVenuePos(ll, 'From pasted coordinates');
  else if (/goo\.gl|maps\.app/.test(s)) toast('Short Google Maps links cannot be read here. In Google Maps, long-press the venue and copy the coordinates instead.', 'error');
});

$('#venueForm').addEventListener('submit', e => {
  e.preventDefault();
  const name = $('#vName').value.trim();
  if (!name) { toast('Enter the venue name.', 'error'); $('#vName').focus(); return; }
  if (!vd.pos) { toast('Set the location: use current location, search, paste coordinates or tap the map.', 'error'); return; }
  const date = $('#vDate').value;
  let v = vd.id && state.venues.find(x => x.id === vd.id);
  const moved = !!v && (Math.abs(v.lat - vd.pos.lat) > 1e-6 || Math.abs(v.lng - vd.pos.lng) > 1e-6);
  const fields = { name, date, lat: vd.pos.lat, lng: vd.pos.lng, address: vd.label };
  if (v) Object.assign(v, fields);
  else {
    v = { id: uid(), ...fields };
    state.venues.push(v);
    if (!state.activeVenueId || date === todayISO()) state.activeVenueId = v.id;
  }
  const affected = state.people.filter(p => p.venueId === v.id);
  affected.forEach(p => { p.venueName = v.name; p.venueDate = v.date; });
  if (affected.length) savePeople();
  saveVenues();
  setActiveVenue(state.activeVenueId);
  $('#venueDialog').close();
  toast('Venue saved', 'ok');
  if (moved && affected.length && confirm(`The venue location changed. Recalculate distances for ${affected.length} participant(s)?`)) {
    recalcRecords(affected);
  }
});

/* setup link: share the venue list with another device */

function encodeSetup(venues) {
  const json = JSON.stringify(venues.map(({ id, name, date, lat, lng, address }) => ({ id, name, date, lat, lng, address })));
  let bin = '';
  new TextEncoder().encode(json).forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeSetup(s) {
  let b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

$('#shareSetup').addEventListener('click', async () => {
  if (!state.venues.length) return toast('Add a venue first.', 'error');
  const link = location.href.split('#')[0] + '#setup=' + encodeSetup(state.venues);
  const input = $('#setupLink');
  input.value = link;
  input.hidden = false;
  if (navigator.share) {
    try { await navigator.share({ title: 'SCALA Workshop Registration venues', url: link }); return; } catch { /* cancelled: fall through to copy */ }
  }
  try {
    await navigator.clipboard.writeText(link);
    toast('Link copied. Open it on the other device.', 'ok');
  } catch {
    input.select();
    toast('Copy the link below and open it on the other device.');
  }
});

function handleSetupLink() {
  const m = location.hash.match(/^#setup=(.+)$/);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search);
  let venues;
  try {
    venues = decodeSetup(m[1]).filter(v => v && v.id && v.name && Number.isFinite(v.lat) && Number.isFinite(v.lng));
  } catch {
    return toast('That setup link is damaged.', 'error');
  }
  if (!venues.length) return;
  if (!confirm(`Add ${venues.length} venue(s) from the setup link to this device?\n\n` + venues.map(venueLabel).join('\n'))) return;
  for (const v of venues) {
    const i = state.venues.findIndex(x => x.id === v.id);
    if (i >= 0) state.venues[i] = v; else state.venues.push(v);
  }
  state.activeVenueId = null;
  saveVenues();
  toast('Venues added', 'ok');
}

/* ---------- signature pad ---------- */

const sig = { el: $('#sigPad'), ctx: $('#sigPad').getContext('2d'), empty: true, drawing: false };

function setupSignaturePad() {
  const { el, ctx } = sig;
  const pos = e => {
    const r = el.getBoundingClientRect();
    return [(e.clientX - r.left) * el.width / r.width, (e.clientY - r.top) * el.height / r.height];
  };
  el.addEventListener('pointerdown', e => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    sig.drawing = true;
    sig.empty = false;
    const [x, y] = pos(e);
    ctx.lineWidth = 5;
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 0.1, y + 0.1);
    ctx.stroke();
  });
  el.addEventListener('pointermove', e => {
    if (!sig.drawing) return;
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of events.length ? events : [e]) {
      const [x, y] = pos(ev);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  });
  const end = () => { sig.drawing = false; };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  $('#sigClear').addEventListener('click', clearSignature);
}

function clearSignature() {
  sig.ctx.clearRect(0, 0, sig.el.width, sig.el.height);
  sig.empty = true;
}

async function loadSignature(dataUrl) {
  clearSignature();
  if (!dataUrl) return;
  try {
    sig.ctx.drawImage(await loadImg(dataUrl), 0, 0, sig.el.width, sig.el.height);
    sig.empty = false;
  } catch { /* unreadable signature: leave the pad empty */ }
}

const signatureData = () => (sig.empty ? null : sig.el.toDataURL('image/png'));

/* ---------- input screen ---------- */

const scan = {
  editingId: null, home: null, level: '', geoLabel: '', dist: null, route: null,
  routePromise: null, routeToken: 0, previewUrl: null, photoData: null,
};
let scanMap = null, homeMarker = null, venueMarker = null, routeLine = null;

function ensureScanMap() {
  if (!scanMap) {
    scanMap = makeMap('scanMap');
    scanMap.on('click', e => setHome(e.latlng, 'manual', 'Pin placed by hand', false));
    const v = activeVenue();
    if (v) scanMap.setView([v.lat, v.lng], 10);
  }
  scanMap.invalidateSize();
  updateVenueMarker();
  return scanMap;
}

function updateVenueMarker() {
  const v = activeVenue();
  if (!v) { venueMarker?.remove(); venueMarker = null; return; }
  if (!venueMarker) venueMarker = L.marker([v.lat, v.lng], { icon: pinIcon('venue'), zIndexOffset: 500 }).addTo(scanMap);
  else venueMarker.setLatLng([v.lat, v.lng]);
  venueMarker.bindTooltip(esc(v.name));
}

function showResultCard() {
  $('#resultCard').hidden = false;
  ensureScanMap();
}

function showIdThumb() {
  const img = $('#idThumb');
  if (scan.photoData) img.src = scan.photoData; else img.removeAttribute('src');
  img.hidden = !scan.photoData;
  $('#idNone').hidden = !!scan.photoData;
}

function setProgress(label, p) {
  $('#readingText').textContent = label;
  $('#progressBar').style.width = Math.round(Math.max(0.05, Math.min(1, p || 0)) * 100) + '%';
}

function readForm() {
  return {
    name: oneLine($('#fName').value),
    nameEn: oneLine($('#fNameEn').value),
    sex: $('#fSex').value,
    house: oneLine($('#fHouse').value),
    tambon: oneLine($('#fTambon').value),
    amphoe: oneLine($('#fAmphoe').value),
    province: oneLine($('#fProvince').value),
    consentJoin: $('#fConsentJoin').checked,
    consentPhoto: $('#fConsentPhoto').checked,
  };
}

function fillForm(r) {
  $('#fName').value = r.name || '';
  $('#fNameEn').value = r.nameEn || '';
  $('#fSex').value = r.sex || guessSex(r.name, r.nameEn);
  $('#fHouse').value = r.house || '';
  $('#fTambon').value = r.tambon || '';
  $('#fAmphoe').value = r.amphoe || '';
  $('#fProvince').value = r.province || '';
  $('#fConsentJoin').checked = !!r.consentJoin;
  $('#fConsentPhoto').checked = !!r.consentPhoto;
  $('#rawText').textContent = r.raw || '';
  $('#rawBox').hidden = !r.raw;
}

// The title on the ID card gives the sex: นาย / Mr. -> M, นาง / นางสาว / Mrs. / Miss -> F.
function guessSex(th, en) {
  const t = oneLine(th), e = oneLine(en).toLowerCase();
  if (/^(?:นาย|เด็กชาย|ด\.ช\.)/.test(t) || /^(?:mr|master)\b/.test(e)) return 'M';
  if (/^(?:นาง|เด็กหญิง|ด\.ญ\.)/.test(t) || /^(?:mrs|miss|ms)\b/.test(e)) return 'F';
  return '';
}

['#fName', '#fNameEn'].forEach(sel => $(sel).addEventListener('change', () => {
  if (!$('#fSex').value) $('#fSex').value = guessSex($('#fName').value, $('#fNameEn').value);
}));

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    scan.previewUrl = url;
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not open that image.'));
    img.src = url;
  });
}

async function onPhoto(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;

  // While editing (or after typing details by hand), a new photo only replaces the ID photo.
  const photoOnly = !!scan.editingId
    || (scan.home && !scan.photoData && confirm('Use this photo as the ID photo for the participant on screen? Cancel to read it as a new card.'));
  if (photoOnly) {
    try {
      const img = await loadImage(file);
      scan.photoData = toCanvas(img, 1200).toDataURL('image/jpeg', 0.8);
      showIdThumb();
      toast('ID photo added. Save to keep it.', 'ok');
    } catch (err) {
      toast(err.message, 'error');
    }
    return;
  }

  resetScan();
  const wantAI = state.settings.reader === 'ai';
  const useAI = wantAI && !!state.settings.apiKey;
  if (wantAI && !useAI) toast('No API key set, so the on-device reader is used.', 'error');
  $('#reading').hidden = false;
  setProgress('Opening photo…', 0.05);
  try {
    const img = await loadImage(file);
    $('#preview').src = scan.previewUrl;
    scan.photoData = toCanvas(img, 1200).toDataURL('image/jpeg', 0.8);
    showIdThumb();
    const r = useAI ? await readWithClaude(img) : await readWithOcr(img);
    fillForm(r);
    if (!r.name && !r.amphoe && !r.province) {
      toast('Could not read the card clearly. Retake the photo or type the details.', 'error');
    } else if (r.amphoe && r.province) {
      $('#reading').hidden = true;
      await findLocation();
    } else {
      toast('Check the details and fill in what is missing, then tap “Find location”.');
    }
  } catch (err) {
    console.error(err);
    toast(err.message || String(err), 'error');
  } finally {
    $('#reading').hidden = true;
  }
}
$('#photoInput').addEventListener('change', onPhoto);
$('#photoPick').addEventListener('change', onPhoto);

async function findLocation() {
  const f = readForm();
  if (!f.tambon && !f.amphoe && !f.province) {
    toast('Enter the subdistrict, district and province first.', 'error');
    return;
  }
  const btn = $('#findBtn');
  busy(btn, true, 'Finding location…');
  try {
    showResultCard();
    const g = await geocodeThai(f);
    if (g) setHome(g, g.level, g.label, true);
    else {
      clearHome();
      setLevelText('Address not found on the map. Search a nearby place below or tap the map where the home is.', 'warn');
    }
  } catch (err) {
    toast('Map search failed: ' + err.message, 'error');
  } finally {
    busy(btn, false);
  }
}

$('#personForm').addEventListener('submit', e => {
  e.preventDefault();
  findLocation();
});

function setLevelText(text, tone) {
  const el = $('#levelText');
  el.textContent = text;
  el.className = 'level ' + (tone || '');
}

function setHome(ll, level, label, fit = false) {
  scan.home = { lat: +ll.lat, lng: +ll.lng };
  scan.level = level;
  scan.geoLabel = label || '';
  ensureScanMap();
  if (!homeMarker) {
    homeMarker = L.marker(scan.home, { draggable: true, icon: pinIcon('home'), zIndexOffset: 1000 }).addTo(scanMap);
    homeMarker.on('dragend', () => setHome(homeMarker.getLatLng(), 'manual', 'Pin placed by hand', false));
  } else {
    homeMarker.setLatLng(scan.home);
  }
  const lv = LEVELS[level] || LEVELS.manual;
  setLevelText(lv.text, lv.tone);
  computeDistances(fit);
}

function clearHome() {
  scan.home = null;
  scan.dist = null;
  scan.route = null;
  scan.routeToken++;
  homeMarker?.remove(); homeMarker = null;
  routeLine?.remove(); routeLine = null;
  renderDistances();
  const v = activeVenue();
  if (v) scanMap.setView([v.lat, v.lng], 9);
}

function computeDistances(fit = false) {
  const v = activeVenue(), h = scan.home;
  routeLine?.remove(); routeLine = null;
  scan.routeToken++;
  scan.routePromise = null;
  scan.route = null;
  if (!h || !v) {
    scan.dist = null;
    renderDistances();
    if (h && fit) scanMap.setView([h.lat, h.lng], 12);
    return;
  }
  const dist = { straightKm: haversineKm(h, v), roadKm: null, roadMin: null, pending: true, error: '' };
  scan.dist = dist;
  renderDistances();
  if (fit) scanMap.fitBounds(L.latLngBounds([[h.lat, h.lng], [v.lat, v.lng]]).pad(0.25), { maxZoom: 14 });
  const token = scan.routeToken;
  scan.routePromise = routeOSRM(h, v)
    .then(r => {
      if (token !== scan.routeToken) return;
      Object.assign(dist, { roadKm: r.km, roadMin: r.min });
      scan.route = r.coords;
      routeLine = L.polyline(r.coords, { color: cssVar('--accent') || '#0f766e', weight: 5, opacity: 0.7 }).addTo(scanMap);
    })
    .catch(err => { dist.error = err.message; })
    .finally(() => {
      dist.pending = false;
      if (token === scan.routeToken) renderDistances();
    });
}

function renderDistances() {
  const d = scan.dist;
  const v = activeVenue();
  $('#straightKm').textContent = d ? fmtKm(d.straightKm) : '–';
  $('#amountText').textContent = '';
  const gmaps = $('#gmapsLink');
  gmaps.hidden = !(scan.home && v);
  if (scan.home && v) gmaps.href = googleMapsUrl(scan.home, v);
  if (!d) {
    $('#roadKm').textContent = '–';
    $('#roadMin').textContent = scan.home && !v ? '(add a venue to calculate)' : '';
  } else if (d.pending) {
    $('#roadKm').textContent = '…';
    $('#roadMin').textContent = '';
  } else if (d.roadKm == null) {
    $('#roadKm').textContent = '–';
    $('#roadMin').textContent = '(road route unavailable)';
  } else {
    $('#roadKm').textContent = fmtKm(d.roadKm);
    $('#roadMin').textContent = `· about ${Math.round(d.roadMin)} min drive`;
    const a = receiptAmounts({ roadKm: d.roadKm });
    $('#amountText').textContent = `Round trip ${a.roundTrip.toFixed(1)} km × ${fmtTHB(a.rate)} THB = ${fmtTHB(a.amount)} THB`;
  }
}

function resetScan() {
  scan.editingId = null;
  scan.home = null;
  scan.level = '';
  scan.geoLabel = '';
  scan.dist = null;
  scan.route = null;
  scan.photoData = null;
  scan.routeToken++;
  scan.routePromise = null;
  fillForm({});
  homeMarker?.remove(); homeMarker = null;
  routeLine?.remove(); routeLine = null;
  $('#resultCard').hidden = true;
  $('#placeResults').innerHTML = '';
  $('#placeSearch').value = '';
  $('#editBanner').hidden = true;
  $('#saveNewBtn').hidden = true;
  $('#saveBtn').textContent = 'Save participant';
  $('#reading').hidden = true;
  if (scan.previewUrl) { URL.revokeObjectURL(scan.previewUrl); scan.previewUrl = null; }
  $('#preview').removeAttribute('src');
  clearSignature();
  showIdThumb();
  renderDistances();
}

let persistAsked = false;

async function saveRecord(asNew) {
  const f = readForm();
  const v = activeVenue();
  if (!v) return toast('Choose or add a venue first.', 'error');
  if (!f.name && !f.nameEn) { toast('Enter the participant’s name.', 'error'); $('#fName').focus(); return; }
  if (!scan.home) return toast('Find the home location first.', 'error');
  const existing = !asNew && scan.editingId ? state.people.find(p => p.id === scan.editingId) : null;
  if (!existing) {
    const dup = state.people.find(p => p.venueId === v.id && bare(p.name) === bare(f.name) && bare(p.nameEn) === bare(f.nameEn));
    if (dup && !confirm(`${f.name || f.nameEn} is already recorded for this venue. Save another record?`)) return;
  }
  if (!f.consentJoin && !confirm('Participation consent (ยินยอมเข้าร่วม) is not ticked. Save anyway?')) return;
  const btn = asNew ? $('#saveNewBtn') : $('#saveBtn');
  busy(btn, true, 'Saving…');
  if (scan.routePromise) await scan.routePromise;
  const now = new Date().toISOString();
  const signature = signatureData();
  const rec = {
    id: existing?.id || uid(),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    venueId: v.id,
    venueName: v.name,
    venueDate: v.date || '',
    venueLat: v.lat,
    venueLng: v.lng,
    ...f,
    lat: scan.home.lat,
    lng: scan.home.lng,
    level: scan.level,
    geoLabel: scan.geoLabel,
    straightKm: scan.dist?.straightKm ?? null,
    roadKm: scan.dist?.roadKm ?? null,
    roadMin: scan.dist?.roadMin ?? null,
    hasPhoto: !!scan.photoData,
    hasSignature: !!signature,
  };
  try {
    await files.put({ id: rec.id, photo: scan.photoData, signature, route: scan.route, routeFull: !!scan.route });
  } catch (err) {
    busy(btn, false);
    toast('Could not save the ID photo and signature on this device: ' + err.message, 'error');
    return;
  }
  busy(btn, false);
  if (existing) state.people[state.people.indexOf(existing)] = rec;
  else state.people.push(rec);
  if (!savePeople()) return;
  if (!persistAsked) {
    persistAsked = true;
    navigator.storage?.persist?.().catch(() => {});
  }
  toast(`Saved ${rec.name || rec.nameEn}: ${fmtKm(rec.roadKm ?? rec.straightKm)} km`, 'ok');
  resetScan();
  window.scrollTo(0, 0);
}

$('#saveBtn').addEventListener('click', () => saveRecord(false));
$('#saveNewBtn').addEventListener('click', () => saveRecord(true));
$('#clearBtn').addEventListener('click', resetScan);
$('#cancelEdit').addEventListener('click', resetScan);
$('#venueSelect').addEventListener('change', e => setActiveVenue(e.target.value));

async function placeSearch() {
  const q = $('#placeSearch').value.trim();
  if (!q) return;
  const btn = $('#placeSearchBtn');
  busy(btn, true, '…');
  try {
    const f = readForm();
    const P = canonicalProvince(f.province);
    const results = await searchPlaces(q, true);
    // Places in the participant's province first.
    results.sort((a, b) => placeValues(b).includes(P) - placeValues(a).includes(P));
    renderResults($('#placeResults'), results, (ll, label) => setHome(ll, 'search', label, true));
  } catch (err) {
    toast('Search failed: ' + err.message, 'error');
  } finally {
    busy(btn, false);
  }
}
$('#placeSearchBtn').addEventListener('click', placeSearch);
$('#placeSearch').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); placeSearch(); } });

async function editRecord(id) {
  const p = state.people.find(x => x.id === id);
  if (!p) return;
  resetScan();
  if (state.venues.some(v => v.id === p.venueId)) setActiveVenue(p.venueId);
  showTab('scan');
  fillForm(p);
  scan.editingId = id;
  $('#editName').textContent = p.name || p.nameEn;
  $('#editBanner').hidden = false;
  $('#saveBtn').textContent = 'Update record';
  $('#saveNewBtn').hidden = false;
  showResultCard();
  setHome({ lat: p.lat, lng: p.lng }, p.level, p.geoLabel, true);
  const saved = await files.get(id);
  scan.photoData = saved?.photo || null;
  showIdThumb();
  await loadSignature(saved?.signature);
}

/* ---------- participants ---------- */

function filteredPeople() {
  const f = $('#peopleFilter').value || 'all';
  let list = state.people;
  if (f === 'other') list = list.filter(p => !state.venues.some(v => v.id === p.venueId));
  else if (f !== 'all') list = list.filter(p => p.venueId === f);
  return [...list].sort((a, b) => (a.venueDate || '').localeCompare(b.venueDate || '') || b.createdAt.localeCompare(a.createdAt));
}

function renderPeople() {
  const filter = $('#peopleFilter');
  const current = filter.value || 'all';
  const orphans = state.people.some(p => !state.venues.some(v => v.id === p.venueId));
  filter.innerHTML = '<option value="all">All days</option>'
    + sortedVenues().map(v => `<option value="${v.id}">${esc(venueLabel(v))}</option>`).join('')
    + (orphans ? '<option value="other">Deleted venues</option>' : '');
  filter.value = [...filter.options].some(o => o.value === current) ? current : 'all';

  const list = filteredPeople();
  $('#peopleEmpty').hidden = list.length > 0;
  const withRoad = list.filter(p => p.roadKm != null);
  const totalKm = withRoad.reduce((s, p) => s + p.roadKm, 0);
  const totalTHB = withRoad.reduce((s, p) => s + receiptAmounts(p).amount, 0);
  $('#peopleSummary').textContent = list.length
    ? `${list.length} participant${list.length === 1 ? '' : 's'}` + (withRoad.length
      ? ` · ${fmtKm(totalKm)} km total road distance (one way) · average ${fmtKm(totalKm / withRoad.length)} km · ${fmtTHB(totalTHB)} THB in total` : '')
    : '';
  $('#fillMissing').hidden = !list.some(p => p.roadKm == null && state.venues.some(v => v.id === p.venueId));

  $('#peopleList').innerHTML = list.map(p => {
    const rough = p.level === 'district' || p.level === 'province';
    const place = [p.tambon, p.amphoe, p.province].filter(Boolean).join(', ');
    const a = receiptAmounts(p);
    return `<li class="item">
      <div>
        <div class="item-title">${esc(p.name || p.nameEn)}</div>
        ${p.name && p.nameEn ? `<div class="item-sub">${esc(p.nameEn)}</div>` : ''}
        <div class="item-sub">${esc(place || p.house)}</div>
        <div class="item-sub muted">${esc(p.venueDate ? fmtDate(p.venueDate) + ' · ' : '')}${esc(p.venueName)}</div>
        <div>
          ${rough ? '<span class="badge warn">Rough location</span>' : ''}
          ${p.hasPhoto ? '' : '<span class="badge warn">No ID photo</span>'}
          ${p.hasSignature ? '<span class="badge ok">Signed</span>' : '<span class="badge warn">Not signed</span>'}
          ${p.consentJoin === false ? '<span class="badge warn">No participation consent</span>' : ''}
          ${p.consentPhoto === false ? '<span class="badge warn">No photo consent</span>' : ''}
        </div>
      </div>
      <div class="item-km">
        <b>${fmtKm(p.roadKm)}</b><small>km by road</small>
        <small>${fmtKm(p.straightKm)} km straight</small>
        ${a ? `<small><b class="thb">${fmtTHB(a.amount)} THB</b></small>` : ''}
      </div>
      <div class="item-actions">
        <button class="btn small primary" data-receipt="${p.id}">Receipt PDF</button>
        <button class="btn small" data-edit="${p.id}">Edit / sign</button>
        <button class="btn small ghost danger" data-del="${p.id}">Delete</button>
      </div>
    </li>`;
  }).join('');
}

$('#peopleFilter').addEventListener('change', renderPeople);

$('#peopleList').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.receipt) {
    const p = state.people.find(x => x.id === b.dataset.receipt);
    downloadReceipts([p], receiptFileName(p), b);
  }
  if (b.dataset.edit) editRecord(b.dataset.edit);
  if (b.dataset.del) {
    const p = state.people.find(x => x.id === b.dataset.del);
    if (!confirm(`Delete ${p.name || p.nameEn} (${p.venueName})?`)) return;
    state.people = state.people.filter(x => x.id !== p.id);
    files.del(p.id);
    savePeople();
    renderPeople();
  }
});

async function recalcRecords(list) {
  let done = 0;
  for (const p of list) {
    const v = state.venues.find(x => x.id === p.venueId);
    if (!v) continue;
    p.venueLat = v.lat;
    p.venueLng = v.lng;
    p.straightKm = haversineKm(p, v);
    let route = null;
    try {
      const r = await routeOSRM(p, v);
      p.roadKm = r.km;
      p.roadMin = r.min;
      route = r.coords;
    } catch {
      p.roadKm = null;
      p.roadMin = null;
    }
    const saved = await files.get(p.id);
    await files.put({ ...(saved || { id: p.id }), route, routeFull: !!route }).catch(() => {});
    done++;
    toast(`Calculating… ${done} / ${list.length}`);
    await sleep(250);
  }
  savePeople();
  renderPeople();
  toast(`Updated ${done} record(s)`, 'ok');
}

$('#fillMissing').addEventListener('click', () => recalcRecords(filteredPeople().filter(p => p.roadKm == null)));

function filterLabel() {
  const f = $('#peopleFilter');
  return f.value === 'all' ? 'all-days' : (f.selectedOptions[0]?.textContent || 'day').replace(/[^\w฀-๿-]+/g, '-');
}

function toCsv(list) {
  const cols = [
    ['Day', p => p.venueDate],
    ['Venue', p => p.venueName],
    ['Name (Thai)', p => p.name],
    ['Name (English)', p => p.nameEn],
    ['Sex', p => ({ M: 'Male', F: 'Female' }[p.sex] || '')],
    ['House / Moo / Road', p => p.house],
    ['Subdistrict', p => p.tambon],
    ['District', p => p.amphoe],
    ['Province', p => p.province],
    ['Road km (one way)', p => receiptAmounts(p)?.oneWay.toFixed(1) ?? ''],
    ['Road km (round trip)', p => receiptAmounts(p)?.roundTrip.toFixed(1) ?? ''],
    ['Rate (THB/km)', p => receiptAmounts(p)?.rate.toFixed(2) ?? ''],
    ['Amount (THB)', p => receiptAmounts(p)?.amount.toFixed(2) ?? ''],
    ['Drive minutes (one way)', p => p.roadMin == null ? '' : Math.round(p.roadMin)],
    ['Straight-line km', p => p.straightKm == null ? '' : p.straightKm.toFixed(1)],
    ['Location accuracy', p => p.level],
    ['Home latitude', p => p.lat.toFixed(6)],
    ['Home longitude', p => p.lng.toFixed(6)],
    ['ID photo', p => (p.hasPhoto ? 'yes' : 'no')],
    ['Signed', p => (p.hasSignature ? 'yes' : 'no')],
    ['Participation consent', p => (p.consentJoin == null ? '' : p.consentJoin ? 'yes' : 'no')],
    ['Photo consent', p => (p.consentPhoto == null ? '' : p.consentPhoto ? 'yes' : 'no')],
    ['Recorded at', p => new Date(p.createdAt).toLocaleString('en-GB')],
  ];
  const cell = v => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [cols.map(c => c[0]), ...list.map(p => cols.map(c => c[1](p)))];
  // BOM so Excel opens the Thai text correctly.
  return '﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n');
}

const byDayThenTime = (a, b) => (a.venueDate || '').localeCompare(b.venueDate || '') || a.createdAt.localeCompare(b.createdAt);

function exportCsv(list, label) {
  if (!list.length) return toast('Nothing to export yet.', 'error');
  download(`participants-${label}-${todayISO()}.csv`, toCsv([...list].sort(byDayThenTime)), 'text/csv;charset=utf-8');
}

$('#exportCsv').addEventListener('click', () => exportCsv(filteredPeople(), filterLabel()));
$('#exportAllCsv').addEventListener('click', () => exportCsv(state.people, 'all-days'));
$('#allReceipts').addEventListener('click', e => {
  const list = [...filteredPeople()].sort(byDayThenTime);
  if (!list.length) return toast('No participants to make receipts for.', 'error');
  downloadReceipts(list, `receipts-${filterLabel()}.pdf`, e.currentTarget);
});

/* ---------- receipts ---------- */

// Round trip uses the rounded one-way figure so every number on the receipt agrees.
function receiptAmounts(p) {
  if (p.roadKm == null) return null;
  const oneWay = Number(p.roadKm.toFixed(1));
  const roundTrip = Number((oneWay * 2).toFixed(1));
  const rate = Number(state.settings.rate) || 0;
  const amount = Math.round(roundTrip * rate * 100) / 100;
  return { oneWay, roundTrip, rate, amount };
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function intToWords(n) {
  if (n === 0) return 'Zero';
  const under1000 = m => {
    const out = [];
    if (m >= 100) { out.push(ONES[Math.floor(m / 100)] + ' Hundred'); m %= 100; }
    if (m >= 20) out.push(TENS[Math.floor(m / 10)] + (m % 10 ? '-' + ONES[m % 10] : ''));
    else if (m > 0) out.push(ONES[m]);
    return out.join(' ');
  };
  const parts = [];
  for (const [size, word] of [[1e9, 'Billion'], [1e6, 'Million'], [1e3, 'Thousand'], [1, '']]) {
    if (n >= size) {
      parts.push(under1000(Math.floor(n / size)) + (word ? ' ' + word : ''));
      n %= size;
    }
  }
  return parts.join(' ');
}

function amountInWords(amount) {
  const satang = Math.round(amount * 100);
  const baht = Math.floor(satang / 100), st = satang % 100;
  return `${intToWords(baht)} Baht` + (st ? ` and ${intToWords(st)} Satang` : '') + ' Only';
}

const RFONT = '"Sarabun", "Leelawadee UI", Thonburi, Tahoma, sans-serif';
let fontsReady = null;
function loadReceiptFonts() {
  if (!fontsReady) {
    fontsReady = Promise.all(['400 24px', '700 24px', 'italic 400 24px'].map(f => document.fonts.load(`${f} Sarabun`, 'กขค ABC'))).catch(() => {});
  }
  return fontsReady;
}

function setFont(ctx, size, weight = 400, style = 'normal') {
  ctx.font = `${style} ${weight} ${size}px ${RFONT}`;
}

const segmenter = window.Intl?.Segmenter ? new Intl.Segmenter('th', { granularity: 'word' }) : null;
function wrapLines(ctx, text, maxW) {
  const lines = [];
  for (const para of String(text || '').split('\n')) {
    const words = segmenter ? [...segmenter.segment(para)].map(s => s.segment) : para.split(/(\s+)/);
    let line = '';
    for (const w of words) {
      if (line.trim() && ctx.measureText(line + w).width > maxW) {
        lines.push(line.trimEnd());
        line = w.trimStart();
      } else {
        line += w;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

function drawContain(ctx, img, x, y, w, h) {
  const s = Math.min(w / img.width, h / img.height);
  const dw = img.width * s, dh = img.height * s;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

// Draws an OpenStreetMap route map (tiles + route + pins) to a canvas, for the receipt.
async function renderRouteMap(home, venue, route, w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d');
  x.fillStyle = '#e8ecef';
  x.fillRect(0, 0, w, h);
  const line = route && route.length > 1 ? route : [[home.lat, home.lng], [venue.lat, venue.lng]];
  const pts = [...line, [home.lat, home.lng], [venue.lat, venue.lng]];
  const project = (lat, lng, z) => {
    const size = 256 * 2 ** z, sin = Math.sin(lat * Math.PI / 180);
    return [(lng + 180) / 360 * size, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size];
  };
  let z = 16, box;
  for (; z >= 3; z--) {
    const ps = pts.map(([a, b]) => project(a, b, z));
    const xs = ps.map(p => p[0]), ys = ps.map(p => p[1]);
    box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    if (box[2] - box[0] <= w * 0.8 && box[3] - box[1] <= h * 0.8) break;
  }
  const ox = (box[0] + box[2]) / 2 - w / 2, oy = (box[1] + box[3]) / 2 - h / 2;
  const n = 2 ** z;
  const jobs = [];
  for (let tx = Math.floor(ox / 256); tx <= Math.floor((ox + w) / 256); tx++) {
    for (let ty = Math.floor(oy / 256); ty <= Math.floor((oy + h) / 256); ty++) {
      if (ty < 0 || ty >= n) continue;
      const wx = ((tx % n) + n) % n;
      jobs.push(loadImg(`${TILE_URL}${z}/${wx}/${ty}.png`, true)
        .then(img => x.drawImage(img, tx * 256 - ox, ty * 256 - oy))
        .catch(() => {}));
    }
  }
  await Promise.all(jobs);

  const px = ([lat, lng]) => { const [a, b] = project(lat, lng, z); return [a - ox, b - oy]; };
  x.lineCap = x.lineJoin = 'round';
  if (!(route && route.length > 1)) x.setLineDash([12, 10]);
  for (const [width, color] of [[9, 'rgba(255,255,255,.9)'], [5, '#0f766e']]) {
    x.lineWidth = width;
    x.strokeStyle = color;
    x.beginPath();
    line.forEach((p, i) => { const [a, b] = px(p); if (i) x.lineTo(a, b); else x.moveTo(a, b); });
    x.stroke();
  }
  x.setLineDash([]);
  const pin = (p, fill, label) => {
    const [a, b] = px(p);
    x.beginPath();
    x.arc(a, b, 15, 0, Math.PI * 2);
    x.fillStyle = fill;
    x.fill();
    x.lineWidth = 3;
    x.strokeStyle = '#fff';
    x.stroke();
    setFont(x, 17, 700);
    x.fillStyle = '#fff';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(label, a, b + 1);
  };
  pin([venue.lat, venue.lng], '#0f766e', 'B');
  pin([home.lat, home.lng], '#d97706', 'A');
  setFont(x, 13);
  const attr = '© OpenStreetMap contributors';
  const aw = x.measureText(attr).width + 10;
  x.fillStyle = 'rgba(255,255,255,.85)';
  x.fillRect(w - aw, h - 20, aw, 20);
  x.fillStyle = '#333';
  x.textAlign = 'right';
  x.textBaseline = 'middle';
  x.fillText(attr, w - 5, h - 10);
  return c;
}

// Draws one A4 receipt (1240 x 1754 px, 150 dpi) and returns the canvas plus the Google Maps link area.
async function drawReceipt(p, saved) {
  await loadReceiptFonts();
  const s = state.settings;
  const a = receiptAmounts(p);
  const venueRef = state.venues.find(v => v.id === p.venueId);
  const venue = { lat: p.venueLat ?? venueRef?.lat, lng: p.venueLng ?? venueRef?.lng };
  const home = { lat: p.lat, lng: p.lng };

  const W = 1240, H = 1754, M = 100, CW = W - 2 * M, LW = 300;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = '#fff';
  x.fillRect(0, 0, W, H);
  x.textBaseline = 'top';
  let y = 80;

  const write = (str, px, py, size, weight = 400, align = 'left', style = 'normal') => {
    setFont(x, size, weight, style);
    x.fillStyle = '#111';
    x.textAlign = align;
    x.fillText(str, px, py);
  };
  const block = (str, px, maxW, size, lh, weight = 400, align = 'left', style = 'normal') => {
    setFont(x, size, weight, style);
    x.fillStyle = '#111';
    x.textAlign = align;
    for (const l of wrapLines(x, str, maxW)) { x.fillText(l, px, y); y += lh; }
  };
  const rule = () => { x.fillStyle = '#111'; x.fillRect(M, y, CW, 2); };
  const row = (label, value, bold = false) => {
    write(label, M, y, 21, 700);
    setFont(x, 21, bold ? 700 : 400);
    const lines = wrapLines(x, value || '–', CW - LW);
    lines.forEach((l, i) => x.fillText(l, M + LW, y + i * 30));
    y += lines.length * 30 + 6;
  };

  write('CASH RECEIPT', W / 2, y, 46, 700, 'center');
  y += 70;
  block(s.receiptTitle, W / 2, CW - 60, 23, 33, 400, 'center', 'italic');
  y += 16;
  if (p.venueDate) { write('Date: ' + fmtDate(p.venueDate), W - M, y, 21, 400, 'right'); y += 34; }

  write('Received FROM', M, y, 24, 700);
  y += 38;
  block(s.receiptFrom, M, CW, 21, 30);
  y += 14;
  rule();
  y += 20;

  write('Description', M, y, 24, 700);
  y += 40;
  row('Name:', p.name);
  row('Name (English):', p.nameEn);
  row('House / Moo / Road:', p.house);
  row('Subdistrict:', p.tambon);
  row('District:', p.amphoe);
  row('Province:', p.province);
  y += 12;
  row('Travel from:', travelFrom(p));
  row('Travel to:', p.venueName + (p.venueDate ? ` (${fmtDate(p.venueDate)})` : ''));
  row('Road km (one way):', `${a.oneWay.toFixed(1)} km`);
  row('Road km (round trip):', `${a.roundTrip.toFixed(1)} km`);
  row('Rate estimates:', `${a.roundTrip.toFixed(1)} km × ${fmtTHB(a.rate)} THB = ${fmtTHB(a.amount)} THB`, true);
  y += 14;

  // Route map and ID photo side by side; the box height shrinks if the text above ran long.
  const gap = 24, bw = Math.floor((CW - gap) / 2);
  const bh = Math.max(220, Math.min(380, H - 60 - y - 400));
  write('Route map', M, y, 19, 700);
  write('ID card photo', M + bw + gap, y, 19, 700);
  y += 30;
  if (Number.isFinite(venue.lat)) {
    // Records saved before full routes were kept only have a coarse line: fetch the full route once.
    let route = saved?.routeFull ? saved.route : null;
    if (!route) {
      try {
        route = (await routeOSRM(home, venue)).coords;
        await files.put({ ...(saved || {}), id: p.id, route, routeFull: true }).catch(() => {});
      } catch {
        route = saved?.route;
      }
    }
    x.drawImage(await renderRouteMap(home, venue, route, bw, bh), M, y);
  }
  if (saved?.photo) {
    x.fillStyle = '#f2f4f6';
    x.fillRect(M + bw + gap, y, bw, bh);
    drawContain(x, await loadImg(saved.photo), M + bw + gap, y, bw, bh);
  } else {
    write('No ID photo recorded', M + bw + gap + bw / 2, y + bh / 2 - 12, 20, 400, 'center');
  }
  x.lineWidth = 2;
  x.strokeStyle = '#999';
  x.strokeRect(M, y, bw, bh);
  x.strokeRect(M + bw + gap, y, bw, bh);
  y += bh + 8;
  write('A = from participant’s address   B = to venue', M, y, 15);
  y += 24;

  const url = Number.isFinite(venue.lat) ? googleMapsUrl(home, venue) : '';
  const linkText = 'Google Maps route: ' + url;
  let size = 15;
  setFont(x, size);
  while (size > 10 && x.measureText(linkText).width > CW) setFont(x, --size);
  x.fillStyle = '#0b57d0';
  x.textAlign = 'left';
  x.fillText(linkText, M, y);
  const link = { x: M, y, w: x.measureText(linkText).width, h: size + 4, url };
  y += 32;
  rule();
  y += 22;

  write('Amount in words:', M, y, 22, 700);
  setFont(x, 22, 400);
  x.fillStyle = '#111';
  const words = wrapLines(x, amountInWords(a.amount), CW - LW);
  words.forEach((l, i) => x.fillText(l, M + LW, y + i * 32));
  y += words.length * 32 + 6;
  write(`(${fmtTHB(a.amount)} THB)`, M + LW, y, 22, 700);
  y += 56;

  const sx = M + LW, sw = 520, sh = 110;
  write('Signed:', M, y + sh - 28, 22, 700);
  if (saved?.signature) drawContain(x, await loadImg(saved.signature), sx, y, sw, sh);
  x.fillStyle = '#111';
  x.fillRect(sx, y + sh + 4, sw, 2);
  write(`( ${p.nameEn || p.name} )`, sx + sw / 2, y + sh + 14, 21, 400, 'center');

  return { canvas: c, link };
}

let jsPdfPromise = null;
function loadJsPdf() {
  if (window.jspdf) return Promise.resolve(window.jspdf.jsPDF);
  if (!jsPdfPromise) {
    jsPdfPromise = new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = JSPDF_URL;
      el.onload = () => resolve(window.jspdf.jsPDF);
      el.onerror = () => { jsPdfPromise = null; reject(new Error('could not load the PDF tool; check the internet connection')); };
      document.head.appendChild(el);
    });
  }
  return jsPdfPromise;
}

// "ต.บ้านเป็ด อ.เมืองขอนแก่น จ.ขอนแก่น" (แขวง/เขต for Bangkok), the start of the trip on the receipt.
function travelFrom(p) {
  const bkk = canonicalProvince(p.province) === 'กรุงเทพมหานคร';
  const t = bare(p.tambon), a = bare(p.amphoe), pr = bare(p.province);
  return [
    t && (bkk ? 'แขวง' : 'ต.') + t,
    a && (bkk ? 'เขต' : 'อ.') + a,
    pr && (bkk ? pr : 'จ.' + pr),
  ].filter(Boolean).join(' ') || p.house;
}

function receiptFileName(p) {
  const who = (p.nameEn || p.name || 'participant').replace(/[\\/:*?"<>|.]+/g, '').trim().replace(/\s+/g, '_');
  return `receipt-${p.venueDate || 'no-date'}-${who}.pdf`;
}

async function downloadReceipts(list, filename, btn) {
  const missing = list.filter(p => p.roadKm == null);
  if (missing.length) {
    return toast(`${missing.length} participant(s) have no road distance yet. Use “Fill in missing road distances” first.`, 'error');
  }
  busy(btn, true, 'Preparing…');
  try {
    const jsPDF = await loadJsPdf();
    const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
    for (let i = 0; i < list.length; i++) {
      if (list.length > 1) btn.textContent = `Preparing ${i + 1} / ${list.length}…`;
      const { canvas, link } = await drawReceipt(list[i], await files.get(list[i].id));
      if (i) doc.addPage();
      doc.addImage(canvas.toDataURL('image/jpeg', 0.85), 'JPEG', 0, 0, 210, 297);
      const k = 210 / canvas.width;
      doc.link(link.x * k, link.y * k, link.w * k, link.h * k, { url: link.url });
    }
    deliverPdf(doc, filename, list.length);
  } catch (err) {
    console.error(err);
    toast('Could not make the receipt: ' + err.message, 'error');
  } finally {
    busy(btn, false);
  }
}

function deliverPdf(doc, filename, pages) {
  const blob = doc.output('blob');
  // Safari only allows a download straight from a tap; after a slow build, ask for one more tap.
  if (navigator.userActivation?.isActive) download(filename, blob);
  else showReady(filename, blob, pages);
}

let readyUrl = null;
function showReady(filename, blob, count) {
  if (readyUrl) URL.revokeObjectURL(readyUrl);
  readyUrl = URL.createObjectURL(blob);
  const a = $('#readyLink');
  a.href = readyUrl;
  a.download = filename;
  $('#readyText').textContent = `${filename} (${count} page${count === 1 ? '' : 's'})`;
  $('#readyDialog').showModal();
}
$('#readyLink').addEventListener('click', () => setTimeout(() => $('#readyDialog').close(), 300));
$('#readyClose').addEventListener('click', () => $('#readyDialog').close());

/* ---------- registration sheet ---------- */

// Columns and relative widths follow the paper form (Form_registration.docx).
const REG_COLS = [
  { en: 'No.', th: 'ลำดับ', w: 692, center: true, always: true, text: (p, n) => String(n) },
  { en: 'Sex', th: 'เพศ', w: 625, center: true, text: p => ({ M: 'M / ชาย', F: 'F / หญิง' }[p.sex] || '') },
  { en: 'Name', th: 'ชื่อ นามสกุล', w: 4115, text: p => [p.name, p.name && p.nameEn ? `(${p.nameEn})` : p.nameEn].filter(Boolean).join(' ') },
  { en: 'Address', th: 'ที่อยู่', w: 2262, text: p => regAddress(p) },
  { en: 'Amphoe', th: 'อำเภอ', w: 2263, text: p => bare(p.amphoe) },
  { en: 'Participation consent', th: 'ยินยอมเข้าร่วม', w: 2265, mark: p => p.consentJoin },
  { en: 'Photo consent', th: 'ยินยอมการถ่ายภาพ', w: 2263, mark: p => p.consentPhoto },
];

function regAddress(p) {
  const bkk = canonicalProvince(p.province) === 'กรุงเทพมหานคร';
  const t = bare(p.tambon);
  return [p.house, t && (bkk ? 'แขวง' : 'ต.') + t].filter(Boolean).join(' ');
}

// ✓ for yes, ✗ for no, nothing when the record predates the consent questions.
function drawMark(x, cx, cy, ok) {
  if (ok == null) return;
  x.save();
  x.lineWidth = 3.5;
  x.lineCap = x.lineJoin = 'round';
  x.strokeStyle = '#111';
  x.beginPath();
  if (ok) {
    x.moveTo(cx - 10, cy);
    x.lineTo(cx - 3, cy + 8);
    x.lineTo(cx + 11, cy - 9);
  } else {
    x.moveTo(cx - 8, cy - 8);
    x.lineTo(cx + 8, cy + 8);
    x.moveTo(cx + 8, cy - 8);
    x.lineTo(cx - 8, cy + 8);
  }
  x.stroke();
  x.restore();
}

// Crops a signature to its ink so it fills the small consent cells.
async function trimSignature(dataUrl) {
  const img = await loadImg(dataUrl);
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const x = c.getContext('2d');
  x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height).data;
  let minX = c.width, minY = c.height, maxX = -1, maxY = -1;
  for (let py = 0; py < c.height; py++) {
    for (let px = 0; px < c.width; px++) {
      if (d[(py * c.width + px) * 4 + 3] > 20) {
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      }
    }
  }
  if (maxX < 0) return null;
  const pad = 6;
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(c.width - 1, maxX + pad); maxY = Math.min(c.height - 1, maxY + pad);
  const out = document.createElement('canvas');
  out.width = maxX - minX + 1;
  out.height = maxY - minY + 1;
  out.getContext('2d').drawImage(c, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

// A4 landscape pages (150 dpi) for one venue/day; spare numbered rows fill the last page for walk-ins.
async function drawRegistrationPages(group) {
  await loadReceiptFonts();
  const sigs = new Map();
  for (const p of group.people) {
    const saved = p.hasSignature ? await files.get(p.id) : null;
    if (saved?.signature) sigs.set(p.id, await trimSignature(saved.signature).catch(() => null));
  }
  const W = 1754, H = 1240, M = 75, CW = W - 2 * M;
  const FS = 16, LH = 21, PAD = 7, MIN_ROW = 42, HEAD_H = 64, TOP = 140, FOOT = 30;
  const total = REG_COLS.reduce((s, c) => s + c.w, 0);
  const cols = REG_COLS.map(c => ({ ...c, px: c.w * CW / total }));
  const scratch = document.createElement('canvas').getContext('2d');
  setFont(scratch, FS);
  const rowFor = (p, n) => {
    const cells = cols.map(c => (c.text && (p || c.always) ? wrapLines(scratch, c.text(p || {}, n), c.px - 2 * PAD) : []));
    const lines = Math.max(1, ...cells.map(l => l.length));
    return { p, n, cells, h: Math.max(MIN_ROW, lines * LH + 2 * PAD) };
  };

  const avail = H - M - TOP - HEAD_H - FOOT - M;
  const pages = [];
  let cur = [], used = 0, n = 0;
  for (const p of group.people) {
    const r = rowFor(p, ++n);
    if (cur.length && used + r.h > avail) { pages.push(cur); cur = []; used = 0; }
    cur.push(r);
    used += r.h;
  }
  while (used + MIN_ROW <= avail) {
    const r = rowFor(null, ++n);
    cur.push(r);
    used += r.h;
  }
  pages.push(cur);

  return pages.map((rows, pi) => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const x = c.getContext('2d');
    x.fillStyle = '#fff';
    x.fillRect(0, 0, W, H);
    x.textBaseline = 'top';
    x.textAlign = 'left';

    let y = M;
    setFont(x, 26, 700);
    x.fillStyle = '#3a3a3a';
    x.fillText((state.settings.regTitle || '').toUpperCase(), M, y);
    y += 44;
    for (const [label, value] of [['LOCATION', group.name], ['DATE', group.date ? fmtDate(group.date) : '']]) {
      setFont(x, 20, 700);
      x.fillStyle = '#3a3a3a';
      x.fillText(label, M, y);
      setFont(x, 20, 400);
      x.fillStyle = '#111';
      x.fillText(value || '', M + 130, y);
      y += 32;
    }

    y = M + TOP;
    x.fillStyle = '#E5ECF4';
    x.fillRect(M, y, CW, HEAD_H);
    let cx = M;
    x.textAlign = 'center';
    x.fillStyle = '#111';
    for (const col of cols) {
      setFont(x, 16, 700);
      x.fillText(col.en, cx + col.px / 2, y + 10);
      setFont(x, 16, 400);
      x.fillText(col.th, cx + col.px / 2, y + 34);
      cx += col.px;
    }
    const tableTop = y;
    y += HEAD_H;

    setFont(x, FS, 400);
    for (const r of rows) {
      cx = M;
      cols.forEach((col, ci) => {
        if (col.mark) {
          // Consent given: the participant's signature; otherwise ✓ / ✗.
          const ok = r.p && col.mark(r.p);
          const sig = r.p && sigs.get(r.p.id);
          if (ok && sig) drawContain(x, sig, cx + PAD, y + 4, col.px - 2 * PAD, r.h - 8);
          else if (r.p) drawMark(x, cx + col.px / 2, y + r.h / 2, ok);
        } else {
          const lines = r.cells[ci];
          const top = y + (r.h - lines.length * LH) / 2 + 1;
          x.textAlign = col.center ? 'center' : 'left';
          x.fillStyle = '#111';
          lines.forEach((l, li) => x.fillText(l, col.center ? cx + col.px / 2 : cx + PAD, top + li * LH));
        }
        cx += col.px;
      });
      y += r.h;
    }

    // Grid: horizontal lines under the header and each row, vertical lines between columns.
    x.strokeStyle = '#999';
    x.lineWidth = 1.5;
    x.beginPath();
    let ly = tableTop;
    x.moveTo(M, ly); x.lineTo(M + CW, ly);
    ly += HEAD_H;
    x.moveTo(M, ly); x.lineTo(M + CW, ly);
    for (const r of rows) { ly += r.h; x.moveTo(M, ly); x.lineTo(M + CW, ly); }
    cx = M;
    x.moveTo(cx, tableTop); x.lineTo(cx, ly);
    for (const col of cols) { cx += col.px; x.moveTo(cx, tableTop); x.lineTo(cx, ly); }
    x.stroke();

    setFont(x, 14, 400);
    x.fillStyle = '#666';
    x.textAlign = 'right';
    x.fillText(`Page ${pi + 1} of ${pages.length}`, M + CW, H - M - 18);
    return c;
  });
}

// One group per venue/day for the current filter, people in registration order.
function registrationGroups() {
  const f = $('#peopleFilter').value || 'all';
  const byTime = (a, b) => a.createdAt.localeCompare(b.createdAt);
  if (f !== 'all' && f !== 'other') {
    const v = state.venues.find(x => x.id === f);
    return [{ name: v.name, date: v.date, people: state.people.filter(p => p.venueId === f).sort(byTime) }];
  }
  const groups = new Map();
  for (const p of state.people) {
    const v = state.venues.find(x => x.id === p.venueId);
    if (f === 'other' && v) continue;
    const key = p.venueId || p.venueName;
    if (!groups.has(key)) groups.set(key, { name: v?.name || p.venueName, date: v?.date ?? p.venueDate, people: [] });
    groups.get(key).people.push(p);
  }
  return [...groups.values()]
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    .map(g => ({ ...g, people: g.people.sort(byTime) }));
}

$('#regSheet').addEventListener('click', async e => {
  const btn = e.currentTarget;
  const groups = registrationGroups();
  if (!groups.length) return toast('No participants yet. Choose a day to print a blank registration sheet.', 'error');
  busy(btn, true, 'Preparing…');
  try {
    const jsPDF = await loadJsPdf();
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
    let pages = 0;
    for (const g of groups) {
      for (const canvas of await drawRegistrationPages(g)) {
        if (pages++) doc.addPage('a4', 'landscape');
        doc.addImage(canvas.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, 297, 210);
      }
    }
    deliverPdf(doc, `registration-${filterLabel()}.pdf`, pages);
  } catch (err) {
    console.error(err);
    toast('Could not make the registration sheet: ' + err.message, 'error');
  } finally {
    busy(btn, false);
  }
});

/* ---------- settings ---------- */

function renderSettings() {
  $$('input[name="reader"]').forEach(r => { r.checked = r.value === state.settings.reader; });
  $('#aiSettings').hidden = state.settings.reader !== 'ai';
  $('#apiKey').value = state.settings.apiKey;
  $('#model').value = state.settings.model;
  $('#rTitle').value = state.settings.receiptTitle;
  $('#rFrom').value = state.settings.receiptFrom;
  $('#rRate').value = state.settings.rate;
  $('#regTitle').value = state.settings.regTitle;
}

$$('input[name="reader"]').forEach(r => r.addEventListener('change', () => {
  state.settings.reader = r.value;
  saveSettings();
  renderSettings();
}));
$('#apiKey').addEventListener('change', e => { state.settings.apiKey = e.target.value.trim(); saveSettings(); toast('API key saved on this device', 'ok'); });
$('#model').addEventListener('change', e => { state.settings.model = e.target.value; saveSettings(); });
$('#rTitle').addEventListener('change', e => { state.settings.receiptTitle = e.target.value.trim(); saveSettings(); toast('Receipt title saved', 'ok'); });
$('#rFrom').addEventListener('change', e => { state.settings.receiptFrom = e.target.value.trim(); saveSettings(); toast('Receipt address saved', 'ok'); });
$('#regTitle').addEventListener('change', e => { state.settings.regTitle = e.target.value.trim(); saveSettings(); toast('Registration sheet title saved', 'ok'); });
$('#rRate').addEventListener('change', e => {
  const rate = parseFloat(e.target.value);
  if (!(rate >= 0)) { toast('Enter a valid rate.', 'error'); renderSettings(); return; }
  state.settings.rate = rate;
  saveSettings();
  toast(`Rate set to ${fmtTHB(rate)} THB per km`, 'ok');
});

$('#backupBtn').addEventListener('click', async e => {
  const btn = e.currentTarget;
  busy(btn, true, 'Preparing…');
  try {
    const all = await files.all().catch(() => []);
    const data = { app: 'workshop-distance', version: 2, exportedAt: new Date().toISOString(), venues: state.venues, people: state.people, files: all };
    download(`workshop-distance-backup-${todayISO()}.json`, JSON.stringify(data), 'application/json');
  } finally {
    busy(btn, false);
  }
});

$('#restoreInput').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'workshop-distance' || !Array.isArray(data.people) || !Array.isArray(data.venues)) throw new Error('not a backup from this app');
    if (!confirm(`Add ${data.people.length} participant(s) and ${data.venues.length} venue(s) from this backup? Records already on this device are kept; the same records are updated.`)) return;
    const merge = (target, items) => items.forEach(it => {
      const i = target.findIndex(x => x.id === it.id);
      if (i >= 0) target[i] = it; else target.push(it);
    });
    merge(state.venues, data.venues);
    merge(state.people, data.people);
    for (const f of data.files || []) await files.put(f);
    savePeople();
    saveVenues();
    renderPeople();
    toast('Backup imported', 'ok');
  } catch (err) {
    toast('Could not import: ' + err.message, 'error');
  }
});

$('#clearPeople').addEventListener('click', async () => {
  if (!state.people.length) return;
  if (!confirm(`Delete all ${state.people.length} participant records, ID photos and signatures from this device? Download a backup first if you need them.`)) return;
  state.people = [];
  await files.clear();
  savePeople();
  renderPeople();
  renderVenues();
  toast('Participants deleted');
});

$('#clearAll').addEventListener('click', async () => {
  if (!confirm('Delete all participants, ID photos, signatures, venues, settings and the saved API key from this device?')) return;
  ['venues', 'people', 'settings', 'activeVenue', 'geocache'].forEach(k => { try { localStorage.removeItem('wd.' + k); } catch { /* ignore */ } });
  await files.clear();
  location.reload();
});

/* ---------- start ---------- */

document.addEventListener('click', e => {
  const g = e.target.closest('[data-goto]');
  if (g) showTab(g.dataset.goto);
});

$('#provinceList').innerHTML = PROVINCES.map(p => `<option value="${p}">`).join('');
setupSignaturePad();
const todays = sortedVenues().find(v => v.date === todayISO());
if (todays) state.activeVenueId = todays.id;
handleSetupLink();
renderVenueSelect();
renderVenues();
renderPeople();
renderSettings();
renderDistances();
showIdThumb();
