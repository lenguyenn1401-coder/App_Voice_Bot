import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express, { type NextFunction, type Request, type Response } from 'express';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  ackDeviceReminder,
  addDaysIso,
  addMessage,
  addNotification,
  authenticatePairedDeviceToken,
  clearConversationMessages,
  copyCalendarWeek,
  createCalendarEvent,
  createConversation,
  createPairedDevice,
  createSessionToken,
  createUserAccount,
  db,
  deleteCalendarEvent,
  deleteConversation,
  deletePairedDevice,
  findUserByIdentifier,
  getPermissionsForUser,
  getSessionUser,
  getVoiceBotPreferences,
  initDatabase,
  listAllPermissions,
  listCalendarEvents,
  listCommandLogs,
  listConversations,
  listMessages,
  listNotifications,
  listPairedDevices,
  listSensorReadings,
  listTasks,
  listUsers,
  markAllNotificationsRead,
  markNotificationRead,
  mondayOfIso,
  nowIso,
  queueTestDeviceReminder,
  renameConversation,
  revokeSessionToken,
  saveVoiceBotPreferences,
  syncAndListDeviceReminders,
  updateCalendarEvent,
  updateDeviceRuntime,
  upsertPermission,
  verifyPassword,
  vnCurrentHmStr,
  vnIsoNow,
  vnTodayDateStr,
} from './server/db.ts';
import { generateVoiceBotReply, isAiConfigured } from './server/ai.ts';
import { engine } from './server/engine.ts';
import type { PairedDeviceInfo, ProjectId, UserProfile, UserRole, VoiceBotMode } from './src/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = __dirname;

dotenv.config({ path: path.join(ROOT, '.env') });

const PORT = Number(
  process.env.PORT && process.env.PORT !== '8080'
    ? process.env.PORT
    : process.env.DEFAULT_APP_PORT || 3000
);
const HOST = process.env.HOST || '0.0.0.0';
const SESSION_COOKIE = 'tp_stem_session';

initDatabase();

interface AuthedRequest extends Request {
  user?: UserProfile;
  sessionToken?: string;
  pairedDevice?: PairedDeviceInfo;
}

function parseCookies(header: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!header) return result;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    try {
      result[k] = decodeURIComponent(v);
    } catch {
      result[k] = v;
    }
  }
  return result;
}

function isHttpsRequest(req: Request | http.IncomingMessage): boolean {
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  if (proto === 'https') return true;
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').toLowerCase();
  if (host.includes('.run.app') || host.includes('.aistudio')) return true;
  return false;
}

