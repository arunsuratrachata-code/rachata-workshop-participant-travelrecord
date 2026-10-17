/* Workshop Distance
 * Reads a participant's address from a Thai ID card photo, places the home on a map
 * and calculates the travel distance to the workshop venue for the selected day.
 * Everything runs in the browser; data is kept in this device's local storage.
 */

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.131.0/+esm';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const OSRM_URL = 'https://router.project-osrm.org/route/v1/driving/';

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
  required: ['name', 'house', 'subdistrict', 'district', 'province', 'full_address'],
  properties: {
    name: { type: 'string' },
    house: { type: 'string' },
    subdistrict: { type: 'string' },
    district: { type: 'string' },
    province: { type: 'string' },
    full_address: { type: 'string' },
  },
};

const ID_PROMPT = `This is a photo of the front of a Thai national ID card. Read the holder's name and the registered address (ที่อยู่) exactly as printed, in Thai.
- name: the Thai full name with title (นาย / นาง / นางสาว ...).
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

const state = {
  venues: store.get('venues', []),
  people: store.get('people', []),
  settings: Object.assign({ reader: 'ocr', apiKey: '', model: 'claude-opus-5-5' }, store.get('settings', {})),
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
  const url = URL.createObjectURL(new Blob([content], { type }));
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
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
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

async function routeOSRM(a, b) {
  const url = `${OSRM_URL}${a.lng},${a.lat};${b.lng},${b.lat}?overview=simplified&geometries=geojson`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`routing returned ${res.status}`);
  const j = await res.json();
  if (j.code !== 'Ok' || !j.routes?.length) throw new Error(j.message || 'no route found');
  const r = j.routes[0];
  return { km: r.distance / 1000, min: r.duration / 60, coords: r.geometry.coordinates.map(([x, y]) => [y, x]) };
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

let ocrWorkerPromise = null;
let ocrProgress = null;

async function readWithOcr(img) {
  if (!window.Tesseract) throw new Error('The text reader did not load. Check the internet connection and reload the page.');
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = Tesseract.createWorker(['tha', 'eng'], 1, { logger: m => ocrProgress && ocrProgress(m) });
    ocrWorkerPromise.catch(() => { ocrWorkerPromise = null; });
  }
  ocrProgress = m => {
    if (m.status === 'recognizing text') setProgress('Reading the card…', m.progress);
    else if (/load/.test(m.status)) setProgress('Downloading the Thai reader (first time only)…', m.progress);
  };
  try {
    const worker = await ocrWorkerPromise;
    setProgress('Reading the card…', 0);
    const { data } = await worker.recognize(prepareForOcr(img));
    return parseThaiId(data.text);
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
    house: out.house,
    tambon: out.subdistrict,
    amphoe: out.district,
    province: canonicalProvince(out.province) || out.province,
    raw: out.full_address,
  };
}

const PROVINCE_MARK = /(?:จ\.|จังหวัด)\s*[ก-๙]|กรุงเทพ/;

function parseThaiId(text) {
  const lines = cleanThai(text).split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean);

  let name = '';
  for (const l of lines) {
    const m = l.match(/ชื่อ\s*ตัว\s*และ\s*ชื่อ\s*สกุล\s*[:.]?\s*(.+)/);
    if (m) { name = m[1]; break; }
  }
  if (!name) name = lines.find(l => /^(?:นาย|นางสาว|นาง|เด็กชาย|เด็กหญิง|ด\.ช\.|ด\.ญ\.)\s*[ก-๙]/.test(l)) || '';
  if (!name) {
    const first = lines.filter(l => !/last\s*name/i.test(l)).map(l => l.match(/(?:^|[^a-z])Name\s+(.+)/i)).find(Boolean);
    const last = lines.map(l => l.match(/Last\s*name\s+(.+)/i)).find(Boolean);
    name = [first?.[1], last?.[1]].filter(Boolean).join(' ');
  }
  name = name.replace(/[^ก-๙a-zA-Z.\s]/g, ' ').replace(/\s+/g, ' ').trim();

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

  return { name, ...splitThaiAddress(addr), raw: text.trim() };
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
          ${active ? '<span class="badge">Scanning for this</span>' : ''}</div>
        <div class="item-sub">${v.date ? esc(fmtDate(v.date)) : 'No date'} · ${n} participant${n === 1 ? '' : 's'}</div>
        <div class="item-sub muted">${esc(v.address || `${v.lat.toFixed(5)}, ${v.lng.toFixed(5)}`)}</div>
      </div>
      <div></div>
      <div class="item-actions">
        ${active ? '' : `<button class="btn small" data-use="${v.id}">Scan for this venue</button>`}
        <button class="btn small" data-edit="${v.id}">Edit</button>
        <button class="btn small ghost danger" data-del="${v.id}">Delete</button>
      </div>
    </li>`;
  }).join('');
}

