import React from 'react';
import { ArrowRight, Battery, Car, Flame, Mic, Search, Volume2, Wind } from 'lucide-react';
import type { ProjectColorStatus, ProjectId, RealtimeSnapshot } from '../types';
import type { NavSection } from './AppShell';

interface HomeViewProps {
  snapshot: RealtimeSnapshot;
  searchQuery: string;
  onSearchChange: (val: string) => void;
  onOpenProject: (nav: NavSection) => void;
}

const STATUS_STYLE: Record<ProjectColorStatus, { dot: string; text: string; border: string; bg: string }> = {
  connected: {
    dot: 'bg-emerald-500',
    text: 'text-emerald-700 dark:text-emerald-300',
    border: 'border-emerald-200 dark:border-emerald-900/60',
    bg: 'bg-emerald-50 dark:bg-emerald-950/30',
  },
  off: {
    dot: 'bg-slate-400',
    text: 'text-slate-600 dark:text-slate-300',
    border: 'border-slate-200 dark:border-slate-700',
    bg: 'bg-slate-100 dark:bg-slate-800/60',
  },
  warning: {
    dot: 'bg-amber-500',
    text: 'text-amber-700 dark:text-amber-300',
    border: 'border-amber-200 dark:border-amber-900/60',
    bg: 'bg-amber-50 dark:bg-amber-950/30',
  },
  error: {
    dot: 'bg-red-500',
    text: 'text-red-700 dark:text-red-300',
    border: 'border-red-200 dark:border-red-900/60',
    bg: 'bg-red-50 dark:bg-red-950/30',
  },
};

