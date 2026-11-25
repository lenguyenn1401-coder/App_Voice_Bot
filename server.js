import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = __dirname;

dotenv.config({ path: path.join(ROOT, '.env') });

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
const SESSION_COOKIE = 'chatbot_session';
const CSRF_COOKIE = 'chatbot_csrf';

const MODELS = [
  'gemini-3-flash-preview',
  'gemini-3.1-flash-lite',
  'gemini-3.6-flash',
];

const VOICES = [
  'Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede',
  'Callirrhoe', 'Autonoe', 'Enceladus', 'Iapetus', 'Umbriel', 'Algieba',
  'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar',
  'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi',
  'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat',
];

const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
const DEFAULT_PREFERENCES = {
  assistant_name: 'Trợ lý STEM',
  style_prompt: '',
  model: MODELS.includes(DEFAULT_MODEL) ? DEFAULT_MODEL : 'gemini-flash-latest',
  voice: 'Kore',
};

const ESP32_S3_PINOUT = {
  board: 'ESP32-S3 (ai-chatbot-s3)',
  flash: '16MB · Octal PSRAM',
  audio_in: 'I2S Mic (WS GPIO4 · SCK GPIO5 · DIN GPIO6 · 16kHz)',
  audio_out: 'MAX98357A (LRCK GPIO16 · BCLK GPIO15 · DOUT GPIO7 · 24kHz)',
  display: 'ST7789 240×240 (CLK 9 · MOSI 10 · RST 18 · DC 8 · CS 14 · BL 13)',
  buttons: 'BOOT GPIO0 · VOL+ GPIO40 · VOL- GPIO39',
};

const WEB_TOKEN = process.env.WEB_TOKEN && process.env.WEB_TOKEN.length >= 24
  ? process.env.WEB_TOKEN
  : crypto.randomBytes(24).toString('base64url');

const AI_PROVIDER = (process.env.AI_PROVIDER || 'gemini').toLowerCase();
const AI_BASE_URL = (process.env.AI_BASE_URL || '').replace(/\/+$/, '');
const AI_MODEL = process.env.AI_MODEL || '';

function buildApiKeyPool() {
  const raw = [
    process.env.GEMINI_API_KEY || '',
    ...(process.env.GEMINI_API_KEYS || '').split(','),
  ];
  const unique = [];
  for (const k of raw) {
    const trimmed = k.trim();
    if (trimmed && !unique.includes(trimmed)) unique.push(trimmed);
  }
  return unique;
}

const GEMINI_KEYS = buildApiKeyPool();
const OPENAI_KEY = process.env.AI_API_KEY || '';
const AI_CONFIGURED = AI_PROVIDER === 'openai_compatible'
  ? Boolean(OPENAI_KEY && AI_MODEL && AI_BASE_URL)
  : GEMINI_KEYS.length > 0;

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------
class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

class ConflictError extends ValidationError {
  constructor(message) {
    super(message);
    this.name = 'ConflictError';
  }
}

// ---------------------------------------------------------------------------
// Asia/Ho_Chi_Minh (GMT+7) Date & Time Utilities
// ---------------------------------------------------------------------------
const TZ_OFFSET_MS = 7 * 60 * 60 * 1000;

function vnNow() {
  return new Date(Date.now() + TZ_OFFSET_MS);
}

