export type UserRole = 'admin' | 'teacher' | 'student';

export type ProjectId = 'voicebot' | 'car' | 'grill';

export type ProjectColorStatus = 'connected' | 'off' | 'warning' | 'error';

export type VoiceBotMode =
  | 'chat'
  | 'stem_qa'
  | 'english'
  | 'story'
  | 'quiz'
  | 'device_cmd';

export type VoiceBotActivity = 'Đang chờ' | 'Đang nghe' | 'Đang xử lý' | 'Đang trả lời';

export type DisplayMode = 'schedule' | 'clock' | 'emotion' | 'sleep';

export type CarDirection = 'idle' | 'forward' | 'backward' | 'left' | 'right' | 'spin_left' | 'spin_right';

export type CarMode = 'manual' | 'avoid' | 'line' | 'patrol' | 'saved_route';

export type GrillStateLabel = 'Đang tắt' | 'Đang làm nóng' | 'Đang nướng' | 'Đã hoàn thành';

export type GrillPreset = 'custom' | 'meat' | 'chicken' | 'fish' | 'veggies' | 'keep_warm';

export type AckStatus = 'Đã nhận lệnh' | 'Đang thực hiện' | 'Hoàn thành' | 'Thất bại';

export interface UserProfile {
  id: string;
  phoneOrEmail: string;
  fullName: string;
  role: UserRole;
  avatarColor: string;
  active: boolean;
  createdAt: string;
}

export interface PermissionRecord {
  id: string;
  userId: string;
  projectId: ProjectId;
  canView: boolean;
  canControl: boolean;
  canChangeSafety: boolean;
  allowedTaskIds: string[];
}

export interface ProjectSummary {
  id: ProjectId;
  name: string;
  slug: string;
  description: string;
  status: ProjectColorStatus;
  statusLabel: string;
  deviceId: string;
  imageUrl: string;
  safetyConfig: Record<string, number | boolean | string>;
  updatedAt: string;
}

export interface DeviceInfo {
  id: string;
  projectId: ProjectId;
  name: string;
  hardwareModel: string;
  macAddress: string;
  firmwareVersion: string;
  ipAddress: string;
  wifiRssi: number;
  online: boolean;
  batteryPct: number | null;
  lastSeenAt: string;
}

export interface PairedDeviceInfo {
  deviceId: string;
  userId: string;
  name: string;
  online: boolean;
  simulated: boolean;
  lastSeen: string | null;
}

export interface TaskInfo {
  id: string;
  projectId: ProjectId;
  code: string;
  name: string;
  componentName: string;
  description: string;
  enabled: boolean;
  statusText: string;
  state: Record<string, unknown>;
  sortOrder: number;
}

export interface VoiceBotPreferences {
  assistantName: string;
  stylePrompt: string;
  model: string;
  voice: string;
  models: string[];
  voices: string[];
}

export interface VoiceBotState {
  online: boolean;
  micEnabled: boolean;
  speakerEnabled: boolean;
  muted: boolean;
  activityState: VoiceBotActivity;
  volume: number;
  backlight: number;
  displayMode: DisplayMode;
  gpioOutputs: {
    led_status: boolean;
    relay_lab: boolean;
    buzzer_alert: boolean;
    servo_angle: number;
  };
  telemetry: {
    wifiRssi: number;
    freePsramKb: number;
    cpuTempC: number;
  };
  speechRate: number;
  voiceGender: 'female' | 'male';
  language: 'vi' | 'en';
  mode: VoiceBotMode;
  assistantName: string;
  stylePrompt: string;
  model: string;
  ttsVoice: string;
  connectionQuality: string;
  lastTranscript: string;
  lastReply: string;
  lastCommandSummary: string | null;
  updatedAt: string;
}

export interface CalendarEvent {
  id: string;
  userId: string;
  title: string;
  date: string;
  start: string;
  end: string;
  note: string;
  remindMinutes: number;
  revision: number;
}

export interface DeviceReminder {
  id: string;
  eventId: string;
  title: string;
  text: string;
  status: 'pending' | 'played' | 'failed' | 'cancelled';
  active: boolean;
  expiresAt: string;
  updatedAt: string;
}

