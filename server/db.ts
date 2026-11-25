import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  CalendarEvent,
  ChatMessage,
  CommandLog,
  Conversation,
  DeviceInfo,
  DeviceReminder,
  NotificationItem,
  PairedDeviceInfo,
  PermissionRecord,
  ProjectColorStatus,
  ProjectId,
  ProjectSummary,
  SensorReading,
  TaskInfo,
  UserProfile,
  UserRole,
  VoiceBotPreferences,
} from '../src/types.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'tp_stem_control.db');
export const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

export function nowIso(): string {
  return new Date().toISOString();
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = String(stored).split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, expectedHex] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

export function initDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      phone_or_email TEXT UNIQUE NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'teacher', 'student')),
      avatar_color TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL,
      status_label TEXT NOT NULL,
      device_id TEXT NOT NULL,
      image_url TEXT NOT NULL,
      safety_config_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      hardware_model TEXT NOT NULL,
      mac_address TEXT NOT NULL,
      firmware_version TEXT NOT NULL,
      ip_address TEXT NOT NULL,
      wifi_rssi INTEGER NOT NULL,
      online INTEGER NOT NULL DEFAULT 1,
      battery_pct REAL,
      last_seen_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      component_name TEXT NOT NULL,
      description TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      status_text TEXT NOT NULL,
      state_json TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS permissions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      can_view INTEGER NOT NULL DEFAULT 1,
      can_control INTEGER NOT NULL DEFAULT 1,
      can_change_safety INTEGER NOT NULL DEFAULT 0,
      allowed_task_ids_json TEXT NOT NULL,
      UNIQUE (user_id, project_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS command_logs (
      id TEXT PRIMARY KEY,
      command_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      action TEXT NOT NULL,
      value_json TEXT NOT NULL,
      user_id TEXT NOT NULL,
      user_name TEXT NOT NULL,
      ack_status TEXT NOT NULL,
      error_message TEXT,
      mqtt_topic TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      mode TEXT NOT NULL,
      language TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      sender TEXT NOT NULL CHECK (sender IN ('user', 'bot')),
      text TEXT NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('voice', 'keyboard')),
      mode TEXT NOT NULL,
      linked_command_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sensor_readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      metric_key TEXT NOT NULL,
      metric_value REAL NOT NULL,
      unit TEXT NOT NULL,
      recorded_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'danger')),
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      read_by_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS voicebot_preferences (
      user_id TEXT PRIMARY KEY,
      assistant_name TEXT NOT NULL,
      style_prompt TEXT NOT NULL,
      model TEXT NOT NULL,
      voice TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS calendar_events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      date TEXT NOT NULL,
      start TEXT NOT NULL,
      end TEXT NOT NULL,
      note TEXT NOT NULL,
      remind_minutes INTEGER NOT NULL DEFAULT 10,
      revision INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS device_reminders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      title TEXT NOT NULL,
      text TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'played', 'failed', 'cancelled')),
      active INTEGER NOT NULL DEFAULT 1,
      expires_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_seq INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS paired_devices (
      device_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      simulated_online INTEGER NOT NULL DEFAULT 0,
      last_seen_ms INTEGER NOT NULL DEFAULT 0
    );
  `);

  seedInitialData();
  seedLegacyVoiceBotData();
}

function seedInitialData(): void {
  const userCountRow = db.prepare('SELECT COUNT(*) AS cnt FROM users').get() as { cnt: number };
  if (userCountRow.cnt === 0) {
    const t = nowIso();
    const insertUser = db.prepare(`
      INSERT INTO users (id, phone_or_email, full_name, role, avatar_color, password_hash, active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?)
    `);

    insertUser.run(
      'usr_admin_1',
      '0968230902',
      'Nguyễn Anh — Quản trị viên',
      'admin',
      '#0F62FE',
      hashPassword('Nguyenanh1'),
      t
    );
    insertUser.run(
      'usr_admin_2',
      'admin@tpstem.vn',
      'Quản trị TP STEM',
      'admin',
      '#0F62FE',
      hashPassword('Admin@123456'),
      t
    );
    insertUser.run(
      'usr_teacher_1',
      '0912345678',
      'Cô Minh Anh — Giáo viên STEM',
      'teacher',
      '#16A34A',
      hashPassword('Giaovien123'),
      t
    );
    insertUser.run(
      'usr_student_1',
      '0987654321',
      'Em Bảo Nam — Học sinh',
      'student',
      '#D97706',
      hashPassword('Hocsinh123'),
      t
    );
  }

  const projectCount = db.prepare('SELECT COUNT(*) AS cnt FROM projects').get() as { cnt: number };
  if (projectCount.cnt === 0) {
    const t = nowIso();
    const insertProject = db.prepare(`
      INSERT INTO projects (id, name, slug, description, status, status_label, device_id, image_url, safety_config_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertProject.run(
      'voicebot',
      'Voice Bot AI',
      'voicebot',
      'Trò chuyện, hỏi đáp và điều khiển robot bằng giọng nói',
      'connected',
      'Đang kết nối',
      'ESP32-VB-01',
      '/assets/voice_bot_illustration_1795576809169.jpg',
      JSON.stringify({ requireConfirmHazardousVoiceCmd: true, maxVolume: 100 }),
      t
    );

    insertProject.run(
      'car',
      'Xe STEM',
      'car',
      'Điều khiển hướng di chuyển, tốc độ, động cơ và servo',
      'connected',
      'Đang kết nối',
      'ESP32-CAR-01',
      '/assets/stem_car_illustration_1795576808752.jpg',
      JSON.stringify({ minObstacleCm: 15, minBatteryPct: 10, heartbeatTimeoutMs: 4500 }),
      t
    );

    insertProject.run(
      'grill',
      'Bếp nướng thông minh',
      'grill',
      'Theo dõi nhiệt độ và điều khiển quá trình nướng',
      'off',
      'Đang tắt',
      'ESP32-GRILL-01',
      '/assets/smart_grill_illustration_1795576808859.jpg',
      JSON.stringify({ maxTempLimitC: 250, requireRemoteHeatConfirm: true, blockAutoRestartAfterPowerLoss: true }),
      t
    );
  }

  const deviceCount = db.prepare('SELECT COUNT(*) AS cnt FROM devices').get() as { cnt: number };
  if (deviceCount.cnt === 0) {
    const t = nowIso();
    const insertDevice = db.prepare(`
      INSERT INTO devices (id, project_id, name, hardware_model, mac_address, firmware_version, ip_address, wifi_rssi, online, battery_pct, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `);

    insertDevice.run(
      'ESP32-VB-01',
      'voicebot',
      'Voice Bot Desk Unit #01',
      'ESP32-S3-N16R8',
      'A4:CF:12:89:3B:01',
      'v2.4.1-stem',
      '192.168.1.101',
      -49,
      100,
      t
    );
    insertDevice.run(
      'ESP32-CAR-01',
      'car',
      'Rover 4WD STEM #01',
      'ESP32-WROOM-32E',
      'A4:CF:12:89:3B:02',
      'v2.2.0-car',
      '192.168.1.102',
      -52,
      86,
      t
    );
    insertDevice.run(
      'ESP32-GRILL-01',
      'grill',
      'Smart Grill Controller #01',
      'ESP32-S3-Mini',
      'A4:CF:12:89:3B:03',
      'v1.9.4-grill',
      '192.168.1.103',
      -56,
      null,
      t
    );
  }

  const taskCount = db.prepare('SELECT COUNT(*) AS cnt FROM tasks').get() as { cnt: number };
  if (taskCount.cnt === 0) {
    const insertTask = db.prepare(`
      INSERT INTO tasks (id, project_id, code, name, component_name, description, enabled, status_text, state_json, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Voice Bot Tasks
    insertTask.run('vb_mic', 'voicebot', 'Task 1', 'Thu âm Micro I2S', 'Micro I2S INMP441', 'Nhận diện giọng nói và truyền luồng âm thanh', 1, 'Sẵn sàng', JSON.stringify({ micEnabled: true }), 1);
    insertTask.run('vb_speaker', 'voicebot', 'Task 2', 'Phát loa TTS', 'Loa MAX98357A', 'Phát câu trả lời giọng nói AI', 1, 'Sẵn sàng', JSON.stringify({ speakerEnabled: true, volume: 78 }), 2);
    insertTask.run('vb_ai_cmd', 'voicebot', 'Task 3', 'Xử lý AI & Lệnh thiết bị', 'Bộ phân tích ngữ nghĩa', 'Hội thoại đa chế độ và điều khiển liên dự án', 1, 'Đang chờ', JSON.stringify({ mode: 'chat' }), 3);

    // STEM Car Tasks
    insertTask.run('car_drive', 'car', 'Task 1', 'Điều khiển di chuyển', 'Cầu H L298N (2 động cơ)', 'Tiến, lùi, quay trái/phải và dừng khẩn cấp', 1, 'Đang dừng', JSON.stringify({ speed: 55, direction: 'idle' }), 1);
    insertTask.run('car_servo', 'car', 'Task 2', 'Servo lái bánh trước', 'Servo SG90 / MG90S', 'Điều chỉnh góc lái từ 0° đến 180°', 1, '90° (Giữa)', JSON.stringify({ angle: 90 }), 2);
    insertTask.run('car_sensors', 'car', 'Task 3', 'Cảm biến siêu âm & Dò đường', 'HC-SR04 + 5 mắt hồng ngoại', 'Đo khoảng cách vật cản và đọc vạch dẫn đường', 1, '68 cm · An toàn', JSON.stringify({ obstacleCm: 68 }), 3);
    insertTask.run('car_camera', 'car', 'Task 4', 'Camera trực tiếp FPV', 'ESP32-CAM OV2640', 'Truyền hình ảnh góc nhìn xe và chụp ảnh', 1, 'Đang bật (HD 720p)', JSON.stringify({ quality: 'HD 720p' }), 4);

    // Smart Grill Tasks (exact 6 independent tasks)
    insertTask.run('grill_temp_sensor', 'grill', 'Task 1', 'Đọc cảm biến nhiệt', 'Đầu dò K-Type MAX6675', 'Giám sát nhiệt độ buồng nướng theo thời gian thực', 1, '32°C · Ổn định', JSON.stringify({ healthy: true, currentTempC: 32 }), 1);
    insertTask.run('grill_fan', 'grill', 'Task 2', 'Điều khiển quạt', 'Quạt đối lưu & làm mát PWM', 'Lưu thông khí nóng hoặc hạ nhiệt nhanh', 0, 'Đang tắt', JSON.stringify({ on: false, speed: 65 }), 2);
    insertTask.run('grill_heater', 'grill', 'Task 3', 'Điều khiển bộ gia nhiệt', 'Relay SSR + Thanh nhiệt', 'Gia nhiệt đạt ngưỡng mục tiêu (có khóa an toàn)', 0, 'Đang tắt', JSON.stringify({ on: false, targetTempC: 180 }), 3);
    insertTask.run('grill_rotisserie', 'grill', 'Task 4', 'Động cơ quay vỉ nướng', 'Động cơ giảm tốc 12V', 'Quay đều xiên/vỉ nướng tránh cháy cục bộ', 0, 'Đang tắt', JSON.stringify({ on: false }), 4);
    insertTask.run('grill_timer', 'grill', 'Task 5', 'Bộ đếm thời gian', 'Timer đếm ngược ESP32', 'Hẹn giờ nướng và tự ngắt khi hoàn tất', 0, '15:00 · Chờ', JSON.stringify({ remainingSec: 900 }), 5);
    insertTask.run('grill_alert', 'grill', 'Task 6', 'Cảnh báo nhiệt độ', 'Còi Buzzer & Rơ-le ngắt cứng', 'Phát cảnh báo và cắt nguồn khi quá nhiệt', 1, 'Đang giám sát (<250°C)', JSON.stringify({ maxLimit: 250 }), 6);
  }

  const permCount = db.prepare('SELECT COUNT(*) AS cnt FROM permissions').get() as { cnt: number };
  if (permCount.cnt === 0) {
    const insertPerm = db.prepare(`
      INSERT INTO permissions (id, user_id, project_id, can_view, can_control, can_change_safety, allowed_task_ids_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const allTasksByProj: Record<ProjectId, string[]> = {
      voicebot: ['vb_mic', 'vb_speaker', 'vb_ai_cmd'],
      car: ['car_drive', 'car_servo', 'car_sensors', 'car_camera'],
      grill: ['grill_temp_sensor', 'grill_fan', 'grill_heater', 'grill_rotisserie', 'grill_timer', 'grill_alert'],
    };

    for (const userId of ['usr_admin_1', 'usr_admin_2']) {
      for (const proj of ['voicebot', 'car', 'grill'] as ProjectId[]) {
        insertPerm.run(`perm_${userId}_${proj}`, userId, proj, 1, 1, 1, JSON.stringify(allTasksByProj[proj]));
      }
    }
    // Teacher: full view & control on all 3, safety change allowed for car/grill
    for (const proj of ['voicebot', 'car', 'grill'] as ProjectId[]) {
      insertPerm.run(`perm_usr_teacher_1_${proj}`, 'usr_teacher_1', proj, 1, 1, 1, JSON.stringify(allTasksByProj[proj]));
    }
    // Student: full view on all 3; control Voice Bot & Car; for Grill can control fan, timer, read sensor, rotisserie, NOT change safety & heater locked by default unless granted
    insertPerm.run('perm_usr_student_1_voicebot', 'usr_student_1', 'voicebot', 1, 1, 0, JSON.stringify(allTasksByProj.voicebot));
    insertPerm.run('perm_usr_student_1_car', 'usr_student_1', 'car', 1, 1, 0, JSON.stringify(allTasksByProj.car));
    insertPerm.run(
      'perm_usr_student_1_grill',
      'usr_student_1',
      'grill',
      1,
      1,
      0,
      JSON.stringify(['grill_temp_sensor', 'grill_fan', 'grill_rotisserie', 'grill_timer', 'grill_alert'])
    );
  }

  const convCount = db.prepare('SELECT COUNT(*) AS cnt FROM conversations').get() as { cnt: number };
  if (convCount.cnt === 0) {
    const t = nowIso();
    db.prepare(`
      INSERT INTO conversations (id, user_id, title, mode, language, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('conv_default_1', 'usr_admin_1', 'Phiên khởi động Lab STEM', 'stem_qa', 'vi', t, t);

    db.prepare(`
      INSERT INTO messages (id, conversation_id, sender, text, source, mode, linked_command_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'msg_seed_1',
      'conv_default_1',
      'bot',
      'Xin chào! Tôi là Voice Bot AI của hệ thống TP STEM Control. Bạn có thể hỏi kiến thức STEM hoặc ra lệnh trực tiếp cho Xe STEM và Bếp nướng thông minh.',
      'keyboard',
      'stem_qa',
      null,
      t
    );
  }

  const notifCount = db.prepare('SELECT COUNT(*) AS cnt FROM notifications').get() as { cnt: number };
  if (notifCount.cnt === 0) {
    const t = nowIso();
    const insertNotif = db.prepare(`
      INSERT INTO notifications (id, project_id, severity, title, message, read_by_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertNotif.run(
      'notif_seed_1',
      'voicebot',
      'info',
      'Voice Bot AI đã sẵn sàng',
      'Kết nối WebSocket và bộ phân tích lệnh giọng nói đang hoạt động ổn định.',
      '[]',
      t
    );
    insertNotif.run(
      'notif_seed_2',
      'car',
      'info',
      'Xe STEM trực tuyến (Pin 86%)',
      'Cảm biến siêu âm HC-SR04 đang giám sát vật cản ngưỡng an toàn 15 cm.',
      '[]',
      t
    );
  }

  const sensorCount = db.prepare('SELECT COUNT(*) AS cnt FROM sensor_readings').get() as { cnt: number };
  if (sensorCount.cnt === 0) {
    const insertSensor = db.prepare(`
      INSERT INTO sensor_readings (project_id, metric_key, metric_value, unit, recorded_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    const now = Date.now();
    for (let i = 10; i >= 0; i--) {
      const ts = new Date(now - i * 30000).toISOString();
      insertSensor.run('grill', 'temperature', 30 + (i % 3), '°C', ts);
      insertSensor.run('car', 'obstacle_cm', 62 + ((i * 3) % 15), 'cm', ts);
      insertSensor.run('car', 'battery_pct', 86, '%', ts);
    }
  }
}

// ---------------------------------------------------------------------------
// Query Helpers (All parameterized)
// ---------------------------------------------------------------------------

export function mapUserRow(row: Record<string, unknown>): UserProfile {
  return {
    id: String(row.id),
    phoneOrEmail: String(row.phone_or_email),
    fullName: String(row.full_name),
    role: row.role as UserRole,
    avatarColor: String(row.avatar_color),
    active: Boolean(row.active),
    createdAt: String(row.created_at),
  };
}

export function findUserByIdentifier(identifier: string): (UserProfile & { passwordHash: string }) | null {
  const normalized = identifier.trim().toLowerCase();
  const row = db
    .prepare('SELECT * FROM users WHERE LOWER(phone_or_email) = ?')
    .get(normalized) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    ...mapUserRow(row),
    passwordHash: String(row.password_hash),
  };
}

export function getUserById(id: string): UserProfile | null {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? mapUserRow(row) : null;
}

export function listUsers(): UserProfile[] {
  const rows = db.prepare('SELECT * FROM users ORDER BY created_at ASC').all() as Array<Record<string, unknown>>;
  return rows.map(mapUserRow);
}

export function createUserAccount(params: {
  phoneOrEmail: string;
  fullName: string;
  password: string;
  role: UserRole;
}): UserProfile {
  const id = `usr_${crypto.randomUUID().slice(0, 8)}`;
  const t = nowIso();
  const colorMap: Record<UserRole, string> = {
    admin: '#0F62FE',
    teacher: '#16A34A',
    student: '#D97706',
  };
  db.prepare(`
    INSERT INTO users (id, phone_or_email, full_name, role, avatar_color, password_hash, active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?)
  `).run(
    id,
    params.phoneOrEmail.trim(),
    params.fullName.trim(),
    params.role,
    colorMap[params.role],
    hashPassword(params.password),
    t
  );

  // Assign default permissions based on role
  const allTasksByProj: Record<ProjectId, string[]> = {
    voicebot: ['vb_mic', 'vb_speaker', 'vb_ai_cmd'],
    car: ['car_drive', 'car_servo', 'car_sensors', 'car_camera'],
    grill:
      params.role === 'student'
        ? ['grill_temp_sensor', 'grill_fan', 'grill_rotisserie', 'grill_timer', 'grill_alert']
        : ['grill_temp_sensor', 'grill_fan', 'grill_heater', 'grill_rotisserie', 'grill_timer', 'grill_alert'],
  };

  const insertPerm = db.prepare(`
    INSERT INTO permissions (id, user_id, project_id, can_view, can_control, can_change_safety, allowed_task_ids_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const proj of ['voicebot', 'car', 'grill'] as ProjectId[]) {
    insertPerm.run(
      `perm_${id}_${proj}`,
      id,
      proj,
      1,
      1,
      params.role === 'student' ? 0 : 1,
      JSON.stringify(allTasksByProj[proj])
    );
  }

  const created = getUserById(id);
  if (!created) throw new Error('Không thể tạo tài khoản.');
  return created;
}

export function createSessionToken(userId: string): string {
  const now = Date.now();
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(
    tokenHash,
    userId,
    now + 7 * 24 * 3600 * 1000
  );
  return rawToken;
}

export function getSessionUser(rawToken: string | undefined): UserProfile | null {
  if (!rawToken || rawToken.length > 256) return null;
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const row = db
    .prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?')
    .get(tokenHash) as { user_id: string; expires_at: number } | undefined;
  if (!row) return null;
  if (row.expires_at <= Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    return null;
  }
  const user = getUserById(row.user_id);
  if (!user || !user.active) return null;
  return user;
}

export function revokeSessionToken(rawToken: string | undefined): void {
  if (!rawToken || rawToken.length > 256) return;
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
}

export function getPermissionsForUser(userId: string): PermissionRecord[] {
  const rows = db
    .prepare('SELECT * FROM permissions WHERE user_id = ?')
    .all(userId) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    userId: String(r.user_id),
    projectId: r.project_id as ProjectId,
    canView: Boolean(r.can_view),
    canControl: Boolean(r.can_control),
    canChangeSafety: Boolean(r.can_change_safety),
    allowedTaskIds: JSON.parse(String(r.allowed_task_ids_json || '[]')) as string[],
  }));
}

export function listAllPermissions(): PermissionRecord[] {
  const rows = db.prepare('SELECT * FROM permissions').all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    userId: String(r.user_id),
    projectId: r.project_id as ProjectId,
    canView: Boolean(r.can_view),
    canControl: Boolean(r.can_control),
    canChangeSafety: Boolean(r.can_change_safety),
    allowedTaskIds: JSON.parse(String(r.allowed_task_ids_json || '[]')) as string[],
  }));
}

export function upsertPermission(perm: {
  userId: string;
  projectId: ProjectId;
  canView: boolean;
  canControl: boolean;
  canChangeSafety: boolean;
  allowedTaskIds: string[];
}): PermissionRecord {
  const id = `perm_${perm.userId}_${perm.projectId}`;
  db.prepare(`
    INSERT INTO permissions (id, user_id, project_id, can_view, can_control, can_change_safety, allowed_task_ids_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, project_id) DO UPDATE SET
      can_view = excluded.can_view,
      can_control = excluded.can_control,
      can_change_safety = excluded.can_change_safety,
      allowed_task_ids_json = excluded.allowed_task_ids_json
  `).run(
    id,
    perm.userId,
    perm.projectId,
    perm.canView ? 1 : 0,
    perm.canControl ? 1 : 0,
    perm.canChangeSafety ? 1 : 0,
    JSON.stringify(perm.allowedTaskIds)
  );
  return {
    id,
    userId: perm.userId,
    projectId: perm.projectId,
    canView: perm.canView,
    canControl: perm.canControl,
    canChangeSafety: perm.canChangeSafety,
    allowedTaskIds: perm.allowedTaskIds,
  };
}

export function listProjects(): ProjectSummary[] {
  const rows = db.prepare('SELECT * FROM projects').all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: r.id as ProjectId,
    name: String(r.name),
    slug: String(r.slug),
    description: String(r.description),
    status: r.status as ProjectColorStatus,
    statusLabel: String(r.status_label),
    deviceId: String(r.device_id),
    imageUrl: String(r.image_url),
    safetyConfig: JSON.parse(String(r.safety_config_json || '{}')),
    updatedAt: String(r.updated_at),
  }));
}

export function updateProjectStatus(
  projectId: ProjectId,
  status: ProjectColorStatus,
  statusLabel: string
): void {
  db.prepare('UPDATE projects SET status = ?, status_label = ?, updated_at = ? WHERE id = ?').run(
    status,
    statusLabel,
    nowIso(),
    projectId
  );
}

export function updateProjectSafetyConfig(
  projectId: ProjectId,
  patch: Record<string, number | boolean | string>
): void {
  const row = db.prepare('SELECT safety_config_json FROM projects WHERE id = ?').get(projectId) as
    | { safety_config_json: string }
    | undefined;
  const current = row ? JSON.parse(row.safety_config_json) : {};
  const merged = { ...current, ...patch };
  db.prepare('UPDATE projects SET safety_config_json = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(merged),
    nowIso(),
    projectId
  );
}

export function listDevices(): DeviceInfo[] {
  const rows = db.prepare('SELECT * FROM devices').all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    projectId: r.project_id as ProjectId,
    name: String(r.name),
    hardwareModel: String(r.hardware_model),
    macAddress: String(r.mac_address),
    firmwareVersion: String(r.firmware_version),
    ipAddress: String(r.ip_address),
    wifiRssi: Number(r.wifi_rssi),
    online: Boolean(r.online),
    batteryPct: r.battery_pct === null ? null : Number(r.battery_pct),
    lastSeenAt: String(r.last_seen_at),
  }));
}

export function updateDeviceRuntime(
  deviceId: string,
  patch: { online?: boolean; wifiRssi?: number; batteryPct?: number | null }
): void {
  const row = db.prepare('SELECT * FROM devices WHERE id = ?').get(deviceId) as Record<string, unknown> | undefined;
  if (!row) return;
  const nextBattery =
    patch.batteryPct === undefined
      ? row.battery_pct === null
        ? null
        : Number(row.battery_pct)
      : patch.batteryPct;
  db.prepare(
    'UPDATE devices SET online = ?, wifi_rssi = ?, battery_pct = ?, last_seen_at = ? WHERE id = ?'
  ).run(
    patch.online === undefined ? Number(row.online) : patch.online ? 1 : 0,
    patch.wifiRssi === undefined ? Number(row.wifi_rssi) : patch.wifiRssi,
    nextBattery,
    nowIso(),
    deviceId
  );
}

export function listTasks(projectId?: ProjectId): TaskInfo[] {
  const rows = (
    projectId
      ? db.prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY sort_order ASC').all(projectId)
      : db.prepare('SELECT * FROM tasks ORDER BY project_id ASC, sort_order ASC').all()
  ) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    projectId: r.project_id as ProjectId,
    code: String(r.code),
    name: String(r.name),
    componentName: String(r.component_name),
    description: String(r.description),
    enabled: Boolean(r.enabled),
    statusText: String(r.status_text),
    state: JSON.parse(String(r.state_json || '{}')),
    sortOrder: Number(r.sort_order),
  }));
}

export function updateTaskState(
  taskId: string,
  patch: { enabled?: boolean; statusText?: string; state?: Record<string, unknown> }
): void {
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as Record<string, unknown> | undefined;
  if (!row) return;
  const currentState = JSON.parse(String(row.state_json || '{}'));
  db.prepare('UPDATE tasks SET enabled = ?, status_text = ?, state_json = ? WHERE id = ?').run(
    patch.enabled === undefined ? Number(row.enabled) : patch.enabled ? 1 : 0,
    patch.statusText ?? String(row.status_text),
    JSON.stringify(patch.state ? { ...currentState, ...patch.state } : currentState),
    taskId
  );
}

export function insertCommandLog(log: CommandLog): void {
  db.prepare(`
    INSERT INTO command_logs (id, command_id, project_id, task_id, device_id, action, value_json, user_id, user_name, ack_status, error_message, mqtt_topic, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    log.id,
    log.commandId,
    log.projectId,
    log.taskId,
    log.deviceId,
    log.action,
    log.valueJson,
    log.userId,
    log.userName,
    log.ackStatus,
    log.errorMessage,
    log.mqttTopic,
    log.createdAt
  );
}

export function updateCommandAck(commandId: string, ackStatus: string, errorMessage: string | null = null): void {
  db.prepare('UPDATE command_logs SET ack_status = ?, error_message = ? WHERE command_id = ?').run(
    ackStatus,
    errorMessage,
    commandId
  );
}

export function listCommandLogs(limit = 100, projectId?: ProjectId): CommandLog[] {
  const rows = (
    projectId
      ? db
          .prepare('SELECT * FROM command_logs WHERE project_id = ? ORDER BY created_at DESC LIMIT ?')
          .all(projectId, limit)
      : db.prepare('SELECT * FROM command_logs ORDER BY created_at DESC LIMIT ?').all(limit)
  ) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    commandId: String(r.command_id),
    projectId: r.project_id as ProjectId,
    taskId: String(r.task_id),
    deviceId: String(r.device_id),
    action: String(r.action),
    valueJson: String(r.value_json),
    userId: String(r.user_id),
    userName: String(r.user_name),
    ackStatus: r.ack_status as CommandLog['ackStatus'],
    errorMessage: r.error_message ? String(r.error_message) : null,
    mqttTopic: String(r.mqtt_topic),
    createdAt: String(r.created_at),
  }));
}

export function recordSensorReading(
  projectId: ProjectId,
  metricKey: string,
  metricValue: number,
  unit: string
): void {
  db.prepare(`
    INSERT INTO sensor_readings (project_id, metric_key, metric_value, unit, recorded_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(projectId, metricKey, Number(metricValue.toFixed(2)), unit, nowIso());

  // Keep table bounded to recent 1200 readings
  db.prepare(`
    DELETE FROM sensor_readings WHERE id NOT IN (
      SELECT id FROM sensor_readings ORDER BY id DESC LIMIT 1200
    )
  `).run();
}

export function listSensorReadings(projectId?: ProjectId, limit = 80): SensorReading[] {
  const rows = (
    projectId
      ? db
          .prepare('SELECT * FROM sensor_readings WHERE project_id = ? ORDER BY id DESC LIMIT ?')
          .all(projectId, limit)
      : db.prepare('SELECT * FROM sensor_readings ORDER BY id DESC LIMIT ?').all(limit)
  ) as Array<Record<string, unknown>>;

  return rows
    .map((r) => ({
      id: Number(r.id),
      projectId: r.project_id as ProjectId,
      metricKey: String(r.metric_key),
      metricValue: Number(r.metric_value),
      unit: String(r.unit),
      recordedAt: String(r.recorded_at),
    }))
    .reverse();
}

export function addNotification(params: {
  projectId: ProjectId;
  severity: 'info' | 'warning' | 'danger';
  title: string;
  message: string;
}): NotificationItem {
  const item: NotificationItem = {
    id: `notif_${crypto.randomUUID().slice(0, 8)}`,
    projectId: params.projectId,
    severity: params.severity,
    title: params.title,
    message: params.message,
    readBy: [],
    createdAt: nowIso(),
  };
  db.prepare(`
    INSERT INTO notifications (id, project_id, severity, title, message, read_by_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(item.id, item.projectId, item.severity, item.title, item.message, '[]', item.createdAt);
  return item;
}

export function listNotifications(limit = 40): NotificationItem[] {
  const rows = db
    .prepare('SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?')
    .all(limit) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    projectId: r.project_id as ProjectId,
    severity: r.severity as NotificationItem['severity'],
    title: String(r.title),
    message: String(r.message),
    readBy: JSON.parse(String(r.read_by_json || '[]')),
    createdAt: String(r.created_at),
  }));
}