function vnIsoNow() {
  const d = vnNow();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+07:00`;
}

function vnTodayDateStr() {
  return vnNow().toISOString().slice(0, 10);
}

function vnCurrentHmStr() {
  return vnNow().toISOString().slice(0, 16);
}

function parseIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ValidationError('Ngày phải có dạng YYYY-MM-DD.');
  }
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    throw new ValidationError('Ngày không hợp lệ.');
  }
  return dt;
}

function addDaysIso(iso, days) {
  const dt = parseIsoDate(iso);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function mondayOf(value) {
  const iso = value || vnTodayDateStr();
  const dt = parseIsoDate(iso);
  const weekday = dt.getUTCDay();
  const offset = weekday === 0 ? -6 : 1 - weekday;
  dt.setUTCDate(dt.getUTCDate() + offset);
  return dt.toISOString().slice(0, 10);
}

function parseVnDateTimeEpochMs(dateStr, timeStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  return Date.UTC(y, m - 1, d, hh, mm, 0) - TZ_OFFSET_MS;
}

// ---------------------------------------------------------------------------
// In-Memory Persistence (Users, Sessions, Devices, IoT State, Calendar)
// ---------------------------------------------------------------------------
const usersById = new Map();
const usersByName = new Map();
const sessions = new Map();
const userPreferences = new Map();
const userDevices = new Map();     // deviceId -> { device_id, user_id, name, tokenHash, state, commandQueue, lastSeenMs }
const deviceTokens = new Map();    // tokenHash -> device
const eventsMap = new Map();
const remindersMap = new Map();
const authAttempts = new Map();

let defaultPreferences = { ...DEFAULT_PREFERENCES };

function defaultDeviceState() {
  return {
    volume: 75,
    muted: false,
    backlight: 85,
    displayMode: 'schedule',
    gpioOutputs: {
      led_status: true,
      relay_lab: false,
      buzzer_alert: false,
      servo_angle: 90,
    },
    telemetry: {
      wifiRssi: -54,
      freePsramKb: 7680,
      cpuTempC: 41.2,
    },
    lastCommand: null,
    updatedAt: vnIsoNow(),
  };
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(password, stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, expectedHex] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

function createSession(user) {
  const now = Date.now();
  for (const [k, v] of sessions.entries()) {
    if (v.expiresAt <= now) sessions.delete(k);
  }
  const token = crypto.randomBytes(32).toString('base64url');
  const digest = crypto.createHash('sha256').update(token).digest('hex');
  sessions.set(digest, { user, expiresAt: now + 86400 * 1000 });
  return token;
}

function getSession(token) {
  if (typeof token !== 'string' || !token || token.length > 256) return null;
  const digest = crypto.createHash('sha256').update(token).digest('hex');
  const item = sessions.get(digest);
  if (!item) return null;
  if (item.expiresAt <= Date.now()) {
    sessions.delete(digest);
    return null;
  }
  return item.user;
}

function revokeSession(token) {
  if (typeof token === 'string' && token.length <= 256) {
    const digest = crypto.createHash('sha256').update(token).digest('hex');
    sessions.delete(digest);
  }
}

function validatePreferences(data) {
  const allowed = ['assistant_name', 'style_prompt', 'model', 'voice'];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new ValidationError('Cần đúng bốn trường assistant_name, style_prompt, model và voice.');
  }
  const keys = Object.keys(data);
  if (keys.length !== allowed.length || !allowed.every((k) => keys.includes(k))) {
    throw new ValidationError('Cần đúng bốn trường assistant_name, style_prompt, model và voice.');
  }
  const { assistant_name, style_prompt, model, voice } = data;
  if (typeof assistant_name !== 'string' || assistant_name.trim().length < 1 || assistant_name.trim().length > 64 || /[\x00-\x1f]/.test(assistant_name)) {
    throw new ValidationError('assistant_name phải dài 1–64 ký tự.');
  }
  if (typeof style_prompt !== 'string' || style_prompt.length > 1200 || style_prompt.includes('\x00')) {
    throw new ValidationError('style_prompt tối đa 1200 ký tự.');
  }
  if (typeof model !== 'string' || (model !== DEFAULT_PREFERENCES.model && !MODELS.includes(model))) {
    throw new ValidationError('Model không hỗ trợ audio, công cụ và thinking tối thiểu.');
  }
  if (typeof voice !== 'string' || !VOICES.includes(voice)) {
    throw new ValidationError('Giọng Gemini TTS không hợp lệ.');
  }
  return {
    assistant_name: assistant_name.trim(),
    style_prompt: style_prompt.trim(),
    model,
    voice,
  };
}

function getPreferencesForUser(userId) {
  if (userId === 'default') return { ...defaultPreferences };
  return { ...(userPreferences.get(userId) || DEFAULT_PREFERENCES) };
}

function savePreferencesForUser(userId, body) {
  const validated = validatePreferences(body);
  if (userId === 'default') {
    defaultPreferences = validated;
  } else {
    userPreferences.set(userId, validated);
  }
  return validated;
}

// ---------------------------------------------------------------------------
// Calendar Store Logic
// ---------------------------------------------------------------------------
const EVENT_FIELDS = ['title', 'date', 'start', 'end', 'note', 'remind_minutes'];

function validateEventPayload(payload, current = null) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ValidationError('Dữ liệu lịch chứa trường không hợp lệ.');
  }
  for (const key of Object.keys(payload)) {
    if (!EVENT_FIELDS.includes(key)) {
      throw new ValidationError('Dữ liệu lịch chứa trường không hợp lệ.');
    }
  }
  const values = current
    ? {
        title: current.title,
        date: current.date,
        start: current.start,
        end: current.end,
        note: current.note,
        remind_minutes: current.remind_minutes,
        ...payload,
      }
    : { note: '', remind_minutes: 0, ...payload };

  for (const key of EVENT_FIELDS) {
    if (values[key] === undefined) {
      throw new ValidationError('Thiếu tiêu đề, ngày hoặc giờ.');
    }
  }
  if (typeof values.title !== 'string' || !values.title.trim() || values.title.length > 120 || values.title.includes('\x00')) {
    throw new ValidationError('Tiêu đề phải có 1–120 ký tự.');
  }
  parseIsoDate(values.date);
  for (const k of ['start', 'end']) {
    if (typeof values[k] !== 'string' || !/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(values[k])) {
      throw new ValidationError('Giờ phải có dạng HH:MM.');
    }
  }
  if (values.end <= values.start) {
    throw new ValidationError('Giờ kết thúc phải sau giờ bắt đầu trong cùng ngày.');
  }
  if (typeof values.note !== 'string' || values.note.length > 2000 || values.note.includes('\x00')) {
    throw new ValidationError('Ghi chú tối đa 2000 ký tự.');
  }
  if (!Number.isInteger(values.remind_minutes) || values.remind_minutes < 0 || values.remind_minutes > 1440) {
    throw new ValidationError('Giá trị số nguyên không hợp lệ.');
  }
  return values;
}

function stripUserId(ev) {
  if (!ev) return null;
  const { user_id: _u, ...rest } = ev;
  return rest;
}

function listEvents(startDate, endDate, userId = 'default') {
  if (parseIsoDate(startDate) > parseIsoDate(endDate)) {
    throw new ValidationError('Khoảng ngày không hợp lệ.');
  }
  const result = [];
  for (const ev of eventsMap.values()) {
    if (ev.user_id === userId && ev.date >= startDate && ev.date <= endDate) {
      result.push(stripUserId(ev));
    }
  }
  result.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
  return result;
}

function getEvent(id, userId = 'default') {
  if (typeof id !== 'string' || !id) throw new ValidationError('ID không hợp lệ.');
  const ev = eventsMap.get(id);
  if (!ev || ev.user_id !== userId) return null;
  return stripUserId(ev);
}

function checkOverlap(values, userId, excludeId = '') {
  for (const ev of eventsMap.values()) {
    if (ev.user_id === userId && ev.date === values.date && ev.id !== excludeId) {
      if (ev.start < values.end && ev.end > values.start) {
        throw new ConflictError('Khoảng giờ bị trùng với lịch hiện có.');
      }
    }
  }
}

function invalidateEventReminders(eventId, userId) {
  for (const rem of remindersMap.values()) {
    if (rem.user_id === userId && rem.event_id === eventId) {
      rem.active = false;
    }
  }
}

function createEvent(payload, userId = 'default') {
  const values = validateEventPayload(payload);
  checkOverlap(values, userId);
  const event = {
    ...values,
    id: crypto.randomUUID(),
    revision: 1,
    user_id: userId,
  };
  eventsMap.set(event.id, event);
  return stripUserId(event);
}

function updateEvent(id, payload, expectedRevision, userId = 'default') {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
    throw new ConflictError('Lịch đã thay đổi hoặc đã bị xóa. Hãy tải lại.');
  }
  const current = getEvent(id, userId);
  if (!current || current.revision !== expectedRevision) {
    throw new ConflictError('Lịch đã thay đổi hoặc đã bị xóa. Hãy tải lại.');
  }
  const values = validateEventPayload(payload, current);
  checkOverlap(values, userId, id);
  const updated = {
    ...values,
    id,
    revision: current.revision + 1,
    user_id: userId,
  };
  eventsMap.set(id, updated);
  invalidateEventReminders(id, userId);
  return stripUserId(updated);
}

function deleteEvent(id, expectedRevision, userId = 'default') {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
    throw new ConflictError('Lịch đã thay đổi hoặc đã bị xóa. Hãy tải lại.');
  }
  const current = getEvent(id, userId);
  if (!current || current.revision !== expectedRevision) {
    throw new ConflictError('Lịch đã thay đổi hoặc đã bị xóa. Hãy tải lại.');
  }
  eventsMap.delete(id);
  invalidateEventReminders(id, userId);
}

function copyWeek(sourceMonday, targetMonday, userId = 'default') {
  const srcDate = parseIsoDate(sourceMonday);
  const tgtDate = parseIsoDate(targetMonday);
  if (srcDate.getUTCDay() !== 1 || tgtDate.getUTCDay() !== 1) {
    throw new ValidationError('Tuần phải bắt đầu vào thứ Hai.');
  }
  const sourceEnd = addDaysIso(sourceMonday, 6);
  const sourceEvents = listEvents(sourceMonday, sourceEnd, userId);
  const dayDiff = Math.round((tgtDate.getTime() - srcDate.getTime()) / 86400000);

  const staged = sourceEvents.map((ev) => {
    const newDate = addDaysIso(ev.date, dayDiff);
    const values = {
      title: ev.title,
      date: newDate,
      start: ev.start,
      end: ev.end,
      note: ev.note,
      remind_minutes: ev.remind_minutes,
    };
    checkOverlap(values, userId);
    return values;
  });

  const copies = [];
  for (const values of staged) {
    copies.push(createEvent(values, userId));
  }
  return copies;
}

function syncAndListReminders(userId = 'default', limit = 30) {
  const nowMs = Date.now();
  const today = vnTodayDateStr();
  const tomorrow = addDaysIso(today, 1);
  const candidates = listEvents(today, tomorrow, userId);

  for (const ev of candidates) {
    const startMs = parseVnDateTimeEpochMs(ev.date, ev.start);
    const endMs = parseVnDateTimeEpochMs(ev.date, ev.end);
    if (nowMs >= endMs || startMs - nowMs > ev.remind_minutes * 60 * 1000) {
      continue;
    }
    const reminderId = `${ev.id}:${ev.revision}`;
    const key = `${userId}:${reminderId}`;
    if (!remindersMap.has(key)) {
      const payload = {
        id: reminderId,
        event: ev,
        text: `Nhắc lịch: ${ev.title}, ${ev.start} ngày ${ev.date}.`,
        expires_at: new Date(endMs + TZ_OFFSET_MS).toISOString().replace('Z', '+07:00'),
      };
      remindersMap.set(key, {
        ...payload,
        event_id: ev.id,
        revision: ev.revision,
        status: 'pending',
        active: true,
        updated_at: vnIsoNow(),
        updated_seq: Date.now(),
        user_id: userId,
      });
    }
  }

  const history = [];
  for (const rem of remindersMap.values()) {
    if (rem.user_id === userId) {
      history.push({
        id: rem.id,
        event: rem.event,
        text: rem.text,
        expires_at: rem.expires_at,
        status: rem.status,
        active: rem.active,
        updated_at: rem.updated_at,
        _seq: rem.updated_seq,
      });
    }
  }
  history.sort((a, b) => b._seq - a._seq);
  return history.slice(0, limit).map(({ _seq, ...rest }) => rest);
}

// ---------------------------------------------------------------------------
// Pre-Seed Demo STEM IoT Workspace
// ---------------------------------------------------------------------------
const DEMO_USERNAME = 'stemdemo';
const DEMO_USER_ID = 'demo-stem-iot-user';

function seedDemoWorkspace() {
  if (usersById.has(DEMO_USER_ID)) return;
  usersById.set(DEMO_USER_ID, {
    id: DEMO_USER_ID,
    username: DEMO_USERNAME,
    passwordHash: hashPassword('stemiotdemo2026'),
    email: null,
  });
  usersByName.set(DEMO_USERNAME, DEMO_USER_ID);
  userPreferences.set(DEMO_USER_ID, { ...DEFAULT_PREFERENCES });

  const demoDeviceId = 'esp32s3-stem-01';
  const demoToken = 'stem-demo-device-token-' + crypto.randomBytes(12).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(demoToken).digest('hex');
  const device = {
    device_id: demoDeviceId,
    user_id: DEMO_USER_ID,
    name: 'Board ESP32-S3 Phòng Lab',
    tokenHash,
    simulatedOnline: true,
    lastSeenMs: Date.now(),
    state: defaultDeviceState(),
    commandQueue: [],
  };
  userDevices.set(demoDeviceId, device);
  deviceTokens.set(tokenHash, device);

  const today = vnTodayDateStr();
  const nextDay = addDaysIso(today, 1);
  const samples = [
    {
      title: 'Thực hành mạch I2S & Loa MAX98357A',
      date: today,
      start: '08:30',
      end: '10:00',
      note: 'Kiểm tra chân LRCK GPIO16, BCLK GPIO15, DOUT GPIO7 trên kit ESP32-S3.',
      remind_minutes: 15,
    },
    {
      title: 'Kiểm thử màn hình ST7789 240×240',
      date: today,
      start: '14:00',
      end: '15:30',
      note: 'Hiệu chỉnh đèn nền GPIO13 và giao diện hiển thị lịch STEM.',
      remind_minutes: 10,
    },
    {
      title: 'Thử nghiệm Servo & Relay IoT qua Web',
      date: nextDay,
      start: '09:00',
      end: '10:30',
      note: 'Đồng bộ lệnh điều khiển từ App Stem IOT xuống thiết bị.',
      remind_minutes: 10,
    },
  ];
  for (const s of samples) {
    createEvent(s, DEMO_USER_ID);
  }
}

seedDemoWorkspace();

// ---------------------------------------------------------------------------
// Gemini Calendar & STEM IoT Agent
// ---------------------------------------------------------------------------
const CONFIRM_WORDS = new Set(['xác nhận', 'đồng ý', 'ok']);
const CANCEL_WORDS = new Set(['hủy', 'huỷ', 'hủy bỏ', 'không', 'không đồng ý']);
const PENDING_MS = 900 * 1000;
const SESSION_TTL_MS = 1800 * 1000;
const MAX_SESSIONS = 128;
const MAX_ROUNDS = 6;
const MAX_CONTENTS = 24;

const CALENDAR_INTENT_RE = /(?:^|\s)(?:lịch(?!\s+sử)|nhắc\s*(?:lịch|tôi|mình)|cuộc\s+hẹn|sự\s+kiện|thời\s+khóa\s+biểu)(?=\s|$|[.,!?])/i;
const CALENDAR_ACTION_RE = /(?:^|\s)(?:thêm|tạo|đặt|sửa|đổi|xóa|hủy|huỷ|lên\s+kế\s+hoạch)(?=\s|$|[.,!?])/i;
const WEEKDAY_RE = /(?:^|\s)(?:thứ\s*(?:hai|ba|tư|năm|sáu|bảy|[2-7])|chủ\s*nhật)(?=\s|$|[.,!?])/i;
const TIME_OF_DAY_RE = /(?:\d{1,2}\s*(?:giờ|h)|\d{1,2}:\d{2}|sáng|trưa|chiều|tối)/i;

function isCalendarIntent(text) {
  if (CALENDAR_INTENT_RE.test(text)) return true;
  return WEEKDAY_RE.test(text) && (CALENDAR_ACTION_RE.test(text) || TIME_OF_DAY_RE.test(text));
}

function describeEvent(ev) {
  return `${ev.title} — ${ev.date}, ${ev.start}–${ev.end}; ghi chú: ${ev.note || '(trống)'}; nhắc trước ${ev.remind_minutes} phút`;
}

function spokenEvent(ev, includeEmpty = false) {
  let text = `${ev.title}, ${ev.start}–${ev.end} ngày ${ev.date} (Asia/Ho_Chi_Minh)`;
  if (ev.note || includeEmpty) text += `; ghi chú: ${ev.note || '(trống)'}`;
  if (ev.remind_minutes || includeEmpty) text += `; nhắc trước ${ev.remind_minutes} phút`;
  return text;
}

function spokenAction(pending, completed = false) {
  const verbs = completed
    ? { propose_create: 'Đã đặt', propose_update: 'Đã sửa', propose_delete: 'Đã xóa' }
    : { propose_create: 'Đặt', propose_update: 'Sửa', propose_delete: 'Xóa' };
  const verb = verbs[pending.action];
  let detail;
  if (pending.action === 'propose_update') {
    detail = `${spokenEvent(pending.current, true)} thành ${spokenEvent(pending.event, true)}`;
  } else {
    detail = spokenEvent(pending.action === 'propose_delete' ? pending.current : pending.event);
  }
  if (pending.action !== 'propose_create') {
    detail += ` (ID ${pending.id})`;
  }
  const warning = pending.conflict && !completed ? '; có lịch trùng giờ' : '';
  return `${verb} lịch ${detail}${warning}${completed ? '.' : '; xác nhận hay hủy?'}`;
}

const chatSessions = new Map();
const genaiClients = new Map();
let activeKeyIndex = 0;

function getOrCreateChatSession(sessionId, userId) {
  const key = userId === 'default' ? sessionId : `${userId}:${sessionId}`;
  const now = Date.now();
  for (const [k, s] of chatSessions.entries()) {
    if (!s.busy && now - s.lastUsed >= SESSION_TTL_MS) {
      chatSessions.delete(k);
    }
  }
  if (!chatSessions.has(key)) {
    if (chatSessions.size >= MAX_SESSIONS) {
      let oldestKey = null;
      let oldestTime = Infinity;
      for (const [k, s] of chatSessions.entries()) {
        if (!s.busy && s.lastUsed < oldestTime) {
          oldestTime = s.lastUsed;
          oldestKey = k;
        }
      }
      if (oldestKey) chatSessions.delete(oldestKey);
    }
    chatSessions.set(key, { history: [], pending: null, lastUsed: now, busy: false });
  }
  const state = chatSessions.get(key);
  state.lastUsed = now;
  return state;
}

function rememberTurn(state, turnItems) {
  state.history.push(turnItems);
  while (state.history.reduce((sum, items) => sum + items.length, 0) > MAX_CONTENTS) {
    state.history.shift();
  }
}

function getCalendarToolsDeclaration() {
  const eventProps = {
    title: { type: Type.STRING },
    date: { type: Type.STRING },
    start: { type: Type.STRING },
    end: { type: Type.STRING },
    note: { type: Type.STRING },
    remind_minutes: { type: Type.INTEGER },
  };
  return [
    {
      functionDeclarations: [
        {
          name: 'list_calendar',
          description: 'Đọc lịch từ cơ sở dữ liệu trong khoảng ngày ISO, bao gồm hai đầu.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              start_date: { type: Type.STRING },
              end_date: { type: Type.STRING },
            },
            required: ['start_date', 'end_date'],
          },
        },
        {
          name: 'propose_create',
          description: 'Đề xuất thêm một lịch, KHÔNG lưu cho đến khi người dùng xác nhận.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              event: {
                type: Type.OBJECT,
                properties: eventProps,
                required: ['title', 'date', 'start', 'end'],
              },
            },
            required: ['event'],
          },
        },
        {
          name: 'propose_update',
          description: 'Đề xuất sửa đúng một ID đã đọc từ lịch; chỉ truyền trường cần sửa.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              event: {
                type: Type.OBJECT,
                properties: eventProps,
              },
            },
            required: ['id', 'event'],
          },
        },
        {
          name: 'propose_delete',
          description: 'Đề xuất xóa đúng một ID đã đọc từ lịch, không xóa cả ngày.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
            },
            required: ['id'],
          },
        },
      ],
    },
  ];
}

function executeCalendarTool(name, args, userId) {
  const validKeys = {
    list_calendar: ['start_date', 'end_date'],
    propose_create: ['event'],
    propose_update: ['id', 'event'],
    propose_delete: ['id'],
  };
  if (!validKeys[name] || !args || typeof args !== 'object' || Array.isArray(args)) {
    throw new ValidationError('Công cụ không hợp lệ.');
  }
  const argKeys = Object.keys(args);
  if (argKeys.length !== validKeys[name].length || !validKeys[name].every((k) => argKeys.includes(k))) {
    throw new ValidationError('Công cụ không hợp lệ.');
  }
  if (name === 'list_calendar') {
    const start = parseIsoDate(args.start_date);
    const end = parseIsoDate(args.end_date);
    const diffDays = Math.round((end.getTime() - start.getTime()) / 86400000);
    if (diffDays < 0 || diffDays > 366) {
      throw new ValidationError('Khoảng tra cứu tối đa 366 ngày.');
    }
    const events = listEvents(args.start_date, args.end_date, userId);
    return { events: events.slice(0, 200), truncated: events.length > 200 };
  }
  let current = null;
  const data = { action: name };
  if (name !== 'propose_create') {
    if (typeof args.id !== 'string' || args.id.length < 1 || args.id.length > 128) {
      throw new ValidationError('ID không hợp lệ.');
    }
    current = getEvent(args.id, userId);
    if (!current) throw new ValidationError('Không tìm thấy lịch.');
    data.id = current.id;
    data.revision = current.revision;
    data.current = current;
  }
  if (name === 'propose_delete') {
    data.summary = 'Xóa: ' + describeEvent(current);
  } else {
    if (!args.event || typeof args.event !== 'object' || Object.keys(args.event).length === 0) {
      throw new ValidationError('Thiếu thay đổi.');
    }
    data.event = validateEventPayload(args.event, current);
    data.summary = (current === null ? 'Thêm: ' : `Sửa từ: ${describeEvent(current)}\nThành: `) + describeEvent(data.event);
    const existing = listEvents(data.event.date, data.event.date, userId);
    data.conflict = existing.some(
      (item) => item.id !== data.id && item.start < data.event.end && item.end > data.event.start,
    );
  }
  if (current) {
    data.summary += ` (ID ${current.id}, phiên bản ${current.revision})`;
  }
  return data;
}

async function generateWithGemini(modelName, contents, systemInstruction, tools) {
  if (!GEMINI_KEYS.length) {
    throw new Error('Chưa cấu hình GEMINI_API_KEY trong .env trên server.');
  }
  let lastError;
  for (let attempt = 0; attempt < GEMINI_KEYS.length; attempt++) {
    const idx = (activeKeyIndex + attempt) % GEMINI_KEYS.length;
    const key = GEMINI_KEYS[idx];
    let client = genaiClients.get(idx);
    if (!client) {
      client = new GoogleGenAI({ apiKey: key });
      genaiClients.set(idx, client);
    }
    try {
      const config = {
        systemInstruction,
        temperature: 0.2,
        maxOutputTokens: 2048,
      };
      if (tools) {
        config.tools = tools;
      }
      const response = await client.models.generateContent({
        model: modelName,
        contents,
        config,
      });
      activeKeyIndex = idx;
      return response;
    } catch (err) {
      lastError = err;
      const status = err?.status || err?.code;
      if ([401, 403, 429, 500, 502, 503, 504].includes(status) && attempt + 1 < GEMINI_KEYS.length) {
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

async function handleChat(sessionId, message, selectedWeek, confirmation, userId) {
  const prefs = getPreferencesForUser(userId);
  const state = getOrCreateChatSession(sessionId, userId);
  const normalized = message.trim().normalize('NFC').toLowerCase().replace(/[.!?…。！？]+$/g, '').trim();

  if (state.pending && Date.now() >= state.pending.expires) {
    state.pending = null;
    state.history = [];
  }

  if (CANCEL_WORDS.has(normalized)) {
    state.pending = null;
    state.history = [];
    return { reply: 'Đã hủy đề xuất; lịch không thay đổi.', pending: null, changed: false };
  }

  if (confirmation !== undefined || CONFIRM_WORDS.has(normalized)) {
    if (!state.pending) {
      return { reply: 'Không có đề xuất còn hiệu lực để xác nhận. Hãy yêu cầu lại.', pending: null, changed: false };
    }
    if (confirmation !== undefined && !safeEqual(confirmation, state.pending.token)) {
      return { reply: 'Mã xác nhận không đúng phiên hoặc đã hết hiệu lực.', pending: null, changed: false };
    }
    if (normalized && !CONFIRM_WORDS.has(normalized)) {
      state.pending = null;
      state.history = [];
      return {
        reply: 'Đã bỏ đề xuất cũ. Hãy gửi riêng yêu cầu thay đổi để xem lại trước khi xác nhận.',
        pending: null,
        changed: false,
      };
    }
    const pending = state.pending;
    state.pending = null;
    state.history = [];
    try {
      if (pending.action === 'propose_create') {
        createEvent(pending.event, userId);
      } else if (pending.action === 'propose_update') {
        updateEvent(pending.id, pending.event, pending.revision, userId);
      } else {
        deleteEvent(pending.id, pending.revision, userId);
      }
    } catch (err) {
      if (err instanceof ValidationError) {
        return {
          reply: 'Không thể lưu: lịch đã thay đổi, bị xóa hoặc trùng giờ. Hãy kiểm tra và yêu cầu lại.',
          pending: null,
          changed: false,
        };
      }
      throw err;
    }
    return { reply: spokenAction(pending, true), pending: null, changed: true };
  }

  if (state.pending) {
    state.pending = null;
    state.history = [];
  }
  if (!normalized) {
    return { reply: 'Hãy nhập yêu cầu hoặc xác nhận một đề xuất còn hiệu lực.', pending: null, changed: false };
  }

  const calendarIntent = isCalendarIntent(normalized);
  if (
    calendarIntent &&
    !selectedWeek &&
    WEEKDAY_RE.test(normalized) &&
    !/(?:tuần\s+(?:này|sau|tới|trước)|\d{4}-\d{2}-\d{2})/i.test(normalized)
  ) {
    return { reply: 'Bạn muốn ngày đó thuộc tuần nào?', pending: null, changed: false };
  }

  if (AI_PROVIDER === 'openai_compatible') {
    const resp = await fetch(
      AI_BASE_URL + (AI_BASE_URL.endsWith('/v1') ? '/chat/completions' : '/v1/chat/completions'),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${OPENAI_KEY}`,
        },
        body: JSON.stringify({
          model: AI_MODEL,
          messages: [
            {
              role: 'system',
              content: `Bạn là trợ lý của App Stem IOT tên là ${prefs.assistant_name}. ${prefs.style_prompt ? `Phong cách: ${prefs.style_prompt}` : ''}`,
            },
            { role: 'user', content: message },
          ],
        }),
      },
    );
    if (!resp.ok) throw new Error(`Provider HTTP ${resp.status}`);
    const data = await resp.json();
    const reply = data?.choices?.[0]?.message?.content?.trim() || 'Không nhận được phản hồi.';
    return { reply, pending: null, changed: false };
  }

  let systemBase =
    'Bạn là trợ lý AI của App Stem IOT, hỗ trợ lịch học, nhắc việc và phần cứng ESP32-S3 (I2S Mic GPIO4/5/6, MAX98357A GPIO15/16/7, ST7789 240x240 GPIO8/9/10/13/14/18). ' +
    'Trò chuyện và trả lời tự nhiên bằng ngôn ngữ người dùng. ' +
    'Chỉ dùng công cụ lịch khi người dùng hỏi về lịch/nhắc lịch. ' +
    'Với yêu cầu lịch, không bịa dữ liệu: chỉ dựa vào list_calendar hoặc ảnh chụp DB mới; ' +
    'hỏi lại bằng một câu hỏi ngắn nếu thiếu thông tin cần thiết. Lịch chưa được lưu cho đến khi người dùng xác nhận; ' +
    'không tự xác nhận hoặc tự thay đổi. Chỉ đề xuất một thay đổi mỗi lượt; không xóa hàng loạt.';

  if (calendarIntent) {
    const today = vnTodayDateStr();
    const upcoming = listEvents(today, addDaysIso(today, 7), userId);
    systemBase +=
      ` Múi giờ Asia/Ho_Chi_Minh; hiện tại ${vnIsoNow()}; ` +
      `tuần được chọn (thứ Hai): ${selectedWeek || 'chưa chọn'}. ` +
      'Ảnh chụp lịch hôm nay và 7 ngày tới:\n' +
      JSON.stringify(upcoming.slice(0, 200));
  }

  const systemInstruction =
    `${systemBase} Bạn tên là ${prefs.assistant_name}.\n` +
    'Phong cách người dùng:\n' +
    `<style>${(prefs.style_prompt || '').slice(0, 1200)}</style>\n` +
    'Mọi thay đổi lịch vẫn cần đề xuất và xác nhận riêng theo mã điều khiển ứng dụng.';

  const tools = calendarIntent ? getCalendarToolsDeclaration() : undefined;
  const turn = [{ role: 'user', parts: [{ text: message }] }];
  const contents = [...state.history.flat(), ...turn];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await generateWithGemini(prefs.model || DEFAULT_PREFERENCES.model, contents, systemInstruction, tools);
    const candidate = response?.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    if (!candidate || !parts.length) {
      return { reply: 'Gemini không trả về nội dung. Hãy thử lại.', pending: null, changed: false };
    }
    const calls = parts.filter((p) => p.functionCall).map((p) => p.functionCall);
    if (!calls.length) {
      const reply = parts
        .filter((p) => typeof p.text === 'string' && !p.thought)
        .map((p) => p.text)
        .join('\n')
        .trim();
      if (!reply) {
        return { reply: 'Gemini không trả về câu trả lời. Hãy thử lại.', pending: null, changed: false };
      }
      turn.push(candidate.content);
      rememberTurn(state, turn);
      return { reply, pending: null, changed: false };
    }
    if (calls.length !== 1) {
      return { reply: 'Chỉ hỗ trợ một công cụ hoặc một đề xuất mỗi lần. Lịch không thay đổi.', pending: null, changed: false };
    }
    const call = calls[0];
    let toolResult;
    try {
      toolResult = executeCalendarTool(call.name, call.args, userId);
    } catch (err) {
      if (err instanceof ValidationError) {
        return {
          reply: 'Yêu cầu công cụ hoặc dữ liệu lịch không hợp lệ. Hãy kiểm tra ngày, giờ và ID; lịch không thay đổi.',
          pending: null,
          changed: false,
        };
      }
      throw err;
    }
    contents.push(candidate.content);
    turn.push(candidate.content);

    if (call.name !== 'list_calendar') {
      const pending = {
        ...toolResult,
        token: crypto.randomBytes(24).toString('base64url'),
        expires: Date.now() + PENDING_MS,
      };
      state.pending = pending;
      const toolReply = {
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: call.name,
              response: { status: 'awaiting_confirmation', summary: pending.summary, changed: false },
            },
          },
        ],
      };
      turn.push(toolReply);
      const reply = spokenAction(pending);
      turn.push({ role: 'model', parts: [{ text: reply }] });
      rememberTurn(state, turn);
      return { reply, pending: { token: pending.token, summary: pending.summary }, changed: false };
    }

    const toolReply = {
      role: 'user',
      parts: [{ functionResponse: { name: call.name, response: toolResult } }],
    };
    contents.push(toolReply);
    turn.push(toolReply);
  }
  return { reply: 'Đã đạt giới hạn tra cứu trong một lượt. Hãy thu hẹp yêu cầu; lịch không thay đổi.', pending: null, changed: false };
}

