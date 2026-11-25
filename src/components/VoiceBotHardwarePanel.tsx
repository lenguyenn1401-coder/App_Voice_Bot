import React, { useEffect, useState } from 'react';
import {
  BellRing,
  Check,
  Copy,
  Cpu,
  Lightbulb,
  Monitor,
  Plus,
  Power,
  Radio,
  Trash2,
  Volume2,
  VolumeX,
  Wifi,
} from 'lucide-react';
import { apiFetch, triggerHaptic } from '../lib/api';
import type { DisplayMode, PairedDeviceInfo, RealtimeSnapshot, VoiceBotState } from '../types';

interface VoiceBotHardwarePanelProps {
  voicebot: VoiceBotState;
  onSnapshotUpdate: (snap: RealtimeSnapshot) => void;
  selectedDeviceId: string;
  onSelectDeviceId: (id: string) => void;
}

const DISPLAY_MODES: Array<{ id: DisplayMode; label: string; desc: string }> = [
  { id: 'schedule', label: 'Lịch trình', desc: 'Hiển thị nhắc lịch trên ST7789' },
  { id: 'clock', label: 'Đồng hồ', desc: 'Đồng hồ số GMT+7 toàn màn hình' },
  { id: 'emotion', label: 'Biểu cảm', desc: 'Mắt robot phản ứng theo giọng nói' },
  { id: 'sleep', label: 'Nghỉ màn hình', desc: 'Giảm sáng và chờ đánh thức' },
];