export function markNotificationRead(notificationId: string, userId: string): void {
  const row = db
    .prepare('SELECT read_by_json FROM notifications WHERE id = ?')
    .get(notificationId) as { read_by_json: string } | undefined;
  if (!row) return;
  const arr = JSON.parse(row.read_by_json || '[]') as string[];
  if (!arr.includes(userId)) {
    arr.push(userId);
    db.prepare('UPDATE notifications SET read_by_json = ? WHERE id = ?').run(JSON.stringify(arr), notificationId);
  }
}

export function markAllNotificationsRead(userId: string): void {
  const rows = db.prepare('SELECT id, read_by_json FROM notifications').all() as Array<{
    id: string;
    read_by_json: string;
  }>;
  const stmt = db.prepare('UPDATE notifications SET read_by_json = ? WHERE id = ?');
  for (const r of rows) {
    const arr = JSON.parse(r.read_by_json || '[]') as string[];
    if (!arr.includes(userId)) {
      arr.push(userId);
      stmt.run(JSON.stringify(arr), r.id);
    }
  }
}

export function listConversations(userId?: string): Conversation[] {
  const rows = (
    userId
      ? db.prepare('SELECT * FROM conversations WHERE user_id = ? OR user_id = ? ORDER BY updated_at DESC').all(userId, 'usr_admin_1')
      : db.prepare('SELECT * FROM conversations ORDER BY updated_at DESC').all()
  ) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    userId: String(r.user_id),
    title: String(r.title),
    mode: r.mode as Conversation['mode'],
    language: (r.language === 'en' ? 'en' : 'vi') as 'vi' | 'en',
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  }));
}