// ---------------------------------------------------------------------------
// Express App & Middleware
// ---------------------------------------------------------------------------
const app = express();
app.set('trust proxy', true);

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const map = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) {
      try {
        map[key] = decodeURIComponent(val);
      } catch {
        map[key] = val;
      }
    }
  }
  return map;
}

function isHttpsRequest(req) {
  return Boolean(req.secure || req.get('x-forwarded-proto') === 'https' || PUBLIC_BASE_URL.startsWith('https://'));
}

function setAuthCookies(req, res, token) {
  const csrf = crypto.randomBytes(24).toString('base64url');
  const secure = isHttpsRequest(req);
  const sameSite = secure ? 'none' : 'lax';
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite,
    secure,
    maxAge: 86400 * 1000,
    path: '/',
  });
  res.cookie(CSRF_COOKIE, csrf, {
    httpOnly: false,
    sameSite,
    secure,
    maxAge: 86400 * 1000,
    path: '/',
  });
}

function clearAuthCookies(req, res) {
  const secure = isHttpsRequest(req);
  const sameSite = secure ? 'none' : 'lax';
  res.clearCookie(SESSION_COOKIE, { path: '/', secure, sameSite });
  res.clearCookie(CSRF_COOKIE, { path: '/', secure, sameSite });
}

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (req.path.startsWith('/api/') || req.path === '/') {
    res.setHeader('Cache-Control', 'no-store');
  }
  req.cookies = parseCookies(req);
  next();
});

