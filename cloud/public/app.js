const $ = id => document.getElementById(id);
let currentHours = 24;
let timer;

const value = (v, digits = 0) => v == null ? '—' : Number(v).toFixed(digits);
const when = iso => iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const clock = minutes => {
  if (minutes == null) return '—';
  const rounded = Math.max(0, Math.round(minutes));
  return rounded < 60 ? `${rounded} min` : `${Math.floor(rounded / 60)}h ${rounded % 60}m`;
};

function showLogin() {
  $('login').hidden = false; $('dashboard').hidden = true; $('signout').hidden = true;
  $('connection').textContent = 'Private dashboard'; $('connection').className = 'connection';
  clearInterval(timer);
}

function showDashboard() {
  $('login').hidden = true; $('dashboard').hidden = false; $('signout').hidden = false;
  refresh(); clearInterval(timer); timer = setInterval(refresh, 30000);
}

async function get(url) {
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
  if (response.status === 401) { showLogin(); throw new Error('Sign in required'); }
  if (!response.ok) throw new Error(`Server error ${response.status}`);
  return response.json();
}

function renderStatus({ sample: s, status }) {
  const titles = { no_data: 'Waiting for battery data', stale: 'Connection needs attention', fault: 'Battery fault reported', discharging: 'Running on battery', charging: 'Battery charging', idle: 'Battery standing by' };
  $('state-title').textContent = titles[status] || 'Battery status';
  $('state-detail').textContent = status === 'no_data' ? 'The site is ready. A local receiver will need to send readings before live monitoring begins.' : status === 'stale' ? 'The last reading is old. Charge and time remaining may have changed.' : status === 'discharging' && s.charge_percent != null && s.charge_percent < 15 ? 'Low charge. Save your work and shut down the PC soon.' : status === 'fault' ? 'Check the battery and its app for details.' : 'Latest readings from your P210.';
  $('last-update').textContent = s ? `UPDATED ${when(s.received_at).toUpperCase()}` : 'NO READING YET';
  $('connection').textContent = status === 'stale' ? 'Data is stale' : status === 'no_data' ? 'Awaiting receiver' : 'Live data';
  $('connection').className = `connection ${status === 'stale' || status === 'fault' ? 'warning' : status === 'no_data' ? '' : 'live'}`;
  $('charge-big').textContent = s?.charge_percent == null ? '—' : `${Math.round(s.charge_percent)}%`;
  $('battery-fill').style.height = `${s?.charge_percent ?? 0}%`;
  $('input').textContent = value(s?.input_w); $('output').textContent = value(s?.output_w);
  $('remaining').textContent = status === 'discharging' ? clock(s?.remaining_minutes) : '—';
  $('remaining-detail').textContent = status === 'stale' ? 'Last reading is old' : status === 'discharging' ? 'Battery estimate while discharging' : 'Shown while discharging';
  $('grid').textContent = s?.grid_present == null ? '—' : s.grid_present ? 'Present' : 'Absent';
  $('input-detail').textContent = s?.ac_input_w != null || s?.dc_input_w != null ? `AC ${value(s.ac_input_w)} W · DC ${value(s.dc_input_w)} W` : 'All input sources';
  $('health-title').textContent = status === 'no_data' ? 'No data yet' : status === 'stale' ? 'Reading is stale' : status === 'fault' ? 'Fault reported' : 'Receiving readings';
  $('health-detail').textContent = s ? `Last received ${when(s.received_at)}. Device ${s.device_id}.` : 'Connection information will appear after the first reading.';
  const raw = (() => { try { return JSON.parse(s?.raw_json || '{}'); } catch { return {}; } })();
  const entries = Object.entries(raw).slice(0, 150);
  $('raw-readings').replaceChildren();
  if (!entries.length) $('raw-readings').textContent = 'No raw fields received yet.';
  else for (const [key, val] of entries) {
    const row = document.createElement('div'), label = document.createElement('span'), reading = document.createElement('strong');
    label.textContent = key; reading.textContent = typeof val === 'object' ? JSON.stringify(val) : String(val);
    row.append(label, reading); $('raw-readings').append(row);
  }
}

function renderChart(samples, hours) {
  const points = samples.filter(s => s.charge_percent != null && Number.isFinite(Date.parse(s.recorded_at)));
  $('chart-empty').hidden = points.length > 0;
  $('range-start').textContent = when(new Date(Date.now() - hours * 3600000).toISOString());
  $('range-end').textContent = when(new Date().toISOString());
  if (!points.length) { $('chart-line').setAttribute('d', ''); $('chart-area').setAttribute('d', ''); return; }
  const start = Date.now() - hours * 3600000, width = hours * 3600000;
  const coords = points.map(s => [Math.max(0, Math.min(1000, (Date.parse(s.recorded_at) - start) / width * 1000)), 240 - Number(s.charge_percent) * 2.4]);
  const segments = [];
  let segment = [];
  for (let i = 0; i < coords.length; i++) {
    if (i && Date.parse(points[i].recorded_at) - Date.parse(points[i-1].recorded_at) > Math.max(120000, width / 50)) { segments.push(segment); segment = []; }
    segment.push(coords[i]);
  }
  segments.push(segment);
  $('chart-line').setAttribute('d', segments.map(seg => seg.map(([x,y],i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')).join(' '));
  $('chart-area').setAttribute('d', segments.map(seg => seg.length > 1 ? `M${seg[0][0].toFixed(1)} 240 ` + seg.map(([x,y]) => `L${x.toFixed(1)} ${y.toFixed(1)}`).join(' ') + ` L${seg.at(-1)[0].toFixed(1)} 240 Z` : '').join(' '));
}

async function refresh() {
  try { const [status, history] = await Promise.all([get('/api/status'), get(`/api/history?hours=${currentHours}`)]); renderStatus(status); renderChart(history.samples, currentHours); }
  catch (error) { if (error.message !== 'Sign in required') { $('connection').textContent = 'Website unavailable'; $('connection').className = 'connection warning'; } }
}

$('login-form').addEventListener('submit', async event => {
  event.preventDefault(); $('login-error').textContent = '';
  const response = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: $('password').value }) });
  if (response.ok) { $('password').value = ''; showDashboard(); } else $('login-error').textContent = (await response.json()).error || 'Could not sign in';
});
$('signout').addEventListener('click', async () => { await fetch('/api/logout', { method: 'POST' }); showLogin(); });
document.querySelectorAll('[data-hours]').forEach(button => button.addEventListener('click', () => { currentHours = Number(button.dataset.hours); document.querySelectorAll('[data-hours]').forEach(b => b.classList.toggle('selected', b === button)); refresh(); }));
get('/api/status').then(() => showDashboard()).catch(() => showLogin());