export function createConversation(params: {
  userId: string;
  title: string;
  mode: Conversation['mode'];
  language: 'vi' | 'en';
}): Conversation {
  const id = `conv_${crypto.randomUUID().slice(0, 8)}`;
  const t = nowIso();
  db.prepare(`
    INSERT INTO conversations (id, user_id, title, mode, language, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, params.userId, params.title, params.mode, params.language, t, t);
  return {
    id,
    userId: params.userId,
    title: params.title,
    mode: params.mode,
    language: params.language,
    createdAt: t,
    updatedAt: t,
  };
}

export function renameConversation(id: string, title: string): void {
  db.prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?').run(title.trim(), nowIso(), id);
}

export function deleteConversation(id: string): void {
  db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
}

export function listMessages(conversationId: string): ChatMessage[] {
  const rows = db
    .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC')
    .all(conversationId) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    conversationId: String(r.conversation_id),
    sender: r.sender as 'user' | 'bot',
    text: String(r.text),
    source: r.source as 'voice' | 'keyboard',
    mode: r.mode as ChatMessage['mode'],
    linkedCommandId: r.linked_command_id ? String(r.linked_command_id) : null,
    createdAt: String(r.created_at),
  }));
}

export function addMessage(params: {
  conversationId: string;
  sender: 'user' | 'bot';
  text: string;
  source: 'voice' | 'keyboard';
  mode: ChatMessage['mode'];
  linkedCommandId?: string | null;
}): ChatMessage {
  const id = `msg_${crypto.randomUUID().slice(0, 8)}`;
  const t = nowIso();
  db.prepare(`
    INSERT INTO messages (id, conversation_id, sender, text, source, mode, linked_command_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    params.conversationId,
    params.sender,
    params.text,
    params.source,
    params.mode,
    params.linkedCommandId ?? null,
    t
  );
  db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(t, params.conversationId);
  return {
    id,
    conversationId: params.conversationId,
    sender: params.sender,
    text: params.text,
    source: params.source,
    mode: params.mode,
    linkedCommandId: params.linkedCommandId ?? null,
    createdAt: t,
  };
}

export function clearConversationMessages(conversationId: string): void {
  db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(conversationId);
}

// ---------------------------------------------------------------------------
// Legacy Voice Bot Full Features: Preferences, GMT+7 Calendar, Reminders, Pairing
// ---------------------------------------------------------------------------

export const GEMINI_MODELS = [
  'gemini-4-hydrogen',
  'gemini-3-flash-preview',
  'gemini-3.1-flash-lite',
  'gemini-3.6-flash',
];

export const GEMINI_VOICES = [
  'Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede',
  'Callirrhoe', 'Autonoe', 'Enceladus', 'Iapetus', 'Umbriel', 'Algieba',
  'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar',
  'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi',
  'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat',
];

const TZ_OFFSET_MS = 7 * 60 * 60 * 1000;

export function vnNow(): Date {
  return new Date(Date.now() + TZ_OFFSET_MS);
}

export function vnTodayDateStr(): string {
  return vnNow().toISOString().slice(0, 10);
}

export function vnCurrentHmStr(): string {
  return vnNow().toISOString().slice(0, 16);
}

export function vnIsoNow(): string {
  const d = vnNow();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+07:00`;
}

export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function mondayOfIso(iso?: string): string {
  const target = iso || vnTodayDateStr();
  const [y, m, d] = target.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const weekday = dt.getUTCDay();
  const offset = weekday === 0 ? -6 : 1 - weekday;
  dt.setUTCDate(dt.getUTCDate() + offset);
  return dt.toISOString().slice(0, 10);
}

function parseVnDateTimeEpochMs(dateStr: string, timeStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  return Date.UTC(y, m - 1, d, hh, mm, 0) - TZ_OFFSET_MS;
}

function seedLegacyVoiceBotData(): void {
  const calCount = db.prepare('SELECT COUNT(*) AS cnt FROM calendar_events').get() as { cnt: number };
  if (calCount.cnt === 0) {
    const today = vnTodayDateStr();
    const nextDay = addDaysIso(today, 1);
    const insertEv = db.prepare(`
      INSERT INTO calendar_events (id, user_id, title, date, start, end, note, remind_minutes, revision)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);
    insertEv.run(
      'ev_seed_1',
      'usr_admin_1',
      'Thực hành mạch I2S & Loa MAX98357A',
      today,
      '08:30',
      '10:00',
      'Kiểm tra chân LRCK GPIO16, BCLK GPIO15, DOUT GPIO7 trên kit ESP32-S3.',
      15
    );
    insertEv.run(
      'ev_seed_2',
      'usr_admin_1',
      'Kiểm thử màn hình ST7789 240×240',
      today,
      '14:00',
      '15:30',
      'Hiệu chỉnh đèn nền GPIO13 và giao diện hiển thị lịch STEM.',
      10
    );
    insertEv.run(
      'ev_seed_3',
      'usr_admin_1',
      'Thử nghiệm Servo & Relay IoT qua Web',
      nextDay,
      '09:00',
      '10:30',
      'Đồng bộ lệnh điều khiển từ TP STEM Control xuống thiết bị ESP32-S3.',
      10
    );
  }

  const pairCount = db.prepare('SELECT COUNT(*) AS cnt FROM paired_devices').get() as { cnt: number };
  if (pairCount.cnt === 0) {
    const tokenHash = crypto.createHash('sha256').update('stem-device-token-default').digest('hex');
    db.prepare(`
      INSERT INTO paired_devices (device_id, user_id, name, token_hash, simulated_online, last_seen_ms)
      VALUES (?, ?, ?, ?, 1, ?)
    `).run('esp32s3-stem-01', 'usr_admin_1', 'Board ESP32-S3 Voice Bot #01', tokenHash, Date.now());
  }
}

