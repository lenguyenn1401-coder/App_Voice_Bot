import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  BellRing,
  Clock,
  Fan,
  Flame,
  Minus,
  OctagonX,
  Pause,
  Play,
  Plus,
  Power,
  RotateCw,
  ShieldAlert,
  Thermometer,
} from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { apiFetch, triggerHaptic } from '../lib/api';
import type { GrillPreset, RealtimeSnapshot } from '../types';

interface SmartGrillViewProps {
  snapshot: RealtimeSnapshot;
  onBack: () => void;
  onSnapshotUpdate: (snap: RealtimeSnapshot) => void;
}

const PRESETS: Array<{ id: GrillPreset; label: string; temp: number; mins: number }> = [
  { id: 'meat', label: 'Nướng thịt', temp: 210, mins: 15 },
  { id: 'chicken', label: 'Nướng gà', temp: 195, mins: 25 },
  { id: 'fish', label: 'Nướng cá', temp: 175, mins: 12 },
  { id: 'veggies', label: 'Nướng rau', temp: 160, mins: 8 },
  { id: 'keep_warm', label: 'Giữ ấm', temp: 70, mins: 30 },
  { id: 'custom', label: 'Tùy chỉnh', temp: 180, mins: 15 },
];

export const SmartGrillView: React.FC<SmartGrillViewProps> = ({
  snapshot,
  onBack,
  onSnapshotUpdate,
}) => {
  const { grill, tasks } = snapshot;
  const grillTasks = tasks.filter((t) => t.projectId === 'grill');

  const [targetInput, setTargetInput] = useState(String(grill.targetTempC));
  const [maxLimitInput, setMaxLimitInput] = useState(String(grill.maxTempLimitC));
  const [timerMinsInput, setTimerMinsInput] = useState('15');
  const [showHeatConfirm, setShowHeatConfirm] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    setTargetInput(String(grill.targetTempC));
  }, [grill.targetTempC]);

  useEffect(() => {
    setMaxLimitInput(String(grill.maxTempLimitC));
  }, [grill.maxTempLimitC]);

  // Play crisp Web Audio notification chime when alarmActive becomes true
  useEffect(() => {
    if (!grill.alarmActive) return;
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
    } catch {
      // Audio playback blocked before interaction
    }
  }, [grill.alarmActive]);

  async function sendGrillCommand(
    action: string,
    value: Record<string, unknown> = {},
    taskId = 'grill_heater',
    confirmDangerous = false
  ) {
    setErrorMsg(null);
    try {
      const res = await apiFetch<{ snapshot: RealtimeSnapshot }>('/api/commands', {
        method: 'POST',
        body: JSON.stringify({
          projectId: 'grill',
          taskId,
          action,
          value,
          confirmDangerous,
        }),
      });
      onSnapshotUpdate(res.snapshot);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Không thể thực hiện lệnh bếp nướng.');
    }
  }

  function getTempColor(temp: number) {
    if (temp >= grill.maxTempLimitC - 10 || grill.overheatAlert) return { stroke: '#DC2626', text: 'text-red-600 dark:text-red-400', label: 'Quá nhiệt / Nguy hiểm' };
    if (temp >= 160) return { stroke: '#EA580C', text: 'text-orange-600 dark:text-orange-400', label: 'Đạt nhiệt nướng' };
    if (temp >= 80) return { stroke: '#D97706', text: 'text-amber-600 dark:text-amber-400', label: 'Đang làm nóng' };
    return { stroke: '#0F62FE', text: 'text-[#0F62FE] dark:text-blue-400', label: 'Nhiệt thấp' };
  }

  const gaugeStyle = getTempColor(grill.currentTempC);
  const progressRatio = Math.min(1, Math.max(0, grill.currentTempC / Math.max(250, grill.maxTempLimitC)));
  const arcRadius = 82;
  const arcCircumference = Math.PI * arcRadius;
  const dashOffset = arcCircumference * (1 - progressRatio);

  const mm = Math.floor(grill.timerRemainingSec / 60);
  const ss = grill.timerRemainingSec % 60;
  const timerFormatted = `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;

  return (
    <div className="space-y-5">
      {/* Header + Emergency Stop */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#131C2A] text-sm font-medium flex items-center gap-1.5 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Trang chủ</span>
          </button>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Bếp nướng thông minh</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Giám sát nhiệt độ K-Type, điều khiển 6 Task độc lập và khóa bảo vệ quá nhiệt
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            triggerHaptic([40, 30, 40]);
            sendGrillCommand('emergency_stop', {}, 'grill_alert');
          }}
          className="h-11 px-5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-sm flex items-center gap-2 shadow-md cursor-pointer"
        >
          <OctagonX className="w-5 h-5" />
          <span>DỪNG KHẨN CẤP</span>
        </button>
      </div>

      {/* Safety / Alarm Banners */}
      {(grill.safetyLockReason || grill.alarmActive || errorMsg) && (
        <div
          className={`p-3.5 rounded-xl border text-sm flex flex-wrap items-center justify-between gap-3 ${
            grill.overheatAlert || !grill.sensorHealthy
              ? 'bg-red-50 dark:bg-red-950/40 border-red-300 dark:border-red-800 text-red-800 dark:text-red-200'
              : 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {grill.alarmActive ? <BellRing className="w-5 h-5 shrink-0" /> : <ShieldAlert className="w-5 h-5 shrink-0" />}
            <span>
              {errorMsg ||
                grill.safetyLockReason ||
                'Hoàn thành thời gian nướng! Bếp đã tự ngắt gia nhiệt an toàn.'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              setErrorMsg(null);
              sendGrillCommand('dismiss_alarm', {}, 'grill_alert');
            }}
            className="px-3 py-1 rounded-lg bg-white/80 dark:bg-slate-900/70 text-xs font-semibold cursor-pointer"
          >
            Xác nhận & Tắt báo
          </button>
        </div>
      )}

      {/* 1. TRẠNG THÁI BẾP */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {[
          { label: 'Kết nối', val: grill.online ? 'Online' : 'Offline', cls: grill.online ? 'text-emerald-600' : 'text-red-600' },
          { label: 'Trạng thái bếp', val: grill.grillState },
          { label: 'Nhiệt hiện tại', val: `${grill.currentTempC.toFixed(1)}°C`, cls: gaugeStyle.text },
          { label: 'Nhiệt mục tiêu', val: `${grill.targetTempC}°C` },
          { label: 'Hẹn giờ còn', val: timerFormatted },
          { label: 'Quạt', val: grill.fanOn ? `Bật (${grill.fanSpeed}%)` : 'Tắt' },
          { label: 'Gia nhiệt / Quay', val: `${grill.heaterOn ? 'Bật' : 'Tắt'} / ${grill.rotisserieOn ? 'Quay' : 'Dừng'}` },
        ].map((st) => (
          <div key={st.label} className="p-3 rounded-xl bg-white dark:bg-[#131C2A] border border-slate-200/80 dark:border-slate-800">
            <div className="text-[11px] text-slate-500 dark:text-slate-400">{st.label}</div>
            <div className={`mt-1 text-sm font-mono font-bold tabular-nums ${st.cls || ''}`}>{st.val}</div>
          </div>
        ))}
      </div>

      {/* 2. ĐỒNG HỒ NHIỆT ĐỘ LỚN + BIỂU ĐỒ THỜI GIAN THỰC */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-5 p-6 rounded-xl bg-white dark:bg-[#131C2A] border border-slate-200/80 dark:border-slate-800 flex flex-col items-center justify-between">
          <div className="w-full flex items-center justify-between mb-2">
            <h2 className="text-sm font-bold flex items-center gap-1.5">
              <Thermometer className="w-4 h-4 text-orange-500" /> Đồng hồ nhiệt độ
            </h2>
            <span className={`text-xs font-semibold ${gaugeStyle.text}`}>{gaugeStyle.label}</span>
          </div>

          {/* Semicircle Color-Coded Gauge */}
          <div className="relative w-64 h-40 flex items-end justify-center my-2">
            <svg viewBox="0 0 200 115" className="w-full h-full overflow-visible">
              <path
                d="M 18 100 A 82 82 0 0 1 182 100"
                fill="none"
                stroke="currentColor"
                strokeWidth="16"
                strokeLinecap="round"
                className="text-slate-200 dark:text-slate-800"
              />
              <path
                d="M 18 100 A 82 82 0 0 1 182 100"
                fill="none"
                stroke={gaugeStyle.stroke}
                strokeWidth="16"
                strokeLinecap="round"
                strokeDasharray={arcCircumference}
                strokeDashoffset={dashOffset}
                className="transition-all duration-500"
              />
            </svg>
            <div className="absolute bottom-2 text-center">
              <div className={`text-4xl font-mono font-bold tabular-nums ${gaugeStyle.text}`}>
                {grill.currentTempC.toFixed(1)}°C
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                Mục tiêu: {grill.targetTempC}°C · Giới hạn: {grill.maxTempLimitC}°C
              </div>
            </div>
          </div>

          {/* Master Quick Action Bar */}
          <div className="w-full grid grid-cols-2 sm:grid-cols-4 gap-2 pt-4 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setShowHeatConfirm(true)}
              disabled={!grill.sensorHealthy}
              className="h-10 rounded-lg bg-[#0F62FE] hover:bg-blue-700 text-white text-xs font-semibold flex items-center justify-center gap-1 disabled:opacity-50 cursor-pointer"
            >
              <Play className="w-3.5 h-3.5" /> Bật bếp
            </button>
            <button
              type="button"
              onClick={() => sendGrillCommand('pause_grill', {}, 'grill_heater')}
              className="h-10 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold flex items-center justify-center gap-1 cursor-pointer"
            >
              <Pause className="w-3.5 h-3.5" /> Tạm dừng
            </button>
            <button
              type="button"
              onClick={() => sendGrillCommand('stop_grill', {}, 'grill_heater')}
              className="h-10 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold flex items-center justify-center gap-1 cursor-pointer"
            >
              <Power className="w-3.5 h-3.5" /> Tắt bếp
            </button>
            <button
              type="button"
              onClick={() => sendGrillCommand('toggle_fan', { on: !grill.fanOn }, 'grill_fan')}
              className={`h-10 rounded-lg border text-xs font-semibold flex items-center justify-center gap-1 cursor-pointer ${
                grill.fanOn ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300' : 'border-slate-200 dark:border-slate-700'
              }`}
            >
              <Fan className="w-3.5 h-3.5" /> {grill.fanOn ? 'Tắt quạt' : 'Bật quạt'}
            </button>
          </div>
        </div>

        {/* Real-time Temperature Chart */}
        <div className="lg:col-span-7 p-5 rounded-xl bg-white dark:bg-[#131C2A] border border-slate-200/80 dark:border-slate-800 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold">Biểu đồ nhiệt độ theo thời gian thực</h2>
            <span className="text-xs font-mono text-slate-400">Cập nhật tự động 2s</span>
          </div>
          <div className="flex-1 min-h-[230px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={grill.tempHistory}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.18} />
                <XAxis dataKey="time" tick={{ fontSize: 11 }} />
                <YAxis domain={[20, Math.max(260, grill.maxTempLimitC + 20)]} tick={{ fontSize: 11 }} unit="°C" />
                <Tooltip />
                <Area
                  type="monotone"
                  dataKey="targetTempC"
                  name="Mục tiêu (°C)"
                  stroke="#94A3B8"
                  strokeDasharray="4 4"
                  fillOpacity={0}
                />
                <Area
                  type="monotone"
                  dataKey="currentTempC"
                  name="Hiện tại (°C)"
                  stroke={gaugeStyle.stroke}
                  fill={gaugeStyle.stroke}
                  fillOpacity={0.16}
                  strokeWidth={2.5}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* 3. CHIA TASK ĐIỀU KHIỂN ĐỘC LẬP (TASK 1 .. TASK 6) */}
      <div className="p-5 rounded-xl bg-white dark:bg-[#131C2A] border border-slate-200/80 dark:border-slate-800 space-y-3">
        <h2 className="text-sm font-bold">6 Task điều khiển thiết bị độc lập</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {grillTasks.map((t) => (
            <div
              key={t.id}
              className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#0B111A] border border-slate-200/80 dark:border-slate-800 flex flex-col justify-between gap-3"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-mono font-bold text-[#0F62FE] dark:text-blue-400">{t.code}</span>
                  <span
                    className={`text-xs font-semibold ${
                      t.enabled ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500'
                    }`}
                  >
                    {t.statusText}
                  </span>
                </div>
                <div className="text-sm font-bold mt-1">{t.name}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">{t.componentName}</div>
              </div>

              <div className="flex items-center justify-end">
                {t.id === 'grill_fan' && (
                  <button
                    type="button"
                    onClick={() => sendGrillCommand('toggle_fan', { on: !grill.fanOn }, t.id)}
                    className="h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#131C2A] text-xs font-semibold cursor-pointer"
                  >
                    {grill.fanOn ? 'Tắt quạt' : 'Bật quạt'}
                  </button>
                )}
                {t.id === 'grill_heater' && (
                  <button
                    type="button"
                    onClick={() =>
                      grill.heaterOn
                        ? sendGrillCommand('pause_grill', {}, t.id)
                        : setShowHeatConfirm(true)
                    }
                    className="h-8 px-3 rounded-lg bg-[#0F62FE] text-white text-xs font-semibold cursor-pointer"
                  >
                    {grill.heaterOn ? 'Tắt gia nhiệt' : 'Bật gia nhiệt'}
                  </button>
                )}
                {t.id === 'grill_rotisserie' && (
                  <button
                    type="button"
                    onClick={() => sendGrillCommand('toggle_rotisserie', { on: !grill.rotisserieOn }, t.id)}
                    className="h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#131C2A] text-xs font-semibold flex items-center gap-1 cursor-pointer"
                  >
                    <RotateCw className="w-3.5 h-3.5" />
                    {grill.rotisserieOn ? 'Dừng quay' : 'Bật quay vỉ'}
                  </button>
                )}
                {t.id === 'grill_temp_sensor' && (
                  <button
                    type="button"
                    onClick={() => sendGrillCommand('toggle_sensor_fault', { healthy: !grill.sensorHealthy }, t.id)}
                    className="h-8 px-3 rounded-lg border border-amber-300 dark:border-amber-800 text-xs font-semibold text-amber-700 dark:text-amber-300 cursor-pointer"
                  >
                    {grill.sensorHealthy ? 'Giả lập lỗi cảm biến' : 'Khôi phục cảm biến'}
                  </button>
                )}
                {t.id === 'grill_timer' && (
                  <button
                    type="button"
                    onClick={() =>
                      sendGrillCommand('set_timer', { seconds: Number(timerMinsInput) * 60, enabled: !grill.timerEnabled }, t.id)
                    }
                    className="h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#131C2A] text-xs font-semibold cursor-pointer"
                  >
                    {grill.timerEnabled ? 'Dừng hẹn giờ' : 'Chạy hẹn giờ'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 4. CÀI ĐẶT NHIỆT ĐỘ + 5. HẸN GIỜ + 6. CHẾ ĐỘ NƯỚNG */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Temperature Settings */}
        <div className="p-5 rounded-xl bg-white dark:bg-[#131C2A] border border-slate-200/80 dark:border-slate-800 space-y-4">
          <h2 className="text-sm font-bold">Cài đặt & Giới hạn nhiệt độ</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => sendGrillCommand('set_target_temp', { targetTempC: grill.targetTempC - 5 }, 'grill_heater')}
              className="w-10 h-10 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center justify-center cursor-pointer"
            >
              <Minus className="w-4 h-4" />
            </button>
            <input
              type="number"
              value={targetInput}
              onChange={(e) => setTargetInput(e.target.value)}
              className="flex-1 h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B111A] text-center font-mono font-bold"
            />
            <button
              type="button"
              onClick={() => sendGrillCommand('set_target_temp', { targetTempC: grill.targetTempC + 5 }, 'grill_heater')}
              className="w-10 h-10 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center justify-center cursor-pointer"
            >
              <Plus className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => sendGrillCommand('set_target_temp', { targetTempC: Number(targetInput) }, 'grill_heater')}
              className="h-10 px-3 rounded-lg bg-[#0F62FE] text-white text-xs font-semibold cursor-pointer"
            >
              Đặt
            </button>
          </div>

          <div>
            <div className="flex items-center justify-between text-xs text-slate-500 mb-1.5">
              <span>Mức nhiệt ưa thích đã lưu</span>
              <button
                type="button"
                onClick={() => sendGrillCommand('save_favorite_temp', { tempC: grill.targetTempC }, 'grill_heater')}
                className="text-[#0F62FE] font-semibold hover:underline cursor-pointer"
              >
                + Lưu {grill.targetTempC}°C
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {grill.favorites.map((fav) => (
                <button
                  key={fav}
                  type="button"
                  onClick={() => sendGrillCommand('set_target_temp', { targetTempC: fav }, 'grill_heater')}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-mono font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  {fav}°C
                </button>
              ))}
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center gap-2">
            <span className="text-xs text-slate-500 shrink-0">Ngưỡng tối đa (°C):</span>
            <input
              type="number"
              value={maxLimitInput}
              onChange={(e) => setMaxLimitInput(e.target.value)}
              className="w-20 h-9 px-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B111A] text-xs font-mono"
            />
            <button
              type="button"
              onClick={() => sendGrillCommand('set_max_temp', { maxTempLimitC: Number(maxLimitInput) }, 'grill_alert')}
              className="h-9 px-3 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold cursor-pointer"
            >
              Cập nhật an toàn
            </button>
          </div>
        </div>

        {/* Countdown Timer */}
        <div className="p-5 rounded-xl bg-white dark:bg-[#131C2A] border border-slate-200/80 dark:border-slate-800 space-y-4">
          <h2 className="text-sm font-bold flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-[#0F62FE]" /> Hẹn giờ nướng tự động ngắt
          </h2>
          <div className="text-3xl font-mono font-bold text-center py-2 rounded-xl bg-slate-50 dark:bg-[#0B111A] tabular-nums">
            {timerFormatted}
          </div>
          <div className="grid grid-cols-4 gap-2">
            {[5, 10, 15, 25].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setTimerMinsInput(String(m));
                  sendGrillCommand('set_timer', { seconds: m * 60, enabled: true }, 'grill_timer');
                }}
                className="h-9 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-mono font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                {m} phút
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={120}
              value={timerMinsInput}
              onChange={(e) => setTimerMinsInput(e.target.value)}
              className="w-24 h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B111A] text-sm font-mono"
            />
            <button
              type="button"
              onClick={() =>
                sendGrillCommand('set_timer', { seconds: Math.max(1, Number(timerMinsInput)) * 60, enabled: true }, 'grill_timer')
              }
              className="flex-1 h-10 rounded-lg bg-[#0F62FE] text-white text-xs font-semibold cursor-pointer"
            >
              Đặt & Bắt đầu đếm ngược
            </button>
          </div>
        </div>

        {/* 6 Grill Presets */}
        <div className="p-5 rounded-xl bg-white dark:bg-[#131C2A] border border-slate-200/80 dark:border-slate-800 space-y-3">
          <h2 className="text-sm font-bold flex items-center gap-1.5">
            <Flame className="w-4 h-4 text-orange-500" /> 6 Chế độ nướng tự động
          </h2>
          <div className="grid grid-cols-2 gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => sendGrillCommand('select_preset', { preset: p.id }, 'grill_heater')}
                className={`p-2.5 rounded-xl border text-left transition-colors cursor-pointer ${
                  grill.presetMode === p.id
                    ? 'border-[#0F62FE] bg-blue-50/70 dark:bg-blue-950/30'
                    : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                }`}
              >
                <div className="text-xs font-bold">{p.label}</div>
                <div className="text-[11px] font-mono text-slate-500">
                  {p.temp}°C · {p.mins} phút
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Mandatory Remote Heating Confirmation Modal */}
      {showHeatConfirm && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white dark:bg-[#131C2A] border border-orange-300 dark:border-orange-800 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-orange-100 dark:bg-orange-950 text-orange-600 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold">Xác nhận bật bộ gia nhiệt từ xa</h3>
                <p className="text-xs text-slate-500">Kiểm tra an toàn trước khi cấp điện thanh nhiệt</p>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-900 text-xs text-slate-700 dark:text-slate-300 space-y-1">
              <p>
                • Nhiệt độ mục tiêu: <strong className="font-mono">{grill.targetTempC}°C</strong> (Giới hạn tối đa:{' '}
                <strong className="font-mono">{grill.maxTempLimitC}°C</strong>)
              </p>
              <p>• Cảm biến K-Type: {grill.sensorHealthy ? 'Hoạt động bình thường' : 'LỖI'}</p>
              <p>• Đảm bảo khu vực quanh bếp nướng thông thoáng trước khi bật từ xa.</p>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowHeatConfirm(false)}
                className="h-10 px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowHeatConfirm(false);
                  sendGrillCommand('start_grill', { targetTempC: grill.targetTempC }, 'grill_heater', true);
                }}
                className="h-10 px-4 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-sm font-semibold cursor-pointer"
              >
                Xác nhận bật bếp
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
