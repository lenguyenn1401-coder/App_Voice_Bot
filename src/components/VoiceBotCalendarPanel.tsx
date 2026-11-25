import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { CalendarEvent, DeviceReminder } from '../types';

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function mondayOfIso(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const wd = dt.getUTCDay();
  const offset = wd === 0 ? -6 : 1 - wd;
  dt.setUTCDate(dt.getUTCDate() + offset);
  return dt.toISOString().slice(0, 10);
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function formatDayVi(iso: string): string {
  try {
    return new Intl.DateTimeFormat('vi-VN', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    }).format(new Date(`${iso}T12:00:00Z`));
  } catch {
    return iso;
  }
}

const WEEKDAY_SHORT = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
const WEEKDAY_LONG = ['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ Nhật'];

export const VoiceBotCalendarPanel: React.FC = () => {
  const todayDefault = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);

  const [today, setToday] = useState(todayDefault);
  const [week, setWeek] = useState(() => mondayOfIso(todayDefault));
  const [selectedDay, setSelectedDay] = useState(todayDefault);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [agendaToday, setAgendaToday] = useState<CalendarEvent[]>([]);
  const [agendaUpcoming, setAgendaUpcoming] = useState<CalendarEvent[]>([]);
  const [reminders, setReminders] = useState<DeviceReminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Event editor dialog
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [formTitle, setFormTitle] = useState('');
  const [formDate, setFormDate] = useState(todayDefault);
  const [formStart, setFormStart] = useState('08:00');
  const [formEnd, setFormEnd] = useState('09:00');
  const [formNote, setFormNote] = useState('');
  const [formRemind, setFormRemind] = useState(10);
  const [savingEvent, setSavingEvent] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [confirmDeleteStep, setConfirmDeleteStep] = useState(false);

  // Copy week modal
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyTarget, setCopyTarget] = useState(() => addDaysIso(mondayOfIso(todayDefault), 7));
  const [copyBusy, setCopyBusy] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  // Live GMT+7 clock
  const [nowClock, setNowClock] = useState(() => {
    try {
      return new Intl.DateTimeFormat('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZone: 'Asia/Ho_Chi_Minh',
      }).format(new Date());
    } catch {
      return '';
    }
  });

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const autoScrolledWeekRef = useRef<string | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => {
      try {
        setNowClock(
          new Intl.DateTimeFormat('vi-VN', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            timeZone: 'Asia/Ho_Chi_Minh',
          }).format(new Date())
        );
      } catch {
        // ignore
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  async function refreshAll(targetWeek = week) {
    setLoading(true);
    setErrorMsg(null);
    try {
      const [evRes, agRes, remRes] = await Promise.all([
        apiFetch<{ week: string; today: string; events: CalendarEvent[] }>(
          `/api/events?week=${encodeURIComponent(targetWeek)}`
        ),
        apiFetch<{ today: CalendarEvent[]; upcoming: CalendarEvent[] }>('/api/agenda'),
        apiFetch<{ reminders: DeviceReminder[] }>('/api/reminders'),
      ]);
      setToday(evRes.today);
      setEvents(evRes.events);
      setAgendaToday(agRes.today);
      setAgendaUpcoming(agRes.upcoming);
      setReminders(remRes.reminders);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Không tải được dữ liệu lịch.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshAll(week);
  }, [week]);

  // Auto-scroll hourly grid on week load/switch to 1h before earliest event (min 06:00)
  useEffect(() => {
    if (loading || !scrollRef.current) return;
    if (autoScrolledWeekRef.current === week) return;
    autoScrolledWeekRef.current = week;

    let targetHour = 6;
    if (events.length > 0) {
      const minStart = Math.min(...events.map((ev) => toMinutes(ev.start)));
      targetHour = Math.max(6, Math.floor(minStart / 60) - 1);
    }
    scrollRef.current.scrollTop = targetHour * 64;
  }, [week, loading, events]);

  function selectDay(isoDate: string) {
    setSelectedDay(isoDate);
    const weekEnd = addDaysIso(week, 6);
    if (isoDate < week || isoDate > weekEnd) {
      setWeek(mondayOfIso(isoDate));
    }
  }

  const weekLabel = useMemo(() => {
    const endIso = addDaysIso(week, 6);
    try {
      const fmt = new Intl.DateTimeFormat('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        timeZone: 'UTC',
      });
      const startStr = fmt.format(new Date(`${week}T12:00:00Z`));
      const endStr = fmt.format(new Date(`${endIso}T12:00:00Z`));
      return `Tuần ${startStr} – ${endStr}/${endIso.slice(0, 4)}`;
    } catch {
      return `Tuần ${week} → ${endIso}`;
    }
  }, [week]);

  const conflictWarning = useMemo(() => {
    if (!formDate || !formStart || !formEnd || formEnd <= formStart) return null;
    const hit = events.find(
      (ev) =>
        ev.date === formDate &&
        ev.id !== editingEvent?.id &&
        formStart < ev.end &&
        ev.start < formEnd
    );
    return hit ? `Trùng khung giờ với "${hit.title}" (${hit.start}–${hit.end}).` : null;
  }, [events, editingEvent, formDate, formStart, formEnd]);

  function openNewEvent(dateStr = selectedDay, start = '08:00', end = '09:00') {
    setEditingEvent(null);
    setFormTitle('');
    setFormDate(dateStr);
    setFormStart(start);
    setFormEnd(end);
    setFormNote('');
    setFormRemind(10);
    setEditorError(null);
    setConfirmDeleteStep(false);
    setEditorOpen(true);
  }

  function openEditEvent(ev: CalendarEvent) {
    setEditingEvent(ev);
    setFormTitle(ev.title);
    setFormDate(ev.date);
    setFormStart(ev.start);
    setFormEnd(ev.end);
    setFormNote(ev.note);
    setFormRemind(ev.remindMinutes);
    setEditorError(null);
    setConfirmDeleteStep(false);
    setEditorOpen(true);
  }

  async function handleSaveEvent(e: React.FormEvent) {
    e.preventDefault();
    if (confirmDeleteStep) return;
    if (!formTitle.trim()) {
      setEditorError('Vui lòng nhập tiêu đề lịch.');
      return;
    }
    if (formEnd <= formStart) {
      setEditorError('Giờ kết thúc phải sau giờ bắt đầu.');
      return;
    }
    setSavingEvent(true);
    setEditorError(null);
    try {
      const payload = {
        title: formTitle.trim(),
        date: formDate,
        start: formStart,
        end: formEnd,
        note: formNote,
        remindMinutes: formRemind,
      };
      if (editingEvent) {
        await apiFetch(`/api/events/${encodeURIComponent(editingEvent.id)}`, {
          method: 'PUT',
          body: JSON.stringify({ ...payload, revision: editingEvent.revision }),
        });
      } else {
        await apiFetch('/api/events', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      setEditorOpen(false);
      setConfirmDeleteStep(false);
      setSelectedDay(formDate);
      const nextMonday = mondayOfIso(formDate);
      if (nextMonday !== week) setWeek(nextMonday);
      else await refreshAll(week);
    } catch (err) {
      setEditorError(err instanceof Error ? err.message : 'Không thể lưu lịch.');
    } finally {
      setSavingEvent(false);
    }
  }

  async function handleDeleteEvent() {
    if (!editingEvent) return;
    setSavingEvent(true);
    setEditorError(null);
    try {
      await apiFetch(`/api/events/${encodeURIComponent(editingEvent.id)}`, {
        method: 'DELETE',
        body: JSON.stringify({ revision: editingEvent.revision }),
      });
      setEditorOpen(false);
      setConfirmDeleteStep(false);
      await refreshAll(week);
    } catch (err) {
      setEditorError(err instanceof Error ? err.message : 'Không thể xóa lịch.');
    } finally {
      setSavingEvent(false);
    }
  }

  async function handleCopyWeek(e: React.FormEvent) {
    e.preventDefault();
    setCopyBusy(true);
    setCopyError(null);
    try {
      const targetMonday = mondayOfIso(copyTarget);
      await apiFetch('/api/weeks/copy', {
        method: 'POST',
        body: JSON.stringify({ sourceWeek: week, targetWeek: targetMonday }),
      });
      setCopyOpen(false);
      setWeek(targetMonday);
      setSelectedDay(targetMonday);
    } catch (err) {
      setCopyError(err instanceof Error ? err.message : 'Không thể sao chép tuần.');
    } finally {
      setCopyBusy(false);
    }
  }

  function jumpToPeriod(hour: number) {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: hour * 64, behavior: 'smooth' });
    }
  }

  const dayEvents = useMemo(
    () => events.filter((ev) => ev.date === selectedDay).sort((a, b) => a.start.localeCompare(b.start)),
    [events, selectedDay]
  );

  const reminderLabels: Record<DeviceReminder['status'], string> = {
    played: 'Đã phát',
    failed: 'Thất bại',
    cancelled: 'Đã hủy',
    pending: 'Đang chờ phát',
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
      {/* Main Weekly Calendar + Day Agenda */}
      <div className="xl:col-span-8 space-y-4">
        <div className="p-4 sm:p-5 rounded-xl bg-white dark:bg-[#131C2A] border border-slate-200/80 dark:border-slate-800 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold flex items-center gap-2">
                <Calendar className="w-4 h-4 text-[#0F62FE]" /> Lịch thực hành & Nhắc lịch thiết bị (GMT+7)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-2 mt-0.5">
                <span className="font-semibold text-slate-700 dark:text-slate-200">{weekLabel}</span>
                <span>·</span>
                <span>{events.length} lịch trong tuần</span>
                {nowClock && (
                  <>
                    <span>·</span>
                    <span className="font-mono text-[#0F62FE] dark:text-blue-400">
                      Giờ hệ thống (GMT+7): {nowClock}
                    </span>
                  </>
                )}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => refreshAll(week)}
                className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium flex items-center gap-1 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Làm mới
              </button>
              <button
                type="button"
                onClick={() => {
                  setCopyTarget(addDaysIso(week, 7));
                  setCopyError(null);
                  setCopyOpen(true);
                }}
                className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium flex items-center gap-1 cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" /> Sao chép tuần
              </button>
              <button
                type="button"
                onClick={() => openNewEvent()}
                className="h-9 px-3.5 rounded-lg bg-[#0F62FE] text-white text-xs font-semibold flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" /> Thêm lịch
              </button>
            </div>
          </div>

          {errorMsg && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 text-xs text-red-700 dark:text-red-300">
              {errorMsg}
            </div>
          )}

          {/* Toolbar: Week Nav & Period Jump */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  const prevW = addDaysIso(week, -7);
                  setWeek(prevW);
                  setSelectedDay(prevW);
                }}
                className="w-9 h-9 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center justify-center cursor-pointer"
                title="Tuần trước"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedDay(today);
                  setWeek(mondayOfIso(today));
                }}
                className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold cursor-pointer"
              >
                Hôm nay
              </button>
              <button
                type="button"
                onClick={() => {
                  const nextW = addDaysIso(week, 7);
                  setWeek(nextW);
                  setSelectedDay(nextW);
                }}
                className="w-9 h-9 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center justify-center cursor-pointer"
                title="Tuần sau"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-1">
              {[
                { label: 'Cả ngày', h: 0 },
                { label: 'Sáng (06:00)', h: 6 },
                { label: 'Chiều (12:00)', h: 12 },
                { label: 'Tối (18:00)', h: 18 },
              ].map((p) => (
                <button
                  key={p.h}
                  type="button"
                  onClick={() => jumpToPeriod(p.h)}
                  className="h-8 px-2.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-blue-950/40 text-xs font-medium cursor-pointer"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Day Agenda Selector with Prev/Next Day Stepper */}
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#0B111A] border border-slate-200/70 dark:border-slate-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => selectDay(addDaysIso(selectedDay, -1))}
                  title="Ngày trước"
                  aria-label="Ngày trước"
                  className="w-7 h-7 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#131C2A] flex items-center justify-center hover:border-[#0F62FE] cursor-pointer"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <div className="text-xs font-bold capitalize px-1">{formatDayVi(selectedDay)}</div>
                <button
                  type="button"
                  onClick={() => selectDay(addDaysIso(selectedDay, 1))}
                  title="Ngày sau"
                  aria-label="Ngày sau"
                  className="w-7 h-7 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#131C2A] flex items-center justify-center hover:border-[#0F62FE] cursor-pointer"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                {WEEKDAY_SHORT.map((lbl, idx) => {
                  const date = addDaysIso(week, idx);
                  const active = date === selectedDay;
                  const isToday = date === today;
                  return (
                    <button
                      key={date}
                      type="button"
                      onClick={() => selectDay(date)}
                      className={`px-2 py-1 rounded-md text-[11px] font-semibold cursor-pointer ${
                        active
                          ? 'bg-[#0F62FE] text-white'
                          : isToday
                          ? 'border border-[#0F62FE] text-[#0F62FE]'
                          : 'hover:bg-slate-200/70 dark:hover:bg-slate-800'
                      }`}
                    >
                      {lbl} {Number(date.slice(8))}
                    </button>
                  );
                })}
              </div>
            </div>

            {dayEvents.length === 0 ? (
              <div className="text-xs text-slate-500 flex items-center justify-between py-1">
                <span>Ngày này chưa có lịch thực hành.</span>
                <button
                  type="button"
                  onClick={() => openNewEvent(selectedDay)}
                  className="text-[#0F62FE] font-semibold hover:underline cursor-pointer"
                >
                  + Thêm lịch ngày này
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {dayEvents.map((ev) => (
                  <button
                    key={ev.id}
                    type="button"
                    onClick={() => openEditEvent(ev)}
                    className="p-2.5 rounded-lg bg-white dark:bg-[#131C2A] border border-slate-200 dark:border-slate-800 text-left hover:border-[#0F62FE] cursor-pointer"
                  >
                    <div className="text-[11px] font-mono text-[#0F62FE] dark:text-blue-400">
                      {ev.start} – {ev.end} (Nhắc trước {ev.remindMinutes}p)
                    </div>
                    <div className="text-xs font-bold truncate mt-0.5">{ev.title}</div>
                    {ev.note && (
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">{ev.note}</div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Empty Week Banner (Legacy Parity) */}
          {!loading && events.length === 0 && (
            <div className="p-4 rounded-xl bg-blue-50/70 dark:bg-blue-950/25 border border-dashed border-blue-300 dark:border-blue-800 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-bold text-slate-800 dark:text-slate-100">
                  Tuần này chưa có lịch thực hành nào
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Bấm nút bên cạnh hoặc nhấp trực tiếp vào lưới giờ bên dưới để tạo lịch và đặt nhắc nhở trên ESP32-S3.
                </div>
              </div>
              <button
                type="button"
                onClick={() => openNewEvent(selectedDay)}
                className="h-9 px-3.5 rounded-lg bg-[#0F62FE] text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer shrink-0"
              >
                <Plus className="w-3.5 h-3.5" /> Tạo lịch đầu tiên
              </button>
            </div>
          )}

          {/* 24-Hour Weekly Grid */}
          <div
            ref={scrollRef}
            className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-auto max-h-[460px] bg-white dark:bg-[#0B111A]"
          >
            <div className="min-w-[720px] grid grid-cols-[56px_repeat(7,1fr)]">
              {/* Header row */}
              <div className="sticky top-0 z-10 bg-slate-50 dark:bg-[#131C2A] border-b border-r border-slate-200 dark:border-slate-800 px-1.5 py-2 text-[10px] font-mono text-center text-slate-500">
                GMT+7
              </div>
              {WEEKDAY_LONG.map((name, i) => {
                const date = addDaysIso(week, i);
                const isToday = date === today;
                return (
                  <button
                    key={date}
                    type="button"
                    onClick={() => selectDay(date)}
                    className={`sticky top-0 z-10 border-b border-r border-slate-200 dark:border-slate-800 px-2 py-2 text-center cursor-pointer ${
                      isToday
                        ? 'bg-blue-50 dark:bg-blue-950/60 text-[#0F62FE]'
                        : date === selectedDay
                        ? 'bg-slate-100 dark:bg-slate-800/80'
                        : 'bg-slate-50 dark:bg-[#131C2A]'
                    }`}
                  >
                    <div className="text-[10px] text-slate-500">{name}</div>
                    <div className="text-xs font-bold font-mono">{Number(date.slice(8))}</div>
                  </button>
                );
              })}

              {/* Time Axis */}
              <div className="border-r border-slate-200 dark:border-slate-800">
                {Array.from({ length: 24 }, (_, h) => {
                  const isPeriodBoundary = h === 6 || h === 12 || h === 18;
                  return (
                    <div
                      key={h}
                      className={`h-16 pr-1.5 pt-1 text-right text-[10px] font-mono ${
                        isPeriodBoundary
                          ? 'border-t-2 border-dashed border-[#0F62FE]/40 text-[#0F62FE] font-bold'
                          : 'border-b border-slate-100 dark:border-slate-800/60 text-slate-400'
                      }`}
                    >
                      {String(h).padStart(2, '0')}:00
                    </div>
                  );
                })}
              </div>

              {/* 7 Day Columns (64px per hour => ~1.0667px per min) */}
              {WEEKDAY_LONG.map((_, i) => {
                const date = addDaysIso(week, i);
                const colEvents = events.filter((e) => e.date === date);
                return (
                  <div
                    key={date}
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest('button')) return;
                      const rect = e.currentTarget.getBoundingClientRect();
                      const relY = e.clientY - rect.top;
                      const clickedMin = Math.max(0, Math.min(1425, Math.floor((relY / 64) * 60)));
                      const snapStart = Math.round(clickedMin / 15) * 15;
                      const snapEnd = Math.min(1439, snapStart + 60);
                      const fmt = (m: number) =>
                        `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
                      openNewEvent(date, fmt(snapStart), fmt(snapEnd));
                    }}
                    className={`relative border-r border-slate-100 dark:border-slate-800/60 h-[1536px] cursor-crosshair ${
                      date === today ? 'bg-blue-50/20 dark:bg-blue-950/10' : ''
                    }`}
                  >
                    {Array.from({ length: 24 }, (_, h) => {
                      const isPeriodBoundary = h === 6 || h === 12 || h === 18;
                      return (
                        <div
                          key={h}
                          className={`h-16 ${
                            isPeriodBoundary
                              ? 'border-t-2 border-dashed border-[#0F62FE]/30 border-b border-slate-100 dark:border-slate-800/40'
                              : 'border-b border-slate-100 dark:border-slate-800/40'
                          }`}
                        />
                      );
                    })}
                    {colEvents.map((ev) => {
                      const startMin = toMinutes(ev.start);
                      const endMin = toMinutes(ev.end);
                      const durationMin = endMin - startMin;
                      const topPx = (startMin / 60) * 64;
                      const heightPx = Math.max(24, (durationMin / 60) * 64 - 2);
                      return (
                        <button
                          key={ev.id}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openEditEvent(ev);
                          }}
                          style={{ top: `${topPx}px`, height: `${heightPx}px` }}
                          className="absolute left-1 right-1 rounded-lg bg-[#0F62FE]/90 hover:bg-[#0F62FE] text-white px-1.5 py-1 text-left overflow-hidden shadow-sm cursor-pointer"
                        >
                          <div className="text-[10px] font-mono opacity-90 truncate">
                            {ev.start}–{ev.end}
                          </div>
                          <div className="text-[11px] font-semibold leading-tight truncate">{ev.title}</div>
                          {durationMin >= 75 && ev.note && (
                            <div className="text-[10px] opacity-80 leading-tight truncate mt-0.5">{ev.note}</div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            Nhấp vào khung giờ trống để thêm lịch mới · Nhấp vào lịch để chỉnh sửa hoặc xóa · Vạch đứt nét tại 06:00, 12:00, 18:00 đánh dấu các buổi trong ngày.
          </div>
        </div>
      </div>

      {/* Right Column: Today, Upcoming 30d & Device Reminders Queue */}
      <div className="xl:col-span-4 space-y-4">
        <div className="p-4 rounded-xl bg-white dark:bg-[#131C2A] border border-slate-200/80 dark:border-slate-800 space-y-2.5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-[#0F62FE]" /> Hôm nay ({today})
            </h3>
          </div>
          {agendaToday.length === 0 ? (
            <div className="text-xs text-slate-400">Hôm nay chưa có lịch thực hành.</div>
          ) : (
            <div className="space-y-2">
              {agendaToday.map((ev) => (
                <button
                  key={ev.id}
                  type="button"
                  onClick={() => openEditEvent(ev)}
                  className="w-full p-2.5 rounded-lg bg-slate-50 dark:bg-[#0B111A] border border-slate-200/70 dark:border-slate-800 text-left hover:border-[#0F62FE] cursor-pointer"
                >
                  <div className="text-[11px] font-mono text-[#0F62FE]">{ev.start} – {ev.end}</div>
                  <div className="text-xs font-semibold truncate">{ev.title}</div>
                  {ev.note && (
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">{ev.note}</div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="p-4 rounded-xl bg-white dark:bg-[#131C2A] border border-slate-200/80 dark:border-slate-800 space-y-2.5">
          <h3 className="text-sm font-bold">Sắp tới (30 ngày)</h3>
          {agendaUpcoming.length === 0 ? (
            <div className="text-xs text-slate-400">Chưa có lịch sắp tới.</div>
          ) : (
            <div className="space-y-2 max-h-56 overflow-y-auto">
              {agendaUpcoming.map((ev) => (
                <button
                  key={ev.id}
                  type="button"
                  onClick={() => openEditEvent(ev)}
                  className="w-full p-2.5 rounded-lg bg-slate-50 dark:bg-[#0B111A] border border-slate-200/70 dark:border-slate-800 text-left hover:border-[#0F62FE] cursor-pointer"
                >
                  <div className="text-[11px] font-mono text-slate-500">
                    {ev.date} · {ev.start} – {ev.end}
                  </div>
                  <div className="text-xs font-semibold truncate">{ev.title}</div>
                  {ev.note && (
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">{ev.note}</div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="p-4 rounded-xl bg-white dark:bg-[#131C2A] border border-slate-200/80 dark:border-slate-800 space-y-2.5">
          <h3 className="text-sm font-bold flex items-center gap-1.5">
            <Bell className="w-4 h-4 text-amber-500" /> Nhắc lịch trên thiết bị
          </h3>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {reminders.length === 0 ? (
              <div className="text-xs text-slate-400">Chưa có hàng đợi nhắc lịch nào.</div>
            ) : (
              reminders.map((r) => (
                <div
                  key={r.id}
                  className="p-2.5 rounded-lg bg-slate-50 dark:bg-[#0B111A] border border-slate-200/70 dark:border-slate-800 text-xs"
                >
                  <div className="flex items-center justify-between font-semibold gap-2">
                    <span className="truncate">{r.title}</span>
                    <span
                      className={`shrink-0 ${
                        r.status === 'played'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : r.status === 'pending'
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-red-600'
                      }`}
                    >
                      {reminderLabels[r.status] || r.status}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 truncate mt-0.5">{r.text}</div>
                </div>
              ))
            )}
          </div>
          <p className="text-[11px] text-slate-400">
            Chỉ chuyển sang “Đã phát” khi kit ESP32-S3 gửi ACK (/device/ack) sau khi phát xong loa.
          </p>
        </div>
      </div>

      {/* Event Editor Modal */}
      {editorOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white dark:bg-[#131C2A] border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold">{editingEvent ? 'Chỉnh sửa lịch' : 'Thêm lịch mới'}</h3>
              <button
                type="button"
                onClick={() => {
                  setEditorOpen(false);
                  setConfirmDeleteStep(false);
                }}
                className="w-8 h-8 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-lg cursor-pointer"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSaveEvent} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold mb-1">Tiêu đề</label>
                <input
                  type="text"
                  required
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="Ví dụ: Thực hành mạch I2S ESP32-S3"
                  className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B111A] text-sm"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-3 sm:col-span-1">
                  <label className="block text-xs font-semibold mb-1">Ngày</label>
                  <input
                    type="date"
                    required
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                    className="w-full h-10 px-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B111A] text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Bắt đầu</label>
                  <input
                    type="time"
                    required
                    value={formStart}
                    onChange={(e) => setFormStart(e.target.value)}
                    className="w-full h-10 px-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B111A] text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Kết thúc</label>
                  <input
                    type="time"
                    required
                    value={formEnd}
                    onChange={(e) => setFormEnd(e.target.value)}
                    className="w-full h-10 px-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B111A] text-xs font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">Nhắc trên ESP32-S3 trước (phút)</label>
                <input
                  type="number"
                  min={0}
                  max={1440}
                  value={formRemind}
                  onChange={(e) => setFormRemind(Number(e.target.value))}
                  className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B111A] text-sm font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">Ghi chú</label>
                <textarea
                  rows={2}
                  value={formNote}
                  onChange={(e) => setFormNote(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B111A] text-sm"
                />
              </div>

              {conflictWarning && (
                <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-xs text-amber-700 dark:text-amber-300">
                  {conflictWarning}
                </div>
              )}
              {editorError && (
                <div className="p-2.5 rounded-lg bg-red-50 dark:bg-red-950/30 text-xs text-red-600">{editorError}</div>
              )}

              {/* 2-Step Delete Confirmation (Legacy Parity) */}
              {editingEvent && confirmDeleteStep && (
                <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 space-y-2.5">
                  <div className="text-xs font-bold text-red-700 dark:text-red-300">Xóa lịch này?</div>
                  <div className="text-xs text-red-600 dark:text-red-400">
                    “{editingEvent.title}” · {editingEvent.date} ({editingEvent.start}–{editingEvent.end}) sẽ bị xóa vĩnh viễn khỏi hệ thống và nhắc lịch ESP32-S3.
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      disabled={savingEvent}
                      onClick={() => setConfirmDeleteStep(false)}
                      className="h-9 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#131C2A] text-xs font-medium cursor-pointer"
                    >
                      Giữ lại
                    </button>
                    <button
                      type="button"
                      disabled={savingEvent}
                      onClick={handleDeleteEvent}
                      className="h-9 px-3 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
                    >
                      {savingEvent ? 'Đang xóa...' : 'Xóa vĩnh viễn'}
                    </button>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                {editingEvent && !confirmDeleteStep ? (
                  <button
                    type="button"
                    disabled={savingEvent}
                    onClick={() => setConfirmDeleteStep(true)}
                    className="h-10 px-3 rounded-xl border border-red-200 dark:border-red-900 text-red-600 text-sm font-semibold flex items-center gap-1 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" /> Xóa lịch
                  </button>
                ) : (
                  <span />
                )}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEditorOpen(false);
                      setConfirmDeleteStep(false);
                    }}
                    className="h-10 px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium cursor-pointer"
                  >
                    Hủy
                  </button>
                  <button
                    type="submit"
                    disabled={savingEvent || confirmDeleteStep}
                    className="h-10 px-4 rounded-xl bg-[#0F62FE] text-white text-sm font-semibold cursor-pointer disabled:opacity-50"
                  >
                    {savingEvent ? 'Đang lưu...' : 'Lưu lịch'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Copy Week Modal */}
      {copyOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="max-w-sm w-full bg-white dark:bg-[#131C2A] border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-bold">Sao chép lịch sang tuần khác</h3>
            <p className="text-xs text-slate-500">Tuần nguồn: Thứ Hai {week}</p>
            <form onSubmit={handleCopyWeek} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold mb-1">Chọn ngày bất kỳ trong tuần đích</label>
                <input
                  type="date"
                  required
                  value={copyTarget}
                  onChange={(e) => setCopyTarget(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B111A] text-sm font-mono"
                />
                {copyTarget && (
                  <div className="text-[11px] text-slate-500 mt-1">
                    Tuần đích: {mondayOfIso(copyTarget)} → {addDaysIso(mondayOfIso(copyTarget), 6)}
                  </div>
                )}
              </div>
              {copyError && <div className="text-xs text-red-600">{copyError}</div>}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCopyOpen(false)}
                  className="h-10 px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-sm cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={copyBusy}
                  className="h-10 px-4 rounded-xl bg-[#0F62FE] text-white text-sm font-semibold cursor-pointer disabled:opacity-50"
                >
                  {copyBusy ? 'Đang chép...' : 'Sao chép ngay'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