$('#venueList').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.use) { setActiveVenue(b.dataset.use); toast('New scans will use this venue'); }
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
    try { await navigator.share({ title: 'Workshop Distance venues', url: link }); return; } catch { /* cancelled: fall through to copy */ }
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

/* ---------- scan screen ---------- */

const scan = { editingId: null, home: null, level: '', geoLabel: '', dist: null, routePromise: null, routeToken: 0, previewUrl: null };
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

function setProgress(label, p) {
  $('#readingText').textContent = label;
  $('#progressBar').style.width = Math.round(Math.max(0.05, Math.min(1, p || 0)) * 100) + '%';
}

function readForm() {
  return {
    name: oneLine($('#fName').value),
    house: oneLine($('#fHouse').value),
    tambon: oneLine($('#fTambon').value),
    amphoe: oneLine($('#fAmphoe').value),
    province: oneLine($('#fProvince').value),
  };
}

function fillForm(r) {
  $('#fName').value = r.name || '';
  $('#fHouse').value = r.house || '';
  $('#fTambon').value = r.tambon || '';
  $('#fAmphoe').value = r.amphoe || '';
  $('#fProvince').value = r.province || '';
  $('#rawText').textContent = r.raw || '';
  $('#rawBox').hidden = !r.raw;
}

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
  resetScan();
  const wantAI = state.settings.reader === 'ai';
  const useAI = wantAI && !!state.settings.apiKey;
  if (wantAI && !useAI) toast('No API key set, so the on-device reader is used.', 'error');
  $('#reading').hidden = false;
  setProgress('Opening photo…', 0.05);
  try {
    const img = await loadImage(file);
    $('#preview').src = scan.previewUrl;
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
  }
}

function resetScan() {
  scan.editingId = null;
  scan.home = null;
  scan.level = '';
  scan.geoLabel = '';
  scan.dist = null;
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
  renderDistances();
}

