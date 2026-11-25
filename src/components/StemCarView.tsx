import React, { useEffect, useRef, useState } from 'react';
import {
  AlertOctagon,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Battery,
  Camera,
  Maximize2,
  Minimize2,
  OctagonX,
  RotateCcw,
  RotateCw,
  ShieldAlert,
  Wifi,
} from 'lucide-react';
import { apiFetch, triggerHaptic } from '../lib/api';
import type { CarDirection, CarMode, RealtimeSnapshot } from '../types';

interface StemCarViewProps {
  snapshot: RealtimeSnapshot;
  onBack: () => void;
  onSnapshotUpdate: (snap: RealtimeSnapshot) => void;
}

const CAR_MODES: Array<{ id: CarMode; label: string }> = [
  { id: 'manual', label: 'Thủ công' },
  { id: 'avoid', label: 'Tránh vật cản' },
  { id: 'line', label: 'Đi theo đường kẻ' },
  { id: 'patrol', label: 'Tuần tra' },
  { id: 'saved_route', label: 'Lộ trình đã lưu' },
];

export const StemCarView: React.FC<StemCarViewProps> = ({
  snapshot,
  onBack,
  onSnapshotUpdate,
}) => {
  const { car } = snapshot;
  const [fullscreen, setFullscreen] = useState(false);
  const [servoInput, setServoInput] = useState(String(car.servoAngle));
  const [joyOffset, setJoyOffset] = useState({ x: 0, y: 0 });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [snapshotStatus, setSnapshotStatus] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const joyZoneRef = useRef<HTMLDivElement | null>(null);
  const joyActiveRef = useRef(false);
  const heartbeatRef = useRef<number | null>(null);

  useEffect(() => {
    setServoInput(String(car.servoAngle));
  }, [car.servoAngle]);

  // Safety: Auto-stop car when leaving the page or closing tab
  useEffect(() => {
    return () => {
      apiFetch('/api/car/leave', { method: 'POST' }).catch(() => {});
      if (heartbeatRef.current) window.clearInterval(heartbeatRef.current);
    };
  }, []);

  // Heartbeat while car is running in manual mode
  useEffect(() => {
    if (car.movingState === 'Đang chạy' && car.mode === 'manual') {
      heartbeatRef.current = window.setInterval(() => {
        sendCarCommand('heartbeat', {}, 'car_drive', true);
      }, 1500);
    } else if (heartbeatRef.current) {
      window.clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
    return () => {
      if (heartbeatRef.current) window.clearInterval(heartbeatRef.current);
    };
  }, [car.movingState, car.mode]);

  // Keyboard shortcuts: WASD / Arrows + Space to stop
  useEffect(() => {
    const keyToDir: Record<string, CarDirection> = {
      w: 'forward',
      arrowup: 'forward',
      s: 'backward',
      arrowdown: 'backward',
      a: 'left',
      arrowleft: 'left',
      d: 'right',
      arrowright: 'right',
    };

    function onKeyDown(e: KeyboardEvent) {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) return;
      const k = e.key.toLowerCase();
      if (k === ' ') {
        e.preventDefault();
        sendCarCommand('stop', {}, 'car_drive');
        return;
      }
      const dir = keyToDir[k];
      if (dir && !e.repeat) {
        e.preventDefault();
        sendCarCommand('move', { direction: dir, speed: car.speed }, 'car_drive');
      }
    }

    function onKeyUp(e: KeyboardEvent) {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) return;
      const k = e.key.toLowerCase();
      if (keyToDir[k]) {
        sendCarCommand('stop', {}, 'car_drive');
      }
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [car.speed]);

  // Simulated FPV Camera Canvas
  useEffect(() => {
    if (!car.cameraEnabled) return;
    let raf = 0;
    let phase = 0;
    const render = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const w = canvas.width;
          const h = canvas.height;
          if (car.movingState === 'Đang chạy') phase += 0.08 * (car.speed / 50);

          // Sky / ceiling & floor
          ctx.fillStyle = '#0F172A';
          ctx.fillRect(0, 0, w, h * 0.45);
          ctx.fillStyle = '#1E293B';
          ctx.fillRect(0, h * 0.45, w, h * 0.55);

          // Perspective lane lines
          const shift = ((car.servoAngle - 90) / 90) * 45;
          ctx.strokeStyle = '#38BDF8';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(w * 0.44 + shift, h * 0.46);
          ctx.lineTo(w * 0.14, h);
          ctx.moveTo(w * 0.56 + shift, h * 0.46);
          ctx.lineTo(w * 0.86, h);
          ctx.stroke();

          // Moving dashes
          ctx.strokeStyle = '#FACC15';
          ctx.lineWidth = 3;
          for (let i = 0; i < 4; i++) {
            const prog = ((i / 4 + phase * 0.12) % 1);
            const y1 = h * 0.48 + prog * h * 0.48;
            const y2 = y1 + 12 + prog * 18;
            const x = w * 0.5 + shift * (1 - prog);
            ctx.beginPath();
            ctx.moveTo(x, y1);
            ctx.lineTo(x, Math.min(h, y2));
            ctx.stroke();
          }

          // Obstacle box scaled by ultrasonic distance
          const distScale = Math.max(0.2, Math.min(1, 50 / Math.max(10, car.obstacleDistanceCm)));
          const boxW = 90 * distScale;
          const boxH = 54 * distScale;
          const boxX = w * 0.5 + shift * 0.5 - boxW / 2;
          const boxY = h * 0.48 - boxH * 0.2 + distScale * 30;
          ctx.fillStyle = car.obstacleDistanceCm < 20 ? 'rgba(220,38,38,0.85)' : 'rgba(245,158,11,0.75)';
          ctx.fillRect(boxX, boxY, boxW, boxH);
          ctx.strokeStyle = '#FFFFFF';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(boxX, boxY, boxW, boxH);

          // HUD overlay
          ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
          ctx.fillRect(10, 10, 175, 42);
          ctx.fillStyle = '#E2E8F0';
          ctx.font = '12px monospace';
          ctx.fillText(`CAM: ${car.cameraQuality} · LIVE`, 18, 27);
          ctx.fillText(`DIST: ${car.obstacleDistanceCm}cm · SPD: ${car.speed}%`, 18, 44);
        }
      }
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [car.cameraEnabled, car.cameraQuality, car.movingState, car.speed, car.servoAngle, car.obstacleDistanceCm]);

  async function sendCarCommand(
    action: string,
    value: Record<string, unknown>,
    taskId = 'car_drive',
    silent = false
  ) {
    if (!silent) setErrorMsg(null);
    try {
      const res = await apiFetch<{ snapshot: RealtimeSnapshot }>('/api/commands', {
        method: 'POST',
        body: JSON.stringify({
          projectId: 'car',
          taskId,
          action,
          value,
        }),
      });
      onSnapshotUpdate(res.snapshot);
    } catch (err) {
      if (!silent) setErrorMsg(err instanceof Error ? err.message : 'Lỗi gửi lệnh Xe STEM.');
    }
  }

  function handleEmergencyStop() {
    triggerHaptic([40, 30, 40]);
    sendCarCommand('emergency_stop', {}, 'car_drive');
  }

  function handleJoystickMove(clientX: number, clientY: number) {
    const zone = joyZoneRef.current;
    if (!zone) return;
    const rect = zone.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const maxR = rect.width / 2 - 22;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > maxR) {
      dx = (dx / dist) * maxR;
      dy = (dy / dist) * maxR;
    }
    setJoyOffset({ x: dx, y: dy });

    if (dist < 14) return;
    let dir: CarDirection = 'forward';
    if (Math.abs(dy) >= Math.abs(dx)) {
      dir = dy < 0 ? 'forward' : 'backward';
    } else {
      dir = dx < 0 ? 'left' : 'right';
    }
    if (car.direction !== dir || car.movingState !== 'Đang chạy') {
      sendCarCommand('move', { direction: dir, speed: car.speed }, 'car_drive');
    }
  }

  function releaseJoystick() {
    if (!joyActiveRef.current) return;
    joyActiveRef.current = false;
    setJoyOffset({ x: 0, y: 0 });
    sendCarCommand('stop', {}, 'car_drive');
  }

  function handleSnapshotCapture() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `xe-stem-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    sendCarCommand('set_camera', { snapshot: true }, 'car_camera');
    setSnapshotStatus(`Đã chụp ảnh lúc ${new Date().toLocaleTimeString('vi-VN')}`);
  }

  const wheelTurnDeg = car.servoAngle - 90;

  return (
    <div className={fullscreen ? 'fixed inset-0 z-50 bg-[#F4F6FA] dark:bg-[#0B111A] p-4 overflow-y-auto space-y-4' : 'space-y-5'}>
      {/* Header + Always-Pinned Emergency Stop */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              if (fullscreen) setFullscreen(false);
              else onBack();
            }}
            className="h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#131C2A] text-sm font-medium flex items-center gap-1.5 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>{fullscreen ? 'Thu gọn' : 'Trang chủ'}</span>
          </button>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Điều khiển xe STEM</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Hỗ trợ Joystick cảm ứng, phím W/A/S/D, Servo 0–180° và 2 động cơ thời gian thực
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setFullscreen(!fullscreen)}
            className="h-11 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#131C2A] text-sm font-medium flex items-center gap-1.5 cursor-pointer"
          >
            {fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            <span className="hidden sm:inline">{fullscreen ? 'Thoát toàn màn hình' : 'Toàn màn hình'}</span>
          </button>

          <button
            type="button"
            onClick={handleEmergencyStop}
            className="h-11 px-5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-sm flex items-center gap-2 shadow-md cursor-pointer"
          >
            <OctagonX className="w-5 h-5" />
            <span>DỪNG KHẨN CẤP</span>
          </button>
        </div>
      </div>

      {/* Safety Banners */}
      {(car.autoStopReason || car.collisionAlert || errorMsg) && (
        <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-sm text-amber-900 dark:text-amber-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0" />
            <span>{errorMsg || car.autoStopReason || 'Cảnh báo va chạm vật cản phía trước!'}</span>
          </div>
          {errorMsg && (
            <button type="button" onClick={() => setErrorMsg(null)} className="text-xs underline shrink-0">
              Đóng
            </button>
          )}
        </div>
      )}

      {/* 1. TRẠNG THÁI XE */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        {[
          { label: 'Kết nối', val: car.online ? 'Online' : 'Offline', highlight: car.online ? 'text-emerald-600' : 'text-red-600' },
          { label: 'Trạng thái', val: car.movingState, highlight: car.movingState === 'Đang chạy' ? 'text-[#0F62FE]' : '' },
          { label: 'Hướng', val: car.direction.toUpperCase() },
          { label: 'Tốc độ', val: `${car.speed}%` },
          { label: 'Góc Servo', val: `${car.servoAngle}°` },
          { label: 'Pin', val: `${Math.round(car.batteryPct)}%`, icon: <Battery className="w-3.5 h-3.5" /> },
          { label: 'Wi-Fi', val: `${car.wifiRssi} dBm`, icon: <Wifi className="w-3.5 h-3.5" /> },
          { label: 'Vật cản', val: `${car.obstacleDistanceCm} cm`, highlight: car.obstacleDistanceCm < 20 ? 'text-red-600' : '' },
        ].map((item) => (
          <div
            key={item.label}
            className="p-3 rounded-xl bg-white dark:bg-[#131C2A] border border-slate-200/80 dark:border-slate-800"
          >
            <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
              {item.icon}
              {item.label}
            </div>
            <div className={`mt-1 text-sm font-mono font-bold tabular-nums ${item.highlight || ''}`}>{item.val}</div>
          </div>
        ))}
      </div>

      {/* Main Controls Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left: Movement D-Pad + Touch Joystick + Speed */}
        <div className="lg:col-span-5 space-y-4">
          <div className="p-5 rounded-xl bg-white dark:bg-[#131C2A] border border-slate-200/80 dark:border-slate-800 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold">Điều khiển di chuyển</h2>
              <span className="text-[11px] font-mono text-slate-400">W/A/S/D · Space dừng</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 items-center">
              {/* Touch Joystick */}
              <div className="flex flex-col items-center">
                <div
                  ref={joyZoneRef}
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    joyActiveRef.current = true;
                    triggerHaptic(15);
                    handleJoystickMove(e.clientX, e.clientY);
                  }}
                  onPointerMove={(e) => {
                    if (joyActiveRef.current) handleJoystickMove(e.clientX, e.clientY);
                  }}
                  onPointerUp={releaseJoystick}
                  onPointerCancel={releaseJoystick}
                  className="joystick-zone relative w-44 h-44 rounded-full bg-slate-100 dark:bg-[#0B111A] border-2 border-slate-200 dark:border-slate-700 flex items-center justify-center cursor-grab active:cursor-grabbing"
                >
                  <div className="absolute inset-4 rounded-full border border-dashed border-slate-300 dark:border-slate-700" />
                  <div
                    style={{ transform: `translate(${joyOffset.x}px, ${joyOffset.y}px)` }}
                    className="w-14 h-14 rounded-full bg-[#0F62FE] text-white shadow-lg flex items-center justify-center text-xs font-bold pointer-events-none"
                  >
                    LÁI
                  </div>
                </div>
                <span className="mt-2 text-xs text-slate-500 dark:text-slate-400">Giữ để chạy · Thả tự dừng</span>
              </div>

              {/* D-Pad Buttons */}
              <div className="grid grid-cols-3 gap-2 max-w-[210px] mx-auto">
                <button
                  type="button"
                  onPointerDown={() => sendCarCommand('move', { direction: 'spin_left', speed: car.speed })}
                  onPointerUp={() => sendCarCommand('stop', {})}
                  className="h-12 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-center hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                  title="Xoay trái"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onPointerDown={() => sendCarCommand('move', { direction: 'forward', speed: car.speed })}
                  onPointerUp={() => sendCarCommand('stop', {})}
                  className="h-12 rounded-xl bg-[#0F62FE] text-white flex items-center justify-center hover:bg-blue-700 cursor-pointer"
                  title="Tiến"
                >
                  <ArrowUp className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  onPointerDown={() => sendCarCommand('move', { direction: 'spin_right', speed: car.speed })}
                  onPointerUp={() => sendCarCommand('stop', {})}
                  className="h-12 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-center hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                  title="Xoay phải"
                >
                  <RotateCw className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onPointerDown={() => sendCarCommand('move', { direction: 'left', speed: car.speed })}
                  onPointerUp={() => sendCarCommand('stop', {})}
                  className="h-12 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer"
                  title="Rẽ trái"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  onClick={() => sendCarCommand('stop', {})}
                  className="h-12 rounded-xl bg-red-100 dark:bg-red-950/50 text-red-700 dark:text-red-300 font-bold text-xs flex items-center justify-center cursor-pointer"
                >
                  DỪNG
                </button>
                <button
                  type="button"
                  onPointerDown={() => sendCarCommand('move', { direction: 'right', speed: car.speed })}
                  onPointerUp={() => sendCarCommand('stop', {})}
                  className="h-12 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer"
                  title="Rẽ phải"
                >
                  <ArrowRight className="w-5 h-5" />
                </button>

                <div />
                <button
                  type="button"
                  onPointerDown={() => sendCarCommand('move', { direction: 'backward', speed: car.speed })}
                  onPointerUp={() => sendCarCommand('stop', {})}
                  className="h-12 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer"
                  title="Lùi"
                >
                  <ArrowDown className="w-5 h-5" />
                </button>
                <div />
              </div>
            </div>

            {/* 3. TỐC ĐỘ XE */}
            <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between text-xs font-semibold">
                <span>Tốc độ xe (0–100%)</span>
                <span className="font-mono text-sm text-[#0F62FE] dark:text-blue-400">{car.speed}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={car.speed}
                onChange={(e) => sendCarCommand('set_speed', { speed: Number(e.target.value), preset: 'custom' })}
                className="w-full accent-[#0F62FE]"
              />
              <div className="grid grid-cols-4 gap-2">
                {[
                  { id: 'slow', label: 'Chậm 30%', val: 30 },
                  { id: 'medium', label: 'TB 55%', val: 55 },
                  { id: 'fast', label: 'Nhanh 85%', val: 85 },
                  { id: 'custom', label: 'Dừng 0%', val: 0 },
                ].map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => sendCarCommand('set_speed', { speed: p.val, preset: p.id })}
                    className={`h-9 rounded-lg border text-xs font-medium cursor-pointer ${
                      car.speed === p.val
                        ? 'border-[#0F62FE] bg-blue-50 dark:bg-blue-950/40 text-[#0F62FE] dark:text-blue-300'
                        : 'border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 4. ĐIỀU KHIỂN SERVO */}
          <div className="p-5 rounded-xl bg-white dark:bg-[#131C2A] border border-slate-200/80 dark:border-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold">Điều khiển Servo (0°–180°)</h2>
              <span className="font-mono text-sm font-bold text-[#0F62FE]">{car.servoAngle}°</span>
            </div>

            <div className="flex items-center gap-5">
              {/* Visual Wheel Steering Angle SVG */}
              <div className="w-28 h-28 rounded-xl bg-slate-50 dark:bg-[#0B111A] border border-slate-200 dark:border-slate-800 flex items-center justify-center shrink-0">
                <svg viewBox="0 0 100 100" className="w-24 h-24">
                  <rect x="34" y="28" width="32" height="48" rx="6" className="fill-slate-300 dark:fill-slate-700" />
                  {/* Front Left Wheel */}
                  <g transform={`translate(25, 36) rotate(${wheelTurnDeg})`}>
                    <rect x="-5" y="-11" width="10" height="22" rx="3" className="fill-[#0F62FE]" />
                  </g>
                  {/* Front Right Wheel */}
                  <g transform={`translate(75, 36) rotate(${wheelTurnDeg})`}>
                    <rect x="-5" y="-11" width="10" height="22" rx="3" className="fill-[#0F62FE]" />
                  </g>
                  {/* Rear Wheels */}
                  <rect x="20" y="58" width="10" height="20" rx="3" className="fill-slate-600" />
                  <rect x="70" y="58" width="10" height="20" rx="3" className="fill-slate-600" />
                </svg>
              </div>

              <div className="flex-1 space-y-3">
                <input
                  type="range"
                  min={0}
                  max={180}
                  value={car.servoAngle}
                  onChange={(e) => sendCarCommand('set_servo', { angle: Number(e.target.value) }, 'car_servo')}
                  className="w-full accent-[#0F62FE]"
                />
                <div className="flex items-center gap-2">
                  {[
                    { label: 'Trái (35°)', angle: 35 },
                    { label: 'Giữa (90°)', angle: 90 },
                    { label: 'Phải (145°)', angle: 145 },
                  ].map((b) => (
                    <button
                      key={b.angle}
                      type="button"
                      onClick={() => sendCarCommand('set_servo', { angle: b.angle }, 'car_servo')}
                      className="flex-1 h-9 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      {b.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={180}
                    value={servoInput}
                    onChange={(e) => setServoInput(e.target.value)}
                    className="w-24 h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B111A] text-xs font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => sendCarCommand('set_servo', { angle: Number(servoInput) }, 'car_servo')}
                    className="h-9 px-3 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold cursor-pointer"
                  >
                    Đặt góc
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Camera + Modes + Dual Motors + Sensors */}
        <div className="lg:col-span-7 space-y-4">
          {/* Camera Feed */}
          <div className="p-4 rounded-xl bg-white dark:bg-[#131C2A] border border-slate-200/80 dark:border-slate-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Camera className="w-4 h-4 text-[#0F62FE]" />
                <h2 className="text-sm font-bold">Camera trực tiếp ESP32-CAM (Mô phỏng FPV)</h2>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={car.cameraQuality}
                  onChange={(e) => sendCarCommand('set_camera', { quality: e.target.value }, 'car_camera')}
                  className="h-8 px-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B111A] text-xs"
                >
                  <option value="HD 720p">HD 720p</option>
                  <option value="SD 480p">SD 480p</option>
                </select>
                <button
                  type="button"
                  onClick={handleSnapshotCapture}
                  disabled={!car.cameraEnabled}
                  className="h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium disabled:opacity-50 cursor-pointer"
                >
                  Chụp ảnh
                </button>
                <button
                  type="button"
                  onClick={() => sendCarCommand('set_camera', { enabled: !car.cameraEnabled }, 'car_camera')}
                  className={`h-8 px-3 rounded-lg text-xs font-semibold cursor-pointer ${
                    car.cameraEnabled ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900' : 'bg-emerald-600 text-white'
                  }`}
                >
                  {car.cameraEnabled ? 'Tắt Camera' : 'Bật Camera'}
                </button>
              </div>
            </div>

            {car.cameraEnabled ? (
              <canvas
                ref={canvasRef}
                width={640}
                height={240}
                className="w-full h-52 rounded-xl bg-slate-950 border border-slate-800 object-cover"
              />
            ) : (
              <div className="w-full h-52 rounded-xl bg-slate-100 dark:bg-[#0B111A] border border-slate-200 dark:border-slate-800 flex items-center justify-center text-sm text-slate-500">
                Camera đang tắt
              </div>
            )}
            {snapshotStatus && <div className="text-xs text-emerald-600 dark:text-emerald-400">{snapshotStatus}</div>}
          </div>

          {/* 6. CHẾ ĐỘ XE */}
          <div className="p-4 rounded-xl bg-white dark:bg-[#131C2A] border border-slate-200/80 dark:border-slate-800">
            <h2 className="text-sm font-bold mb-3">Chế độ vận hành Xe STEM</h2>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {CAR_MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => sendCarCommand('set_mode', { mode: m.id })}
                  className={`h-10 px-2.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                    car.mode === m.id
                      ? 'border-[#0F62FE] bg-[#0F62FE] text-white'
                      : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* 5. ĐIỀU KHIỂN 2 ĐỘNG CƠ ĐỘC LẬP / ĐỒNG BỘ */}
          <div className="p-4 rounded-xl bg-white dark:bg-[#131C2A] border border-slate-200/80 dark:border-slate-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-bold">Điều khiển động cơ Trái & Phải</h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    sendCarCommand('set_motors', {
                      sync: !car.motors.sync,
                      leftSpeed: car.motors.leftSpeed,
                      rightSpeed: car.motors.rightSpeed,
                      leftDir: car.motors.leftDir,
                      rightDir: car.motors.rightDir,
                    })
                  }
                  className={`h-8 px-3 rounded-lg border text-xs font-medium cursor-pointer ${
                    car.motors.sync ? 'border-[#0F62FE] text-[#0F62FE]' : 'border-slate-200 dark:border-slate-700'
                  }`}
                >
                  {car.motors.sync ? 'Đang đồng bộ 2 bánh' : 'Đang chạy độc lập'}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    sendCarCommand('set_motors', {
                      sync: car.motors.sync,
                      leftSpeed: 50,
                      rightSpeed: 50,
                      leftDir: 'forward',
                      rightDir: 'forward',
                    })
                  }
                  className="h-8 px-3 rounded-lg bg-emerald-600 text-white text-xs font-semibold cursor-pointer"
                >
                  Chạy thử 50%
                </button>
                <button
                  type="button"
                  onClick={() =>
                    sendCarCommand('set_motors', {
                      sync: car.motors.sync,
                      leftSpeed: 0,
                      rightSpeed: 0,
                      leftDir: 'stop',
                      rightDir: 'stop',
                    })
                  }
                  className="h-8 px-3 rounded-lg bg-slate-200 dark:bg-slate-800 text-xs font-semibold cursor-pointer"
                >
                  Dừng toàn bộ
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {(['left', 'right'] as const).map((side) => {
                const spd = side === 'left' ? car.motors.leftSpeed : car.motors.rightSpeed;
                const dir = side === 'left' ? car.motors.leftDir : car.motors.rightDir;
                return (
                  <div key={side} className="p-3 rounded-lg bg-slate-50 dark:bg-[#0B111A] border border-slate-200/70 dark:border-slate-800 space-y-2">
                    <div className="flex justify-between text-xs font-semibold">
                      <span>{side === 'left' ? 'Động cơ Trái' : 'Động cơ Phải'}</span>
                      <span className="font-mono">
                        {spd}% · {dir}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={spd}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        sendCarCommand('set_motors', {
                          sync: car.motors.sync,
                          leftSpeed: side === 'left' || car.motors.sync ? val : car.motors.leftSpeed,
                          rightSpeed: side === 'right' || car.motors.sync ? val : car.motors.rightSpeed,
                          leftDir: val === 0 ? 'stop' : car.motors.leftDir === 'stop' ? 'forward' : car.motors.leftDir,
                          rightDir: val === 0 ? 'stop' : car.motors.rightDir === 'stop' ? 'forward' : car.motors.rightDir,
                        });
                      }}
                      className="w-full accent-[#0F62FE]"
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* Cảm biến & Kiểm thử an toàn */}
          <div className="p-4 rounded-xl bg-white dark:bg-[#131C2A] border border-slate-200/80 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                Cảm biến dò đường (5 mắt IR) & Hoạt động
              </div>
              <div className="flex items-center gap-2">
                {car.lineSensors.map((v, idx) => (
                  <span
                    key={idx}
                    className={`w-7 h-7 rounded-md font-mono text-xs font-bold flex items-center justify-center ${
                      v === 1 ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900' : 'bg-slate-100 dark:bg-slate-800 text-slate-400'
                    }`}
                  >
                    {v}
                  </span>
                ))}
                <span className="text-xs font-mono text-slate-500 ml-2">Uptime: {car.uptimeSec}s</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => sendCarCommand('simulate_obstacle', { distanceCm: 11 }, 'car_sensors')}
              className="h-9 px-3 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <AlertOctagon className="w-4 h-4" /> Mô phỏng vật cản gần (11 cm)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
