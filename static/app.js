'use strict';

// ---------------------------------------------------------------------------
// PWA Service Worker & Install Prompt (shared by login and dashboard)
// ---------------------------------------------------------------------------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

(() => {
  const installBtn = document.getElementById('pwa-install-btn');
  const iosDialog = document.getElementById('ios-install-dialog');
  if (!installBtn) return;

  let deferredPrompt = null;
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;
  const isIOS = /iphone|ipad|ipod/i.test(window.navigator.userAgent);

  if (isStandalone) {
    installBtn.hidden = true;
    return;
  }

  if (isIOS) {
    installBtn.hidden = false;
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    installBtn.hidden = false;
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    installBtn.hidden = true;
  });

  installBtn.addEventListener('click', async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        deferredPrompt = null;
        installBtn.hidden = true;
      }
      return;
    }
    if (isIOS && iosDialog) {
      iosDialog.showModal();
    }
  });
})();

document.querySelectorAll('[data-close]').forEach((button) => {
  button.addEventListener('click', () => {
    const dlg = document.getElementById(button.dataset.close);
    if (dlg) dlg.close();
  });
});

// ---------------------------------------------------------------------------
// Login / Registration Page
// ---------------------------------------------------------------------------
if (document.getElementById('auth-form')) {
  const form = document.getElementById('auth-form');
  const errorEl = document.getElementById('auth-error');
  const demoBtn = document.getElementById('demo-login');

  function showAuthError(msg) {
    errorEl.textContent = msg;
    errorEl.hidden = !msg;
  }

  async function authenticate(action) {
    if (!form.reportValidity()) return;
    showAuthError('');
    const fields = new FormData(form);
    const result = await fetch(`/api/auth/${action}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'chatbot' },
      body: JSON.stringify({
        username: fields.get('username'),
        password: fields.get('password'),
      }),
    });
    const data = await result.json();
    if (!result.ok) throw new Error(data.error || 'Đăng nhập thất bại.');
    location.assign('/');
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    authenticate('login').catch((err) => showAuthError(err.message));
  });

  document.getElementById('register').addEventListener('click', () => {
    authenticate('register').catch((err) => showAuthError(err.message));
  });

  if (demoBtn) {
    demoBtn.addEventListener('click', async () => {
      demoBtn.disabled = true;
      showAuthError('');
      try {
        const result = await fetch('/api/auth/demo', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'chatbot' },
          body: '{}',
        });
        const data = await result.json();
        if (!result.ok) throw new Error(data.error || 'Không thể vào tài khoản Demo.');
        location.assign('/');
      } catch (err) {
        showAuthError(err.message);
        demoBtn.disabled = false;
      }
    });
  }
} else {
// ---------------------------------------------------------------------------
// Main App Stem IOT Dashboard
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const csrf = () =>
  decodeURIComponent(
    document.cookie
      .split('; ')
      .find((c) => c.startsWith('chatbot_csrf='))
      ?.split('=')[1] || '',
  );
const VI_ZONE = 'Asia/Ho_Chi_Minh';

const state = {
  today: vnToday(),
  week: mondayOf(vnToday()),
  selectedDay: vnToday(),
  weekTouched: false,
  events: [],
  iotDevices: [],
  selectedDeviceId: '',
  loadedWeek: '',
  calendarKey: '',
  iotKey: '',
  agendaKey: '',
  remindersKey: '',
  preferencesKey: '',
  initialized: false,
  refreshId: 0,
  editor: null,
  eventBusy: false,
  copySource: '',
  copyBusy: false,
  pending: null,
  chatBusy: false,
  preferencesBusy: false,
  preferencesDirty: false,
  assistantName: 'Trợ lý STEM',
  assistantModel: '',
  aiAvailable: false,
  session: Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join(''),
  lastScrollWeek: '',
};

// Offline indicator
function syncOnlineBanner() {
  const banner = $('offline-banner');
  if (banner) banner.hidden = navigator.onLine;
}
window.addEventListener('online', syncOnlineBanner);
window.addEventListener('offline', syncOnlineBanner);
syncOnlineBanner();

function vnToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: VI_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type) => parts.find((p) => p.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function addDays(iso, days) {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function mondayOf(iso) {
  const weekday = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return addDays(iso, -(weekday === 0 ? 6 : weekday - 1));
}

function dateLabel(iso, options = {}) {
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', ...options, timeZone: 'UTC' }).format(
    new Date(`${iso}T12:00:00Z`),
  );
}

function weekLabel(week) {
  return `${dateLabel(week)} – ${dateLabel(addDays(week, 6), { year: 'numeric' })}`;
}

function minutes(time) {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = String(text);
  return el;
}

function messageAt(id, text = '') {
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  el.hidden = !text;
}

let toastTimer;
function notify(text) {
  clearTimeout(toastTimer);
  messageAt('toast', text);
  toastTimer = setTimeout(() => {
    $('toast').hidden = true;
  }, 5000);
}

async function api(path, method = 'GET', body) {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(path === '/chat' ? 95000 : 20000),
      headers:
        method === 'GET'
          ? { Accept: 'application/json' }
          : {
              Accept: 'application/json',
              'Content-Type': 'application/json',
              'X-Requested-With': 'chatbot',
              'X-CSRF-Token': csrf(),
            },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new Error(
      method === 'GET'
        ? 'Không kết nối được máy chủ. Dữ liệu đang hiển thị có thể chưa cập nhật.'
        : 'Mất kết nối khi gửi yêu cầu. Vui lòng thử lại.',
    );
  }
  let data;
  try {
    data = response.status === 204 ? {} : await response.json();
  } catch {
    throw new Error('Máy chủ trả về dữ liệu không hợp lệ.');
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error('Phiên đăng nhập đã hết hạn. Tải lại trang để đăng nhập lại.');
  }
  if (!response.ok) throw new Error(data.error || `Yêu cầu thất bại (HTTP ${response.status}).`);
  return data;
}

function updateWeekHeading() {
  $('week-label').textContent = weekLabel(state.week);
}

function updateClock() {
  $('clock-label').textContent = new Intl.DateTimeFormat('vi-VN', {
    timeZone: VI_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date());
}

// ---------------------------------------------------------------------------
// Section 1: STEM IoT Device Controls
// ---------------------------------------------------------------------------
function renderIotSection(data) {
  const devices = Array.isArray(data.devices) ? data.devices : [];
  const key = JSON.stringify(devices);
  if (key === state.iotKey && state.selectedDeviceId) return;
  state.iotKey = key;
  state.iotDevices = devices;

  const select = $('iot-device-select');
  select.replaceChildren();

  if (!devices.length) {
    $('iot-empty').hidden = false;
    $('iot-controls-wrap').hidden = true;
    $('iot-test-reminder').disabled = true;
    select.hidden = true;
    renderDeviceList([]);
    return;
  }

  select.hidden = false;
  $('iot-empty').hidden = true;
  $('iot-controls-wrap').hidden = false;
  $('iot-test-reminder').disabled = false;

  if (!devices.some((d) => d.id === state.selectedDeviceId)) {
    state.selectedDeviceId = devices[0].id;
  }

  for (const d of devices) {
    const opt = element('option', '', `${d.name} (${d.id})`);
    opt.value = d.id;
    opt.selected = d.id === state.selectedDeviceId;
    select.append(opt);
  }

  renderSelectedIotDevice();
  renderDeviceList(devices);
}

function renderSelectedIotDevice() {
  const device = state.iotDevices.find((d) => d.id === state.selectedDeviceId);
  if (!device) return;
  const st = device.state;

  const connLabel = $('iot-conn-label');
  connLabel.textContent = device.online ? (device.simulated ? 'Sẵn sàng (Mô phỏng)' : 'Đang kết nối') : 'Chờ thiết bị kết nối';
  connLabel.className = `status-text ${device.online ? 'online' : 'offline'}`;

  $('iot-volume').value = st.volume;
  $('iot-volume-val').textContent = `${st.volume}%`;
  $('iot-mute-btn').setAttribute('aria-pressed', String(st.muted));
  $('iot-mute-btn').textContent = st.muted ? 'Đang tắt tiếng' : 'Tắt tiếng';

  $('iot-backlight').value = st.backlight;
  $('iot-backlight-val').textContent = `${st.backlight}%`;

  document.querySelectorAll('[data-display-mode]').forEach((btn) => {
    const active = btn.dataset.displayMode === st.displayMode;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });

  for (const key of ['led_status', 'relay_lab', 'buzzer_alert']) {
    const tile = $(`gpio-${key}`);
    const on = Boolean(st.gpioOutputs[key]);
    tile.setAttribute('aria-pressed', String(on));
    tile.querySelector('[data-state]').textContent = on ? 'Đang bật' : 'Đang tắt';
  }

  $('iot-servo').value = st.gpioOutputs.servo_angle;
  $('iot-servo-val').textContent = `${st.gpioOutputs.servo_angle}°`;

  $('tel-rssi').textContent = `${st.telemetry.wifiRssi} dBm`;
  $('tel-psram').textContent = `${st.telemetry.freePsramKb} KB`;
  $('tel-temp').textContent = `${Number(st.telemetry.cpuTempC).toFixed(1)} °C`;
  $('iot-last-cmd').textContent = st.lastCommand ? `Lệnh gần nhất: ${st.lastCommand.summary}` : 'Chưa gửi lệnh nào';
}

function renderDeviceList(devices) {
  const list = $('device-list');
  list.replaceChildren();
  if (!devices.length) {
    list.append(element('li', 'muted', 'Chưa có thiết bị nào được ghép nối.'));
    return;
  }
  for (const d of devices) {
    const li = element('li');
    const info = element('div');
    info.append(
      element('strong', '', d.name),
      document.createTextNode(` · ${d.id} · ${d.online ? 'Trực tuyến' : 'Ngoại tuyến'}`),
    );
    li.append(info);
    if (!d.simulated) {
      const del = element('button', 'text-button', 'Gỡ bỏ');
      del.type = 'button';
      del.addEventListener('click', async () => {
        try {
          await api(`/devices/${encodeURIComponent(d.id)}`, 'DELETE', {});
          notify(`Đã gỡ thiết bị ${d.name}.`);
          state.iotKey = '';
          await refreshAll();
        } catch (err) {
          notify(err.message);
        }
      });
      li.append(del);
    }
    list.append(li);
  }
}

async function sendIotCommand(payload) {
  if (!state.selectedDeviceId) return;
  try {
    const res = await api(`/iot/devices/${encodeURIComponent(state.selectedDeviceId)}/command`, 'POST', payload);
    const idx = state.iotDevices.findIndex((d) => d.id === res.device.id);
    if (idx !== -1) state.iotDevices[idx] = res.device;
    state.iotKey = JSON.stringify(state.iotDevices);
    renderSelectedIotDevice();
    notify(`Đã gửi lệnh: ${res.device.state.lastCommand.summary}`);
  } catch (err) {
    notify(err.message);
  }
}

$('iot-device-select').addEventListener('change', (e) => {
  state.selectedDeviceId = e.target.value;
  renderSelectedIotDevice();
});

$('iot-volume').addEventListener('input', (e) => {
  $('iot-volume-val').textContent = `${e.target.value}%`;
});
$('iot-volume').addEventListener('change', (e) => {
  void sendIotCommand({ volume: Number(e.target.value) });
});

$('iot-mute-btn').addEventListener('click', () => {
  const device = state.iotDevices.find((d) => d.id === state.selectedDeviceId);
  if (!device) return;
  void sendIotCommand({ muted: !device.state.muted });
});

$('iot-backlight').addEventListener('input', (e) => {
  $('iot-backlight-val').textContent = `${e.target.value}%`;
});
$('iot-backlight').addEventListener('change', (e) => {
  void sendIotCommand({ backlight: Number(e.target.value) });
});

document.querySelectorAll('[data-display-mode]').forEach((btn) => {
  btn.addEventListener('click', () => {
    void sendIotCommand({ displayMode: btn.dataset.displayMode });
  });
});

for (const key of ['led_status', 'relay_lab', 'buzzer_alert']) {
  $(`gpio-${key}`).addEventListener('click', () => {
    const device = state.iotDevices.find((d) => d.id === state.selectedDeviceId);
    if (!device) return;
    void sendIotCommand({ gpioOutputs: { [key]: !device.state.gpioOutputs[key] } });
  });
}

$('iot-servo').addEventListener('input', (e) => {
  $('iot-servo-val').textContent = `${e.target.value}°`;
});
$('iot-servo').addEventListener('change', (e) => {
  void sendIotCommand({ gpioOutputs: { servo_angle: Number(e.target.value) } });
});

$('iot-test-reminder').addEventListener('click', async () => {
  if (!state.selectedDeviceId) return;
  const btn = $('iot-test-reminder');
  btn.disabled = true;
  try {
    await api(`/iot/devices/${encodeURIComponent(state.selectedDeviceId)}/test-reminder`, 'POST', {});
    state.remindersKey = '';
    state.iotKey = '';
    await refreshAll();
    notify('Đã gửi yêu cầu phát thử nhắc lịch xuống thiết bị.');
  } catch (err) {
    notify(err.message);
  } finally {
    btn.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// Calendar, Day Agenda, Reminders, Preferences
// ---------------------------------------------------------------------------
function renderConflictWarning() {
  const date = $('event-date').value;
  const start = $('event-start').value;
  const end = $('event-end').value;
  if (!date || !start || !end || end <= start) {
    messageAt('event-conflict');
    return;
  }
  const conflict = state.events.find(
    (item) => item.date === date && item.id !== state.editor?.id && start < item.end && item.start < end,
  );
  messageAt(
    'event-conflict',
    conflict ? `Trùng với “${conflict.title}” (${conflict.start}–${conflict.end}).` : '',
  );
}

function renderCalendar() {
  const key = JSON.stringify([state.week, state.today, state.events]);
  if (key === state.calendarKey) return;
  state.calendarKey = key;
  const grid = $('week-grid');
  const focusedId = document.activeElement?.dataset.eventId;
  const sameWeek = state.lastScrollWeek === state.week;
  const scrollTop = $('calendar-scroll').scrollTop;
  const scrollLeft = $('calendar-scroll').scrollLeft;
  const fragment = document.createDocumentFragment();
  fragment.append(element('div', 'time-header', 'GMT+7'));
  const days = ['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ Nhật'];
  for (let i = 0; i < 7; i++) {
    const date = addDays(state.week, i);
    const header = element('div', `day-header${date === state.today ? ' today' : ''}`);
    header.append(element('span', '', days[i]), element('strong', '', Number(date.slice(8))));
    fragment.append(header);
  }
  const axis = element('div', 'time-axis');
  axis.setAttribute('aria-hidden', 'true');
  for (let hour = 0; hour < 24; hour++) {
    const label = element('div', 'hour-label');
    label.append(element('time', '', `${String(hour).padStart(2, '0')}:00`));
    axis.append(label);
  }
  fragment.append(axis);
  for (let i = 0; i < 7; i++) {
    const date = addDays(state.week, i);
    const column = element('div', `day-column${date === state.today ? ' today' : ''}`);
    column.style.height = '1728px';
    for (const hour of [6, 12, 18]) {
      const divider = element('span', 'period-divider');
      divider.style.top = `${hour * 72}px`;
      column.append(divider);
    }
    for (const event of state.events.filter((e) => e.date === date)) {
      const duration = minutes(event.end) - minutes(event.start);
      const button = element('button', 'calendar-event');
      button.type = 'button';
      button.dataset.eventId = event.id;
      button.style.top = `${minutes(event.start) * 1.2}px`;
      button.style.height = `${Math.max(22, duration * 1.2 - 3)}px`;
      button.title = `${event.title}\n${event.start} – ${event.end}${event.note ? `\n${event.note}` : ''}`;
      button.append(element('time', '', `${event.start} – ${event.end}`), element('strong', '', event.title));
      if (event.note && duration >= 75) button.append(element('span', 'event-note', event.note));
      button.addEventListener('click', () => openEvent(event));
      column.append(button);
    }
    column.addEventListener('click', (event) => {
      if (event.target.closest('button')) return;
      const rect = column.getBoundingClientRect();
      const clickedMinutes = Math.max(0, Math.min(1439, Math.floor((event.clientY - rect.top) / 1.2)));
      const startMinutes = Math.min(23 * 60 + 45, Math.round(clickedMinutes / 15) * 15);
      const endMinutes = Math.min(23 * 60 + 59, startMinutes + 60);
      const format = (v) => `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
      state.selectedDay = date;
      renderDayNavigation();
      renderDayAgenda();
      openEvent(null, { date, start: format(startMinutes), end: format(endMinutes) });
    });
    fragment.append(column);
  }
  grid.replaceChildren(fragment);
  $('calendar-empty').hidden = state.events.length !== 0;
  $('calendar-summary').textContent = `${state.events.length} lịch trong tuần`;
  const firstEventMinute = state.events.length ? Math.min(...state.events.map((e) => minutes(e.start))) : 7 * 60;
  $('calendar-scroll').scrollTop = sameWeek ? scrollTop : Math.max(6, Math.floor(firstEventMinute / 60) - 1) * 72;
  $('calendar-scroll').scrollLeft = sameWeek ? scrollLeft : 0;
  state.lastScrollWeek = state.week;
  renderDayNavigation();
  renderDayAgenda();
  if (focusedId) {
    [...grid.querySelectorAll('[data-event-id]')].find((el) => el.dataset.eventId === focusedId)?.focus({ preventScroll: true });
  }
}