export function getVoiceBotPreferences(userId: string): VoiceBotPreferences {
  const row = db
    .prepare('SELECT * FROM voicebot_preferences WHERE user_id = ?')
    .get(userId) as Record<string, unknown> | undefined;
  return {
    assistantName: row ? String(row.assistant_name) : 'Trợ lý STEM',
    stylePrompt: row ? String(row.style_prompt) : '',
    model: row ? String(row.model) : GEMINI_MODELS[0],
    voice: row ? String(row.voice) : 'Kore',
    models: [...GEMINI_MODELS],
    voices: [...GEMINI_VOICES],
  };
}

export function saveVoiceBotPreferences(
  userId: string,
  input: { assistantName: string; stylePrompt: string; model: string; voice: string }
): VoiceBotPreferences {
  const assistantName = input.assistantName.trim().slice(0, 64);
  if (!assistantName) throw new Error('Tên trợ lý phải dài 1–64 ký tự.');
  const stylePrompt = (input.stylePrompt || '').trim().slice(0, 1200);
  const model = GEMINI_MODELS.includes(input.model) ? input.model : GEMINI_MODELS[0];
  const voice = GEMINI_VOICES.includes(input.voice) ? input.voice : 'Kore';

  db.prepare(`
    INSERT INTO voicebot_preferences (user_id, assistant_name, style_prompt, model, voice)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      assistant_name = excluded.assistant_name,
      style_prompt = excluded.style_prompt,
      model = excluded.model,
      voice = excluded.voice
  `).run(userId, assistantName, stylePrompt, model, voice);

  return getVoiceBotPreferences(userId);
}