async function saveRecord(asNew) {
  const f = readForm();
  const v = activeVenue();
  if (!v) return toast('Choose or add a venue first.', 'error');
  if (!f.name) { toast('Enter the participant’s name.', 'error'); $('#fName').focus(); return; }
  if (!scan.home) return toast('Find the home location first.', 'error');
  const existing = !asNew && scan.editingId ? state.people.find(p => p.id === scan.editingId) : null;
  if (!existing) {
    const dup = state.people.find(p => p.venueId === v.id && bare(p.name) === bare(f.name));
    if (dup && !confirm(`${f.name} is already recorded for this venue. Save another record?`)) return;
  }
  const btn = asNew ? $('#saveNewBtn') : $('#saveBtn');
  busy(btn, true, 'Saving…');
  if (scan.routePromise) await scan.routePromise;
  busy(btn, false);
  const now = new Date().toISOString();
  const rec = {
    id: existing?.id || uid(),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    venueId: v.id,
    venueName: v.name,
    venueDate: v.date || '',
    ...f,
    lat: scan.home.lat,
    lng: scan.home.lng,
    level: scan.level,
    geoLabel: scan.geoLabel,
    straightKm: scan.dist?.straightKm ?? null,
    roadKm: scan.dist?.roadKm ?? null,
    roadMin: scan.dist?.roadMin ?? null,
  };
  if (existing) state.people[state.people.indexOf(existing)] = rec;
  else state.people.push(rec);
  if (!savePeople()) return;
  toast(`Saved ${rec.name}: ${fmtKm(rec.roadKm ?? rec.straightKm)} km`, 'ok');
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

function editRecord(id) {
  const p = state.people.find(x => x.id === id);
  if (!p) return;
  resetScan();
  if (state.venues.some(v => v.id === p.venueId)) setActiveVenue(p.venueId);
  showTab('scan');
  fillForm(p);
  scan.editingId = id;
  $('#editName').textContent = p.name;
  $('#editBanner').hidden = false;
  $('#saveBtn').textContent = 'Update record';
  $('#saveNewBtn').hidden = false;
  showResultCard();
  setHome({ lat: p.lat, lng: p.lng }, p.level, p.geoLabel, true);
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
  const total = withRoad.reduce((s, p) => s + p.roadKm, 0);
  $('#peopleSummary').textContent = list.length
    ? `${list.length} participant${list.length === 1 ? '' : 's'}` + (withRoad.length
      ? ` · ${fmtKm(total)} km total road distance (one way) · average ${fmtKm(total / withRoad.length)} km` : '')
    : '';
  $('#fillMissing').hidden = !list.some(p => p.roadKm == null && state.venues.some(v => v.id === p.venueId));

  $('#peopleList').innerHTML = list.map(p => {
    const rough = p.level === 'district' || p.level === 'province';
    const place = [p.tambon, p.amphoe, p.province].filter(Boolean).join(', ');
    return `<li class="item">
      <div>
        <div class="item-title">${esc(p.name)}</div>
        <div class="item-sub">${esc(place || p.house)}</div>
        <div class="item-sub muted">${esc(p.venueDate ? fmtDate(p.venueDate) + ' · ' : '')}${esc(p.venueName)}
          ${rough ? '<span class="badge warn">Rough location</span>' : ''}</div>
      </div>
      <div class="item-km">
        <b>${fmtKm(p.roadKm)}</b><small>km by road</small>
        <small>${fmtKm(p.straightKm)} km straight</small>
      </div>
      <div class="item-actions">
        <button class="btn small" data-edit="${p.id}">Edit / check pin</button>
        <button class="btn small ghost danger" data-del="${p.id}">Delete</button>
      </div>
    </li>`;
  }).join('');
}

$('#peopleFilter').addEventListener('change', renderPeople);

$('#peopleList').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.edit) editRecord(b.dataset.edit);
  if (b.dataset.del) {
    const p = state.people.find(x => x.id === b.dataset.del);
    if (!confirm(`Delete ${p.name} (${p.venueName})?`)) return;
    state.people = state.people.filter(x => x.id !== p.id);
    savePeople();
    renderPeople();
  }
});

async function recalcRecords(list) {
  let done = 0;
  for (const p of list) {
    const v = state.venues.find(x => x.id === p.venueId);
    if (!v) continue;
    p.straightKm = haversineKm(p, v);
    try {
      const r = await routeOSRM(p, v);
      p.roadKm = r.km;
      p.roadMin = r.min;
    } catch {
      p.roadKm = null;
      p.roadMin = null;
    }
    done++;
    toast(`Calculating… ${done} / ${list.length}`);
    await sleep(250);
  }
  savePeople();
  renderPeople();
  toast(`Updated ${done} record(s)`, 'ok');
}

$('#fillMissing').addEventListener('click', () => recalcRecords(filteredPeople().filter(p => p.roadKm == null)));