export interface StemCarState {
  online: boolean;
  movingState: 'Đang dừng' | 'Đang chạy';
  direction: CarDirection;
  speed: number;
  speedPreset: 'slow' | 'medium' | 'fast' | 'custom';
  servoAngle: number;
  motors: {
    sync: boolean;
    leftSpeed: number;
    leftDir: 'forward' | 'backward' | 'stop';
    rightSpeed: number;
    rightDir: 'forward' | 'backward' | 'stop';
  };
  mode: CarMode;
  batteryPct: number;
  wifiRssi: number;
  obstacleDistanceCm: number;
  lineSensors: [number, number, number, number, number];
  sideSensors: {
    leftClear: boolean;
    rightClear: boolean;
  };
  collisionAlert: boolean;
  uptimeSec: number;
  cameraEnabled: boolean;
  cameraQuality: 'HD 720p' | 'SD 480p';
  autoStopReason: string | null;
  lastSnapshotAt: string | null;
  updatedAt: string;
}

export interface SmartGrillState {
  online: boolean;
  grillState: GrillStateLabel;
  currentTempC: number;
  targetTempC: number;
  maxTempLimitC: number;
  sensorHealthy: boolean;
  heaterOn: boolean;
  fanOn: boolean;
  fanSpeed: number;
  rotisserieOn: boolean;
  timerEnabled: boolean;
  timerTotalSec: number;
  timerRemainingSec: number;
  presetMode: GrillPreset;
  favorites: number[];
  alarmActive: boolean;
  overheatAlert: boolean;
  safetyLockReason: string | null;
  powerLossBlocked: boolean;
  tempHistory: Array<{ time: string; currentTempC: number; targetTempC: number }>;
  updatedAt: string;
}

export interface CommandLog {
  id: string;
  commandId: string;
  projectId: ProjectId;
  taskId: string;
  deviceId: string;
  action: string;
  valueJson: string;
  userId: string;
  userName: string;
  ackStatus: AckStatus;
  errorMessage: string | null;
  mqttTopic: string;
  createdAt: string;
}

export interface Conversation {
  id: string;
  userId: string;
  title: string;
  mode: VoiceBotMode;
  language: 'vi' | 'en';
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  sender: 'user' | 'bot';
  text: string;
  source: 'voice' | 'keyboard';
  mode: VoiceBotMode;
  linkedCommandId: string | null;
  createdAt: string;
}

export interface PendingVoiceCommand {
  projectId: ProjectId;
  taskId: string;
  action: string;
  value: Record<string, unknown>;
  humanLabel: string;
  reason: string;
}

export interface PendingCalendarProposal {
  action: 'propose_create' | 'propose_update' | 'propose_delete';
  summary: string;
  event?: Partial<Omit<CalendarEvent, 'id' | 'userId' | 'revision'>> & {
    title?: string;
    date?: string;
    start?: string;
    end?: string;
  };
  eventId?: string;
  revision?: number;
  conflict?: boolean;
}

export interface SensorReading {
  id: number;
  projectId: ProjectId;
  metricKey: string;
  metricValue: number;
  unit: string;
  recordedAt: string;
}

export interface NotificationItem {
  id: string;
  projectId: ProjectId;
  severity: 'info' | 'warning' | 'danger';
  title: string;
  message: string;
  readBy: string[];
  createdAt: string;
}

export interface MqttTopicInfo {
  projectId: ProjectId;
  deviceId: string;
  topics: {
    command: string;
    status: string;
    telemetry?: string;
    alert?: string;
  };
}

export interface RealtimeSnapshot {
  projects: ProjectSummary[];
  devices: DeviceInfo[];
  tasks: TaskInfo[];
  voicebot: VoiceBotState;
  car: StemCarState;
  grill: SmartGrillState;
  notifications: NotificationItem[];
  recentCommands: CommandLog[];
  mqttTopics: MqttTopicInfo[];
  serverTime: string;
  aiAvailable: boolean;
}