function mapCalendarRow(r: Record<string, unknown>): CalendarEvent {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    title: String(r.title),
    date: String(r.date),
    start: String(r.start),
    end: String(r.end),
    note: String(r.note),
    remindMinutes: Number(r.remind_minutes),
    revision: Number(r.revision),
  };
}

export function listCalendarEvents(startDate: string, endDate: string, _userId?: string): CalendarEvent[] {
  const rows = db
    .prepare('SELECT * FROM calendar_events WHERE date >= ? AND date <= ? ORDER BY date ASC, start ASC, id ASC')
    .all(startDate, endDate) as Array<Record<string, unknown>>;
  return rows.map(mapCalendarRow);
}

export function getCalendarEventById(id: string): CalendarEvent | null {
  const row = db
    .prepare('SELECT * FROM calendar_events WHERE id = ?')
    .get(id) as Record<string, unknown> | undefined;
  return row ? mapCalendarRow(row) : null;
}

function assertNoCalendarOverlap(date: string, start: string, end: string, excludeId = ''): void {
  const existing = db
    .prepare('SELECT id, title, start, end FROM calendar_events WHERE date = ? AND id != ?')
    .all(date, excludeId) as Array<{ id: string; title: string; start: string; end: string }>;
  for (const ev of existing) {
    if (ev.start < end && ev.end > start) {
      throw new Error(`Khoảng giờ bị trùng với lịch "${ev.title}" (${ev.start}–${ev.end}).`);
    }
  }
}