app.use(['/api', '/device', '/xiaozhi'], (req, res, next) => {
  express.json({ limit: '32kb' })(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: 'Nội dung phải là JSON object.' });
    }
    return next();
  });
});

// API boundary middleware
app.use('/api', (req, res, next) => {
  const user = getSession(req.cookies[SESSION_COOKIE] || '');
  req.user = user;
  req.userId = user ? user.id : null;
  req.legacyAuth = Boolean(user && user.id === 'default');

  const isPublicAuth = req.path === '/auth/register' || req.path === '/auth/login' || req.path === '/auth/demo';
  if (isPublicAuth && req.method === 'POST') {
    const peer = req.ip || 'unknown';
    const now = Date.now();
    for (const [addr, list] of authAttempts.entries()) {
      const fresh = list.filter((ts) => ts > now - 60000);
      if (fresh.length) authAttempts.set(addr, fresh);
      else authAttempts.delete(addr);
    }
    const queue = authAttempts.get(peer) || [];
    if (queue.length >= 20) {
      res.setHeader('Retry-After', '60');
      return res.status(429).json({ error: 'Thử lại sau một phút.' });
    }
    queue.push(now);
    authAttempts.set(peer, queue);
  }

  if (!user && !isPublicAuth) {
    return res.status(401).json({ error: 'Vui lòng đăng nhập để tiếp tục.' });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const origin = req.get('origin');
    const host = req.get('host');
    const expectedOrigin = PUBLIC_BASE_URL.startsWith('https://')
      ? PUBLIC_BASE_URL
      : `${req.protocol}://${host}`;
    const altOrigin = host ? `https://${host}` : '';
    const originOk = !origin || origin === expectedOrigin || origin === altOrigin || origin === `http://${host}`;
    if (req.get('x-requested-with') !== 'chatbot' || !originOk) {
      return res.status(403).json({ error: 'Yêu cầu khác nguồn bị từ chối.' });
    }
    if (!req.is('application/json')) {
      return res.status(400).json({ error: 'Yêu cầu JSON.' });
    }
    if (user && !isPublicAuth && !req.legacyAuth) {
      const csrfCookie = req.cookies[CSRF_COOKIE] || '';
      const csrfHeader = req.get('x-csrf-token') || '';
      if (!safeEqual(csrfCookie, csrfHeader)) {
        return res.status(403).json({ error: 'Thiếu hoặc sai mã CSRF.' });
      }
    }
  }
  return next();
});