function setSessionCookie(req: Request, res: Response, token: string): void {
  const https = isHttpsRequest(req);
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'Max-Age=604800',
    https ? 'SameSite=None' : 'SameSite=Lax',
  ];
  if (https) {
    parts.push('Secure', 'Partitioned');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(req: Request, res: Response): void {
  const https = isHttpsRequest(req);
  const parts = [
    `${SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'Max-Age=0',
    https ? 'SameSite=None' : 'SameSite=Lax',
  ];
  if (https) {
    parts.push('Secure', 'Partitioned');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

function extractToken(req: Request | http.IncomingMessage): string | undefined {
  const authHeader = String(req.headers.authorization || '');
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const cookies = parseCookies(req.headers.cookie);
  return cookies[SESSION_COOKIE];
}

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const token = extractToken(req);
  const user = getSessionUser(token);
  if (!user) {
    res.status(401).json({ error: 'Phiên đăng nhập đã hết hạn hoặc không hợp lệ.' });
    return;
  }
  req.user = user;
  req.sessionToken = token;
  next();
}

function requireRole(roles: UserRole[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(400).json({
        code: 'FORBIDDEN',
        error: 'Vai trò hiện tại không có quyền thực hiện thao tác này.',
      });
      return;
    }
    next();
  };
}

function authenticateHardwareDevice(req: AuthedRequest, res: Response, next: NextFunction): void {
  const auth = String(req.headers.authorization || '');
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const queryToken = typeof req.query.token === 'string' ? req.query.token : '';
  const token = bearer || queryToken;
  const device = authenticatePairedDeviceToken(token);
  if (!device) {
    res.status(401).json({ error: 'Device token không hợp lệ.' });
    return;
  }
  const suppliedId =
    String(req.headers['device-id'] || '') ||
    (typeof req.query.device_id === 'string' ? req.query.device_id : '');
  if (suppliedId && suppliedId !== device.deviceId) {
    res.status(400).json({ code: 'DEVICE_MISMATCH', error: 'Device-Id không khớp token.' });
    return;
  }
  req.pairedDevice = device;
  next();
}

async function startServer(): Promise<void> {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));

  // Serve generated illustration assets reliably in both dev and prod
  app.use('/assets', express.static(path.join(ROOT, 'src/assets/images')));
  app.use('/icons', express.static(path.join(ROOT, 'public/icons')));

  // Healthcheck
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'TP STEM Control', time: nowIso() });
  });

  // ---- AUTH ROUTES ----
  app.post('/api/auth/login', (req, res) => {
    const { identifier, password } = req.body || {};
    if (typeof identifier !== 'string' || typeof password !== 'string' || !identifier.trim() || !password) {
      res.status(400).json({ error: 'Vui lòng nhập đầy đủ số điện thoại/email và mật khẩu.' });
      return;
    }
    const found = findUserByIdentifier(identifier);
    if (!found || !verifyPassword(password, found.passwordHash)) {
      res.status(401).json({ error: 'Tài khoản hoặc mật khẩu không chính xác.' });
      return;
    }
    if (!found.active) {
      res.status(400).json({ code: 'ACCOUNT_DISABLED', error: 'Tài khoản đã bị tạm khóa.' });
      return;
    }
    const token = createSessionToken(found.id);
    setSessionCookie(req, res, token);
    const { passwordHash: _ignored, ...safeUser } = found;
    res.json({
      user: safeUser,
      permissions: getPermissionsForUser(found.id),
      token,
    });
  });

  app.post('/api/auth/register', (req, res) => {
    const { phoneOrEmail, fullName, password, confirmPassword } = req.body || {};
    if (typeof phoneOrEmail !== 'string' || !phoneOrEmail.trim()) {
      res.status(400).json({ error: 'Vui lòng nhập số điện thoại hoặc email.' });
      return;
    }
    if (typeof password !== 'string' || password.length < 6) {
      res.status(400).json({ error: 'Mật khẩu phải có ít nhất 6 ký tự.' });
      return;
    }
    if (password !== confirmPassword) {
      res.status(400).json({ error: 'Mật khẩu xác nhận không khớp.' });
      return;
    }
    if (findUserByIdentifier(phoneOrEmail)) {
      res.status(409).json({ error: 'Số điện thoại hoặc email này đã tồn tại.' });
      return;
    }
    const user = createUserAccount({
      phoneOrEmail: phoneOrEmail.trim(),
      fullName: typeof fullName === 'string' && fullName.trim() ? fullName.trim() : `Thành viên ${phoneOrEmail.trim()}`,
      password,
      role: 'student',
    });
    const token = createSessionToken(user.id);
    setSessionCookie(req, res, token);
    res.status(201).json({
      user,
      permissions: getPermissionsForUser(user.id),
      token,
    });
  });

  app.post('/api/auth/demo-login', (req, res) => {
    const role = String(req.body?.role || 'admin') as UserRole;
    const roleMap: Record<UserRole, string> = {
      admin: '0968230902',
      teacher: '0912345678',
      student: '0987654321',
    };
    const found = findUserByIdentifier(roleMap[role] || roleMap.admin);
    if (!found) {
      res.status(404).json({ error: 'Không tìm thấy tài khoản mẫu.' });
      return;
    }
    const token = createSessionToken(found.id);
    setSessionCookie(req, res, token);
    const { passwordHash: _ignored, ...safeUser } = found;
    res.json({
      user: safeUser,
      permissions: getPermissionsForUser(found.id),
      token,
    });
  });

  app.get('/api/auth/me', requireAuth, (req: AuthedRequest, res) => {
    res.json({
      user: req.user,
      permissions: getPermissionsForUser(req.user!.id),
    });
  });

  app.post('/api/auth/logout', (req: AuthedRequest, res) => {
    const token = extractToken(req);
    revokeSessionToken(token);
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  // ---- REALTIME SNAPSHOT & COMMANDS ----
  app.get('/api/snapshot', requireAuth, (_req, res) => {
    res.json(engine.getSnapshot());
  });

  app.post('/api/commands', requireAuth, (req: AuthedRequest, res) => {
    const { projectId, taskId, action, value, confirmDangerous } = req.body || {};
    if (!['voicebot', 'car', 'grill'].includes(projectId) || typeof action !== 'string') {
      res.status(400).json({ error: 'Dữ liệu lệnh điều khiển không hợp lệ.' });
      return;
    }
    try {
      const log = engine.dispatchCommand({
        user: req.user!,
        projectId: projectId as ProjectId,
        taskId: typeof taskId === 'string' && taskId ? taskId : 'system',
        action,
        value: typeof value === 'object' && value !== null ? value : {},
        confirmDangerous: Boolean(confirmDangerous),
      });
      res.json({ log, snapshot: engine.getSnapshot() });
    } catch (err) {
      res.status(400).json({
        code: 'COMMAND_REJECTED',
        error: err instanceof Error ? err.message : 'Không thể thực hiện lệnh.',
      });
    }
  });

  app.post('/api/car/leave', requireAuth, (req: AuthedRequest, res) => {
    engine.forceCarStopOnLeave(req.user!);
    res.json({ ok: true });
  });

  // ---- VOICE BOT CONVERSATIONS & AI ----
  app.get('/api/voicebot/conversations', requireAuth, (req: AuthedRequest, res) => {
    res.json({ conversations: listConversations(req.user!.id) });
  });

  app.post('/api/voicebot/conversations', requireAuth, (req: AuthedRequest, res) => {
    const title = typeof req.body?.title === 'string' && req.body.title.trim() ? req.body.title.trim() : 'Cuộc hội thoại mới';
    const mode = (req.body?.mode || engine.voicebot.mode) as VoiceBotMode;
    const language = req.body?.language === 'en' ? 'en' : 'vi';
    const conv = createConversation({ userId: req.user!.id, title, mode, language });
    res.status(201).json({ conversation: conv });
  });

  app.patch('/api/voicebot/conversations/:id', requireAuth, (req, res) => {
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    if (!title) {
      res.status(400).json({ error: 'Tên cuộc hội thoại không được để trống.' });
      return;
    }
    renameConversation(String(req.params.id), title);
    res.json({ ok: true });
  });

  app.delete('/api/voicebot/conversations/:id', requireAuth, (req, res) => {
    deleteConversation(String(req.params.id));
    res.json({ ok: true });
  });

  app.get('/api/voicebot/conversations/:id/messages', requireAuth, (req, res) => {
    res.json({ messages: listMessages(String(req.params.id)) });
  });

  app.delete('/api/voicebot/conversations/:id/messages', requireAuth, (req, res) => {
    clearConversationMessages(String(req.params.id));
    res.json({ ok: true });
  });

  app.post('/api/voicebot/ask', requireAuth, async (req: AuthedRequest, res) => {
    const { conversationId, text, source, mode, language } = req.body || {};
    if (typeof text !== 'string' || !text.trim()) {
      res.status(400).json({ error: 'Nội dung câu hỏi không được để trống.' });
      return;
    }

    const activeConvId =
      typeof conversationId === 'string' && conversationId
        ? conversationId
        : listConversations(req.user!.id)[0]?.id ||
          createConversation({
            userId: req.user!.id,
            title: 'Hội thoại Voice Bot',
            mode: engine.voicebot.mode,
            language: engine.voicebot.language,
          }).id;

    const chosenMode = (mode || engine.voicebot.mode) as VoiceBotMode;
    const chosenLang = language === 'en' ? 'en' : 'vi';
    const msgSource = source === 'voice' ? 'voice' : 'keyboard';

    engine.voicebot.activityState = 'Đang xử lý';
    engine.voicebot.lastTranscript = text.trim();
    broadcastAll('state_update', engine.getSnapshot());

    const userMsg = addMessage({
      conversationId: activeConvId,
      sender: 'user',
      text: text.trim(),
      source: msgSource,
      mode: chosenMode,
    });

    const prefs = getVoiceBotPreferences(req.user!.id);
    const aiResult = await generateVoiceBotReply({
      prompt: text.trim(),
      mode: chosenMode,
      language: chosenLang,
      car: engine.car,
      grill: engine.grill,
      userId: req.user!.id,
      prefs,
    });

    let linkedCommandId: string | null = null;
    let finalReply = aiResult.reply;
    let pendingConfirmation = null;

    if (aiResult.detectedCommand) {
      if (aiResult.requiresConfirmation) {
        pendingConfirmation = aiResult.detectedCommand;
      } else {
        try {
          const log = engine.dispatchCommand({
            user: req.user!,
            projectId: aiResult.detectedCommand.projectId,
            taskId: aiResult.detectedCommand.taskId,
            action: aiResult.detectedCommand.action,
            value: aiResult.detectedCommand.value,
            confirmDangerous: false,
          });
          linkedCommandId = log.commandId;
          finalReply = `${aiResult.reply} (Mã lệnh: ${log.commandId} — Hoàn thành)`;
        } catch (err) {
          finalReply = `Không thể thực hiện lệnh "${aiResult.detectedCommand.humanLabel}": ${
            err instanceof Error ? err.message : 'Lỗi phân quyền/an toàn'
          }`;
        }
      }
    }

    const botMsg = addMessage({
      conversationId: activeConvId,
      sender: 'bot',
      text: finalReply,
      source: 'keyboard',
      mode: chosenMode,
      linkedCommandId,
    });

    engine.voicebot.activityState = 'Đang trả lời';
    engine.voicebot.lastReply = finalReply;
    broadcastAll('state_update', engine.getSnapshot());

    setTimeout(() => {
      if (engine.voicebot.activityState === 'Đang trả lời') {
        engine.voicebot.activityState = 'Đang chờ';
        broadcastAll('state_update', engine.getSnapshot());
      }
    }, 1500);

    res.json({
      conversationId: activeConvId,
      userMessage: userMsg,
      botMessage: botMsg,
      pendingConfirmation,
      calendarProposal: aiResult.calendarProposal,
      snapshot: engine.getSnapshot(),
    });
  });

  // ---- LEGACY VOICE BOT PREFERENCES, CALENDAR (GMT+7), REMINDERS & HARDWARE PAIRING ----
  app.get('/api/status', requireAuth, (_req, res) => {
    const paired = listPairedDevices();
    res.json({
      ai_configured: isAiConfigured,
      model: engine.voicebot.model,
      timezone: 'Asia/Ho_Chi_Minh',
      now: vnIsoNow(),
      devices: paired.map((d) => ({ id: d.deviceId, name: d.name, online: d.online, busy: false })),
      voice_mode: 'button-turn',
    });
  });

  app.get('/api/preferences', requireAuth, (req: AuthedRequest, res) => {
    const prefs = getVoiceBotPreferences(req.user!.id);
    res.json(prefs);
  });

  app.put('/api/preferences', requireAuth, (req: AuthedRequest, res) => {
    try {
      const b = req.body || {};
      const prefs = saveVoiceBotPreferences(req.user!.id, {
        assistantName: String(b.assistantName ?? b.assistant_name ?? engine.voicebot.assistantName),
        stylePrompt: String(b.stylePrompt ?? b.style_prompt ?? ''),
        model: String(b.model ?? engine.voicebot.model),
        voice: String(b.voice ?? engine.voicebot.ttsVoice),
      });
      engine.voicebot.assistantName = prefs.assistantName;
      engine.voicebot.stylePrompt = prefs.stylePrompt;
      engine.voicebot.model = prefs.model;
      engine.voicebot.ttsVoice = prefs.voice;
      engine.voicebot.updatedAt = nowIso();
      broadcastAll('state_update', engine.getSnapshot());
      res.json(prefs);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Không thể lưu tùy chỉnh.' });
    }
  });

  app.get('/api/events', requireAuth, (req: AuthedRequest, res) => {
    const week = mondayOfIso(typeof req.query.week === 'string' && req.query.week ? req.query.week : undefined);
    const end = addDaysIso(week, 6);
    res.json({
      week,
      today: vnTodayDateStr(),
      events: listCalendarEvents(week, end, req.user!.id),
    });
  });

  app.post('/api/events', requireAuth, (req: AuthedRequest, res) => {
    try {
      const b = req.body || {};
      const ev = createCalendarEvent({
        userId: req.user!.id,
        title: String(b.title || ''),
        date: String(b.date || ''),
        start: String(b.start || ''),
        end: String(b.end || ''),
        note: typeof b.note === 'string' ? b.note : '',
        remindMinutes: Number(b.remindMinutes ?? b.remind_minutes ?? 10),
      });
      res.status(201).json({ event: ev });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Không thể tạo lịch.';
      res.status(msg.includes('trùng') ? 409 : 400).json({ error: msg });
    }
  });

  app.put('/api/events/:id', requireAuth, (req, res) => {
    try {
      const b = req.body || {};
      const revision = Number(b.revision);
      if (!Number.isInteger(revision)) {
        res.status(400).json({ error: 'Thiếu revision hợp lệ. Tải lại lịch trước khi sửa.' });
        return;
      }
      const ev = updateCalendarEvent(String(req.params.id), revision, {
        title: b.title !== undefined ? String(b.title) : undefined,
        date: b.date !== undefined ? String(b.date) : undefined,
        start: b.start !== undefined ? String(b.start) : undefined,
        end: b.end !== undefined ? String(b.end) : undefined,
        note: b.note !== undefined ? String(b.note) : undefined,
        remindMinutes: b.remindMinutes ?? b.remind_minutes,
      });
      res.json({ event: ev });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Không thể cập nhật lịch.';
      res.status(msg.includes('trùng') || msg.includes('thay đổi') ? 409 : 400).json({ error: msg });
    }
  });

  app.delete('/api/events/:id', requireAuth, (req, res) => {
    try {
      const revision = Number(req.body?.revision ?? req.query.revision);
      if (!Number.isInteger(revision)) {
        res.status(400).json({ error: 'Thiếu revision hợp lệ.' });
        return;
      }
      deleteCalendarEvent(String(req.params.id), revision);
      res.json({ ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Không thể xóa lịch.';
      res.status(msg.includes('thay đổi') ? 409 : 400).json({ error: msg });
    }
  });

  app.post('/api/weeks/copy', requireAuth, (req: AuthedRequest, res) => {
    try {
      const b = req.body || {};
      const src = mondayOfIso(String(b.sourceWeek ?? b.source_week ?? ''));
      const tgt = mondayOfIso(String(b.targetWeek ?? b.target_week ?? ''));
      if (src === tgt) {
        res.status(400).json({ error: 'Tuần đích phải khác tuần nguồn.' });
        return;
      }
      const events = copyCalendarWeek(src, tgt, req.user!.id);
      res.json({ events });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Không thể sao chép tuần.';
      res.status(msg.includes('trùng') ? 409 : 400).json({ error: msg });
    }
  });

  app.get('/api/agenda', requireAuth, (req: AuthedRequest, res) => {
    const today = vnTodayDateStr();
    const currentHm = vnCurrentHmStr();
    const all = listCalendarEvents(today, addDaysIso(today, 30), req.user!.id);
    res.json({
      today: all.filter((e) => e.date === today),
      upcoming: all.filter((e) => `${e.date}T${e.end}` > currentHm).slice(0, 12),
    });
  });

  app.get('/api/reminders', requireAuth, (req: AuthedRequest, res) => {
    res.json({ reminders: syncAndListDeviceReminders(req.user!.id, 30) });
  });

  app.get('/api/paired-devices', requireAuth, (_req, res) => {
    res.json({ devices: listPairedDevices() });
  });

  app.post('/api/paired-devices', requireAuth, (req: AuthedRequest, res) => {
    try {
      const deviceId = String(req.body?.deviceId ?? req.body?.device_id ?? '');
      const name = String(req.body?.name ?? '');
      const result = createPairedDevice(req.user!.id, deviceId, name);
      res.status(201).json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Không thể ghép thiết bị.' });
    }
  });

  app.delete('/api/paired-devices/:id', requireAuth, (req, res) => {
    deletePairedDevice(String(req.params.id));
    res.json({ ok: true });
  });

  app.post('/api/iot/devices/:id/test-reminder', requireAuth, (req: AuthedRequest, res) => {
    const paired = listPairedDevices().find((d) => d.deviceId === String(req.params.id));
    const devName = paired?.name || 'ESP32-S3 Voice Bot';
    const online = paired ? paired.online : engine.voicebot.online;
    const reminder = queueTestDeviceReminder(
      req.user!.id,
      devName,
      engine.voicebot.volume,
      engine.voicebot.muted,
      online
    );
    engine.voicebot.lastCommandSummary = 'Phát thử nhắc lịch';
    engine.voicebot.updatedAt = nowIso();
    broadcastAll('state_update', engine.getSnapshot());
    res.json({ ok: true, reminder, snapshot: engine.getSnapshot() });
  });

  // ---- REAL ESP32-S3 FIRMWARE HARDWARE ENDPOINTS (XIAOZHI OTA, POLLING, ACK, TELEMETRY) ----
  app.post(['/xiaozhi/ota', '/xiaozhi/ota/'], authenticateHardwareDevice, (req: AuthedRequest, res) => {
    const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
    const host = forwardedHost || String(req.headers.host || `127.0.0.1:${PORT}`);
    const proto = isHttpsRequest(req) ? 'wss' : 'ws';
    const authHeader = String(req.headers.authorization || '').replace(/^Bearer\s+/, '');
    res.json({
      server_time: { timestamp: Date.now(), timezone_offset: 420 },
      firmware: { version: '2.4.1-stem', url: '' },
      websocket: {
        url: `${proto}://${host}/ws`,
        token: authHeader,
        version: 1,
      },
      device: req.pairedDevice,
    });
  });

  app.get('/device/reminders', authenticateHardwareDevice, (req: AuthedRequest, res) => {
    const history = syncAndListDeviceReminders(req.pairedDevice!.userId, 10);
    const pending = history.find((r) => r.active && r.status === 'pending');
    const commands = engine.voicebotCommandQueue.splice(0, engine.voicebotCommandQueue.length);
    res.json({
      notification: pending ? { id: pending.id, text: pending.text, mode: 'text' } : null,
      commands,
      state: {
        volume: engine.voicebot.volume,
        muted: engine.voicebot.muted,
        backlight: engine.voicebot.backlight,
        displayMode: engine.voicebot.displayMode,
        gpioOutputs: engine.voicebot.gpioOutputs,
        telemetry: engine.voicebot.telemetry,
      },
    });
  });

  app.post('/device/ack', authenticateHardwareDevice, (req, res) => {
    const { id, status } = req.body || {};
    if (typeof id !== 'string' || !['played', 'failed', 'cancelled'].includes(status)) {
      res.status(400).json({ error: 'ACK không hợp lệ.' });
      return;
    }
    ackDeviceReminder(id, status as 'played' | 'failed' | 'cancelled');
    res.json({ ok: true });
  });

  app.post('/device/telemetry', authenticateHardwareDevice, (req, res) => {
    const body = req.body || {};
    if (typeof body.wifiRssi === 'number') {
      engine.voicebot.telemetry.wifiRssi = body.wifiRssi;
      updateDeviceRuntime('ESP32-VB-01', { online: true, wifiRssi: body.wifiRssi });
    }
    if (typeof body.freePsramKb === 'number') {
      engine.voicebot.telemetry.freePsramKb = body.freePsramKb;
    }
    if (typeof body.cpuTempC === 'number') {
      engine.voicebot.telemetry.cpuTempC = body.cpuTempC;
    }
    engine.voicebot.updatedAt = nowIso();
    engine.emitSnapshot();
    res.json({ ok: true });
  });

  // ---- HISTORY, SENSORS, NOTIFICATIONS, TASKS ----
  app.get('/api/history', requireAuth, (req, res) => {
    const projectId = req.query.projectId ? (String(req.query.projectId) as ProjectId) : undefined;
    const limit = Math.min(200, Math.max(10, Number(req.query.limit || 100)));
    res.json({ logs: listCommandLogs(limit, projectId) });
  });

  app.get('/api/sensors', requireAuth, (req, res) => {
    const projectId = req.query.projectId ? (String(req.query.projectId) as ProjectId) : undefined;
    const limit = Math.min(200, Math.max(10, Number(req.query.limit || 80)));
    res.json({ readings: listSensorReadings(projectId, limit) });
  });

  app.get('/api/tasks', requireAuth, (req, res) => {
    const projectId = req.query.projectId ? (String(req.query.projectId) as ProjectId) : undefined;
    res.json({ tasks: listTasks(projectId) });
  });

  app.get('/api/notifications', requireAuth, (_req, res) => {
    res.json({ notifications: listNotifications(50) });
  });

  app.post('/api/notifications/read-all', requireAuth, (req: AuthedRequest, res) => {
    markAllNotificationsRead(req.user!.id);
    broadcastAll('state_update', engine.getSnapshot());
    res.json({ ok: true });
  });

  app.post('/api/notifications/:id/read', requireAuth, (req: AuthedRequest, res) => {
    markNotificationRead(String(req.params.id), req.user!.id);
    broadcastAll('state_update', engine.getSnapshot());
    res.json({ ok: true });
  });

  // ---- USERS & PERMISSIONS (ADMIN / TEACHER) ----
  app.get('/api/users', requireAuth, requireRole(['admin', 'teacher']), (_req, res) => {
    res.json({
      users: listUsers(),
      permissions: listAllPermissions(),
    });
  });

  app.post('/api/users', requireAuth, requireRole(['admin']), (req, res) => {
    const { phoneOrEmail, fullName, password, role } = req.body || {};
    if (typeof phoneOrEmail !== 'string' || !phoneOrEmail.trim() || typeof password !== 'string' || password.length < 6) {
      res.status(400).json({ error: 'Vui lòng nhập tài khoản và mật khẩu tối thiểu 6 ký tự.' });
      return;
    }
    if (findUserByIdentifier(phoneOrEmail)) {
      res.status(409).json({ error: 'Tài khoản đã tồn tại.' });
      return;
    }
    const validRole: UserRole = role === 'admin' || role === 'teacher' ? role : 'student';
    const user = createUserAccount({
      phoneOrEmail,
      fullName: typeof fullName === 'string' && fullName.trim() ? fullName : phoneOrEmail,
      password,
      role: validRole,
    });
    res.status(201).json({ user, permissions: listAllPermissions() });
  });

  app.patch('/api/users/:id/active', requireAuth, requireRole(['admin']), (req: AuthedRequest, res) => {
    const targetId = String(req.params.id);
    if (targetId === req.user!.id) {
      res.status(400).json({ error: 'Không thể tự khóa tài khoản đang đăng nhập.' });
      return;
    }
    const active = req.body?.active ? 1 : 0;
    db.prepare('UPDATE users SET active = ? WHERE id = ?').run(active, targetId);
    res.json({ users: listUsers() });
  });

  app.put('/api/permissions', requireAuth, requireRole(['admin', 'teacher']), (req: AuthedRequest, res) => {
    const { userId, projectId, canView, canControl, canChangeSafety, allowedTaskIds } = req.body || {};
    if (!userId || !['voicebot', 'car', 'grill'].includes(projectId)) {
      res.status(400).json({ error: 'Dữ liệu phân quyền không hợp lệ.' });
      return;
    }
    if (req.user!.role === 'teacher' && Boolean(canChangeSafety) && userId !== req.user!.id) {
      // Teachers can grant/revoke control & tasks for students, keep safety restriction strict
    }
    const updated = upsertPermission({
      userId: String(userId),
      projectId: projectId as ProjectId,
      canView: Boolean(canView),
      canControl: Boolean(canControl),
      canChangeSafety: req.user!.role === 'admin' ? Boolean(canChangeSafety) : false,
      allowedTaskIds: Array.isArray(allowedTaskIds) ? allowedTaskIds.map(String) : [],
    });
    addNotification({
      projectId: projectId as ProjectId,
      severity: 'info',
      title: 'Cập nhật phân quyền dự án',
      message: `${req.user!.fullName} đã cập nhật quyền truy cập dự án ${projectId}.`,
    });
    broadcastAll('state_update', engine.getSnapshot());
    res.json({ permission: updated, permissions: listAllPermissions() });
  });

  // ---- FRONTEND SERVING (VITE DEV OR DIST PROD) ----
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(ROOT, 'dist');
    app.use(express.static(distDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/ws')) {
        next();
        return;
      }
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  // ---- HTTP + WEBSOCKET SERVER ----
  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  const wsClients = new Set<{ ws: WebSocket; user: UserProfile }>();

  function broadcastAll(event: string, payload: unknown): void {
    const msg = JSON.stringify({ event, payload });
    for (const client of wsClients) {
      if (client.ws.readyState === 1) {
        client.ws.send(msg);
      }
    }
  }

  engine.setBroadcaster(broadcastAll);
  engine.startLoop();

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url || '/ws', 'http://localhost');
    const queryToken = url.searchParams.get('token') || undefined;
    const token = queryToken || extractToken(req);
    const user = getSessionUser(token);

    if (!user) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    const clientEntry = { ws, user };
    wsClients.add(clientEntry);

    ws.send(JSON.stringify({ event: 'state_update', payload: engine.getSnapshot() }));

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw));
        if (msg.type === 'ping') {
          ws.send(JSON.stringify({ event: 'pong', payload: { time: nowIso() } }));
        } else if (msg.type === 'car_leave') {
          engine.forceCarStopOnLeave(user);
        } else if (msg.type === 'command') {
          engine.dispatchCommand({
            user,
            projectId: msg.projectId,
            taskId: msg.taskId || 'system',
            action: msg.action,
            value: msg.value || {},
            confirmDangerous: Boolean(msg.confirmDangerous),
          });
        }
      } catch (err) {
        ws.send(
          JSON.stringify({
            event: 'command_error',
            payload: { error: err instanceof Error ? err.message : 'Lỗi lệnh WebSocket' },
          })
        );
      }
    });

    ws.on('close', () => {
      wsClients.delete(clientEntry);
    });
  });

  httpServer.listen(PORT, HOST, () => {
    console.log(`[TP STEM Control] Server running on http://${HOST}:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
