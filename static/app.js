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
if (document.getElementById('login-form')) {
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  const tabLogin = document.getElementById('tab-login');
  const tabRegister = document.getElementById('tab-register');
  const loginError = document.getElementById('login-error');
  const registerError = document.getElementById('register-error');
  const demoBtn = document.getElementById('demo-login');

  function showError(el, msg) {
    el.textContent = msg;
    el.hidden = !msg;
  }

  function switchTab(mode) {
    const isLogin = mode === 'login';
    loginForm.hidden = !isLogin;
    registerForm.hidden = isLogin;
    tabLogin.classList.toggle('active', isLogin);
    tabRegister.classList.toggle('active', !isLogin);
    tabLogin.setAttribute('aria-selected', String(isLogin));
    tabRegister.setAttribute('aria-selected', String(!isLogin));
    showError(loginError, '');
    showError(registerError, '');
  }

  async function parseAuthResponse(result) {
    const text = await result.text();
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`Máy chủ trả về phản hồi không hợp lệ (HTTP ${result.status}).`);
    }
  }

  tabLogin?.addEventListener('click', () => switchTab('login'));
  tabRegister?.addEventListener('click', () => switchTab('register'));

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!loginForm.reportValidity()) return;
    showError(loginError, '');
    const fields = new FormData(loginForm);
    try {
      const result = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'chatbot' },
        body: JSON.stringify({
          phone: fields.get('phone'),
          password: fields.get('password'),
        }),
      });
      const data = await parseAuthResponse(result);
      if (!result.ok) throw new Error(data.error || 'Đăng nhập thất bại.');
      location.assign('/');
    } catch (err) {
      showError(loginError, err.message);
    }
  });

  registerForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!registerForm.reportValidity()) return;
    showError(registerError, '');
    const fields = new FormData(registerForm);
    const password = String(fields.get('password') || '');
    const confirmPassword = String(fields.get('confirm_password') || '');
    if (password !== confirmPassword) {
      showError(registerError, 'Mật khẩu xác nhận không khớp.');
      return;
    }
    try {
      const result = await fetch('/api/auth/register', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'chatbot' },
        body: JSON.stringify({
          phone: fields.get('phone'),
          password,
          confirm_password: confirmPassword,
        }),
      });
      const data = await parseAuthResponse(result);
      if (!result.ok) throw new Error(data.error || 'Đăng ký thất bại.');
      location.assign('/');
    } catch (err) {
      showError(registerError, err.message);
    }
  });

  if (demoBtn) {
    demoBtn.addEventListener('click', async () => {
      demoBtn.disabled = true;
      showError(loginError, '');
      try {
        const result = await fetch('/api/auth/demo', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'chatbot' },
          body: '{}',
        });
        const data = await parseAuthResponse(result);
        if (!result.ok) throw new Error(data.error || 'Không thể vào tài khoản Demo.');
        location.assign('/');
      } catch (err) {
        showError(loginError, err.message);
        demoBtn.disabled = false;
      }
    });
  }
} else if (document.getElementById('iot-section') && document.getElementById('week-grid')) {
// ---------------------------------------------------------------------------
// Main App Stem IOT Dashboard
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const on = (id, eventName, handler) => $(id)?.addEventListener(eventName, handler);
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
  renderFirmwareConfigSnippet(device);
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

on('iot-device-select', 'change', (e) => {
  state.selectedDeviceId = e.target.value;
  renderSelectedIotDevice();
});

on('iot-volume', 'input', (e) => {
  $('iot-volume-val').textContent = `${e.target.value}%`;
});
on('iot-volume', 'change', (e) => {
  void sendIotCommand({ volume: Number(e.target.value) });
});

on('iot-mute-btn', 'click', () => {
  const device = state.iotDevices.find((d) => d.id === state.selectedDeviceId);
  if (!device) return;
  void sendIotCommand({ muted: !device.state.muted });
});

on('iot-backlight', 'input', (e) => {
  $('iot-backlight-val').textContent = `${e.target.value}%`;
});
on('iot-backlight', 'change', (e) => {
  void sendIotCommand({ backlight: Number(e.target.value) });
});

document.querySelectorAll('[data-display-mode]').forEach((btn) => {
  btn.addEventListener('click', () => {
    void sendIotCommand({ displayMode: btn.dataset.displayMode });
  });
});

for (const key of ['led_status', 'relay_lab', 'buzzer_alert']) {
  on(`gpio-${key}`, 'click', () => {
    const device = state.iotDevices.find((d) => d.id === state.selectedDeviceId);
    if (!device) return;
    void sendIotCommand({ gpioOutputs: { [key]: !device.state.gpioOutputs[key] } });
  });
}

on('iot-servo', 'input', (e) => {
  $('iot-servo-val').textContent = `${e.target.value}°`;
});
on('iot-servo', 'change', (e) => {
  void sendIotCommand({ gpioOutputs: { servo_angle: Number(e.target.value) } });
});

on('iot-test-reminder', 'click', async () => {
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
// Section 2: Web Serial Firmware Flasher, Serial Monitor & Config Generator
// ---------------------------------------------------------------------------
const FW_PROFILES = {
  'ai-chatbot-s3': {
    chip: 'ESP32-S3 LX7',
    mem: '16MB · Octal',
    offset: '0x0000',
    badge: 'ESP32-S3 · 16MB',
  },
  'stem-display-alt': {
    chip: 'ESP32-S3 Multi',
    mem: '16MB · QIO/Octal',
    offset: '0x10000',
    badge: 'Multi-Display · 16MB',
  },
};

function renderFirmwareConfigSnippet(device) {
  const pre = $('fw-config-snippet');
  if (!pre) return;
  const origin = window.location.origin;
  const devId = device?.id || state.selectedDeviceId || 'esp32s3-stem-01';
  const mode = device?.state?.displayMode || 'schedule';
  pre.textContent =
`// App Stem IOT · Firmware Config (${devId})
#pragma once
#define CHATBOT_SERVER_URL "${origin}"
#define STEM_DEVICE_ID     "${devId}"
#define STEM_DISPLAY_MODE  "${mode}"
// Endpoints:
// OTA & WebSocket: POST ${origin}/xiaozhi/ota/
// Reminder Poll:   GET  ${origin}/device/reminders?device_id=${devId}
// Telemetry Push:  POST ${origin}/device/telemetry`;
}
renderFirmwareConfigSnippet(null);

on('copy-fw-config', 'click', async () => {
  const pre = $('fw-config-snippet');
  if (!pre) return;
  try {
    await navigator.clipboard.writeText(pre.textContent);
    $('fw-config-status').textContent = 'Đã sao chép cấu hình Firmware.';
  } catch {
    $('fw-config-status').textContent = 'Không tự sao chép được. Hãy bôi đen và copy thủ công.';
  }
});

document.querySelectorAll('[data-fw-profile]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const profile = FW_PROFILES[btn.dataset.fwProfile];
    if (!profile) return;
    document.querySelectorAll('[data-fw-profile]').forEach((el) => {
      el.classList.toggle('active', el === btn);
    });
    if ($('fw-spec-chip')) $('fw-spec-chip').textContent = profile.chip;
    if ($('fw-spec-mem')) $('fw-spec-mem').textContent = profile.mem;
    if ($('fw-spec-offset')) $('fw-spec-offset').textContent = profile.offset;
    if ($('flash-profile-chip')) $('flash-profile-chip').textContent = profile.badge;
    if ($('flash-offset')) $('flash-offset').value = profile.offset;
  });
});