export const HomeView: React.FC<HomeViewProps> = ({
  snapshot,
  searchQuery,
  onSearchChange,
  onOpenProject,
}) => {
  const { voicebot, car, grill, projects } = snapshot;

  function resolveCardStatus(id: ProjectId): { status: ProjectColorStatus; label: string } {
    if (id === 'voicebot') {
      if (!voicebot.online) return { status: 'error', label: 'Mất kết nối' };
      return { status: 'connected', label: 'Đang kết nối' };
    }
    if (id === 'car') {
      if (!car.online) return { status: 'error', label: 'Mất kết nối' };
      if (car.collisionAlert || car.batteryPct <= 15) return { status: 'warning', label: 'Có cảnh báo' };
      return { status: 'connected', label: 'Đang kết nối' };
    }
    if (!grill.online) return { status: 'error', label: 'Mất kết nối' };
    if (!grill.sensorHealthy || grill.overheatAlert) return { status: 'error', label: 'Có lỗi / Quá nhiệt' };
    if (grill.powerLossBlocked || grill.alarmActive) return { status: 'warning', label: 'Có cảnh báo' };
    if (grill.heaterOn || grill.fanOn || grill.rotisserieOn) return { status: 'connected', label: 'Đang kết nối' };
    return { status: 'off', label: 'Đang tắt' };
  }

  const normalizedQuery = searchQuery.trim().toLowerCase();

  const cards = [
    {
      id: 'voicebot' as ProjectId,
      nav: 'project_voicebot' as NavSection,
      title: 'Voice Bot AI',
      description: 'Trò chuyện, hỏi đáp và điều khiển robot bằng giọng nói',
      imageUrl: projects.find((p) => p.id === 'voicebot')?.imageUrl || '/assets/voice_bot_illustration_1795576809169.jpg',
      buttonLabel: 'Mở Voice Bot',
      icon: <Mic className="w-5 h-5 text-[#0F62FE] dark:text-blue-400" />,
      metrics: [
        { label: 'Trạng thái Micro', value: voicebot.micEnabled ? 'Đang bật' : 'Đang tắt', icon: <Mic className="w-4 h-4" /> },
        { label: 'Trạng thái Loa', value: voicebot.speakerEnabled ? `Đang bật (${voicebot.volume}%)` : 'Đang tắt', icon: <Volume2 className="w-4 h-4" /> },
        { label: 'Hoạt động', value: voicebot.activityState },
      ],
    },
    {
      id: 'car' as ProjectId,
      nav: 'project_car' as NavSection,
      title: 'Xe STEM',
      description: 'Điều khiển hướng di chuyển, tốc độ, động cơ và servo',
      imageUrl: projects.find((p) => p.id === 'car')?.imageUrl || '/assets/stem_car_illustration_1795576808752.jpg',
      buttonLabel: 'Điều khiển xe',
      icon: <Car className="w-5 h-5 text-[#0F62FE] dark:text-blue-400" />,
      metrics: [
        { label: 'Trạng thái xe', value: `${car.movingState} (${car.speed}%)` },
        { label: 'Mức pin', value: `${Math.round(car.batteryPct)}%`, icon: <Battery className="w-4 h-4" /> },
        { label: 'Vật cản', value: `${car.obstacleDistanceCm} cm · Servo ${car.servoAngle}°` },
      ],
    },
    {
      id: 'grill' as ProjectId,
      nav: 'project_grill' as NavSection,
      title: 'Bếp nướng thông minh',
      description: 'Theo dõi nhiệt độ và điều khiển quá trình nướng',
      imageUrl: projects.find((p) => p.id === 'grill')?.imageUrl || '/assets/smart_grill_illustration_1795576808859.jpg',
      buttonLabel: 'Mở bếp nướng',
      icon: <Flame className="w-5 h-5 text-amber-600 dark:text-amber-400" />,
      metrics: [
        { label: 'Nhiệt độ hiện tại', value: `${grill.currentTempC.toFixed(1)}°C / ${grill.targetTempC}°C` },
        { label: 'Trạng thái quạt', value: grill.fanOn ? `Đang bật (${grill.fanSpeed}%)` : 'Đang tắt', icon: <Wind className="w-4 h-4" /> },
        { label: 'Trạng thái bếp', value: grill.grillState },
      ],
    },
  ].filter(
    (c) =>
      !normalizedQuery ||
      c.title.toLowerCase().includes(normalizedQuery) ||
      c.description.toLowerCase().includes(normalizedQuery)
  );

  return (
    <div className="space-y-6">
      {/* Top Overview Heading & Mobile Search */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Danh sách Dự án STEM
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Chọn một dự án bên dưới để mở trang chi tiết, xem thông số cảm biến và điều khiển thiết bị.
          </p>
        </div>

        {/* Mobile Search */}
        <div className="md:hidden relative w-full sm:w-64">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Tìm kiếm dự án..."
            className="w-full h-10 pl-9 pr-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#131C2A] text-sm"
          />
        </div>
      </div>

      {/* Status Color Legend */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 rounded-xl bg-white dark:bg-[#131C2A] border border-slate-200/80 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300">
        <span className="font-semibold text-slate-800 dark:text-slate-100">Trạng thái màu:</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Xanh lá: Đang kết nối
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-slate-400" /> Xám: Đang tắt
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> Cam: Có cảnh báo
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500" /> Đỏ: Mất kết nối hoặc Lỗi
        </span>
      </div>

      {/* 3 Large Project Cards (ZERO direct device control buttons on Home) */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {cards.map((card) => {
          const st = resolveCardStatus(card.id);
          const style = STATUS_STYLE[st.status];

          return (
            <div
              key={card.id}
              onClick={() => onOpenProject(card.nav)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onOpenProject(card.nav);
                }
              }}
              className="group bg-white dark:bg-[#131C2A] border border-slate-200/90 dark:border-slate-800 rounded-2xl overflow-hidden flex flex-col justify-between hover:border-[#0F62FE] dark:hover:border-blue-500 transition-colors cursor-pointer shadow-xs"
            >
              <div>
                {/* Illustration Banner */}
                <div className="relative aspect-video bg-slate-100 dark:bg-slate-900 overflow-hidden border-b border-slate-200/70 dark:border-slate-800">
                  <img
                    src={card.imageUrl}
                    alt={card.title}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
                  />
                  <div
                    className={`absolute top-3 right-3 px-2.5 py-1 rounded-md border text-xs font-semibold flex items-center gap-1.5 backdrop-blur-sm ${style.border} ${style.bg} ${style.text}`}
                  >
                    <span className={`w-2 h-2 rounded-full ${style.dot}`} />
                    <span>{st.label}</span>
                  </div>
                </div>

                {/* Title & Description */}
                <div className="p-5">
                  <div className="flex items-center gap-2.5 mb-2">
                    <div className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
                      {card.icon}
                    </div>
                    <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                      {card.title}
                    </h2>
                  </div>
                  <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-5">
                    {card.description}
                  </p>

                  {/* Read-only Overview Telemetry */}
                  <div className="space-y-2.5 pt-4 border-t border-slate-100 dark:border-slate-800">
                    {card.metrics.map((m) => (
                      <div key={m.label} className="flex items-center justify-between text-sm">
                        <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                          {m.icon}
                          {m.label}
                        </span>
                        <span className="font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                          {m.value}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Single Entry Action Button */}
              <div className="px-5 pb-5 pt-2">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenProject(card.nav);
                  }}
                  className="w-full min-h-[46px] px-4 rounded-xl bg-[#0F62FE] hover:bg-blue-700 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <span>{card.buttonLabel}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {cards.length === 0 && (
        <div className="p-10 text-center bg-white dark:bg-[#131C2A] border border-slate-200 dark:border-slate-800 rounded-xl text-sm text-slate-500">
          Không tìm thấy dự án phù hợp với từ khóa "{searchQuery}".
        </div>
      )}
    </div>
  );
};