// Device token authentication middleware for real ESP32 hardware
function authenticateDevice(req, res, next) {
  const auth = req.get('authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const token = bearer || (typeof req.query.token === 'string' ? req.query.token : '');
  if (!token || token.length > 256) {
    return res.status(401).json({ error: 'Device token không hợp lệ.' });
  }
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const device = deviceTokens.get(tokenHash);
  if (!device) {
    return res.status(401).json({ error: 'Device token không hợp lệ.' });
  }
  const suppliedId = req.get('device-id') || (typeof req.query.device_id === 'string' ? req.query.device_id : '');
  if (suppliedId && suppliedId !== device.device_id) {
    return res.status(403).json({ error: 'Device ID không thuộc token.' });
  }
  device.lastSeenMs = Date.now();
  req.device = device;
  return next();
}

// ---------------------------------------------------------------------------
// HTML, PWA Manifest, Service Worker & Static Routes
// ---------------------------------------------------------------------------
app.get('/', (req, res) => {
  const user = getSession(req.cookies[SESSION_COOKIE] || '');
  if (!user) {
    return res.sendFile(path.join(ROOT, 'static', 'login.html'));
  }
  return res.sendFile(path.join(ROOT, 'static', 'index.html'));
});

app.get('/login', (req, res) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  if (!safeEqual(token, WEB_TOKEN)) {
    return res.status(401).type('text').send('Mã truy cập không đúng.');
  }
  const sessionToken = createSession({ id: 'default', username: 'default' });
  setAuthCookies(req, res, sessionToken);
  return res.redirect('/');
});