function toCsv(list) {
  const cols = [
    ['Day', p => p.venueDate],
    ['Venue', p => p.venueName],
    ['Name', p => p.name],
    ['House / Moo / Road', p => p.house],
    ['Subdistrict', p => p.tambon],
    ['District', p => p.amphoe],
    ['Province', p => p.province],
    ['Road km (one way)', p => p.roadKm == null ? '' : p.roadKm.toFixed(1)],
    // Double the rounded one-way figure so the two columns always agree.
    ['Road km (round trip)', p => p.roadKm == null ? '' : (Number(p.roadKm.toFixed(1)) * 2).toFixed(1)],
    ['Drive minutes (one way)', p => p.roadMin == null ? '' : Math.round(p.roadMin)],
    ['Straight-line km', p => p.straightKm == null ? '' : p.straightKm.toFixed(1)],
    ['Location accuracy', p => p.level],
    ['Home latitude', p => p.lat.toFixed(6)],
    ['Home longitude', p => p.lng.toFixed(6)],
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

function exportCsv(list, label) {
  if (!list.length) return toast('Nothing to export yet.', 'error');
  const sorted = [...list].sort((a, b) => (a.venueDate || '').localeCompare(b.venueDate || '') || a.createdAt.localeCompare(b.createdAt));
  download(`participants-${label}-${todayISO()}.csv`, toCsv(sorted), 'text/csv;charset=utf-8');
}

$('#exportCsv').addEventListener('click', () => {
  const f = $('#peopleFilter');
  const label = f.value === 'all' ? 'all-days' : (f.selectedOptions[0]?.textContent || 'day').replace(/[^\w฀-๿-]+/g, '-');
  exportCsv(filteredPeople(), label);
});
$('#exportAllCsv').addEventListener('click', () => exportCsv(state.people, 'all-days'));

/* ---------- settings ---------- */

function renderSettings() {
  $$('input[name="reader"]').forEach(r => { r.checked = r.value === state.settings.reader; });
  $('#aiSettings').hidden = state.settings.reader !== 'ai';
  $('#apiKey').value = state.settings.apiKey;
  $('#model').value = state.settings.model;
}

$$('input[name="reader"]').forEach(r => r.addEventListener('change', () => {
  state.settings.reader = r.value;
  saveSettings();
  renderSettings();
}));
$('#apiKey').addEventListener('change', e => { state.settings.apiKey = e.target.value.trim(); saveSettings(); toast('API key saved on this device', 'ok'); });
$('#model').addEventListener('change', e => { state.settings.model = e.target.value; saveSettings(); });

$('#backupBtn').addEventListener('click', () => {
  const data = { app: 'workshop-distance', version: 1, exportedAt: new Date().toISOString(), venues: state.venues, people: state.people };
  download(`workshop-distance-backup-${todayISO()}.json`, JSON.stringify(data, null, 1), 'application/json');
});

$('#restoreInput').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'workshop-distance' || !Array.isArray(data.people) || !Array.isArray(data.venues)) throw new Error('not a Workshop Distance backup');
    if (!confirm(`Add ${data.people.length} participant(s) and ${data.venues.length} venue(s) from this backup? Records already on this device are kept; the same records are updated.`)) return;
    const merge = (target, items) => items.forEach(it => {
      const i = target.findIndex(x => x.id === it.id);
      if (i >= 0) target[i] = it; else target.push(it);
    });
    merge(state.venues, data.venues);
    merge(state.people, data.people);
    savePeople();
    saveVenues();
    renderPeople();
    toast('Backup imported', 'ok');
  } catch (err) {
    toast('Could not import: ' + err.message, 'error');
  }
});

$('#clearPeople').addEventListener('click', () => {
  if (!state.people.length) return;
  if (!confirm(`Delete all ${state.people.length} participant records from this device? Export a CSV or backup first if you need them.`)) return;
  state.people = [];
  savePeople();
  renderPeople();
  renderVenues();
  toast('Participants deleted');
});

$('#clearAll').addEventListener('click', () => {
  if (!confirm('Delete all participants, venues, settings and the saved API key from this device?')) return;
  ['venues', 'people', 'settings', 'activeVenue', 'geocache'].forEach(k => { try { localStorage.removeItem('wd.' + k); } catch { /* ignore */ } });
  location.reload();
});

/* ---------- start ---------- */

document.addEventListener('click', e => {
  const g = e.target.closest('[data-goto]');
  if (g) showTab(g.dataset.goto);
});

$('#provinceList').innerHTML = PROVINCES.map(p => `<option value="${p}">`).join('');
const todays = sortedVenues().find(v => v.date === todayISO());
if (todays) state.activeVenueId = todays.id;
handleSetupLink();
renderVenueSelect();
renderVenues();
renderPeople();
renderSettings();
renderDistances();