function dayName(iso, options = { weekday: 'long', day: 'numeric', month: 'long' }) {
  return new Intl.DateTimeFormat('vi-VN', { ...options, timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`));
}

function renderDayNavigation() {
  const nav = $('day-navigation');
  nav.replaceChildren();
  const weekdays = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
  for (let i = 0; i < 7; i++) {
    const date = addDays(state.week, i);
    const button = element(
      'button',
      `day-choice${date === state.selectedDay ? ' selected' : ''}${date === state.today ? ' today' : ''}`,
    );
    button.type = 'button';
    button.setAttribute('aria-pressed', String(date === state.selectedDay));
    button.append(element('span', '', weekdays[i]), element('strong', '', Number(date.slice(8))));
    if (date === state.today) button.append(element('small', '', 'Hôm nay'));
    button.addEventListener('click', () => selectDay(date));
    nav.append(button);
  }
}

function renderDayAgenda(error = '', loading = false) {
  const list = $('day-agenda');
  list.replaceChildren();
  list.setAttribute('aria-busy', String(loading));
  if (loading) {
    list.append(element('p', 'muted', 'Đang tải lịch trong ngày…'));
    return;
  }
  $('selected-day-label').textContent = dayName(state.selectedDay);
  renderDayNavigation();
  if (error) {
    list.append(element('p', 'field-error', error));
    return;
  }
  const events = state.events
    .filter((event) => event.date === state.selectedDay)
    .sort((a, b) => a.start.localeCompare(b.start));
  if (!events.length) {
    const empty = element('div', 'empty-box');
    empty.append(element('strong', '', 'Ngày này chưa có lịch.'));
    const add = element('button', 'button subtle', 'Thêm lịch cho ngày này');
    add.type = 'button';
    add.addEventListener('click', () => {
      openEvent();
      $('event-date').value = state.selectedDay;
    });
    empty.append(add);
    list.append(empty);
    return;
  }
  for (const event of events) {
    const button = element('button', 'day-event');
    button.type = 'button';
    button.dataset.eventId = event.id;
    button.append(element('time', '', `${event.start} - ${event.end}`), element('strong', '', event.title));
    if (event.note) button.append(element('span', 'day-event-note', event.note));
    button.addEventListener('click', () => openEvent(event));
    list.append(button);
  }
}

function selectDay(date) {
  let changedWeek = false;
  if (date < state.week || date > addDays(state.week, 6)) {
    state.weekTouched = true;
    state.week = mondayOf(date);
    state.calendarKey = '';
    changedWeek = true;
  }
  state.selectedDay = date;
  if (changedWeek || state.loadedWeek !== state.week) {
    renderDayAgenda('', true);
    void refreshAll();
  } else {
    renderDayAgenda();
  }
}

function renderPreferences(data) {
  const models = Array.isArray(data.models) ? data.models : [];
  const voices = Array.isArray(data.voices) ? data.voices : [];
  const key = JSON.stringify([data.assistant_name, data.style_prompt, data.model, data.voice, models, voices]);
  if (key === state.preferencesKey || state.preferencesDirty || state.preferencesBusy) return;
  state.preferencesKey = key;
  const fill = (select, values, selected) => {
    select.replaceChildren();
    for (const value of values) {
      const opt = element('option', '', value);
      opt.value = value;
      opt.selected = value === selected;
      select.append(opt);
    }
  };
  $('assistant-name').value = data.assistant_name || '';
  $('style-prompt').value = data.style_prompt || '';
  fill($('preference-model'), models, data.model);
  fill($('preference-voice'), voices, data.voice);
  state.assistantName = data.assistant_name || 'Trợ lý STEM';
  state.assistantModel = data.model || '';
  $('model-label').textContent = state.assistantName;
  messageAt('preference-error');
  $('preference-status').textContent = 'Đã tải tùy chỉnh.';
}

$('preferences-form').addEventListener('input', () => {
  state.preferencesDirty = true;
});
$('preferences-form').addEventListener('change', () => {
  state.preferencesDirty = true;
});
$('preferences-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (state.preferencesBusy) return;
  const body = {
    assistant_name: $('assistant-name').value.trim(),
    style_prompt: $('style-prompt').value.trim(),
    model: $('preference-model').value,
    voice: $('preference-voice').value,
  };
  if (!body.assistant_name) {
    messageAt('preference-error', 'Hãy nhập tên trợ lý.');
    return;
  }
  state.preferencesBusy = true;
  $('preference-status').textContent = 'Đang lưu…';
  try {
    const result = await api('/preferences', 'PUT', body);
    state.preferencesDirty = false;
    state.preferencesKey = '';
    renderPreferences(result);
    $('preference-status').textContent = 'Đã lưu tùy chỉnh.';
    notify('Đã lưu tùy chỉnh trợ lý.');
  } catch (err) {
    messageAt('preference-error', err.message);
  } finally {
    state.preferencesBusy = false;
  }
});

function renderAgenda(data) {
  const key = JSON.stringify(data);
  if (key === state.agendaKey) return;
  state.agendaKey = key;
  for (const [id, events, emptyTitle] of [
    ['today-list', data.today, 'Hôm nay chưa có lịch thực hành.'],
    ['upcoming-list', data.upcoming, 'Chưa có lịch sắp tới.'],
  ]) {
    const container = $(id);
    container.replaceChildren();
    if (!events.length) {
      container.append(element('p', 'muted small', emptyTitle));
      continue;
    }
    for (const event of events) {
      const button = element('button', 'agenda-event');
      button.type = 'button';
      button.append(
        element('time', '', `${id === 'upcoming-list' ? `${dateLabel(event.date)} · ` : ''}${event.start} – ${event.end}`),
        element('strong', '', event.title),
      );
      if (event.note) button.append(element('small', 'muted', event.note));
      button.addEventListener('click', () => openEvent(event));
      container.append(button);
    }
  }
}

function renderStatus(data) {
  state.aiAvailable = Boolean(data.ai_configured);
  $('ai-status').textContent = data.ai_configured ? 'AI sẵn sàng' : 'AI chưa có key';
  $('ai-status').className = `meta-item ${data.ai_configured ? 'online' : 'offline'}`;
  $('ai-help').hidden = data.ai_configured;

  const online = (data.devices || []).filter((d) => d.online);
  $('device-status').textContent = online.length
    ? `${online.length} thiết bị trực tuyến`
    : data.devices?.length
      ? `${data.devices.length} thiết bị ngoại tuyến`
      : 'Chưa có thiết bị';
  $('device-status').className = `meta-item ${online.length ? 'online' : 'offline'}`;

  const date = vnToday(new Date(data.now));
  state.today = date;
  $('today-label').textContent = dateLabel(date, { weekday: 'long', year: 'numeric' });
  setChatControls();
}

function renderReminders(data) {
  const key = JSON.stringify(data.reminders);
  if (key === state.remindersKey) return;
  state.remindersKey = key;
  const list = $('reminder-list');
  list.replaceChildren();
  if (!data.reminders.length) {
    list.append(element('p', 'muted small', 'Chưa có lịch sử nhắc trên thiết bị.'));
    return;
  }
  const labels = {
    played: 'Đã phát',
    failed: 'Thất bại',
    cancelled: 'Đã hủy',
    pending: 'Đang chờ phát',
  };
  for (const r of data.reminders) {
    const item = element('div', 'reminder-item');
    item.append(element('strong', '', r.event?.title || r.text || 'Nhắc lịch'), element('span', 'muted small', labels[r.status] || r.status));
    list.append(item);
  }
}

let refreshInFlight = 0;
async function refreshAll(background = false) {
  if (background && refreshInFlight) return false;
  refreshInFlight++;
  try {
    return await refreshSnapshot();
  } finally {
    refreshInFlight--;
  }
}

async function refreshSnapshot() {
  const requestId = ++state.refreshId;
  const isFirst = !state.initialized;
  const errors = [];
  try {
    const status = await api('/status');
    if (requestId !== state.refreshId) return false;
    renderStatus(status);
    if (!state.initialized) {
      if (!state.weekTouched) state.week = mondayOf(state.today);
      state.selectedDay = state.today;
    }
    state.initialized = true;
  } catch (err) {
    errors.push(err.message);
  }

  const requestedWeek = state.week;
  updateWeekHeading();
  if (isFirst) renderDayAgenda('', true);

  const results = await Promise.allSettled([
    api(`/events?week=${encodeURIComponent(requestedWeek)}`),
    api('/agenda'),
    api('/reminders'),
    api('/preferences'),
    api('/iot/devices'),
  ]);
  if (requestId !== state.refreshId || requestedWeek !== state.week) return false;

  const handlers = [
    (d) => {
      state.events = d.events;
      state.loadedWeek = requestedWeek;
      renderCalendar();
    },
    renderAgenda,
    renderReminders,
    renderPreferences,
    renderIotSection,
  ];
  results.forEach((res, idx) => {
    if (res.status === 'fulfilled') handlers[idx](res.value);
    else {
      errors.push(res.reason.message);
      if (idx === 0) renderDayAgenda(res.reason.message);
    }
  });

  messageAt('connection-error', [...new Set(errors)].join(' '));
  $('sync-status').textContent = errors.length
    ? 'Chưa đồng bộ'
    : `Đồng bộ ${new Intl.DateTimeFormat('vi-VN', { timeZone: VI_ZONE, hour: '2-digit', minute: '2-digit' }).format(new Date())}`;
  return errors.length === 0;
}

async function changeWeek(week) {
  state.weekTouched = true;
  state.week = week;
  if (state.selectedDay < week || state.selectedDay > addDays(week, 6)) {
    state.selectedDay = state.today >= week && state.today <= addDays(week, 6) ? state.today : week;
  }
  state.calendarKey = '';
  updateWeekHeading();
  await refreshAll();
}

function openEvent(event = null, defaults = null) {
  state.editor = event ? { ...event } : null;
  $('event-form').reset();
  messageAt('event-error');
  $('delete-confirmation').hidden = true;
  $('delete-event').hidden = !event;
  $('event-dialog-title').textContent = event ? 'Chỉnh sửa lịch' : 'Thêm lịch mới';
  $('event-title').value = event?.title || '';
  $('event-date').value = event?.date || defaults?.date || state.selectedDay;
  $('event-start').value = event?.start || defaults?.start || '08:00';
  $('event-end').value = event?.end || defaults?.end || '09:00';
  $('event-note').value = event?.note || '';
  $('event-reminder').value = event?.remind_minutes ?? 10;
  $('save-event').disabled = false;
  renderConflictWarning();
  $('event-dialog').showModal();
  $('event-title').focus();
}

for (const id of ['event-title', 'event-date', 'event-start', 'event-end']) {
  $(id).addEventListener('input', renderConflictWarning);
  $(id).addEventListener('change', renderConflictWarning);
}

$('event-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (state.eventBusy) return;
  const payload = {
    title: $('event-title').value.trim(),
    date: $('event-date').value,
    start: $('event-start').value,
    end: $('event-end').value,
    note: $('event-note').value,
    remind_minutes: Number($('event-reminder').value),
  };
  if (!payload.title) {
    messageAt('event-error', 'Hãy nhập tên lịch.');
    return;
  }
  if (payload.end <= payload.start) {
    messageAt('event-error', 'Giờ kết thúc phải sau giờ bắt đầu.');
    return;
  }
  state.eventBusy = true;
  $('save-event').disabled = true;
  try {
    const current = state.editor;
    await api(
      current ? `/events/${encodeURIComponent(current.id)}` : '/events',
      current ? 'PUT' : 'POST',
      current ? { ...payload, revision: current.revision } : payload,
    );
    state.selectedDay = payload.date;
    if (payload.date < state.week || payload.date > addDays(state.week, 6)) {
      state.week = mondayOf(payload.date);
      state.weekTouched = true;
      state.calendarKey = '';
    }
    $('event-dialog').close();
    await refreshAll();
    notify('Đã lưu lịch.');
  } catch (err) {
    messageAt('event-error', err.message);
  } finally {
    state.eventBusy = false;
    $('save-event').disabled = false;
  }
});

$('delete-event').addEventListener('click', () => {
  $('delete-summary').textContent = `${state.editor.title} · ${dateLabel(state.editor.date)} · ${state.editor.start} – ${state.editor.end}`;
  $('delete-confirmation').hidden = false;
  $('save-event').disabled = true;
});

$('cancel-delete').addEventListener('click', () => {
  $('delete-confirmation').hidden = true;
  $('save-event').disabled = false;
});

$('confirm-delete').addEventListener('click', async () => {
  if (!state.editor) return;
  try {
    await api(`/events/${encodeURIComponent(state.editor.id)}`, 'DELETE', { revision: state.editor.revision });
    $('event-dialog').close();
    await refreshAll();
    notify('Đã xóa lịch.');
  } catch (err) {
    messageAt('event-error', err.message);
  }
});

$('copy-week').addEventListener('click', () => {
  state.copySource = state.week;
  $('copy-source').textContent = `Tuần nguồn: ${weekLabel(state.copySource)}`;
  $('copy-target').value = addDays(state.copySource, 7);
  $('copy-target-hint').textContent = `Tuần đích: ${weekLabel(mondayOf($('copy-target').value))}`;
  messageAt('copy-error');
  $('copy-dialog').showModal();
});

$('copy-target').addEventListener('input', () => {
  const val = $('copy-target').value;
  $('copy-target-hint').textContent = val ? `Tuần đích: ${weekLabel(mondayOf(val))}` : '';
});

$('copy-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const target = mondayOf($('copy-target').value);
  if (target === state.copySource) {
    messageAt('copy-error', 'Hãy chọn tuần khác tuần nguồn.');
    return;
  }
  try {
    await api('/weeks/copy', 'POST', { source_week: state.copySource, target_week: target });
    $('copy-dialog').close();
    await changeWeek(target);
    notify('Đã sao chép lịch sang tuần mới.');
  } catch (err) {
    messageAt('copy-error', err.message);
  }
});

// Chat
function appendMessage(role, text) {
  const log = $('chat-log');
  $('chat-welcome')?.remove();
  const item = element('div', `message ${role}`);
  item.append(
    element('span', 'message-label', role === 'user' ? 'Bạn' : state.assistantName),
    element('div', 'message-body', text),
  );
  log.append(item);
  log.scrollTop = log.scrollHeight;
}

function setChatControls() {
  $('chat-send').disabled = state.chatBusy || !state.aiAvailable || Boolean(state.pending);
  $('chat-confirm').disabled = state.chatBusy || !state.aiAvailable;
  $('chat-cancel').disabled = state.chatBusy || !state.aiAvailable;
  if ($('ask-today')) {
    $('ask-today').disabled = state.chatBusy || !state.aiAvailable || Boolean(state.pending);
  }
  $('chat-send').textContent = state.chatBusy ? 'Đang gửi…' : 'Gửi';
  $('chat-state').textContent = state.chatBusy
    ? 'Trợ lý đang xử lý…'
    : state.pending
      ? 'Đang chờ bạn xác nhận thay đổi lịch.'
      : 'Lịch chỉ đổi sau khi bạn xác nhận.';
}

async function sendChat(message, confirmation) {
  if (state.chatBusy || !state.aiAvailable) return;
  state.chatBusy = true;
  messageAt('chat-error');
  setChatControls();
  appendMessage('user', message);
  try {
    const result = await api('/chat', 'POST', {
      session_id: state.session,
      message,
      week: state.week,
      ...(confirmation ? { confirmation } : {}),
    });
    appendMessage('assistant', result.reply);
    state.pending = result.pending || null;
    $('chat-confirmation').hidden = !state.pending;
    $('chat-proposal').textContent = state.pending?.summary || '';
    if (result.changed) await refreshAll();
  } catch (err) {
    messageAt('chat-error', err.message);
  } finally {
    state.chatBusy = false;
    setChatControls();
  }
}

$('chat-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const msg = $('chat-input').value.trim();
  if (!msg || state.pending || state.chatBusy || !state.aiAvailable) return;
  $('chat-input').value = '';
  void sendChat(msg);
});

$('chat-input').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    $('chat-form').requestSubmit();
  }
});

$('ask-today')?.addEventListener('click', () => {
  $('chat-input').value = 'Hôm nay tôi có lịch gì?';
  $('chat-form').requestSubmit();
});
$('chat-confirm').addEventListener('click', () => {
  if (state.pending) void sendChat('Xác nhận', state.pending.token);
});
$('chat-cancel').addEventListener('click', () => {
  if (state.pending) void sendChat('Hủy');
});

// Toolbar & Navigation
$('add-event').addEventListener('click', () => openEvent());
$('add-first-event').addEventListener('click', () => openEvent());
for (const hour of [0, 6, 12, 18]) {
  $(`period-jump-${String(hour).padStart(2, '0')}`).addEventListener('click', () => {
    $('calendar-scroll').scrollTo({ top: hour * 72, behavior: 'smooth' });
  });
}
$('previous-week').addEventListener('click', () => void changeWeek(addDays(state.week, -7)));
$('next-week').addEventListener('click', () => void changeWeek(addDays(state.week, 7)));
$('current-week').addEventListener('click', () => {
  state.selectedDay = state.today;
  void changeWeek(mondayOf(state.today));
});
$('previous-day').addEventListener('click', () => selectDay(addDays(state.selectedDay, -1)));
$('next-day').addEventListener('click', () => selectDay(addDays(state.selectedDay, 1)));
$('refresh').addEventListener('click', () => void refreshAll());

// Preferences & Account Popover
function closeAccountMenu() {
  $('account-popover').hidden = true;
  $('account-trigger').setAttribute('aria-expanded', 'false');
}

function openPreferences() {
  closeAccountMenu();
  $('preferences-dialog').showModal();
}
$('open-settings').addEventListener('click', openPreferences);
$('account-settings').addEventListener('click', openPreferences);
$('preferences-close').addEventListener('click', () => $('preferences-dialog').close());

$('account-trigger').addEventListener('click', () => {
  const open = $('account-popover').hidden;
  $('account-popover').hidden = !open;
  $('account-trigger').setAttribute('aria-expanded', String(open));
});

document.addEventListener('click', (event) => {
  if (!event.target.closest('#account-menu')) closeAccountMenu();
});

$('logout').addEventListener('click', async () => {
  $('logout').disabled = true;
  try {
    await api('/auth/logout', 'POST', {});
    location.assign('/');
  } catch (err) {
    notify(err.message);
    $('logout').disabled = false;
  }
});

// Device Registration
function openDeviceRegistration() {
  $('device-register-form').reset();
  $('device-register-form').hidden = false;
  $('device-result').hidden = true;
  $('device-token').textContent = '';
  messageAt('device-error');
  $('device-register-dialog').showModal();
}

$('add-device').addEventListener('click', openDeviceRegistration);
$('iot-empty-add').addEventListener('click', openDeviceRegistration);
$('device-register-close').addEventListener('click', () => $('device-register-dialog').close());

$('device-register-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const btn = $('device-register-submit');
  btn.disabled = true;
  messageAt('device-error');
  try {
    const res = await api('/devices', 'POST', {
      device_id: form.elements.device_id.value.trim(),
      name: form.elements.name.value.trim(),
    });
    $('device-token').textContent = res.token;
    form.hidden = true;
    $('device-result').hidden = false;
    $('device-copy-status').textContent = '';
    state.selectedDeviceId = res.device_id;
    state.iotKey = '';
    await refreshAll();
  } catch (err) {
    messageAt('device-error', err.message);
  } finally {
    btn.disabled = false;
  }
});

$('device-copy-token').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('device-token').textContent);
    $('device-copy-status').textContent = 'Đã sao chép mã kết nối.';
  } catch {
    $('device-copy-status').textContent = 'Không tự sao chép được. Hãy chọn mã và copy thủ công.';
  }
});

// Boot
updateWeekHeading();
updateClock();
setInterval(updateClock, 15000);
setChatControls();
void refreshAll();
setInterval(() => {
  if (!document.hidden) void refreshAll(true);
}, 10000);
void api('/auth/me')
  .then((data) => {
    const name = data.user?.username || 'Đã đăng nhập';
    $('account-identity').textContent = name;
    $('account-label').textContent = name;
  })
  .catch(() => {});
}