app.get('/manifest.webmanifest', (req, res) => {
  res.type('application/manifest+json');
  res.sendFile(path.join(ROOT, 'static', 'manifest.webmanifest'));
});

app.get('/sw.js', (req, res) => {
  res.setHeader('Service-Worker-Allowed', '/');
  res.type('application/javascript');
  res.sendFile(path.join(ROOT, 'static', 'sw.js'));
});

app.use('/static', express.static(path.join(ROOT, 'static')));

// ---------------------------------------------------------------------------
// Auth API
// ---------------------------------------------------------------------------
app.get('/api/auth/me', (req, res) => {
  res.json({ user: req.user });
});

app.post('/api/auth/demo', (req, res) => {
  seedDemoWorkspace();
  const record = usersById.get(DEMO_USER_ID);
  const user = { id: record.id, username: record.username, email: record.email };
  revokeSession(req.cookies[SESSION_COOKIE] || '');
  setAuthCookies(req, res, createSession(user));
  return res.json({ user });
});

app.post('/api/auth/logout', (req, res) => {
  revokeSession(req.cookies[SESSION_COOKIE] || '');
  clearAuthCookies(req, res);
  res.json({ ok: true });
});

app.post('/api/auth/:action', (req, res) => {
  const { action } = req.params;
  if (action !== 'register' && action !== 'login') {
    return res.status(404).json({ error: 'Not found' });
  }
  const data = req.body;
  if (!data || typeof data !== 'object' || Array.isArray(data) ||
      Object.keys(data).length !== 2 || !('username' in data) || !('password' in data)) {
    return res.status(400).json({ error: 'Cần tên đăng nhập và mật khẩu.' });
  }
  const { username, password } = data;
  if (typeof username !== 'string' || username.trim().length < 1 || username.trim().length > 80 || username.trim().toLowerCase() === 'default') {
    return res.status(400).json({ error: 'Tên đăng nhập không hợp lệ.' });
  }
  if (typeof password !== 'string' || password.length < 1 || password.length > 1024 || (action === 'register' && password.length < 12)) {
    return res.status(400).json({ error: 'Mật khẩu cần 12–1024 ký tự khi đăng ký.' });
  }
  const cleanName = username.trim();
  const lookupKey = cleanName.toLowerCase();

  let user;
  if (action === 'register') {
    if (usersByName.has(lookupKey)) {
      return res.status(400).json({ error: 'Tên đăng nhập đã tồn tại.' });
    }
    const id = crypto.randomUUID();
    const record = { id, username: cleanName, passwordHash: hashPassword(password), email: null };
    usersById.set(id, record);
    usersByName.set(lookupKey, id);
    user = { id: record.id, username: record.username, email: record.email };
  } else {
    const existingId = usersByName.get(lookupKey);
    const record = existingId ? usersById.get(existingId) : null;
    if (!record || !verifyPassword(password, record.passwordHash)) {
      return res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không đúng.' });
    }
    user = { id: record.id, username: record.username, email: record.email };
  }

  revokeSession(req.cookies[SESSION_COOKIE] || '');
  setAuthCookies(req, res, createSession(user));
  return res.status(action === 'register' ? 201 : 200).json({ user });
});

// ---------------------------------------------------------------------------
// Preferences, Devices, Status & STEM IoT Control
// ---------------------------------------------------------------------------
function isDeviceOnline(device) {
  if (device.simulatedOnline) return true;
  return Date.now() - (device.lastSeenMs || 0) < 35000;
}

function serializeIotDevice(device) {
  return {
    id: device.device_id,
    name: device.name,
    online: isDeviceOnline(device),
    busy: false,
    simulated: Boolean(device.simulatedOnline),
    last_seen: device.lastSeenMs ? new Date(device.lastSeenMs).toISOString() : null,
    state: device.state,
    pinout: ESP32_S3_PINOUT,
  };
}

app.get('/api/preferences', (req, res) => {
  const values = getPreferencesForUser(req.userId);
  res.json({ ...values, models: [...MODELS], voices: [...VOICES] });
});

app.put('/api/preferences', (req, res, next) => {
  try {
    const values = savePreferencesForUser(req.userId, req.body);
    res.json({ ...values, models: [...MODELS], voices: [...VOICES] });
  } catch (err) {
    next(err);
  }
});

