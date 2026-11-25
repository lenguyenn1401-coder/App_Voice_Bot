import { GoogleGenAI, Type, type Tool } from '@google/genai';
import { addDaysIso, getCalendarEventById, listCalendarEvents, vnIsoNow, vnTodayDateStr } from './db.ts';
import type {
  PendingCalendarProposal,
  PendingVoiceCommand,
  SmartGrillState,
  StemCarState,
  VoiceBotMode,
  VoiceBotPreferences,
} from '../src/types.ts';

const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || '').trim();
const DEFAULT_GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-4-hydrogen';

export const isAiConfigured = Boolean(GEMINI_API_KEY);

const aiClient = GEMINI_API_KEY
  ? new GoogleGenAI({
      apiKey: GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    })
  : null;

export interface VoiceAnalysisResult {
  reply: string;
  detectedCommand: PendingVoiceCommand | null;
  requiresConfirmation: boolean;
  calendarProposal: PendingCalendarProposal | null;
}

function normalizeVi(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .trim();
}

export function parseVoiceDeviceIntent(
  input: string,
  car: StemCarState,
  grill: SmartGrillState
): { command: PendingVoiceCommand | null; requiresConfirmation: boolean; immediateText?: string } {
  const norm = normalizeVi(input);

  // 1. Emergency stop
  if (norm.includes('dung khan cap') || norm.includes('emergency stop')) {
    return {
      command: {
        projectId: 'car',
        taskId: 'car_drive',
        action: 'emergency_stop',
        value: {},
        humanLabel: 'Dừng khẩn cấp Xe STEM',
        reason: 'Lệnh dừng an toàn',
      },
      requiresConfirmation: false,
    };
  }

  // 2. Voice Bot ESP32-S3 GPIO / LCD / Servo commands
  if (norm.includes('den bao') || norm.includes('led trang thai')) {
    const on = !norm.includes('tat');
    return {
      command: {
        projectId: 'voicebot',
        taskId: 'vb_ai_cmd',
        action: 'set_gpio',
        value: { led_status: on },
        humanLabel: `${on ? 'Bật' : 'Tắt'} đèn báo trạng thái trên Voice Bot ESP32-S3`,
        reason: 'Điều khiển GPIO Voice Bot',
      },
      requiresConfirmation: false,
    };
  }
  if (norm.includes('relay')) {
    const on = !norm.includes('tat');
    return {
      command: {
        projectId: 'voicebot',
        taskId: 'vb_ai_cmd',
        action: 'set_gpio',
        value: { relay_lab: on },
        humanLabel: `${on ? 'Bật' : 'Tắt'} Relay nguồn thực hành trên Voice Bot`,
        reason: 'Điều khiển Relay GPIO',
      },
      requiresConfirmation: false,
    };
  }
  if (norm.includes('coi bao') || norm.includes('buzzer')) {
    const on = !norm.includes('tat');
    return {
      command: {
        projectId: 'voicebot',
        taskId: 'vb_ai_cmd',
        action: 'set_gpio',
        value: { buzzer_alert: on },
        humanLabel: `${on ? 'Bật' : 'Tắt'} còi cảnh báo Voice Bot`,
        reason: 'Điều khiển còi GPIO',
      },
      requiresConfirmation: false,
    };
  }
  if (norm.includes('man hinh')) {
    const mode = norm.includes('dong ho')
      ? 'clock'
      : norm.includes('bieu cam')
      ? 'emotion'
      : norm.includes('nghi')
      ? 'sleep'
      : 'schedule';
    return {
      command: {
        projectId: 'voicebot',
        taskId: 'vb_ai_cmd',
        action: 'set_display_mode',
        value: { displayMode: mode },
        humanLabel: `Chuyển màn hình ST7789 sang chế độ ${mode}`,
        reason: 'Điều khiển hiển thị LCD',
      },
      requiresConfirmation: false,
    };
  }

  // 3. Car direction & speed
  if (norm.includes('xe tien') || norm.includes('tien len') || norm.includes('car forward')) {
    return {
      command: {
        projectId: 'car',
        taskId: 'car_drive',
        action: 'move',
        value: { direction: 'forward', speed: car.speed || 55 },
        humanLabel: `Xe STEM tiến lên (tốc độ ${car.speed || 55}%)`,
        reason: 'Điều khiển chuyển động xe',
      },
      requiresConfirmation: false,
    };
  }
  if (norm.includes('xe lui') || norm.includes('lui lai') || norm.includes('car backward')) {
    return {
      command: {
        projectId: 'car',
        taskId: 'car_drive',
        action: 'move',
        value: { direction: 'backward', speed: car.speed || 50 },
        humanLabel: `Xe STEM lùi lại (tốc độ ${car.speed || 50}%)`,
        reason: 'Điều khiển chuyển động xe',
      },
      requiresConfirmation: false,
    };
  }
  if (norm.includes('dung xe') || norm.includes('xe dung')) {
    return {
      command: {
        projectId: 'car',
        taskId: 'car_drive',
        action: 'stop',
        value: {},
        humanLabel: 'Dừng Xe STEM',
        reason: 'Dừng chuyển động',
      },
      requiresConfirmation: false,
    };
  }

  // 4. Servo angle
  if (norm.includes('servo') && (norm.includes('trai') || norm.includes('left'))) {
    return {
      command: {
        projectId: 'car',
        taskId: 'car_servo',
        action: 'set_servo',
        value: { angle: 35 },
        humanLabel: 'Quay servo xe STEM sang trái (35°)',
        reason: 'Điều chỉnh góc lái servo',
      },
      requiresConfirmation: false,
    };
  }
  if (norm.includes('servo') && (norm.includes('phai') || norm.includes('right'))) {
    return {
      command: {
        projectId: 'car',
        taskId: 'car_servo',
        action: 'set_servo',
        value: { angle: 145 },
        humanLabel: 'Quay servo xe STEM sang phải (145°)',
        reason: 'Điều chỉnh góc lái servo',
      },
      requiresConfirmation: false,
    };
  }
  if (norm.includes('servo') && (norm.includes('giua') || norm.includes('center'))) {
    return {
      command: {
        projectId: 'car',
        taskId: 'car_servo',
        action: 'set_servo',
        value: { angle: 90 },
        humanLabel: 'Đưa servo về giữa (90°)',
        reason: 'Cân bằng góc lái servo',
      },
      requiresConfirmation: false,
    };
  }

  // 5. Read grill temperature
  if (
    (norm.includes('nhiet do') || norm.includes('temperature')) &&
    (norm.includes('bep') || norm.includes('grill') || norm.includes('doc'))
  ) {
    return {
      command: null,
      requiresConfirmation: false,
      immediateText: `Nhiệt độ hiện tại của Bếp nướng thông minh là ${grill.currentTempC.toFixed(1)}°C (mục tiêu ${grill.targetTempC}°C, trạng thái: ${grill.grillState}, quạt: ${grill.fanOn ? 'Đang bật' : 'Đang tắt'}).`,
    };
  }

  // 6. Cooling fan control
  if (norm.includes('bat quat') || norm.includes('fan on')) {
    return {
      command: {
        projectId: 'grill',
        taskId: 'grill_fan',
        action: 'toggle_fan',
        value: { on: true, speed: 80 },
        humanLabel: 'Bật quạt làm mát Bếp nướng (80%)',
        reason: 'Điều khiển quạt đối lưu',
      },
      requiresConfirmation: false,
    };
  }
  if (norm.includes('tat quat') || norm.includes('fan off')) {
    return {
      command: {
        projectId: 'grill',
        taskId: 'grill_fan',
        action: 'toggle_fan',
        value: { on: false },
        humanLabel: 'Tắt quạt Bếp nướng',
        reason: 'Điều khiển quạt đối lưu',
      },
      requiresConfirmation: false,
    };
  }

  // 7. HAZARDOUS temperature/heater commands -> MUST require confirmation!
  const tempMatch = norm.match(/(\d{2,3})\s*(do|c)/);
  if (
    norm.includes('bat bep') ||
    norm.includes('gia nhiet') ||
    norm.includes('turn on grill') ||
    norm.includes('tang nhiet') ||
    (norm.includes('nuong') && tempMatch)
  ) {
    const requestedTemp = tempMatch ? Math.min(250, Math.max(50, Number(tempMatch[1]))) : grill.targetTempC;
    return {
      command: {
        projectId: 'grill',
        taskId: 'grill_heater',
        action: 'start_grill',
        value: { targetTempC: requestedTemp, confirmDangerous: true },
        humanLabel: `Bật bộ gia nhiệt Bếp nướng lên ${requestedTemp}°C`,
        reason: 'Lệnh liên quan đến sinh nhiệt cao (bắt buộc xác nhận an toàn trước khi kích hoạt rơ-le gia nhiệt).',
      },
      requiresConfirmation: true,
    };
  }

  if (norm.includes('tat bep') || norm.includes('turn off grill')) {
    return {
      command: {
        projectId: 'grill',
        taskId: 'grill_heater',
        action: 'stop_grill',
        value: {},
        humanLabel: 'Tắt Bếp nướng thông minh',
        reason: 'Ngắt gia nhiệt an toàn',
      },
      requiresConfirmation: false,
    };
  }

  return { command: null, requiresConfirmation: false };
}