export const VoiceBotHardwarePanel: React.FC<VoiceBotHardwarePanelProps> = ({
  voicebot,
  onSnapshotUpdate,
  selectedDeviceId,
  onSelectDeviceId,
}) => {
  const [pairedDevices, setPairedDevices] = useState<PairedDeviceInfo[]>([]);
  const [volumeDraft, setVolumeDraft] = useState(voicebot.volume);
  const [backlightDraft, setBacklightDraft] = useState(voicebot.backlight);
  const [servoDraft, setServoDraft] = useState(voicebot.gpioOutputs.servo_angle);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [testingReminder, setTestingReminder] = useState(false);

  // Pair Modal state
  const [showPairModal, setShowPairModal] = useState(false);
  const [pairId, setPairId] = useState('');
  const [pairName, setPairName] = useState('');
  const [pairingBusy, setPairingBusy] = useState(false);
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState(false);

  useEffect(() => {
    setVolumeDraft(voicebot.volume);
  }, [voicebot.volume]);

  useEffect(() => {
    setBacklightDraft(voicebot.backlight);
  }, [voicebot.backlight]);

  useEffect(() => {
    setServoDraft(voicebot.gpioOutputs.servo_angle);
  }, [voicebot.gpioOutputs.servo_angle]);

  useEffect(() => {
    loadPairedDevices();
  }, []);

  async function loadPairedDevices() {
    try {
      const res = await apiFetch<{ devices: PairedDeviceInfo[] }>('/api/paired-devices');
      setPairedDevices(res.devices);
      if (res.devices.length > 0 && !res.devices.some((d) => d.deviceId === selectedDeviceId)) {
        onSelectDeviceId(res.devices[0].deviceId);
      }
    } catch {
      // ignore
    }
  }

  async function sendVoicebotCommand(action: string, value: Record<string, unknown>, taskId = 'vb_ai_cmd') {
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await apiFetch<{ snapshot: RealtimeSnapshot }>('/api/commands', {
        method: 'POST',
        body: JSON.stringify({
          projectId: 'voicebot',
          taskId,
          action,
          value,
        }),
      });
      onSnapshotUpdate(res.snapshot);
      triggerHaptic(16);
      if (res.snapshot.voicebot.lastCommandSummary) {
        setStatusMsg(`Đã gửi lệnh: ${res.snapshot.voicebot.lastCommandSummary}`);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Lỗi gửi lệnh ESP32-S3.');
    }
  }

  async function handleTestReminder() {
    setTestingReminder(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const targetId = selectedDeviceId || 'esp32s3-stem-01';
      const res = await apiFetch<{ snapshot: RealtimeSnapshot }>(
        `/api/iot/devices/${encodeURIComponent(targetId)}/test-reminder`,
        { method: 'POST', body: JSON.stringify({}) }
      );
      onSnapshotUpdate(res.snapshot);
      triggerHaptic([20, 40, 20]);
      setStatusMsg('Đã gửi yêu cầu phát thử nhắc lịch xuống thiết bị ESP32-S3.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Không thể phát thử nhắc lịch.');
    } finally {
      setTestingReminder(false);
    }
  }

  async function handleCreatePairedDevice(e: React.FormEvent) {
    e.preventDefault();
    if (!pairId.trim()) return;
    setPairingBusy(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch<{ device: PairedDeviceInfo; token: string }>('/api/paired-devices', {
        method: 'POST',
        body: JSON.stringify({ deviceId: pairId.trim(), name: pairName.trim() || 'Kit STEM ESP32-S3' }),
      });
      setIssuedToken(res.token);
      setCopiedToken(false);
      await loadPairedDevices();
      onSelectDeviceId(res.device.deviceId);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Không thể ghép nối thiết bị mới.');
    } finally {
      setPairingBusy(false);
    }
  }

  async function handleDeletePaired(id: string) {
    try {
      await apiFetch(`/api/paired-devices/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await loadPairedDevices();
      setStatusMsg(`Đã gỡ thiết bị ${id}.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Không thể gỡ thiết bị.');
    }
  }

  const selectedDevice = pairedDevices.find((d) => d.deviceId === selectedDeviceId) || pairedDevices[0];

  return (
    <div className="space-y-5">
      {/* Device Selector & Pairing Bar */}
      <div className="p-4 rounded-xl bg-white dark:bg-[#131C2A] border border-slate-200/80 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-[#0F62FE] flex items-center justify-center shrink-0">
            <Cpu className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Thiết bị ESP32-S3 đang điều khiển</div>
            <div className="flex items-center gap-2 mt-0.5">
              <select
                value={selectedDeviceId}
                onChange={(e) => onSelectDeviceId(e.target.value)}
                className="h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B111A] text-sm font-semibold"
              >
                {pairedDevices.length === 0 && <option value="esp32s3-stem-01">Board ESP32-S3 Voice Bot #01</option>}
                {pairedDevices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.name} ({d.deviceId})
                  </option>
                ))}
              </select>
              <span
                className={`inline-flex items-center gap-1.5 text-xs font-semibold ${
                  (selectedDevice?.online ?? voicebot.online) ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600'
                }`}
              >
                <Wifi className="w-3.5 h-3.5" />
                {(selectedDevice?.online ?? voicebot.online) ? 'Trực tuyến' : 'Ngoại tuyến'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={testingReminder}
            onClick={handleTestReminder}
            className="h-10 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B111A] hover:bg-blue-50 dark:hover:bg-blue-950/30 text-sm font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <BellRing className="w-4 h-4 text-[#0F62FE]" />
            <span>{testingReminder ? 'Đang phát thử...' : 'Phát thử nhắc lịch'}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setPairId('');
              setPairName('');
              setIssuedToken(null);
              setShowPairModal(true);
            }}
            className="h-10 px-3.5 rounded-xl bg-[#0F62FE] hover:bg-blue-700 text-white text-sm font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Ghép nối mạch mới</span>
          </button>
        </div>
      </div>

      {statusMsg && (
        <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 text-sm text-emerald-700 dark:text-emerald-300">
          {statusMsg}
        </div>
      )}
      {errorMsg && (
        <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-sm text-red-700 dark:text-red-300">
          {errorMsg}
        </div>
      )}

      {/* Telemetry & Last Command Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="p-3.5 rounded-xl bg-white dark:bg-[#131C2A] border border-slate-200/80 dark:border-slate-800">
          <div className="text-xs text-slate-500 dark:text-slate-400">Wi-Fi RSSI</div>
          <div className="mt-1 text-base font-mono font-bold tabular-nums">{voicebot.telemetry.wifiRssi} dBm</div>
        </div>
        <div className="p-3.5 rounded-xl bg-white dark:bg-[#131C2A] border border-slate-200/80 dark:border-slate-800">
          <div className="text-xs text-slate-500 dark:text-slate-400">Octal PSRAM trống</div>
          <div className="mt-1 text-base font-mono font-bold tabular-nums">{voicebot.telemetry.freePsramKb} KB</div>
        </div>
        <div className="p-3.5 rounded-xl bg-white dark:bg-[#131C2A] border border-slate-200/80 dark:border-slate-800">
          <div className="text-xs text-slate-500 dark:text-slate-400">Nhiệt độ SoC ESP32-S3</div>
          <div className="mt-1 text-base font-mono font-bold tabular-nums">{voicebot.telemetry.cpuTempC.toFixed(1)} °C</div>
        </div>
        <div className="p-3.5 rounded-xl bg-white dark:bg-[#131C2A] border border-slate-200/80 dark:border-slate-800">
          <div className="text-xs text-slate-500 dark:text-slate-400">Lệnh gần nhất</div>
          <div className="mt-1 text-sm font-semibold truncate">{voicebot.lastCommandSummary || 'Chưa gửi lệnh'}</div>
        </div>
      </div>

      {/* Audio + ST7789 LCD + GPIO Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Audio MAX98357A & ST7789 240x240 LCD */}
        <div className="p-5 rounded-xl bg-white dark:bg-[#131C2A] border border-slate-200/80 dark:border-slate-800 space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold flex items-center gap-2">
              <Monitor className="w-4 h-4 text-[#0F62FE]" /> Âm thanh MAX98357A & Màn hình ST7789
            </h3>
            <button
              type="button"
              onClick={() => sendVoicebotCommand('set_muted', { muted: !voicebot.muted }, 'vb_speaker')}
              className={`h-9 px-3 rounded-lg border text-xs font-semibold flex items-center gap-1.5 cursor-pointer ${
                voicebot.muted
                  ? 'border-red-300 bg-red-50 dark:bg-red-950/30 text-red-600'
                  : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              {voicebot.muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
              <span>{voicebot.muted ? 'Đang tắt tiếng' : 'Tắt tiếng nhanh'}</span>
            </button>
          </div>

          {/* Volume Slider */}
          <div>
            <div className="flex justify-between text-xs font-medium mb-1.5">
              <span>Âm lượng loa MAX98357A (GPIO 16/15/7)</span>
              <span className="font-mono font-bold tabular-nums">{volumeDraft}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={volumeDraft}
              onChange={(e) => setVolumeDraft(Number(e.target.value))}
              onMouseUp={() => sendVoicebotCommand('set_volume', { volume: volumeDraft }, 'vb_speaker')}
              onTouchEnd={() => sendVoicebotCommand('set_volume', { volume: volumeDraft }, 'vb_speaker')}
              className="w-full accent-[#0F62FE]"
            />
          </div>

          {/* ST7789 Backlight Slider */}
          <div>
            <div className="flex justify-between text-xs font-medium mb-1.5">
              <span>Độ sáng đèn nền LCD ST7789 (BL GPIO13)</span>
              <span className="font-mono font-bold tabular-nums">{backlightDraft}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={backlightDraft}
              onChange={(e) => setBacklightDraft(Number(e.target.value))}
              onMouseUp={() => sendVoicebotCommand('set_backlight', { backlight: backlightDraft })}
              onTouchEnd={() => sendVoicebotCommand('set_backlight', { backlight: backlightDraft })}
              className="w-full accent-[#0F62FE]"
            />
          </div>

          {/* Display Modes */}
          <div>
            <div className="text-xs font-medium mb-2">Chế độ hiển thị màn hình 240×240</div>
            <div className="grid grid-cols-2 gap-2">
              {DISPLAY_MODES.map((dm) => {
                const active = voicebot.displayMode === dm.id;
                return (
                  <button
                    key={dm.id}
                    type="button"
                    onClick={() => sendVoicebotCommand('set_display_mode', { displayMode: dm.id })}
                    className={`p-2.5 rounded-lg border text-left cursor-pointer transition-colors ${
                      active
                        ? 'border-[#0F62FE] bg-blue-50/80 dark:bg-blue-950/40 text-[#0F62FE] dark:text-blue-300'
                        : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                    }`}
                  >
                    <div className="text-xs font-bold">{dm.label}</div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{dm.desc}</div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* GPIO Outputs & Servo Actuator */}
        <div className="p-5 rounded-xl bg-white dark:bg-[#131C2A] border border-slate-200/80 dark:border-slate-800 space-y-5">
          <h3 className="text-sm font-bold flex items-center gap-2">
            <Radio className="w-4 h-4 text-[#0F62FE]" /> Điều khiển GPIO & Cơ cấu chấp hành
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <button
              type="button"
              onClick={() =>
                sendVoicebotCommand('set_gpio', { led_status: !voicebot.gpioOutputs.led_status })
              }
              className={`min-h-[84px] p-3.5 rounded-xl border text-left flex flex-col justify-between cursor-pointer transition-colors ${
                voicebot.gpioOutputs.led_status
                  ? 'border-emerald-500 bg-emerald-50/70 dark:bg-emerald-950/30'
                  : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40'
              }`}
            >
              <Lightbulb
                className={`w-5 h-5 ${
                  voicebot.gpioOutputs.led_status ? 'text-emerald-600' : 'text-slate-400'
                }`}
              />
              <div>
                <div className="text-xs font-bold">Đèn báo trạng thái</div>
                <div className="text-[11px] font-mono text-slate-500">
                  {voicebot.gpioOutputs.led_status ? 'Đang bật' : 'Đang tắt'}
                </div>
              </div>
            </button>

            <button
              type="button"
              onClick={() =>
                sendVoicebotCommand('set_gpio', { relay_lab: !voicebot.gpioOutputs.relay_lab })
              }
              className={`min-h-[84px] p-3.5 rounded-xl border text-left flex flex-col justify-between cursor-pointer transition-colors ${
                voicebot.gpioOutputs.relay_lab
                  ? 'border-[#0F62FE] bg-blue-50/70 dark:bg-blue-950/30'
                  : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40'
              }`}
            >
              <Power
                className={`w-5 h-5 ${
                  voicebot.gpioOutputs.relay_lab ? 'text-[#0F62FE]' : 'text-slate-400'
                }`}
              />
              <div>
                <div className="text-xs font-bold">Relay nguồn mạch</div>
                <div className="text-[11px] font-mono text-slate-500">
                  {voicebot.gpioOutputs.relay_lab ? 'Đang bật' : 'Đang tắt'}
                </div>
              </div>
            </button>

            <button
              type="button"
              onClick={() =>
                sendVoicebotCommand('set_gpio', { buzzer_alert: !voicebot.gpioOutputs.buzzer_alert })
              }
              className={`min-h-[84px] p-3.5 rounded-xl border text-left flex flex-col justify-between cursor-pointer transition-colors ${
                voicebot.gpioOutputs.buzzer_alert
                  ? 'border-amber-500 bg-amber-50/70 dark:bg-amber-950/30'
                  : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40'
              }`}
            >
              <BellRing
                className={`w-5 h-5 ${
                  voicebot.gpioOutputs.buzzer_alert ? 'text-amber-600' : 'text-slate-400'
                }`}
              />
              <div>
                <div className="text-xs font-bold">Còi cảnh báo</div>
                <div className="text-[11px] font-mono text-slate-500">
                  {voicebot.gpioOutputs.buzzer_alert ? 'Đang bật' : 'Đang tắt'}
                </div>
              </div>
            </button>
          </div>

          {/* Servo Slider */}
          <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
            <div className="flex justify-between text-xs font-medium mb-1.5">
              <span>Góc quay Servo thực hành gắn trên Voice Bot (0°–180°)</span>
              <span className="font-mono font-bold tabular-nums">{servoDraft}°</span>
            </div>
            <input
              type="range"
              min={0}
              max={180}
              value={servoDraft}
              onChange={(e) => setServoDraft(Number(e.target.value))}
              onMouseUp={() => sendVoicebotCommand('set_gpio', { servo_angle: servoDraft })}
              onTouchEnd={() => sendVoicebotCommand('set_gpio', { servo_angle: servoDraft })}
              className="w-full accent-[#0F62FE]"
            />
            <div className="mt-2 flex gap-2">
              {[0, 45, 90, 135, 180].map((ang) => (
                <button
                  key={ang}
                  type="button"
                  onClick={() => {
                    setServoDraft(ang);
                    sendVoicebotCommand('set_gpio', { servo_angle: ang });
                  }}
                  className="px-2.5 h-8 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-mono hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  {ang}°
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ESP32-S3 Pinout Table + Paired Devices List */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-7 p-5 rounded-xl bg-white dark:bg-[#131C2A] border border-slate-200/80 dark:border-slate-800">
          <h3 className="text-sm font-bold mb-3">Sơ đồ chân phần cứng ESP32-S3 (firmware/board/config.h)</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-[#0B111A] border-b border-slate-200 dark:border-slate-800 text-slate-500">
                <tr>
                  <th className="px-3 py-2">Thành phần</th>
                  <th className="px-3 py-2">Chân GPIO / Chuẩn</th>
                  <th className="px-3 py-2">Thông số</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                <tr>
                  <td className="px-3 py-2.5 font-medium">Micro I2S INMP441</td>
                  <td className="px-3 py-2.5 font-mono">WS 4 · SCK 5 · DIN 6</td>
                  <td className="px-3 py-2.5 font-mono">16 kHz mono</td>
                </tr>
                <tr>
                  <td className="px-3 py-2.5 font-medium">Loa MAX98357A</td>
                  <td className="px-3 py-2.5 font-mono">LRCK 16 · BCLK 15 · DOUT 7</td>
                  <td className="px-3 py-2.5 font-mono">24 kHz stereo</td>
                </tr>
                <tr>
                  <td className="px-3 py-2.5 font-medium">Màn hình ST7789</td>
                  <td className="px-3 py-2.5 font-mono">CLK 9 · MOSI 10 · RST 18 · DC 8 · CS 14 · BL 13</td>
                  <td className="px-3 py-2.5 font-mono">240×240 SPI</td>
                </tr>
                <tr>
                  <td className="px-3 py-2.5 font-medium">Nút bấm vật lý</td>
                  <td className="px-3 py-2.5 font-mono">BOOT 0 · VOL+ 40 · VOL- 39</td>
                  <td className="px-3 py-2.5">Ngắt phần cứng</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="lg:col-span-5 p-5 rounded-xl bg-white dark:bg-[#131C2A] border border-slate-200/80 dark:border-slate-800 space-y-3">
          <h3 className="text-sm font-bold">Thiết bị ESP32-S3 đã ghép nối</h3>
          <div className="space-y-2 max-h-52 overflow-y-auto">
            {pairedDevices.map((d) => (
              <div
                key={d.deviceId}
                className="p-2.5 rounded-lg bg-slate-50 dark:bg-[#0B111A] border border-slate-200/70 dark:border-slate-800 flex items-center justify-between gap-2 text-xs"
              >
                <div className="min-w-0">
                  <div className="font-semibold truncate">{d.name}</div>
                  <div className="font-mono text-[11px] text-slate-500">
                    {d.deviceId} · {d.online ? 'Trực tuyến' : 'Ngoại tuyến'}
                  </div>
                </div>
                {!d.simulated && (
                  <button
                    type="button"
                    onClick={() => handleDeletePaired(d.deviceId)}
                    className="h-8 px-2 rounded text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 flex items-center gap-1 cursor-pointer shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Gỡ
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Pair New Device Modal */}
      {showPairModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white dark:bg-[#131C2A] border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold">Ghép nối thiết bị ESP32-S3 mới</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Tạo mã token xác thực Bearer cho firmware kit STEM.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowPairModal(false)}
                className="w-8 h-8 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-lg cursor-pointer"
              >
                ×
              </button>
            </div>

            {!issuedToken ? (
              <form onSubmit={handleCreatePairedDevice} className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold mb-1">Mã thiết bị (Device-Id)</label>
                  <input
                    type="text"
                    required
                    value={pairId}
                    onChange={(e) => setPairId(e.target.value)}
                    placeholder="Ví dụ: esp32s3-lab-02"
                    className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B111A] text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Tên gợi nhớ</label>
                  <input
                    type="text"
                    required
                    value={pairName}
                    onChange={(e) => setPairName(e.target.value)}
                    placeholder="Ví dụ: Kit Voice Bot bàn 2"
                    className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B111A] text-sm"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowPairModal(false)}
                    className="h-10 px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium cursor-pointer"
                  >
                    Hủy
                  </button>
                  <button
                    type="submit"
                    disabled={pairingBusy}
                    className="h-10 px-4 rounded-xl bg-[#0F62FE] text-white text-sm font-semibold cursor-pointer disabled:opacity-50"
                  >
                    {pairingBusy ? 'Đang tạo...' : 'Tạo mã kết nối'}
                  </button>
                </div>
              </form>
            ) : (
              <div className="space-y-3">
                <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 space-y-2">
                  <div className="text-xs font-bold text-amber-800 dark:text-amber-300">
                    Mã token chỉ hiển thị một lần
                  </div>
                  <div className="text-xs text-slate-600 dark:text-slate-300">
                    Sao chép và dán vào cấu hình Wi-Fi / NVS / header Bearer của ESP32-S3:
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 p-2 rounded bg-white dark:bg-[#0B111A] border border-slate-200 dark:border-slate-800 font-mono text-xs break-all">
                      {issuedToken}
                    </code>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(issuedToken);
                          setCopiedToken(true);
                        } catch {
                          // ignore
                        }
                      }}
                      className="h-9 px-3 rounded-lg bg-[#0F62FE] text-white text-xs font-semibold flex items-center gap-1 cursor-pointer shrink-0"
                    >
                      {copiedToken ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedToken ? 'Đã chép' : 'Sao chép'}</span>
                    </button>
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setShowPairModal(false)}
                    className="h-10 px-4 rounded-xl bg-[#0F62FE] text-white text-sm font-semibold cursor-pointer"
                  >
                    Hoàn tất
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