app.get('/api/devices', (req, res) => {
  if (req.userId === 'default') {
    return res.status(400).json({ error: 'Đăng nhập tài khoản để quản lý thiết bị.' });
  }
  const list = [];
  for (const d of userDevices.values()) {
    if (d.user_id === req.userId) {
      list.push({ device_id: d.device_id, user_id: d.user_id, name: d.name });
    }
  }
  list.sort((a, b) => a.device_id.localeCompare(b.device_id));
  return res.json({ devices: list });
});

app.post('/api/devices', (req, res) => {
  if (req.userId === 'default') {
    return res.status(400).json({ error: 'Đăng nhập tài khoản để quản lý thiết bị.' });
  }
  const data = req.body;
  if (!data || typeof data !== 'object' || Array.isArray(data) || !('device_id' in data) ||
      Object.keys(data).some((k) => k !== 'device_id' && k !== 'name')) {
    return res.status(400).json({ error: 'Device ID không hợp lệ.' });
  }
  const deviceId = typeof data.device_id === 'string' ? data.device_id.trim() : '';
  const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : 'Board ESP32-S3';
  if (!deviceId || deviceId.length > 80 || name.length > 80) {
    return res.status(400).json({ error: 'Device ID không hợp lệ.' });
  }
  if (userDevices.has(deviceId)) {
    return res.status(400).json({ error: 'Thiết bị đã tồn tại.' });
  }
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const device = {
    device_id: deviceId,
    user_id: req.userId,
    name,
    tokenHash,
    simulatedOnline: false,
    lastSeenMs: 0,
    state: defaultDeviceState(),
    commandQueue: [],
  };
  userDevices.set(deviceId, device);
  deviceTokens.set(tokenHash, device);
  return res.status(201).json({ device_id: deviceId, user_id: req.userId, name, token });
});

app.delete('/api/devices/:id', (req, res) => {
  if (req.userId === 'default') {
    return res.status(400).json({ error: 'Đăng nhập tài khoản để quản lý thiết bị.' });
  }
  const existing = userDevices.get(req.params.id);
  if (!existing || existing.user_id !== req.userId) {
    return res.status(404).json({ error: 'Not found' });
  }
  userDevices.delete(req.params.id);
  deviceTokens.delete(existing.tokenHash);
  return res.json({ ok: true });
});

app.get('/api/iot/devices', (req, res) => {
  const list = [];
  for (const d of userDevices.values()) {
    if (d.user_id === req.userId) {
      list.push(serializeIotDevice(d));
    }
  }
  list.sort((a, b) => a.id.localeCompare(b.id));
  res.json({ devices: list, pinout: ESP32_S3_PINOUT });
});

app.post('/api/iot/devices/:id/command', (req, res, next) => {
  try {
    const device = userDevices.get(req.params.id);
    if (!device || device.user_id !== req.userId) {
      return res.status(404).json({ error: 'Không tìm thấy thiết bị.' });
    }
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new ValidationError('Lệnh điều khiển không hợp lệ.');
    }
    const s = device.state;
    const changes = [];

    if ('volume' in body) {
      if (!Number.isInteger(body.volume) || body.volume < 0 || body.volume > 100) {
        throw new ValidationError('Âm lượng phải từ 0 đến 100.');
      }
      s.volume = body.volume;
      changes.push(`Âm lượng ${s.volume}%`);
    }
    if ('muted' in body) {
      if (typeof body.muted !== 'boolean') throw new ValidationError('Trạng thái tắt tiếng không hợp lệ.');
      s.muted = body.muted;
      changes.push(s.muted ? 'Tắt tiếng loa' : 'Bật tiếng loa');
    }
    if ('backlight' in body) {
      if (!Number.isInteger(body.backlight) || body.backlight < 0 || body.backlight > 100) {
        throw new ValidationError('Độ sáng màn hình phải từ 0 đến 100.');
      }
      s.backlight = body.backlight;
      changes.push(`Độ sáng LCD ${s.backlight}%`);
    }
    if ('displayMode' in body) {
      if (!['schedule', 'clock', 'emotion', 'sleep'].includes(body.displayMode)) {
        throw new ValidationError('Chế độ màn hình không hợp lệ.');
      }
      s.displayMode = body.displayMode;
      changes.push(`Màn hình: ${s.displayMode}`);
    }
    if ('gpioOutputs' in body) {
      const g = body.gpioOutputs;
      if (!g || typeof g !== 'object' || Array.isArray(g)) {
        throw new ValidationError('Trạng thái GPIO không hợp lệ.');
      }
      if ('led_status' in g) {
        if (typeof g.led_status !== 'boolean') throw new ValidationError('LED không hợp lệ.');
        s.gpioOutputs.led_status = g.led_status;
        changes.push(`Đèn trạng thái ${g.led_status ? 'Bật' : 'Tắt'}`);
      }
      if ('relay_lab' in g) {
        if (typeof g.relay_lab !== 'boolean') throw new ValidationError('Relay không hợp lệ.');
        s.gpioOutputs.relay_lab = g.relay_lab;
        changes.push(`Relay nguồn ${g.relay_lab ? 'Bật' : 'Tắt'}`);
      }
      if ('buzzer_alert' in g) {
        if (typeof g.buzzer_alert !== 'boolean') throw new ValidationError('Còi không hợp lệ.');
        s.gpioOutputs.buzzer_alert = g.buzzer_alert;
        changes.push(`Còi báo ${g.buzzer_alert ? 'Bật' : 'Tắt'}`);
      }
      if ('servo_angle' in g) {
        if (!Number.isInteger(g.servo_angle) || g.servo_angle < 0 || g.servo_angle > 180) {
          throw new ValidationError('Góc Servo phải từ 0 đến 180°.');
        }
        s.gpioOutputs.servo_angle = g.servo_angle;
        changes.push(`Servo ${g.servo_angle}°`);
      }
    }

    if (!changes.length) {
      throw new ValidationError('Không có tham số điều khiển nào được gửi.');
    }

    const command = {
      id: crypto.randomUUID(),
      summary: changes.join(' · '),
      payload: body,
      timestamp: vnIsoNow(),
    };
    s.lastCommand = command;
    s.updatedAt = command.timestamp;
    device.commandQueue.push(command);
    if (device.commandQueue.length > 20) device.commandQueue.shift();

    return res.json({ device: serializeIotDevice(device) });
  } catch (err) {
    return next(err);
  }
});

app.post('/api/iot/devices/:id/test-reminder', (req, res) => {
  const device = userDevices.get(req.params.id);
  if (!device || device.user_id !== req.userId) {
    return res.status(404).json({ error: 'Không tìm thấy thiết bị.' });
  }
  const reminderId = `test:${Date.now()}`;
  const text = `Kiểm tra nhắc lịch trên ${device.name}: âm lượng ${device.state.muted ? '0' : device.state.volume}%.`;
  const key = `${req.userId}:${reminderId}`;
  remindersMap.set(key, {
    id: reminderId,
    event_id: 'test',
    revision: 1,
    event: { id: 'test', title: `Kiểm tra phát trên ${device.name}` },
    text,
    expires_at: vnIsoNow(),
    status: device.simulatedOnline ? 'played' : 'pending',
    active: !device.simulatedOnline,
    updated_at: vnIsoNow(),
    updated_seq: Date.now(),
    user_id: req.userId,
  });
  device.state.lastCommand = {
    id: crypto.randomUUID(),
    summary: 'Phát thử nhắc lịch',
    timestamp: vnIsoNow(),
  };
  device.state.updatedAt = vnIsoNow();
  return res.json({
    ok: true,
    status: device.simulatedOnline ? 'played' : 'pending',
    device: serializeIotDevice(device),
  });
});