function checkCalendarIntentFallback(prompt: string, userId: string): VoiceAnalysisResult | null {
  const norm = normalizeVi(prompt);
  const isScheduleQuery =
    norm.includes('lich') || norm.includes('nhac lich') || norm.includes('thoi khoa bieu') || norm.includes('su kien');
  if (!isScheduleQuery) return null;

  const today = vnTodayDateStr();
  const tomorrow = addDaysIso(today, 1);

  const extractTime = (s: string): { hour: number; min: number } | null => {
    const colonMatch = s.match(/(\d{1,2}):(\d{2})/);
    if (colonMatch) {
      return {
        hour: Math.min(22, Math.max(6, Number(colonMatch[1]))),
        min: Math.min(59, Math.max(0, Number(colonMatch[2]))),
      };
    }
    const hMatch = s.match(/(\d{1,2})\s*(?:h|gio)(?:\s*(\d{2}))?/);
    if (hMatch) {
      return {
        hour: Math.min(22, Math.max(6, Number(hMatch[1]))),
        min: hMatch[2] ? Math.min(59, Math.max(0, Number(hMatch[2]))) : 0,
      };
    }
    return null;
  };

  if (norm.includes('them lich') || norm.includes('dat lich') || norm.includes('tao lich')) {
    const parsedTime = extractTime(norm);
    const startHour = parsedTime ? parsedTime.hour : 16;
    const startMin = parsedTime ? parsedTime.min : 0;
    const endHour = Math.min(23, startHour + 1);
    const pad = (n: number) => String(n).padStart(2, '0');
    const date = norm.includes('ngay mai') ? tomorrow : today;
    const start = `${pad(startHour)}:${pad(startMin)}`;
    const end = `${pad(endHour)}:${pad(startMin)}`;
    const ev = {
      title: 'Thực hành STEM IoT (từ Voice Bot)',
      date,
      start,
      end,
      note: `Tạo từ câu lệnh: "${prompt}"`,
      remindMinutes: 10,
    };
    const existing = listCalendarEvents(date, date, userId);
    const conflict = existing.some((item) => item.start < ev.end && item.end > ev.start);
    return {
      reply: `Đề xuất thêm lịch "${ev.title}" vào ${ev.start}–${ev.end} ngày ${ev.date}${conflict ? ' (Lưu ý: có lịch trùng giờ)' : ''}. Vui lòng bấm Xác nhận hoặc Hủy bên dưới.`,
      detectedCommand: null,
      requiresConfirmation: false,
      calendarProposal: {
        action: 'propose_create',
        summary: `Thêm lịch: ${ev.title} (${ev.date}, ${ev.start}–${ev.end})${conflict ? ' — Cảnh báo trùng giờ' : ''}`,
        event: ev,
        conflict,
      },
    };
  }

  if (norm.includes('xoa lich') || norm.includes('huy lich')) {
    const todayEvents = listCalendarEvents(today, addDaysIso(today, 7), userId);
    const matched =
      todayEvents.find((ev) => norm.includes(normalizeVi(ev.title).slice(0, 12))) || todayEvents[0];
    if (!matched) {
      return {
        reply: 'Hiện không tìm thấy lịch phù hợp trong 7 ngày tới để xóa.',
        detectedCommand: null,
        requiresConfirmation: false,
        calendarProposal: null,
      };
    }
    return {
      reply: `Đề xuất xóa lịch "${matched.title}" (${matched.start}–${matched.end} ngày ${matched.date}). Vui lòng bấm Xác nhận hoặc Hủy bên dưới.`,
      detectedCommand: null,
      requiresConfirmation: false,
      calendarProposal: {
        action: 'propose_delete',
        eventId: matched.id,
        revision: matched.revision,
        summary: `Xóa lịch: ${matched.title} (${matched.date}, ${matched.start}–${matched.end})`,
      },
    };
  }

  if (norm.includes('sua lich') || norm.includes('doi gio') || norm.includes('doi lich')) {
    const todayEvents = listCalendarEvents(today, addDaysIso(today, 7), userId);
    const target =
      todayEvents.find((ev) => norm.includes(normalizeVi(ev.title).slice(0, 12))) || todayEvents[0];
    const parsedTime = extractTime(norm);
    if (!target || !parsedTime) {
      return {
        reply: target
          ? `Để đổi giờ lịch "${target.title}", hãy nhập giờ mới (ví dụ: "Đổi giờ lịch sang 15:30" hoặc "15h").`
          : 'Không tìm thấy lịch để sửa.',
        detectedCommand: null,
        requiresConfirmation: false,
        calendarProposal: null,
      };
    }
    const startHour = parsedTime.hour;
    const startMin = parsedTime.min;
    const endHour = Math.min(23, startHour + 1);
    const pad = (n: number) => String(n).padStart(2, '0');
    const start = `${pad(startHour)}:${pad(startMin)}`;
    const end = `${pad(endHour)}:${pad(startMin)}`;
    const existing = listCalendarEvents(target.date, target.date, userId);
    const conflict = existing.some((item) => item.id !== target.id && item.start < end && item.end > start);
    return {
      reply: `Đề xuất dời lịch "${target.title}" ngày ${target.date} sang ${start}–${end}${conflict ? ' (trùng giờ)' : ''}. Xác nhận hay hủy?`,
      detectedCommand: null,
      requiresConfirmation: false,
      calendarProposal: {
        action: 'propose_update',
        eventId: target.id,
        revision: target.revision,
        event: {
          title: target.title,
          date: target.date,
          start,
          end,
          note: target.note,
          remindMinutes: target.remindMinutes,
        },
        summary: `Sửa lịch: ${target.title} (${target.date}) ${target.start}–${target.end} → ${start}–${end}`,
        conflict,
      },
    };
  }

  const rangeEnd = norm.includes('tuan') ? addDaysIso(today, 6) : norm.includes('ngay mai') ? tomorrow : today;
  const rangeStart = norm.includes('ngay mai') && !norm.includes('hom nay') ? tomorrow : today;
  const events = listCalendarEvents(rangeStart, rangeEnd, userId);

  if (events.length === 0) {
    return {
      reply: `Trong khoảng từ ${rangeStart} đến ${rangeEnd} chưa có lịch thực hành nào.`,
      detectedCommand: null,
      requiresConfirmation: false,
      calendarProposal: null,
    };
  }

  const lines = events.map((e) => `• ${e.date} (${e.start}–${e.end}): ${e.title}`).join('\n');
  return {
    reply: `Lịch thực hành của bạn (${rangeStart}${rangeEnd !== rangeStart ? ` → ${rangeEnd}` : ''}):\n${lines}`,
    detectedCommand: null,
    requiresConfirmation: false,
    calendarProposal: null,
  };
}

