import crypto from 'node:crypto';
import {
  addNotification,
  getPermissionsForUser,
  insertCommandLog,
  listCommandLogs,
  listDevices,
  listNotifications,
  listProjects,
  listTasks,
  nowIso,
  recordSensorReading,
  updateCommandAck,
  updateDeviceRuntime,
  updateProjectSafetyConfig,
  updateProjectStatus,
  updateTaskState,
} from './db.ts';
import type {
  CarDirection,
  CarMode,
  CommandLog,
  GrillPreset,
  DisplayMode,
  MqttTopicInfo,
  ProjectId,
  RealtimeSnapshot,
  SmartGrillState,
  StemCarState,
  UserProfile,
  VoiceBotMode,
  VoiceBotState,
} from '../src/types.ts';
import { isAiConfigured } from './ai.ts';

type BroadcastFn = (event: string, payload: unknown) => void;

class StemEngine {
  private broadcast: BroadcastFn = () => {};
  private carHeartbeatMs = Date.now();
  private tickCount = 0;

  public voicebotCommandQueue: Array<{ id: string; summary: string; payload: Record<string, unknown>; timestamp: string }> = [];

  public voicebot: VoiceBotState = {
    online: true,
    micEnabled: true,
    speakerEnabled: true,
    muted: false,
    activityState: 'Đang chờ',
    volume: 78,
    backlight: 85,
    displayMode: 'schedule',
    gpioOutputs: {
      led_status: true,
      relay_lab: false,
      buzzer_alert: false,
      servo_angle: 90,
    },
    telemetry: {
      wifiRssi: -49,
      freePsramKb: 7680,
      cpuTempC: 41.2,
    },
    speechRate: 1.0,
    voiceGender: 'female',
    language: 'vi',
    mode: 'stem_qa',
    assistantName: 'Trợ lý STEM',
    stylePrompt: '',
    model: 'gemini-4-hydrogen',
    ttsVoice: 'Kore',
    connectionQuality: 'Tốt · 18 ms',
    lastTranscript: '',
    lastReply: 'Xin chào! Tôi là Voice Bot AI của TP STEM Control.',
    lastCommandSummary: null,
    updatedAt: nowIso(),
  };

  public car: StemCarState = {
    online: true,
    movingState: 'Đang dừng',
    direction: 'idle',
    speed: 55,
    speedPreset: 'medium',
    servoAngle: 90,
    motors: {
      sync: true,
      leftSpeed: 0,
      leftDir: 'stop',
      rightSpeed: 0,
      rightDir: 'stop',
    },
    mode: 'manual',
    batteryPct: 86,
    wifiRssi: -52,
    obstacleDistanceCm: 68,
    lineSensors: [0, 1, 1, 0, 0],
    sideSensors: {
      leftClear: true,
      rightClear: true,
    },
    collisionAlert: false,
    uptimeSec: 124,
    cameraEnabled: true,
    cameraQuality: 'HD 720p',
    autoStopReason: null,
    lastSnapshotAt: null,
    updatedAt: nowIso(),
  };

  public grill: SmartGrillState = {
    online: true,
    grillState: 'Đang tắt',
    currentTempC: 32.0,
    targetTempC: 180,
    maxTempLimitC: 250,
    sensorHealthy: true,
    heaterOn: false,
    fanOn: false,
    fanSpeed: 65,
    rotisserieOn: false,
    timerEnabled: false,
    timerTotalSec: 900,
    timerRemainingSec: 900,
    presetMode: 'custom',
    favorites: [160, 185, 210],
    alarmActive: false,
    overheatAlert: false,
    safetyLockReason: null,
    powerLossBlocked: false,
    tempHistory: [
      { time: '00:00', currentTempC: 31, targetTempC: 180 },
      { time: '00:10', currentTempC: 31.5, targetTempC: 180 },
      { time: '00:20', currentTempC: 32, targetTempC: 180 },
    ],
    updatedAt: nowIso(),
  };

  public setBroadcaster(fn: BroadcastFn): void {
    this.broadcast = fn;
  }

  public startLoop(): void {
    setInterval(() => {
      this.stepPhysics();
    }, 1000);
  }

  public getMqttTopics(): MqttTopicInfo[] {
    return [
      {
        projectId: 'voicebot',
        deviceId: 'ESP32-VB-01',
        topics: {
          command: 'stem/voicebot/ESP32-VB-01/command',
          status: 'stem/voicebot/ESP32-VB-01/status',
        },
      },
      {
        projectId: 'car',
        deviceId: 'ESP32-CAR-01',
        topics: {
          command: 'stem/car/ESP32-CAR-01/command',
          status: 'stem/car/ESP32-CAR-01/status',
          telemetry: 'stem/car/ESP32-CAR-01/sensor',
        },
      },
      {
        projectId: 'grill',
        deviceId: 'ESP32-GRILL-01',
        topics: {
          command: 'stem/grill/ESP32-GRILL-01/command',
          status: 'stem/grill/ESP32-GRILL-01/status',
          telemetry: 'stem/grill/ESP32-GRILL-01/temperature',
          alert: 'stem/grill/ESP32-GRILL-01/alert',
        },
      },
    ];
  }