app.get('/api/status', (req, res) => {
  const prefs = getPreferencesForUser(req.userId);
  const devices = [];
  if (req.userId !== 'default') {
    for (const d of userDevices.values()) {
      if (d.user_id === req.userId) {
        devices.push({
          id: d.device_id,
          name: d.name,
          online: isDeviceOnline(d),
          busy: false,
        });
      }
    }
  }
  res.json({
    ai_configured: AI_CONFIGURED,
    model: prefs.model,
    timezone: 'Asia/Ho_Chi_Minh',
    now: vnIsoNow(),
    devices,
    voice_mode: 'button-turn',
    last_audio_mode: 'none',
  });
});

// ---------------------------------------------------------------------------
// Calendar Events, Agenda, Reminders, Chat
// ---------------------------------------------------------------------------
app.get('/api/events', (req, res, next) => {
  try {
    const week = mondayOf(typeof req.query.week === 'string' && req.query.week ? req.query.week : undefined);
    const end = addDaysIso(week, 6);
    res.json({ week, events: listEvents(week, end, req.userId) });
  } catch (err) {
    next(err);
  }
});

app.post('/api/events', (req, res, next) => {
  try {
    const created = createEvent(req.body, req.userId);
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

app.put('/api/events/:id', (req, res, next) => {
  try {
    const payload = { ...(req.body || {}) };
    const revision = payload.revision;
    delete payload.revision;
    if (!Number.isInteger(revision)) {
      throw new ValidationError('Thiếu revision hợp lệ. Tải lại lịch trước khi sửa.');
    }
    res.json(updateEvent(req.params.id, payload, revision, req.userId));
  } catch (err) {
    next(err);
  }
});

app.delete('/api/events/:id', (req, res, next) => {
  try {
    const payload = { ...(req.body || {}) };
    const revision = payload.revision;
    delete payload.revision;
    if (!Number.isInteger(revision)) {
      throw new ValidationError('Thiếu revision hợp lệ. Tải lại lịch trước khi sửa.');
    }
    if (Object.keys(payload).length > 0) {
      throw new ValidationError('DELETE chỉ nhận revision.');
    }
    deleteEvent(req.params.id, revision, req.userId);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.post('/api/weeks/copy', (req, res, next) => {
  try {
    const data = req.body;
    if (!data || typeof data !== 'object' || Array.isArray(data) ||
        Object.keys(data).length !== 2 || !('source_week' in data) || !('target_week' in data)) {
      throw new ValidationError('Cần source_week và target_week.');
    }
    const events = copyWeek(mondayOf(data.source_week), mondayOf(data.target_week), req.userId);
    res.json({ events });
  } catch (err) {
    next(err);
  }
});

app.get('/api/agenda', (req, res) => {
  const today = vnTodayDateStr();
  const currentHm = vnCurrentHmStr();
  const all = listEvents(today, addDaysIso(today, 30), req.userId);
  res.json({
    today: all.filter((e) => e.date === today),
    upcoming: all.filter((e) => `${e.date}T${e.end}` > currentHm).slice(0, 12),
  });
});

app.get('/api/reminders', (req, res) => {
  res.json({ reminders: syncAndListReminders(req.userId) });
});

app.post('/api/chat', async (req, res, next) => {
  try {
    const data = req.body;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new ValidationError('Nội dung phải là JSON object.');
    }
    const session = data.session_id ?? 'web';
    const message = data.message ?? '';
    if (typeof session !== 'string' || session.length < 1 || session.length > 80 ||
        typeof message !== 'string' || message.length > 4000) {
      throw new ValidationError('Phiên chat hoặc tin nhắn không hợp lệ.');
    }
    if (!AI_CONFIGURED) {
      return res.status(503).json({
        error: 'Chưa cấu hình GEMINI_API_KEY trong .env. Lịch thủ công và điều khiển thiết bị vẫn dùng bình thường.',
      });
    }
    const result = await handleChat(
      `web:${session}`,
      message,
      data.week ?? null,
      data.confirmation,
      req.userId,
    );
    return res.json(result);
  } catch (err) {
    if (err instanceof ValidationError) return next(err);
    console.warn('Gemini request failed:', err?.message || err);
    return res.status(503).json({
      error: 'Không gọi được Gemini. Kiểm tra key, model, hạn mức và Internet.',
    });
  }
});

// ---------------------------------------------------------------------------
// ESP32-S3 Hardware Integration Endpoints (from firmware/board)
// ---------------------------------------------------------------------------
app.post(['/xiaozhi/ota', '/xiaozhi/ota/'], authenticateDevice, (req, res) => {
  const host = req.get('host') || `127.0.0.1:${PORT}`;
  const proto = isHttpsRequest(req) ? 'wss' : 'ws';
  res.json({
    server_time: { timestamp: Date.now(), timezone_offset: 420 },
    firmware: { version: '1.0.0', url: '' },
    websocket: { url: `${proto}://${host}/xiaozhi/v1/`, token: req.get('authorization')?.replace(/^Bearer\s+/, '') || '', version: 1 },
  });
});

app.get('/device/reminders', authenticateDevice, (req, res) => {
  const history = syncAndListReminders(req.device.user_id, 10);
  const pending = history.find((r) => r.active && r.status === 'pending');
  const commands = req.device.commandQueue.splice(0, req.device.commandQueue.length);
  res.json({
    notification: pending ? { id: pending.id, text: pending.text, mode: 'text' } : null,
    commands,
    state: req.device.state,
  });
});

app.post('/device/ack', authenticateDevice, (req, res) => {
  const { id, status } = req.body || {};
  if (typeof id !== 'string' || !['played', 'failed', 'cancelled'].includes(status)) {
    return res.status(400).json({ error: 'ACK không hợp lệ.' });
  }
  const rem = remindersMap.get(`${req.device.user_id}:${id}`);
  if (rem && rem.status !== 'played') {
    rem.status = status;
    rem.updated_at = vnIsoNow();
    rem.updated_seq = Date.now();
  }
  return res.json({ ok: true });
});

app.post('/device/telemetry', authenticateDevice, (req, res) => {
  const body = req.body || {};
  if (typeof body.wifiRssi === 'number') req.device.state.telemetry.wifiRssi = body.wifiRssi;
  if (typeof body.freePsramKb === 'number') req.device.state.telemetry.freePsramKb = body.freePsramKb;
  if (typeof body.cpuTempC === 'number') req.device.state.telemetry.cpuTempC = body.cpuTempC;
  req.device.state.updatedAt = vnIsoNow();
  res.json({ ok: true });
});

app.all(['/xiaozhi/*', '/media/*'], (req, res) => {
  res.status(501).json({ error: 'Audio WebSocket/media pipeline requires native runtime' });
});

// ---------------------------------------------------------------------------
// Error Handler
// ---------------------------------------------------------------------------
app.use((err, req, res, _next) => {
  if (err instanceof ConflictError) {
    return res.status(409).json({ error: err.message });
  }
  if (err instanceof ValidationError) {
    return res.status(400).json({ error: err.message });
  }
  console.error('Unhandled error:', err);
  return res.status(500).json({ error: 'Server gặp lỗi. Kiểm tra cấu hình và nhật ký.' });
});

app.listen(PORT, HOST, () => {
  console.log(`App Stem IOT running at http://127.0.0.1:${PORT}/`);
  console.log(`Legacy WEB_TOKEN: ${WEB_TOKEN}`);
  console.log(`Gemini: ${AI_CONFIGURED ? 'đã cấu hình' : 'chưa có key; lịch thủ công và điều khiển thiết bị vẫn hoạt động'}`);
});