(() => {
  const badge = $('serial-support-badge');
  const note = $('serial-support-note');
  const fileInput = $('flash-bin-file');
  const fileNameLabel = $('flash-file-name');
  const flashBtn = $('btn-flash-firmware');
  const progressBox = $('flash-progress-box');
  const progressStatus = $('flash-progress-status');
  const progressFill = $('flash-progress-fill');
  const progressBytes = $('flash-progress-bytes');
  const progressPct = $('flash-progress-pct');
  const flashLog = $('flash-terminal-log');

  const monTerminal = $('mon-terminal');
  const monToggleBtn = $('mon-toggle-btn');
  const monClearBtn = $('mon-clear-btn');
  const monSimBtn = $('mon-sim-btn');
  const monSendForm = $('mon-send-form');
  const monSendInput = $('mon-send-input');
  const monSendBtn = $('mon-send-btn');

  let selectedFile = null;
  let monPort = null;
  let monReader = null;
  let monReading = false;
  let isFlashing = false;

  const hasWebSerial = 'serial' in navigator;
  const inIframe = window.self !== window.top;
  if (badge) {
    badge.textContent = hasWebSerial ? 'Web Serial sẵn sàng' : 'Chưa hỗ trợ Web Serial';
    badge.className = `meta-item ${hasWebSerial ? 'online' : 'offline'}`;
  }
  if (note && (!hasWebSerial || inIframe)) {
    note.hidden = false;
    note.textContent = !hasWebSerial
      ? 'Trình duyệt hiện tại (hoặc thiết bị di động) chưa hỗ trợ Web Serial USB. Bạn vẫn có thể dùng "Log mẫu", điều khiển IoT qua Wi-Fi và sao chép cấu hình Firmware.'
      : 'Lưu ý: Nếu trình duyệt chặn cổng COM bên trong khung xem trước (iframe), hãy mở App Stem IOT ở tab trình duyệt riêng (Chrome/Edge trên máy tính) để nạp USB trực tiếp.';
  }

  function appendTerminalLine(el, text) {
    if (!el) return;
    if (el.textContent.startsWith('Nhấn "Mở cổng Serial"')) {
      el.textContent = '';
    }
    el.textContent += text;
    if (el.textContent.length > 24000) {
      el.textContent = el.textContent.slice(-18000);
    }
    el.scrollTop = el.scrollHeight;
  }

  function logFlash(line) {
    appendTerminalLine(flashLog, `${line}\n`);
  }

  fileInput?.addEventListener('change', () => {
    selectedFile = fileInput.files?.[0] || null;
    if (fileNameLabel) {
      fileNameLabel.textContent = selectedFile
        ? `${selectedFile.name} (${(selectedFile.size / 1024 / 1024).toFixed(2)} MB)`
        : 'Chưa chọn tệp firmware (.bin)';
    }
  });

  async function disconnectMonitor() {
    monReading = false;
    if (monReader) {
      try {
        await monReader.cancel();
      } catch { /* ignore */ }
      try {
        monReader.releaseLock();
      } catch { /* ignore */ }
      monReader = null;
    }
    if (monPort) {
      try {
        await monPort.close();
      } catch { /* ignore */ }
      monPort = null;
    }
    if (monToggleBtn) {
      monToggleBtn.textContent = 'Mở cổng Serial';
      monToggleBtn.className = 'button primary';
    }
    if (monSendBtn) monSendBtn.disabled = true;
  }

  monToggleBtn?.addEventListener('click', async () => {
    if (monPort) {
      await disconnectMonitor();
      appendTerminalLine(monTerminal, '\n[Serial] Đã đóng cổng COM.\n');
      return;
    }
    if (!hasWebSerial) {
      notify('Trình duyệt không hỗ trợ Web Serial API. Hãy dùng Chrome/Edge trên máy tính.');
      return;
    }
    try {
      monPort = await navigator.serial.requestPort();
      await monPort.open({ baudRate: 115200 });
      monReading = true;
      monToggleBtn.textContent = 'Ngắt kết nối';
      monToggleBtn.className = 'button danger';
      if (monSendBtn) monSendBtn.disabled = false;
      appendTerminalLine(monTerminal, '\n[Serial] Đã mở cổng COM @ 115,200 bps.\n');

      const decoder = new TextDecoder();
      while (monPort?.readable && monReading) {
        monReader = monPort.readable.getReader();
        try {
          while (monReading) {
            const { value, done } = await monReader.read();
            if (done) break;
            if (value) appendTerminalLine(monTerminal, decoder.decode(value, { stream: true }));
          }
        } catch (err) {
          appendTerminalLine(monTerminal, `\n[Serial lỗi đọc]: ${err.message}\n`);
          break;
        } finally {
          monReader?.releaseLock();
          monReader = null;
        }
      }
    } catch (err) {
      await disconnectMonitor();
      if (err?.name !== 'NotFoundError') {
        appendTerminalLine(monTerminal, `\n[Serial]: ${err.message}\n`);
      }
    }
  });

  monSendForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const cmd = monSendInput?.value.trim();
    if (!cmd || !monPort?.writable) return;
    const writer = monPort.writable.getWriter();
    try {
      await writer.write(new TextEncoder().encode(`${cmd}\r\n`));
      appendTerminalLine(monTerminal, `\n> ${cmd}\n`);
      monSendInput.value = '';
    } finally {
      writer.releaseLock();
    }
  });

  monClearBtn?.addEventListener('click', () => {
    if (monTerminal) monTerminal.textContent = '';
  });

  monSimBtn?.addEventListener('click', () => {
    const dev = state.iotDevices.find((d) => d.id === state.selectedDeviceId) || state.iotDevices[0];
    const devId = dev?.id || 'esp32s3-stem-01';
    const st = dev?.state || { volume: 75, backlight: 85, displayMode: 'schedule', telemetry: { wifiRssi: -54, freePsramKb: 7680, cpuTempC: 41.2 } };
    const origin = window.location.origin;
    const sample = [
      'ESP-ROM:esp32s3-20210327',
      'I (12) boot: ESP-IDF v5.3 · App Stem IOT (ai-chatbot-s3)',
      `I (48) spiram: Octal PSRAM initialized · free=${st.telemetry.freePsramKb}KB`,
      'I (105) st7789: SPI 240x240 CLK=9 MOSI=10 RST=18 DC=8 CS=14 BL=13',
      `I (112) st7789: Backlight=${st.backlight}% · Mode=${st.displayMode}`,
      `I (140) i2s_audio: Mic(WS=4,SCK=5,DIN=6) 16kHz | MAX98357A(LRC=16,BCLK=15,DOUT=7) vol=${st.volume}%`,
      `I (410) wifi: connected · RSSI=${st.telemetry.wifiRssi}dBm · Temp=${st.telemetry.cpuTempC}C`,
      `I (520) ota: POST ${origin}/xiaozhi/ota/ [device=${devId}] -> 200 OK`,
      `I (680) reminder_client: Polling ${origin}/device/reminders -> READY`,
    ].join('\n');
    appendTerminalLine(monTerminal, `\n${sample}\n`);
  });

  flashBtn?.addEventListener('click', async () => {
    if (isFlashing) return;
    if (!hasWebSerial) {
      notify('Trình duyệt hiện tại không hỗ trợ Web Serial API. Hãy dùng Chrome hoặc Edge trên máy tính.');
      return;
    }
    if (!selectedFile) {
      notify('Vui lòng chọn tệp firmware (.bin) trước khi bấm nạp.');
      fileInput?.click();
      return;
    }
    const offsetRaw = ($('flash-offset')?.value || '0x0000').trim();
    const address = Number.parseInt(offsetRaw, 16);
    if (!Number.isFinite(address) || address < 0) {
      notify('Địa chỉ offset không hợp lệ (ví dụ: 0x0000 hoặc 0x10000).');
      return;
    }

    isFlashing = true;
    flashBtn.disabled = true;
    if (progressBox) progressBox.hidden = false;
    if (flashLog) flashLog.textContent = '';
    if (progressFill) progressFill.style.width = '0%';
    if (progressPct) progressPct.textContent = '0%';
    if (progressBytes) progressBytes.textContent = `0 / ${selectedFile.size} bytes`;
    if (progressStatus) progressStatus.textContent = 'Đang chọn cổng COM và nạp thư viện esptool-js…';

    let transport = null;
    try {
      await disconnectMonitor();
      const baudrate = Number($('flash-baudrate')?.value || 460800);
      const [{ ESPLoader, Transport }, fileBuf] = await Promise.all([
        import('https://unpkg.com/esptool-js@0.7.1/bundle.js'),
        selectedFile.arrayBuffer(),
      ]);

      const port = await navigator.serial.requestPort();
      transport = new Transport(port, true);
      const terminal = {
        clean: () => { if (flashLog) flashLog.textContent = ''; },
        writeLine: (line) => logFlash(line),
        write: (chunk) => appendTerminalLine(flashLog, chunk),
      };

      const esploader = new ESPLoader({ transport, baudrate, terminal });
      if (progressStatus) progressStatus.textContent = 'Đang kết nối bootloader ESP32-S3…';
      await esploader.main();

      const bytes = new Uint8Array(fileBuf);
      let binary = '';
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }

      if (progressStatus) progressStatus.textContent = `Đang nạp ${selectedFile.name} tại ${offsetRaw}…`;
      await esploader.writeFlash({
        fileArray: [{ data: binary, address }],
        flashSize: 'keep',
        eraseAll: false,
        compress: true,
        reportProgress: (_idx, written, total) => {
          const pct = total ? Math.round((written / total) * 100) : 0;
          if (progressFill) progressFill.style.width = `${pct}%`;
          if (progressPct) progressPct.textContent = `${pct}%`;
          if (progressBytes) progressBytes.textContent = `${written} / ${total} bytes`;
        },
      });

      if (progressStatus) progressStatus.textContent = 'Nạp firmware thành công! Đang khởi động lại mạch…';
      await transport.setDTR(false);
      await transport.setRTS(true);
      await new Promise((r) => setTimeout(r, 120));
      await transport.setRTS(false);
      notify('Đã nạp firmware ESP32-S3 thành công!');
    } catch (err) {
      if (progressStatus) progressStatus.textContent = 'Nạp firmware chưa hoàn tất.';
      logFlash(`[Lỗi]: ${err?.message || err}`);
      if (err?.name !== 'NotFoundError') notify(err?.message || 'Lỗi nạp firmware.');
    } finally {
      if (transport) {
        try { await transport.disconnect(); } catch { /* ignore */ }
      }
      isFlashing = false;
      flashBtn.disabled = false;
    }
  });
})();

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
    const user = data.user || {};
    const phoneOrName = user.phone || user.username || 'Đã đăng nhập';
    const roleLabel = user.role === 'admin' ? 'Quản trị viên' : 'Thành viên';
    $('account-identity').textContent = `${roleLabel} · ${phoneOrName}`;
    $('account-label').textContent = user.role === 'admin' ? 'Quản trị viên' : phoneOrName;
  })
  .catch(() => {});
}