function buildFallbackReply(
  prompt: string,
  mode: VoiceBotMode,
  language: 'vi' | 'en',
  car: StemCarState,
  grill: SmartGrillState,
  prefs?: VoiceBotPreferences
): string {
  const norm = normalizeVi(prompt);
  const botName = prefs?.assistantName || 'Trợ lý STEM';

  if (mode === 'english') {
    if (norm.includes('hello') || norm.includes('hi') || norm.includes('chao')) {
      return `Hello! I am ${botName}, your TP STEM English Tutor. Let us practice speaking about robotics and IoT. Can you tell me what sensor measures distance on our STEM Car?`;
    }
    return `Great practice! You said: "${prompt}". Tip: On our STEM projects, we use ultrasonic sensors (HC-SR04) for distance, servo motors for steering, and temperature probes for smart grilling.`;
  }

  if (mode === 'story') {
    return `Ngày xửa ngày xưa trong phòng Lab TP STEM, chú robot ${botName} (dùng màn hình ST7789 và loa MAX98357A) cùng chiếc Xe STEM 4 bánh đang phối hợp thực nghiệm. Cảm biến siêu âm phát hiện chướng ngại vật phía trước chỉ còn ${car.obstacleDistanceCm} cm, chú xe lập tức phanh an toàn để bảo vệ cả phòng thí nghiệm!`;
  }

  if (mode === 'quiz') {
    return `Câu đố STEM dành cho bạn: Trên bo mạch Voice Bot ESP32-S3, cặp chân GPIO nào điều khiển màn hình SPI ST7789 240×240 và loa MAX98357A?\nA) Đèn nền BL GPIO13, Loa LRCK 16 / BCLK 15 / DOUT 7\nB) Chỉ dùng 1 chân Analog\nC) Giao tiếp HDMI\nHãy nói hoặc nhập đáp án của bạn nhé!`;
  }

  if (mode === 'stem_qa') {
    if (norm.includes('esp32') || norm.includes('gpio') || norm.includes('pinout') || norm.includes('chan')) {
      return 'Sơ đồ chân ESP32-S3 Voice Bot: Micro I2S (WS=4, SCK=5, DIN=6 @ 16kHz), Loa MAX98357A (LRCK=16, BCLK=15, DOUT=7 @ 24kHz), Màn hình ST7789 240×240 (CLK=9, MOSI=10, RST=18, DC=8, CS=14, BL=13), Nút BOOT=0, VOL+=40, VOL-=39.';
    }
    if (norm.includes('servo')) {
      return 'Động cơ Servo sử dụng tín hiệu PWM 50Hz để giữ góc chính xác từ 0° đến 180°. Trên Xe STEM, góc 90° giúp xe đi thẳng chuẩn tâm.';
    }
    if (norm.includes('sieu am') || norm.includes('hc-sr04')) {
      return `Cảm biến siêu âm HC-SR04 đo khoảng cách bằng sóng 40kHz. Hiện tại Xe STEM đo được ${car.obstacleDistanceCm} cm.`;
    }
    if (norm.includes('pid') || norm.includes('nhiet') || norm.includes('bep')) {
      return `Bếp nướng thông minh đo nhiệt liên tục (${grill.currentTempC.toFixed(1)}°C) và tự ngắt rơ-le gia nhiệt nếu vượt ngưỡng ${grill.maxTempLimitC}°C.`;
    }
  }

  if (language === 'en') {
    return `${botName} received: "${prompt}". STEM Car battery is ${car.batteryPct}%, Smart Grill is ${grill.currentTempC.toFixed(1)}°C.`;
  }

  return `${botName} đã ghi nhận "${prompt}". Hệ thống đang giám sát Xe STEM (pin ${car.batteryPct}%, vật cản ${car.obstacleDistanceCm} cm) và Bếp nướng (${grill.currentTempC.toFixed(1)}°C). Bạn có thể hỏi lịch hôm nay, sơ đồ chân ESP32-S3 hoặc ra lệnh điều khiển thiết bị!`;
}