export function createCalendarEvent(params: {
  userId: string;
  title: string;
  date: string;
  start: string;
  end: string;
  note?: string;
  remindMinutes?: number;
}): CalendarEvent {
  const title = params.title.trim();
  if (!title || title.length > 120) throw new Error('Tiêu đề phải có 1–120 ký tự.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.date)) throw new Error('Ngày phải có dạng YYYY-MM-DD.');
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(params.start) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(params.end)) {
    throw new Error('Giờ phải có dạng HH:MM.');
  }
  if (params.end <= params.start) throw new Error('Giờ kết thúc phải sau giờ bắt đầu.');
  const remindMinutes = Math.min(1440, Math.max(0, Math.round(Number(params.remindMinutes ?? 10))));
  assertNoCalendarOverlap(params.date, params.start, params.end);

  const id = `ev_${crypto.randomUUID().slice(0, 8)}`;
  db.prepare(`
    INSERT INTO calendar_events (id, user_id, title, date, start, end, note, remind_minutes, revision)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(id, params.userId, title, params.date, params.start, params.end, (params.note || '').slice(0, 2000), remindMinutes);

  const row = db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(id) as Record<string, unknown>;
  return mapCalendarRow(row);
}

export function updateCalendarEvent(
  id: string,
  expectedRevision: number,
  patch: { title?: string; date?: string; start?: string; end?: string; note?: string; remindMinutes?: number }
): CalendarEvent {
  const row = db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!row || Number(row.revision) !== expectedRevision) {
    throw new Error('Lịch đã thay đổi hoặc đã bị xóa. Hãy tải lại.');
  }
  const title = (patch.title ?? String(row.title)).trim();
  const date = patch.date ?? String(row.date);
  const start = patch.start ?? String(row.start);
  const end = patch.end ?? String(row.end);
  const note = (patch.note ?? String(row.note)).slice(0, 2000);
  const remindMinutes = Math.min(1440, Math.max(0, Math.round(Number(patch.remindMinutes ?? row.remind_minutes))));

  if (!title) throw new Error('Thiếu tiêu đề.');
  if (end <= start) throw new Error('Giờ kết thúc phải sau giờ bắt đầu.');
  assertNoCalendarOverlap(date, start, end, id);

  db.prepare(`
    UPDATE calendar_events
    SET title = ?, date = ?, start = ?, end = ?, note = ?, remind_minutes = ?, revision = revision + 1
    WHERE id = ?
  `).run(title, date, start, end, note, remindMinutes, id);

  db.prepare('UPDATE device_reminders SET active = 0 WHERE event_id = ?').run(id);
  const updated = db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(id) as Record<string, unknown>;
  return mapCalendarRow(updated);
}

export function deleteCalendarEvent(id: string, expectedRevision: number): void {
  const row = db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!row || Number(row.revision) !== expectedRevision) {
    throw new Error('Lịch đã thay đổi hoặc đã bị xóa. Hãy tải lại.');
  }
  db.prepare('DELETE FROM calendar_events WHERE id = ?').run(id);
  db.prepare('UPDATE device_reminders SET active = 0 WHERE event_id = ?').run(id);
}

export function copyCalendarWeek(sourceMonday: string, targetMonday: string, userId: string): CalendarEvent[] {
  const srcEnd = addDaysIso(sourceMonday, 6);
  const sourceEvents = listCalendarEvents(sourceMonday, srcEnd);
  const srcMs = new Date(`${sourceMonday}T12:00:00Z`).getTime();
  const tgtMs = new Date(`${targetMonday}T12:00:00Z`).getTime();
  const dayDiff = Math.round((tgtMs - srcMs) / 86400000);

  const created: CalendarEvent[] = [];
  for (const ev of sourceEvents) {
    const newDate = addDaysIso(ev.date, dayDiff);
    assertNoCalendarOverlap(newDate, ev.start, ev.end);
    created.push(
      createCalendarEvent({
        userId,
        title: ev.title,
        date: newDate,
        start: ev.start,
        end: ev.end,
        note: ev.note,
        remindMinutes: ev.remindMinutes,
      })
    );
  }
  return created;
}

export function syncAndListDeviceReminders(userId: string, limit = 30): DeviceReminder[] {
  const nowMs = Date.now();
  const today = vnTodayDateStr();
  const tomorrow = addDaysIso(today, 1);
  const candidates = listCalendarEvents(today, tomorrow);

  for (const ev of candidates) {
    const startMs = parseVnDateTimeEpochMs(ev.date, ev.start);
    const endMs = parseVnDateTimeEpochMs(ev.date, ev.end);
    if (nowMs >= endMs || startMs - nowMs > ev.remindMinutes * 60 * 1000) {
      continue;
    }
    const reminderId = `${ev.id}:${ev.revision}`;
    const existing = db.prepare('SELECT id FROM device_reminders WHERE id = ?').get(reminderId);
    if (!existing) {
      const expiresAt = new Date(endMs + TZ_OFFSET_MS).toISOString().replace('Z', '+07:00');
      db.prepare(`
        INSERT INTO device_reminders (id, user_id, event_id, title, text, status, active, expires_at, updated_at, updated_seq)
        VALUES (?, ?, ?, ?, ?, 'pending', 1, ?, ?, ?)
      `).run(
        reminderId,
        userId,
        ev.id,
        ev.title,
        `Nhắc lịch: ${ev.title}, ${ev.start} ngày ${ev.date}.`,
        expiresAt,
        vnIsoNow(),
        Date.now()
      );
    }
  }

  const rows = db
    .prepare('SELECT * FROM device_reminders ORDER BY updated_seq DESC LIMIT ?')
    .all(limit) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    eventId: String(r.event_id),
    title: String(r.title),
    text: String(r.text),
    status: r.status as DeviceReminder['status'],
    active: Boolean(r.active),
    expiresAt: String(r.expires_at),
    updatedAt: String(r.updated_at),
  }));
}

export function queueTestDeviceReminder(userId: string, deviceName: string, volume: number, muted: boolean, online: boolean): DeviceReminder {
  const id = `test:${Date.now()}`;
  const status = online ? 'played' : 'pending';
  const active = online ? 0 : 1;
  const text = `Kiểm tra nhắc lịch trên ${deviceName}: âm lượng ${muted ? '0' : volume}%.`;
  const updatedAt = vnIsoNow();
  db.prepare(`
    INSERT INTO device_reminders (id, user_id, event_id, title, text, status, active, expires_at, updated_at, updated_seq)
    VALUES (?, ?, 'test', ?, ?, ?, ?, ?, ?, ?)
  `).run(id, userId, `Phát thử trên ${deviceName}`, text, status, active, updatedAt, updatedAt, Date.now());

  return {
    id,
    eventId: 'test',
    title: `Phát thử trên ${deviceName}`,
    text,
    status,
    active: Boolean(active),
    expiresAt: updatedAt,
    updatedAt,
  };
}

export function ackDeviceReminder(id: string, status: 'played' | 'failed' | 'cancelled'): void {
  db.prepare(`
    UPDATE device_reminders
    SET status = ?, active = ?, updated_at = ?, updated_seq = ?
    WHERE id = ? AND status != 'played'
  `).run(status, status === 'played' ? 0 : 1, vnIsoNow(), Date.now(), id);
}

export function listPairedDevices(): PairedDeviceInfo[] {
  const rows = db
    .prepare('SELECT * FROM paired_devices ORDER BY device_id ASC')
    .all() as Array<Record<string, unknown>>;
  return rows.map((r) => {
    const lastMs = Number(r.last_seen_ms || 0);
    const simulated = Boolean(r.simulated_online);
    const online = simulated || (lastMs > 0 && Date.now() - lastMs < 35000);
    return {
      deviceId: String(r.device_id),
      userId: String(r.user_id),
      name: String(r.name),
      online,
      simulated,
      lastSeen: lastMs > 0 ? new Date(lastMs).toISOString() : null,
    };
  });
}

export function createPairedDevice(userId: string, deviceId: string, name: string): { device: PairedDeviceInfo; token: string } {
  const cleanId = deviceId.trim();
  const cleanName = name.trim() || 'Board ESP32-S3';
  if (!cleanId || cleanId.length > 80) throw new Error('Mã thiết bị (Device-Id) không hợp lệ.');
  if (db.prepare('SELECT device_id FROM paired_devices WHERE device_id = ?').get(cleanId)) {
    throw new Error('Mã thiết bị này đã được đăng ký.');
  }
  const token = `stem-token-${crypto.randomBytes(24).toString('base64url')}`;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  db.prepare(`
    INSERT INTO paired_devices (device_id, user_id, name, token_hash, simulated_online, last_seen_ms)
    VALUES (?, ?, ?, ?, 0, 0)
  `).run(cleanId, userId, cleanName, tokenHash);

  return {
    device: {
      deviceId: cleanId,
      userId,
      name: cleanName,
      online: false,
      simulated: false,
      lastSeen: null,
    },
    token,
  };
}

export function deletePairedDevice(deviceId: string): void {
  db.prepare('DELETE FROM paired_devices WHERE device_id = ?').run(deviceId);
}

export function authenticatePairedDeviceToken(rawToken: string): PairedDeviceInfo | null {
  if (!rawToken || rawToken.length > 256) return null;
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const row = db
    .prepare('SELECT * FROM paired_devices WHERE token_hash = ?')
    .get(tokenHash) as Record<string, unknown> | undefined;
  if (!row) return null;
  db.prepare('UPDATE paired_devices SET last_seen_ms = ? WHERE device_id = ?').run(Date.now(), String(row.device_id));
  return {
    deviceId: String(row.device_id),
    userId: String(row.user_id),
    name: String(row.name),
    online: true,
    simulated: Boolean(row.simulated_online),
    lastSeen: new Date().toISOString(),
  };
}