  public getSnapshot(): RealtimeSnapshot {
    return {
      projects: listProjects(),
      devices: listDevices(),
      tasks: listTasks(),
      voicebot: this.voicebot,
      car: this.car,
      grill: this.grill,
      notifications: listNotifications(30),
      recentCommands: listCommandLogs(40),
      mqttTopics: this.getMqttTopics(),
      serverTime: nowIso(),
      aiAvailable: isAiConfigured,
    };
  }

  public emitSnapshot(): void {
    this.broadcast('state_update', this.getSnapshot());
  }

  private stepPhysics(): void {
    this.tickCount += 1;
    const t = nowIso();

    // ---- 1. STEM CAR PHYSICS & SAFETY WATCHDOG ----
    if (this.car.online) {
      this.car.uptimeSec += 1;
      const isMoving = this.car.movingState === 'Đang chạy';

      // Watchdog: manual movement heartbeat timeout (4.5s)
      if (isMoving && this.car.mode === 'manual' && Date.now() - this.carHeartbeatMs > 4500) {
        this.forceStopCar('Tự động dừng: Hết thời gian giữ lệnh điều khiển.');
      } else if (isMoving) {
        // Gentle battery consumption while driving
        this.car.batteryPct = Math.max(5, Number((this.car.batteryPct - 0.04).toFixed(2)));

        // Simulated ultrasonic reading fluctuation based on mode
        if (this.car.mode === 'avoid') {
          this.car.obstacleDistanceCm = Math.max(22, Math.round(40 + Math.sin(this.tickCount * 0.6) * 28));
        } else if (this.car.direction === 'forward') {
          this.car.obstacleDistanceCm = Math.max(12, Math.round(this.car.obstacleDistanceCm - 2));
        } else {
          this.car.obstacleDistanceCm = Math.min(140, this.car.obstacleDistanceCm + 4);
        }

        // Line sensor animation
        if (this.car.mode === 'line') {
          const patterns: Array<[number, number, number, number, number]> = [
            [0, 1, 1, 0, 0],
            [0, 0, 1, 1, 0],
            [0, 0, 1, 0, 0],
            [1, 1, 0, 0, 0],
          ];
          this.car.lineSensors = patterns[this.tickCount % patterns.length];
        }

        // Watchdog: Obstacle < 15 cm during forward drive
        if (this.car.obstacleDistanceCm < 15 && this.car.direction === 'forward' && this.car.mode === 'manual') {
          this.car.collisionAlert = true;
          this.forceStopCar(`Cảnh báo va chạm! Vật cản phía trước ${this.car.obstacleDistanceCm} cm.`);
          addNotification({
            projectId: 'car',
            severity: 'warning',
            title: 'Xe STEM tự dừng tránh va chạm',
            message: `Phát hiện vật cản ở khoảng cách ${this.car.obstacleDistanceCm} cm (< 15 cm).`,
          });
        }

        // Watchdog: Low battery <= 10%
        if (this.car.batteryPct <= 10) {
          this.forceStopCar('Pin yếu dưới 10% — Hệ thống tự động dừng xe.');
          addNotification({
            projectId: 'car',
            severity: 'danger',
            title: 'Pin Xe STEM yếu nghiêm trọng',
            message: `Dung lượng pin còn ${this.car.batteryPct}%. Vui lòng sạc pin trước khi vận hành tiếp.`,
          });
        }
      } else {
        // Recover simulated obstacle reading gradually when stopped
        if (this.car.obstacleDistanceCm < 65) {
          this.car.obstacleDistanceCm = Math.min(68, this.car.obstacleDistanceCm + 3);
        }
      }

      this.car.wifiRssi = -50 - (this.tickCount % 6);
      this.car.updatedAt = t;
      updateDeviceRuntime('ESP32-CAR-01', {
        online: true,
        wifiRssi: this.car.wifiRssi,
        batteryPct: Math.round(this.car.batteryPct),
      });
    } else {
      if (this.car.movingState === 'Đang chạy') {
        this.forceStopCar('Mất kết nối thiết bị Xe STEM.');
      }
    }

    // ---- 2. SMART GRILL THERMAL PHYSICS & SAFETY WATCHDOG ----
    if (this.grill.online) {
      if (!this.grill.sensorHealthy && this.grill.heaterOn) {
        this.grill.heaterOn = false;
        this.grill.grillState = 'Đang tắt';
        this.grill.safetyLockReason = 'Cảm biến nhiệt bị lỗi — Khóa bộ gia nhiệt an toàn.';
        updateProjectStatus('grill', 'error', 'Lỗi cảm biến');
      } else if (this.grill.heaterOn && this.grill.sensorHealthy) {
        const diff = this.grill.targetTempC - this.grill.currentTempC;
        const delta = diff > 0 ? Math.min(4.8, Math.max(0.6, diff * 0.08)) : Math.max(-1.4, diff * 0.05);
        const fanPenalty = this.grill.fanOn ? -0.45 : 0;
        this.grill.currentTempC = Number(Math.max(25, this.grill.currentTempC + delta + fanPenalty).toFixed(1));

        if (this.grill.currentTempC >= this.grill.targetTempC - 4) {
          this.grill.grillState = 'Đang nướng';
        } else {
          this.grill.grillState = 'Đang làm nóng';
        }
      } else {
        // Cooling curve toward ambient 30°C
        const coolRate = this.grill.fanOn ? 2.6 : 0.7;
        if (this.grill.currentTempC > 30) {
          this.grill.currentTempC = Number(Math.max(30, this.grill.currentTempC - coolRate).toFixed(1));
        }
      }

      // Overheat protection watchdog
      if (this.grill.currentTempC >= this.grill.maxTempLimitC && !this.grill.overheatAlert) {
        this.grill.heaterOn = false;
        this.grill.fanOn = true;
        this.grill.fanSpeed = 100;
        this.grill.overheatAlert = true;
        this.grill.alarmActive = true;
        this.grill.grillState = 'Đang tắt';
        this.grill.safetyLockReason = `Quá nhiệt (${this.grill.currentTempC}°C >= ${this.grill.maxTempLimitC}°C). Đã tự ngắt gia nhiệt và bật quạt làm mát tối đa.`;
        updateProjectStatus('grill', 'error', 'Cảnh báo quá nhiệt');
        updateTaskState('grill_heater', { enabled: false, statusText: 'Ngắt khẩn cấp' });
        updateTaskState('grill_fan', { enabled: true, statusText: 'Làm mát khẩn 100%' });
        addNotification({
          projectId: 'grill',
          severity: 'danger',
          title: 'Cảnh báo quá nhiệt Bếp nướng!',
          message: this.grill.safetyLockReason,
        });
      }

      // Countdown timer tick
      if (this.grill.timerEnabled && this.grill.heaterOn && this.grill.timerRemainingSec > 0) {
        this.grill.timerRemainingSec -= 1;
        updateTaskState('grill_timer', {
          enabled: true,
          statusText: `${formatSeconds(this.grill.timerRemainingSec)} · Đang đếm`,
        });

        if (this.grill.timerRemainingSec <= 0) {
          this.grill.timerEnabled = false;
          this.grill.heaterOn = false;
          this.grill.rotisserieOn = false;
          this.grill.grillState = 'Đã hoàn thành';
          this.grill.alarmActive = true;
          updateProjectStatus('grill', 'connected', 'Đã hoàn thành');
          updateTaskState('grill_heater', { enabled: false, statusText: 'Đã tắt (Hết giờ)' });
          updateTaskState('grill_rotisserie', { enabled: false, statusText: 'Đang tắt' });
          updateTaskState('grill_timer', { enabled: false, statusText: '00:00 · Hoàn tất' });
          addNotification({
            projectId: 'grill',
            severity: 'info',
            title: 'Bếp nướng đã hoàn thành thời gian hẹn giờ',
            message: 'Bộ gia nhiệt đã tự ngắt an toàn khi hết thời gian nướng.',
          });
        }
      }

      // Update thermal chart series every 2 seconds
      if (this.tickCount % 2 === 0) {
        const label = new Date().toLocaleTimeString('vi-VN', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });
        this.grill.tempHistory = [
          ...this.grill.tempHistory.slice(-24),
          {
            time: label,
            currentTempC: this.grill.currentTempC,
            targetTempC: this.grill.targetTempC,
          },
        ];
      }

      updateTaskState('grill_temp_sensor', {
        enabled: this.grill.sensorHealthy,
        statusText: this.grill.sensorHealthy
          ? `${this.grill.currentTempC.toFixed(1)}°C · Ổn định`
          : 'Lỗi cảm biến!',
      });
      this.grill.updatedAt = t;
      updateDeviceRuntime('ESP32-GRILL-01', { online: true, wifiRssi: -55 });
    }