export async function generateVoiceBotReply(params: {
  prompt: string;
  mode: VoiceBotMode;
  language: 'vi' | 'en';
  car: StemCarState;
  grill: SmartGrillState;
  userId: string;
  prefs?: VoiceBotPreferences;
}): Promise<VoiceAnalysisResult> {
  const { prompt, mode, language, car, grill, userId, prefs } = params;

  // 1. Deterministic hardware command parser (Voice Bot GPIO/LCD, Xe STEM, Bếp nướng)
  const intent = parseVoiceDeviceIntent(prompt, car, grill);
  if (intent.immediateText) {
    return {
      reply: intent.immediateText,
      detectedCommand: null,
      requiresConfirmation: false,
      calendarProposal: null,
    };
  }
  if (intent.command) {
    if (intent.requiresConfirmation) {
      return {
        reply: `Cảnh báo an toàn: Bạn yêu cầu "${intent.command.humanLabel}". Vì lệnh này liên quan đến thiết bị sinh nhiệt, vui lòng bấm "Xác nhận thực hiện" trên màn hình để tiếp tục.`,
        detectedCommand: intent.command,
        requiresConfirmation: true,
        calendarProposal: null,
      };
    }
    return {
      reply: `Đã tiếp nhận lệnh: ${intent.command.humanLabel}. Hệ thống đang gửi tín hiệu điều khiển xuống thiết bị.`,
      detectedCommand: intent.command,
      requiresConfirmation: false,
      calendarProposal: null,
    };
  }

  // 2. Gemini API with Calendar Tools & ESP32-S3 STEM context (when configured)
  if (aiClient) {
    try {
      const today = vnTodayDateStr();
      const upcoming = listCalendarEvents(today, addDaysIso(today, 7), userId);
      const botName = prefs?.assistantName || 'Trợ lý STEM';
      const styleNote = prefs?.stylePrompt ? `\nPhong cách trả lời: ${prefs.stylePrompt}` : '';

      const systemInstruction = [
        `Bạn tên là ${botName}, trợ lý AI của hệ thống TP STEM Control (hỗ trợ lịch thực hành GMT+7, ESP32-S3 Voice Bot, Xe STEM và Bếp nướng thông minh).`,
        `Thông số phần cứng ESP32-S3: Micro I2S (WS=4, SCK=5, DIN=6), Loa MAX98357A (LRCK=16, BCLK=15, DOUT=7), ST7789 240x240 (CLK=9, MOSI=10, RST=18, DC=8, CS=14, BL=13).`,
        `Ngôn ngữ chính: ${language === 'en' ? 'English' : 'Tiếng Việt'}. Chế độ: ${mode}.${styleNote}`,
        `Thời gian hiện tại (Asia/Ho_Chi_Minh): ${vnIsoNow()}.`,
        `Lịch 7 ngày tới: ${JSON.stringify(upcoming.slice(0, 50))}`,
        `Dữ liệu thiết bị: Xe STEM (${car.online ? 'Online' : 'Offline'}, Pin ${car.batteryPct}%, Vật cản ${car.obstacleDistanceCm}cm); Bếp nướng (${grill.grillState}, ${grill.currentTempC.toFixed(1)}°C / ${grill.targetTempC}°C).`,
        'Nếu người dùng muốn thêm lịch mới, hãy gọi tool propose_create để chờ người dùng xác nhận trên giao diện.',
      ].join('\n');

      const tools: Tool[] = [
        {
          functionDeclarations: [
            {
              name: 'list_calendar',
              description: 'Đọc lịch từ cơ sở dữ liệu trong khoảng ngày YYYY-MM-DD.',
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
              description: 'Đề xuất thêm một lịch thực hành STEM mới (cần người dùng xác nhận).',
              parameters: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  date: { type: Type.STRING },
                  start: { type: Type.STRING },
                  end: { type: Type.STRING },
                  note: { type: Type.STRING },
                  remindMinutes: { type: Type.INTEGER },
                },
                required: ['title', 'date', 'start', 'end'],
              },
            },
            {
              name: 'propose_update',
              description: 'Đề xuất sửa đúng một lịch theo ID (cần người dùng xác nhận).',
              parameters: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  title: { type: Type.STRING },
                  date: { type: Type.STRING },
                  start: { type: Type.STRING },
                  end: { type: Type.STRING },
                  note: { type: Type.STRING },
                  remindMinutes: { type: Type.INTEGER },
                },
                required: ['id'],
              },
            },
            {
              name: 'propose_delete',
              description: 'Đề xuất xóa đúng một lịch theo ID (cần người dùng xác nhận).',
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

      const contents: Array<Record<string, unknown>> = [
        { role: 'user', parts: [{ text: prompt }] },
      ];

      for (let round = 0; round < 4; round++) {
        const response = await aiClient.models.generateContent({
          model: prefs?.model || DEFAULT_GEMINI_MODEL,
          contents: contents as unknown as string,
          config: {
            systemInstruction,
            tools,
          },
        });

        const candidate = response.candidates?.[0];
        const parts = candidate?.content?.parts || [];
        const calls = parts.filter((p) => p.functionCall).map((p) => p.functionCall!);

        if (calls.length === 0) {
          const text = response.text?.trim();
          if (text) {
            return {
              reply: text,
              detectedCommand: null,
              requiresConfirmation: false,
              calendarProposal: null,
            };
          }
          break;
        }

        const call = calls[0];
        const args = (call.args || {}) as Record<string, unknown>;

        if (call.name === 'list_calendar') {
          const startDate = String(args.start_date || today);
          const endDate = String(args.end_date || addDaysIso(today, 7));
          const foundEvents = listCalendarEvents(startDate, endDate, userId).slice(0, 100);
          if (candidate?.content) contents.push(candidate.content as unknown as Record<string, unknown>);
          contents.push({
            role: 'user',
            parts: [{ functionResponse: { name: 'list_calendar', response: { events: foundEvents } } }],
          });
          continue;
        }

        if (call.name === 'propose_create') {
          const ev = {
            title: String(args.title || 'Lịch thực hành STEM'),
            date: String(args.date || today),
            start: String(args.start || '09:00'),
            end: String(args.end || '10:00'),
            note: String(args.note || ''),
            remindMinutes: Number(args.remindMinutes ?? 10),
          };
          const existing = listCalendarEvents(ev.date, ev.date, userId);
          const conflict = existing.some((item) => item.start < ev.end && item.end > ev.start);
          return {
            reply: `Đề xuất tạo lịch: ${ev.title} (${ev.start}–${ev.end} ngày ${ev.date})${conflict ? ' — Có lịch trùng giờ' : ''}. Xác nhận hay hủy?`,
            detectedCommand: null,
            requiresConfirmation: false,
            calendarProposal: {
              action: 'propose_create',
              summary: `Thêm lịch: ${ev.title} (${ev.date}, ${ev.start}–${ev.end})`,
              event: ev,
              conflict,
            },
          };
        }

        if (call.name === 'propose_update') {
          const current = getCalendarEventById(String(args.id || ''));
          if (!current) {
            return {
              reply: 'Không tìm thấy mã lịch cần sửa. Bạn hãy kiểm tra lại nhé.',
              detectedCommand: null,
              requiresConfirmation: false,
              calendarProposal: null,
            };
          }
          const nextEv = {
            title: String(args.title ?? current.title),
            date: String(args.date ?? current.date),
            start: String(args.start ?? current.start),
            end: String(args.end ?? current.end),
            note: String(args.note ?? current.note),
            remindMinutes: Number(args.remindMinutes ?? current.remindMinutes),
          };
          const existing = listCalendarEvents(nextEv.date, nextEv.date, userId);
          const conflict = existing.some(
            (item) => item.id !== current.id && item.start < nextEv.end && item.end > nextEv.start
          );
          return {
            reply: `Đề xuất sửa lịch "${current.title}" (${current.date}, ${current.start}–${current.end}) thành "${nextEv.title}" (${nextEv.date}, ${nextEv.start}–${nextEv.end})${conflict ? ' — Có lịch trùng giờ' : ''}. Xác nhận hay hủy?`,
            detectedCommand: null,
            requiresConfirmation: false,
            calendarProposal: {
              action: 'propose_update',
              eventId: current.id,
              revision: current.revision,
              event: nextEv,
              summary: `Sửa lịch "${current.title}" → "${nextEv.title}" (${nextEv.date}, ${nextEv.start}–${nextEv.end})`,
              conflict,
            },
          };
        }

        if (call.name === 'propose_delete') {
          const current = getCalendarEventById(String(args.id || ''));
          if (!current) {
            return {
              reply: 'Không tìm thấy mã lịch cần xóa.',
              detectedCommand: null,
              requiresConfirmation: false,
              calendarProposal: null,
            };
          }
          return {
            reply: `Đề xuất xóa lịch "${current.title}" (${current.start}–${current.end} ngày ${current.date}). Xác nhận hay hủy?`,
            detectedCommand: null,
            requiresConfirmation: false,
            calendarProposal: {
              action: 'propose_delete',
              eventId: current.id,
              revision: current.revision,
              summary: `Xóa lịch: ${current.title} (${current.date}, ${current.start}–${current.end})`,
            },
          };
        }
      }
    } catch {
      // Fallback gracefully below
    }
  }

  // 3. Calendar offline fallback
  const calFallback = checkCalendarIntentFallback(prompt, userId);
  if (calFallback) return calFallback;

  // 4. General STEM offline fallback
  return {
    reply: buildFallbackReply(prompt, mode, language, car, grill, prefs),
    detectedCommand: null,
    requiresConfirmation: false,
    calendarProposal: null,
  };
}