    // Record DB telemetry every 5 seconds
    if (this.tickCount % 5 === 0) {
      recordSensorReading('grill', 'temperature', this.grill.currentTempC, '°C');
      recordSensorReading('car', 'obstacle_cm', this.car.obstacleDistanceCm, 'cm');
      recordSensorReading('car', 'battery_pct', this.car.batteryPct, '%');
    }

    this.emitSnapshot();
  }

  private forceStopCar(reason: string): void {
    this.car.movingState = 'Đang dừng';
    this.car.direction = 'idle';
    this.car.motors = {
      sync: this.car.motors.sync,
      leftSpeed: 0,
      leftDir: 'stop',
      rightSpeed: 0,
      rightDir: 'stop',
    };
    this.car.autoStopReason = reason;
    updateTaskState('car_drive', { enabled: true, statusText: 'Đang dừng' });
    updateProjectStatus('car', this.car.collisionAlert || this.car.batteryPct <= 10 ? 'warning' : 'connected', this.car.collisionAlert ? 'Cảnh báo vật cản' : 'Đang kết nối');
  }

  public forceCarStopOnLeave(user: UserProfile): void {
    if (this.car.movingState === 'Đang chạy') {
      this.forceStopCar('Tự động dừng vì người dùng rời trang điều khiển.');
      const commandId = `cmd_${crypto.randomUUID().slice(0, 8)}`;
      insertCommandLog({
        id: `log_${crypto.randomUUID().slice(0, 8)}`,
        commandId,
        projectId: 'car',
        taskId: 'car_drive',
        deviceId: 'ESP32-CAR-01',
        action: 'auto_stop_leave',
        valueJson: JSON.stringify({ reason: 'leave_page' }),
        userId: user.id,
        userName: user.fullName,
        ackStatus: 'Hoàn thành',
        errorMessage: null,
        mqttTopic: 'stem/car/ESP32-CAR-01/command',
        createdAt: nowIso(),
      });
      this.emitSnapshot();
    }
  }

  public dispatchCommand(params: {
    user: UserProfile;
    projectId: ProjectId;
    taskId: string;
    action: string;
    value?: Record<string, unknown>;
    confirmDangerous?: boolean;
  }): CommandLog {
    const { user, projectId, taskId, action, value = {}, confirmDangerous = false } = params;
    const deviceIdMap: Record<ProjectId, string> = {
      voicebot: 'ESP32-VB-01',
      car: 'ESP32-CAR-01',
      grill: 'ESP32-GRILL-01',
    };
    const deviceId = deviceIdMap[projectId];
    const mqttTopic = `stem/${projectId}/${deviceId}/command`;
    const commandId = `cmd_${crypto.randomUUID().slice(0, 8)}`;

    // 1. RBAC Verification
    const perms = getPermissionsForUser(user.id);
    const projPerm = perms.find((p) => p.projectId === projectId);
    const isAdmin = user.role === 'admin';
    if (!isAdmin) {
      if (!projPerm || !projPerm.canControl) {
        throw new Error('Bạn không có quyền điều khiển dự án này.');
      }
      if (
        taskId !== 'system' &&
        !action.includes('emergency_stop') &&
        !action.includes('stop') &&
        projPerm.allowedTaskIds.length > 0 &&
        !projPerm.allowedTaskIds.includes(taskId)
      ) {
        throw new Error('Vai trò của bạn chưa được cấp quyền thao tác Task này.');
      }
      if ((action === 'set_max_temp' || action === 'toggle_sensor_fault') && !projPerm.canChangeSafety) {
        throw new Error('Chỉ Admin hoặc Giáo viên mới được thay đổi cấu hình an toàn.');
      }
    }

    const log: CommandLog = {
      id: `log_${crypto.randomUUID().slice(0, 8)}`,
      commandId,
      projectId,
      taskId,
      deviceId,
      action,
      valueJson: JSON.stringify(value),
      userId: user.id,
      userName: user.fullName,
      ackStatus: 'Đã nhận lệnh',
      errorMessage: null,
      mqttTopic,
      createdAt: nowIso(),
    };
    insertCommandLog(log);

    try {
      updateCommandAck(commandId, 'Đang thực hiện');
      this.applyAction({ projectId, taskId, action, value, confirmDangerous });
      updateCommandAck(commandId, 'Hoàn thành');
      log.ackStatus = 'Hoàn thành';
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Lỗi thực thi thiết bị';
      updateCommandAck(commandId, 'Thất bại', msg);
      log.ackStatus = 'Thất bại';
      log.errorMessage = msg;
      this.emitSnapshot();
      throw err;
    }

    this.emitSnapshot();
    return log;
  }

  private applyAction(params: {
    projectId: ProjectId;
    taskId: string;
    action: string;
    value: Record<string, unknown>;
    confirmDangerous: boolean;
  }): void {
    const { projectId, action, value, confirmDangerous } = params;

    // ---- Device online/offline simulation (for testing real watchdogs) ----
    if (action === 'set_device_online') {
      const online = Boolean(value.online);
      if (projectId === 'voicebot') {
        this.voicebot.online = online;
        updateDeviceRuntime('ESP32-VB-01', { online });
        updateProjectStatus('voicebot', online ? 'connected' : 'error', online ? 'Đang kết nối' : 'Mất kết nối');
      } else if (projectId === 'car') {
        this.car.online = online;
        if (!online) this.forceStopCar('Mất kết nối thiết bị Xe STEM.');
        updateDeviceRuntime('ESP32-CAR-01', { online });
        updateProjectStatus('car', online ? 'connected' : 'error', online ? 'Đang kết nối' : 'Mất kết nối');
      } else if (projectId === 'grill') {
        this.grill.online = online;
        if (!online) {
          this.grill.heaterOn = false;
          this.grill.powerLossBlocked = true;
          this.grill.grillState = 'Đang tắt';
          this.grill.safetyLockReason = 'Mất kết nối/nguồn — Đã ngắt gia nhiệt và khóa tự bật lại.';
        }
        updateDeviceRuntime('ESP32-GRILL-01', { online });
        updateProjectStatus('grill', online ? 'off' : 'error', online ? 'Đang tắt' : 'Mất kết nối');
      }
      return;
    }

    // ---- VOICE BOT ACTIONS (INCLUDING FULL ESP32-S3 HARDWARE CONTROLS) ----
    if (projectId === 'voicebot') {
      if (!this.voicebot.online) throw new Error('Voice Bot AI đang offline.');
      let summary = '';
      switch (action) {
        case 'toggle_mic': {
          this.voicebot.micEnabled = Boolean(value.enabled);
          summary = this.voicebot.micEnabled ? 'Bật Micro I2S' : 'Tắt Micro I2S';
          updateTaskState('vb_mic', {
            enabled: this.voicebot.micEnabled,
            statusText: this.voicebot.micEnabled ? 'Micro Đang bật' : 'Micro Đang tắt',
          });
          break;
        }
        case 'toggle_speaker': {
          this.voicebot.speakerEnabled = Boolean(value.enabled);
          this.voicebot.muted = !this.voicebot.speakerEnabled;
          summary = this.voicebot.speakerEnabled ? 'Bật Loa MAX98357A' : 'Tắt Loa MAX98357A';
          updateTaskState('vb_speaker', {
            enabled: this.voicebot.speakerEnabled,
            statusText: this.voicebot.speakerEnabled ? 'Loa Đang bật' : 'Loa Đang tắt',
          });
          break;
        }
        case 'set_muted': {
          this.voicebot.muted = Boolean(value.muted);
          this.voicebot.speakerEnabled = !this.voicebot.muted;
          summary = this.voicebot.muted ? 'Tắt tiếng loa' : 'Bật tiếng loa';
          updateTaskState('vb_speaker', {
            enabled: !this.voicebot.muted,
            statusText: this.voicebot.muted ? 'Đang tắt tiếng' : `Âm lượng ${this.voicebot.volume}%`,
          });
          break;
        }
        case 'set_volume': {
          const vol = Math.min(100, Math.max(0, Math.round(Number(value.volume ?? 75))));
          this.voicebot.volume = vol;
          summary = `Âm lượng ${vol}%`;
          updateTaskState('vb_speaker', { statusText: `Âm lượng ${vol}%` });
          break;
        }
        case 'set_backlight': {
          const bl = Math.min(100, Math.max(0, Math.round(Number(value.backlight ?? 85))));
          this.voicebot.backlight = bl;
          summary = `Độ sáng LCD ${bl}%`;
          break;
        }
        case 'set_display_mode': {
          const dm = String(value.displayMode || 'schedule') as DisplayMode;
          if (!['schedule', 'clock', 'emotion', 'sleep'].includes(dm)) {
            throw new Error('Chế độ màn hình ST7789 không hợp lệ.');
          }
          this.voicebot.displayMode = dm;
          summary = `Màn hình ST7789: ${dm}`;
          break;
        }
        case 'set_gpio': {
          const g = value;
          const parts: string[] = [];
          if ('led_status' in g) {
            this.voicebot.gpioOutputs.led_status = Boolean(g.led_status);
            parts.push(`Đèn báo ${this.voicebot.gpioOutputs.led_status ? 'Bật' : 'Tắt'}`);
          }
          if ('relay_lab' in g) {
            this.voicebot.gpioOutputs.relay_lab = Boolean(g.relay_lab);
            parts.push(`Relay nguồn ${this.voicebot.gpioOutputs.relay_lab ? 'Bật' : 'Tắt'}`);
          }
          if ('buzzer_alert' in g) {
            this.voicebot.gpioOutputs.buzzer_alert = Boolean(g.buzzer_alert);
            parts.push(`Còi báo ${this.voicebot.gpioOutputs.buzzer_alert ? 'Bật' : 'Tắt'}`);
          }
          if ('servo_angle' in g) {
            const ang = Math.min(180, Math.max(0, Math.round(Number(g.servo_angle ?? 90))));
            this.voicebot.gpioOutputs.servo_angle = ang;
            parts.push(`Servo ${ang}°`);
          }
          if (!parts.length) throw new Error('Không có ngõ ra GPIO nào được chọn.');
          summary = parts.join(' · ');
          break;
        }
        case 'set_voice_options': {
          if (value.speechRate !== undefined) {
            this.voicebot.speechRate = Math.min(1.6, Math.max(0.6, Number(value.speechRate)));
          }
          if (value.voiceGender === 'male' || value.voiceGender === 'female') {
            this.voicebot.voiceGender = value.voiceGender;
          }
          if (value.language === 'vi' || value.language === 'en') {
            this.voicebot.language = value.language;
          }
          if (typeof value.mode === 'string') {
            this.voicebot.mode = value.mode as VoiceBotMode;
          }
          if (typeof value.assistantName === 'string') {
            this.voicebot.assistantName = value.assistantName;
          }
          if (typeof value.stylePrompt === 'string') {
            this.voicebot.stylePrompt = value.stylePrompt;
          }
          if (typeof value.model === 'string') {
            this.voicebot.model = value.model;
          }
          if (typeof value.ttsVoice === 'string') {
            this.voicebot.ttsVoice = value.ttsVoice;
          }
          summary = 'Cập nhật tùy chọn Voice Bot';
          break;
        }
        case 'set_activity': {
          const act = String(value.activityState || 'Đang chờ');
          if (['Đang chờ', 'Đang nghe', 'Đang xử lý', 'Đang trả lời'].includes(act)) {
            this.voicebot.activityState = act as VoiceBotState['activityState'];
          }
          break;
        }
        default:
          throw new Error(`Lệnh Voice Bot không hợp lệ: ${action}`);
      }
      if (summary) {
        this.voicebot.lastCommandSummary = summary;
        this.voicebotCommandQueue.push({
          id: crypto.randomUUID(),
          summary,
          payload: value,
          timestamp: nowIso(),
        });
        if (this.voicebotCommandQueue.length > 20) this.voicebotCommandQueue.shift();
      }
      this.voicebot.updatedAt = nowIso();
      return;
    }

    // ---- STEM CAR ACTIONS ----
    if (projectId === 'car') {
      if (!this.car.online && action !== 'emergency_stop') {
        throw new Error('Xe STEM đang mất kết nối.');
      }

      switch (action) {
        case 'heartbeat': {
          this.carHeartbeatMs = Date.now();
          break;
        }
        case 'move': {
          const dir = String(value.direction || 'forward') as CarDirection;
          const speed = Math.min(100, Math.max(10, Number(value.speed ?? this.car.speed)));
          if (dir === 'forward' && this.car.obstacleDistanceCm < 15 && this.car.mode === 'manual') {
            this.car.collisionAlert = true;
            throw new Error(`Không thể tiến: có vật cản phía trước ở khoảng cách ${this.car.obstacleDistanceCm} cm!`);
          }
          if (this.car.batteryPct <= 10) {
            throw new Error('Pin dưới 10%, không thể di chuyển.');
          }
          this.carHeartbeatMs = Date.now();
          this.car.autoStopReason = null;
          this.car.collisionAlert = false;
          this.car.speed = speed;
          this.car.direction = dir;
          this.car.movingState = dir === 'idle' ? 'Đang dừng' : 'Đang chạy';
          this.car.motors = {
            sync: true,
            leftSpeed: dir === 'idle' ? 0 : speed,
            leftDir: dir === 'backward' || dir === 'spin_left' ? 'backward' : 'forward',
            rightSpeed: dir === 'idle' ? 0 : speed,
            rightDir: dir === 'backward' || dir === 'spin_right' ? 'backward' : 'forward',
          };
          updateTaskState('car_drive', { statusText: `${this.car.movingState} · ${dir} (${speed}%)` });
          updateProjectStatus('car', 'connected', 'Đang kết nối');
          break;
        }
        case 'stop': {
          this.car.movingState = 'Đang dừng';
          this.car.direction = 'idle';
          this.car.motors.leftSpeed = 0;
          this.car.motors.rightSpeed = 0;
          this.car.motors.leftDir = 'stop';
          this.car.motors.rightDir = 'stop';
          updateTaskState('car_drive', { statusText: 'Đang dừng' });
          break;
        }
        case 'emergency_stop': {
          this.forceStopCar('Người dùng đã kích hoạt DỪNG KHẨN CẤP.');
          addNotification({
            projectId: 'car',
            severity: 'warning',
            title: 'Xe STEM Dừng Khẩn Cấp',
            message: 'Toàn bộ động cơ dẫn động đã ngắt về tốc độ 0%.',
          });
          break;
        }
        case 'set_speed': {
          const speed = Math.min(100, Math.max(0, Number(value.speed ?? 50)));
          this.car.speed = speed;
          if (value.preset === 'slow' || value.preset === 'medium' || value.preset === 'fast' || value.preset === 'custom') {
            this.car.speedPreset = value.preset;
          }
          if (this.car.movingState === 'Đang chạy' && speed === 0) {
            this.forceStopCar('Tốc độ đặt về 0%.');
          } else if (this.car.movingState === 'Đang chạy') {
            this.car.motors.leftSpeed = speed;
            this.car.motors.rightSpeed = speed;
          }
          break;
        }
        case 'set_servo': {
          const angle = Math.min(180, Math.max(0, Math.round(Number(value.angle ?? 90))));
          this.car.servoAngle = angle;
          const posLabel = angle < 75 ? 'Trái' : angle > 105 ? 'Phải' : 'Giữa';
          updateTaskState('car_servo', { statusText: `${angle}° (${posLabel})` });
          break;
        }
        case 'set_motors': {
          const sync = value.sync !== undefined ? Boolean(value.sync) : this.car.motors.sync;
          const leftSpeed = Math.min(100, Math.max(0, Number(value.leftSpeed ?? this.car.motors.leftSpeed)));
          const rightSpeed = Math.min(100, Math.max(0, Number(value.rightSpeed ?? (sync ? leftSpeed : this.car.motors.rightSpeed))));
          const leftDir = (value.leftDir as 'forward' | 'backward' | 'stop') || 'forward';
          const rightDir = (value.rightDir as 'forward' | 'backward' | 'stop') || (sync ? leftDir : 'forward');
          this.carHeartbeatMs = Date.now();
          this.car.motors = { sync, leftSpeed, leftDir, rightSpeed, rightDir };
          const active = (leftDir !== 'stop' && leftSpeed > 0) || (rightDir !== 'stop' && rightSpeed > 0);
          this.car.movingState = active ? 'Đang chạy' : 'Đang dừng';
          this.car.direction = active ? 'forward' : 'idle';
          break;
        }
        case 'set_mode': {
          const mode = String(value.mode || 'manual') as CarMode;
          this.car.mode = mode;
          this.car.autoStopReason = null;
          if (mode === 'avoid' || mode === 'line' || mode === 'patrol' || mode === 'saved_route') {
            this.car.movingState = 'Đang chạy';
            this.car.direction = 'forward';
            this.carHeartbeatMs = Date.now();
          } else {
            this.car.movingState = 'Đang dừng';
            this.car.direction = 'idle';
          }
          updateTaskState('car_drive', { statusText: `Chế độ: ${mode}` });
          break;
        }
        case 'set_camera': {
          if (value.enabled !== undefined) this.car.cameraEnabled = Boolean(value.enabled);
          if (value.quality === 'HD 720p' || value.quality === 'SD 480p') {
            this.car.cameraQuality = value.quality;
          }
          if (value.snapshot) {
            this.car.lastSnapshotAt = nowIso();
          }
          updateTaskState('car_camera', {
            enabled: this.car.cameraEnabled,
            statusText: this.car.cameraEnabled ? `Đang bật (${this.car.cameraQuality})` : 'Đang tắt',
          });
          break;
        }
        case 'simulate_obstacle': {
          const dist = Math.min(200, Math.max(5, Number(value.distanceCm ?? 12)));
          this.car.obstacleDistanceCm = dist;
          if (dist < 15 && this.car.movingState === 'Đang chạy') {
            this.car.collisionAlert = true;
            this.forceStopCar(`Phát hiện vật cản ở ${dist} cm (< 15 cm).`);
          }
          updateTaskState('car_sensors', { statusText: `${dist} cm · ${dist < 15 ? 'Cảnh báo!' : 'An toàn'}` });
          break;
        }
        default:
          throw new Error(`Lệnh Xe STEM không hợp lệ: ${action}`);
      }
      this.car.updatedAt = nowIso();
      return;
    }

    // ---- SMART GRILL ACTIONS ----
    if (projectId === 'grill') {
      if (!this.grill.online && action !== 'emergency_stop') {
        throw new Error('Bếp nướng thông minh đang mất kết nối.');
      }

      switch (action) {
        case 'start_grill': {
          if (!this.grill.sensorHealthy) {
            throw new Error('Cảm biến nhiệt đang lỗi — Khóa không cho phép bật bộ gia nhiệt.');
          }
          if (!confirmDangerous) {
            throw new Error('Bắt buộc xác nhận an toàn trước khi bật gia nhiệt từ xa.');
          }
          if (value.targetTempC !== undefined) {
            const reqT = Math.min(this.grill.maxTempLimitC, Math.max(40, Number(value.targetTempC)));
            this.grill.targetTempC = reqT;
          }
          this.grill.overheatAlert = false;
          this.grill.powerLossBlocked = false;
          this.grill.safetyLockReason = null;
          this.grill.alarmActive = false;
          this.grill.heaterOn = true;
          this.grill.fanOn = true;
          this.grill.grillState = this.grill.currentTempC >= this.grill.targetTempC - 4 ? 'Đang nướng' : 'Đang làm nóng';
          updateProjectStatus('grill', 'connected', 'Đang kết nối');
          updateTaskState('grill_heater', { enabled: true, statusText: `Gia nhiệt -> ${this.grill.targetTempC}°C` });
          updateTaskState('grill_fan', { enabled: true, statusText: `Đang chạy (${this.grill.fanSpeed}%)` });
          break;
        }
        case 'pause_grill': {
          this.grill.heaterOn = false;
          this.grill.grillState = 'Đang tắt';
          updateTaskState('grill_heater', { enabled: false, statusText: 'Tạm dừng' });
          break;
        }
        case 'stop_grill': {
          this.grill.heaterOn = false;
          this.grill.rotisserieOn = false;
          this.grill.timerEnabled = false;
          this.grill.alarmActive = false;
          this.grill.grillState = 'Đang tắt';
          updateProjectStatus('grill', 'off', 'Đang tắt');
          updateTaskState('grill_heater', { enabled: false, statusText: 'Đang tắt' });
          updateTaskState('grill_rotisserie', { enabled: false, statusText: 'Đang tắt' });
          break;
        }
        case 'emergency_stop': {
          this.grill.heaterOn = false;
          this.grill.rotisserieOn = false;
          this.grill.timerEnabled = false;
          this.grill.fanOn = true;
          this.grill.fanSpeed = 100;
          this.grill.grillState = 'Đang tắt';
          this.grill.safetyLockReason = 'Đã kích hoạt DỪNG KHẨN CẤP bếp nướng.';
          updateProjectStatus('grill', 'warning', 'Dừng khẩn cấp');
          updateTaskState('grill_heater', { enabled: false, statusText: 'Ngắt khẩn cấp' });
          updateTaskState('grill_fan', { enabled: true, statusText: 'Làm mát 100%' });
          addNotification({
            projectId: 'grill',
            severity: 'danger',
            title: 'Dừng khẩn cấp Bếp nướng thông minh',
            message: 'Đã ngắt bộ gia nhiệt và động cơ quay, bật quạt làm mát 100%.',
          });
          break;
        }
        case 'toggle_fan': {
          this.grill.fanOn = Boolean(value.on);
          if (value.speed !== undefined) {
            this.grill.fanSpeed = Math.min(100, Math.max(20, Number(value.speed)));
          }
          updateTaskState('grill_fan', {
            enabled: this.grill.fanOn,
            statusText: this.grill.fanOn ? `Đang chạy (${this.grill.fanSpeed}%)` : 'Đang tắt',
          });
          break;
        }
        case 'toggle_rotisserie': {
          this.grill.rotisserieOn = Boolean(value.on);
          updateTaskState('grill_rotisserie', {
            enabled: this.grill.rotisserieOn,
            statusText: this.grill.rotisserieOn ? 'Đang quay đều' : 'Đang tắt',
          });
          break;
        }
        case 'set_target_temp': {
          const req = Math.round(Number(value.targetTempC ?? 180));
          if (req > this.grill.maxTempLimitC) {
            throw new Error(`Nhiệt độ mục tiêu (${req}°C) vượt giới hạn tối đa ${this.grill.maxTempLimitC}°C.`);
          }
          this.grill.targetTempC = Math.max(40, req);
          this.grill.presetMode = 'custom';
          break;
        }
        case 'set_max_temp': {
          const maxT = Math.min(280, Math.max(100, Math.round(Number(value.maxTempLimitC ?? 250))));
          this.grill.maxTempLimitC = maxT;
          if (this.grill.targetTempC > maxT) this.grill.targetTempC = maxT;
          updateProjectSafetyConfig('grill', { maxTempLimitC: maxT });
          updateTaskState('grill_alert', { statusText: `Đang giám sát (<${maxT}°C)` });
          break;
        }
        case 'save_favorite_temp': {
          const fav = Math.min(this.grill.maxTempLimitC, Math.max(40, Math.round(Number(value.tempC ?? this.grill.targetTempC))));
          if (!this.grill.favorites.includes(fav)) {
            this.grill.favorites = [...this.grill.favorites.slice(-3), fav];
          }
          break;
        }
        case 'set_timer': {
          const sec = Math.min(7200, Math.max(10, Math.round(Number(value.seconds ?? 900))));
          this.grill.timerTotalSec = sec;
          this.grill.timerRemainingSec = sec;
          this.grill.timerEnabled = value.enabled !== undefined ? Boolean(value.enabled) : true;
          this.grill.alarmActive = false;
          updateTaskState('grill_timer', {
            enabled: this.grill.timerEnabled,
            statusText: `${formatSeconds(sec)} · ${this.grill.timerEnabled ? 'Đang đếm' : 'Chờ'}`,
          });
          break;
        }
        case 'select_preset': {
          const preset = String(value.preset || 'custom') as GrillPreset;
          const presetMap: Record<GrillPreset, { temp: number; sec: number; rotisserie: boolean }> = {
            custom: { temp: this.grill.targetTempC, sec: this.grill.timerTotalSec, rotisserie: this.grill.rotisserieOn },
            meat: { temp: 210, sec: 900, rotisserie: false },
            chicken: { temp: 195, sec: 1500, rotisserie: true },
            fish: { temp: 175, sec: 720, rotisserie: false },
            veggies: { temp: 160, sec: 480, rotisserie: false },
            keep_warm: { temp: 70, sec: 1800, rotisserie: false },
          };
          const cfg = presetMap[preset] || presetMap.custom;
          this.grill.presetMode = preset;
          this.grill.targetTempC = Math.min(this.grill.maxTempLimitC, cfg.temp);
          this.grill.timerTotalSec = cfg.sec;
          this.grill.timerRemainingSec = cfg.sec;
          this.grill.rotisserieOn = cfg.rotisserie;
          updateTaskState('grill_rotisserie', {
            enabled: cfg.rotisserie,
            statusText: cfg.rotisserie ? 'Đang quay đều' : 'Đang tắt',
          });
          break;
        }
        case 'toggle_sensor_fault': {
          const healthy = Boolean(value.healthy);
          this.grill.sensorHealthy = healthy;
          if (!healthy) {
            this.grill.heaterOn = false;
            this.grill.grillState = 'Đang tắt';
            this.grill.safetyLockReason = 'Cảm biến nhiệt lỗi — Khóa gia nhiệt bắt buộc.';
            updateProjectStatus('grill', 'error', 'Lỗi cảm biến');
            addNotification({
              projectId: 'grill',
              severity: 'danger',
              title: 'Lỗi cảm biến nhiệt Bếp nướng',
              message: 'Phát hiện tín hiệu cảm biến K-Type bất thường. Đã khóa bộ gia nhiệt.',
            });
          } else {
            this.grill.safetyLockReason = null;
            this.grill.overheatAlert = false;
            updateProjectStatus('grill', this.grill.heaterOn ? 'connected' : 'off', this.grill.heaterOn ? 'Đang kết nối' : 'Đang tắt');
          }
          break;
        }
        case 'dismiss_alarm': {
          this.grill.alarmActive = false;
          this.grill.overheatAlert = false;
          this.grill.safetyLockReason = null;
          updateProjectStatus('grill', this.grill.heaterOn ? 'connected' : 'off', this.grill.heaterOn ? 'Đang kết nối' : 'Đang tắt');
          break;
        }
        default:
          throw new Error(`Lệnh Bếp nướng không hợp lệ: ${action}`);
      }
      this.grill.updatedAt = nowIso();
    }
  }
}

function formatSeconds(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export const engine = new StemEngine();
