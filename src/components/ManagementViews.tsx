import React, { useEffect, useState } from 'react';
import {
  Activity,
  Bell,
  CheckCircle2,
  Cpu,
  Download,
  History,
  Lock,
  Radio,
  Shield,
  Smartphone,
  UserPlus,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { apiFetch } from '../lib/api';
import type {
  CommandLog,
  PermissionRecord,
  ProjectId,
  RealtimeSnapshot,
  SensorReading,
  UserProfile,
  UserRole,
} from '../types';
import type { NavSection } from './AppShell';

export const ProjectsTasksView: React.FC<{
  snapshot: RealtimeSnapshot;
  onOpenProject: (nav: NavSection) => void;
}> = ({ snapshot, onOpenProject }) => {
  const navMap: Record<ProjectId, NavSection> = {
    voicebot: 'project_voicebot',
    car: 'project_car',
    grill: 'project_grill',
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dự án & Phân chia Task</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Mỗi dự án được chia thành các Task điều khiển độc lập gắn trực tiếp với từng bộ phận phần cứng.
        </p>
      </div>

      {snapshot.projects.map((proj) => {
        const projTasks = snapshot.tasks.filter((t) => t.projectId === proj.id);
        return (
          <div
            key={proj.id}
            className="p-5 rounded-2xl bg-white dark:bg-[#131C2A] border border-slate-200/80 dark:border-slate-800 space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold">{proj.name}</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Thiết bị: <span className="font-mono">{proj.deviceId}</span> · {proj.description}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onOpenProject(navMap[proj.id])}
                className="h-9 px-4 rounded-lg bg-[#0F62FE] text-white text-xs font-semibold cursor-pointer"
              >
                Mở trang điều khiển
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {projTasks.map((t) => (
                <div
                  key={t.id}
                  className="p-3 rounded-xl bg-slate-50 dark:bg-[#0B111A] border border-slate-200/70 dark:border-slate-800"
                >
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-mono font-bold text-[#0F62FE] dark:text-blue-400">{t.code}</span>
                    <span className={t.enabled ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-slate-400'}>
                      {t.statusText}
                    </span>
                  </div>
                  <div className="text-sm font-semibold">{t.name}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{t.componentName}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export const DevicesMqttView: React.FC<{
  snapshot: RealtimeSnapshot;
  onSnapshotUpdate: (snap: RealtimeSnapshot) => void;
}> = ({ snapshot, onSnapshotUpdate }) => {
  const [err, setErr] = useState<string | null>(null);

  async function toggleDeviceOnline(projectId: ProjectId, online: boolean) {
    setErr(null);
    try {
      const res = await apiFetch<{ snapshot: RealtimeSnapshot }>('/api/commands', {
        method: 'POST',
        body: JSON.stringify({
          projectId,
          taskId: 'system',
          action: 'set_device_online',
          value: { online },
        }),
      });
      onSnapshotUpdate(res.snapshot);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Không thể thay đổi trạng thái thiết bị.');
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Thiết bị ESP32 & Kênh MQTT</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Quản lý phần cứng kết nối và cấu trúc chủ đề MQTT theo thời gian thực.
        </p>
      </div>

      {err && <div className="p-3 rounded-xl bg-red-50 text-red-700 text-sm">{err}</div>}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {snapshot.devices.map((d) => (
          <div
            key={d.id}
            className="p-5 rounded-2xl bg-white dark:bg-[#131C2A] border border-slate-200/80 dark:border-slate-800 space-y-3"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-[#0F62FE] flex items-center justify-center">
                  <Cpu className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-sm font-bold">{d.name}</div>
                  <div className="text-xs font-mono text-slate-500">{d.id}</div>
                </div>
              </div>
              <span
                className={`text-xs font-semibold flex items-center gap-1 ${
                  d.online ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600'
                }`}
              >
                {d.online ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
                {d.online ? 'Online' : 'Offline'}
              </span>
            </div>

            <div className="space-y-1.5 text-xs border-t border-slate-100 dark:border-slate-800 pt-3">
              <div className="flex justify-between">
                <span className="text-slate-500">Vi điều khiển</span>
                <span className="font-mono">{d.hardwareModel}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Firmware</span>
                <span className="font-mono">{d.firmwareVersion}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">IP / MAC</span>
                <span className="font-mono">
                  {d.ipAddress} · {d.macAddress}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Tín hiệu Wi-Fi</span>
                <span className="font-mono">{d.wifiRssi} dBm</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => toggleDeviceOnline(d.projectId, !d.online)}
              className={`w-full h-9 rounded-lg border text-xs font-semibold cursor-pointer ${
                d.online
                  ? 'border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/30'
                  : 'border-emerald-300 bg-emerald-600 text-white'
              }`}
            >
              {d.online ? 'Giả lập mất kết nối (Test an toàn)' : 'Khôi phục kết nối thiết bị'}
            </button>
          </div>
        ))}
      </div>

      <div className="p-5 rounded-2xl bg-white dark:bg-[#131C2A] border border-slate-200/80 dark:border-slate-800 space-y-3">
        <h2 className="text-sm font-bold flex items-center gap-2">
          <Radio className="w-4 h-4 text-[#0F62FE]" /> Cấu trúc chủ đề MQTT chuẩn hóa
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {snapshot.mqttTopics.map((m) => (
            <div
              key={m.deviceId}
              className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#0B111A] border border-slate-200/70 dark:border-slate-800 space-y-1.5 text-xs font-mono"
            >
              <div className="font-sans font-bold text-slate-800 dark:text-slate-200">{m.deviceId}</div>
              <div>CMD: {m.topics.command}</div>
              <div>STS: {m.topics.status}</div>
              {m.topics.telemetry && <div>TEL: {m.topics.telemetry}</div>}
              {m.topics.alert && <div className="text-red-600 dark:text-red-400">ALT: {m.topics.alert}</div>}
            </div>
          ))}
        </div>
      </div>

      <div className="p-5 rounded-2xl bg-white dark:bg-[#131C2A] border border-slate-200/80 dark:border-slate-800 space-y-2">
        <h2 className="text-sm font-bold">Giao thức HTTP/OTA cho Kit ESP32-S3 thực tế</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs font-mono">
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#0B111A] border border-slate-200/70 dark:border-slate-800">
            <div className="font-sans font-bold text-[#0F62FE] mb-1">OTA & WebSocket</div>
            POST /xiaozhi/ota/
          </div>
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#0B111A] border border-slate-200/70 dark:border-slate-800">
            <div className="font-sans font-bold text-[#0F62FE] mb-1">Lấy lệnh & Nhắc lịch</div>
            GET /device/reminders
          </div>
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#0B111A] border border-slate-200/70 dark:border-slate-800">
            <div className="font-sans font-bold text-[#0F62FE] mb-1">Xác nhận phát loa</div>
            POST /device/ack
          </div>
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#0B111A] border border-slate-200/70 dark:border-slate-800">
            <div className="font-sans font-bold text-[#0F62FE] mb-1">Đẩy thông số PSRAM/Temp</div>
            POST /device/telemetry
          </div>
        </div>
      </div>
    </div>
  );
};

export const SensorsTelemetryView: React.FC<{ snapshot: RealtimeSnapshot }> = ({ snapshot }) => {
  const [readings, setReadings] = useState<SensorReading[]>([]);

  useEffect(() => {
    apiFetch<{ readings: SensorReading[] }>('/api/sensors?limit=90')
      .then((res) => setReadings(res.readings))
      .catch(() => {});
  }, [snapshot.serverTime]);

  const grillSeries = readings
    .filter((r) => r.projectId === 'grill' && r.metricKey === 'temperature')
    .map((r) => ({
      time: new Date(r.recordedAt).toLocaleTimeString('vi-VN', { minute: '2-digit', second: '2-digit' }),
      value: r.metricValue,
    }));

  const carSeries = readings
    .filter((r) => r.projectId === 'car' && r.metricKey === 'obstacle_cm')
    .map((r) => ({
      time: new Date(r.recordedAt).toLocaleTimeString('vi-VN', { minute: '2-digit', second: '2-digit' }),
      value: r.metricValue,
    }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Activity className="w-6 h-6 text-[#0F62FE]" /> Dữ liệu cảm biến thời gian thực
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Chuỗi thời gian nhiệt độ Bếp nướng thông minh và khoảng cách siêu âm Xe STEM lưu trong cơ sở dữ liệu.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="p-5 rounded-2xl bg-white dark:bg-[#131C2A] border border-slate-200/80 dark:border-slate-800">
          <h2 className="text-sm font-bold mb-3">Nhiệt độ Bếp nướng thông minh (°C)</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={grillSeries}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="time" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} unit="°C" />
                <Tooltip />
                <Line type="monotone" dataKey="value" name="Nhiệt độ" stroke="#EA580C" strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-white dark:bg-[#131C2A] border border-slate-200/80 dark:border-slate-800">
          <h2 className="text-sm font-bold mb-3">Khoảng cách vật cản Xe STEM (cm)</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={carSeries}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="time" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} unit=" cm" />
                <Tooltip />
                <Line type="monotone" dataKey="value" name="Khoảng cách" stroke="#0F62FE" strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};

export const CommandHistoryView: React.FC<{ snapshot: RealtimeSnapshot }> = ({ snapshot }) => {
  const [filterProj, setFilterProj] = useState<'all' | ProjectId>('all');
  const [logs, setLogs] = useState<CommandLog[]>(snapshot.recentCommands);

  useEffect(() => {
    const q = filterProj === 'all' ? '' : `?projectId=${filterProj}`;
    apiFetch<{ logs: CommandLog[] }>(`/api/history${q}`)
      .then((res) => setLogs(res.logs))
      .catch(() => {});
  }, [filterProj, snapshot.recentCommands]);

  function exportCsv() {
    const header = 'commandId,projectId,taskId,deviceId,action,value,user,ackStatus,mqttTopic,createdAt';
    const rows = logs.map((l) =>
      [
        l.commandId,
        l.projectId,
        l.taskId,
        l.deviceId,
        l.action,
        `"${l.valueJson.replace(/"/g, '""')}"`,
        `"${l.userName}"`,
        l.ackStatus,
        l.mqttTopic,
        l.createdAt,
      ].join(',')
    );
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tp-stem-history-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <History className="w-6 h-6 text-[#0F62FE]" /> Lịch sử hoạt động & Lệnh điều khiển
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Theo dõi vòng đời xác nhận lệnh (Đã nhận lệnh → Đang thực hiện → Hoàn thành / Thất bại).
          </p>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={filterProj}
            onChange={(e) => setFilterProj(e.target.value as 'all' | ProjectId)}
            className="h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#131C2A] text-sm"
          >
            <option value="all">Tất cả dự án</option>
            <option value="voicebot">Voice Bot AI</option>
            <option value="car">Xe STEM</option>
            <option value="grill">Bếp nướng thông minh</option>
          </select>
          <button
            type="button"
            onClick={exportCsv}
            className="h-10 px-3.5 rounded-lg bg-[#0F62FE] text-white text-sm font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-4 h-4" /> Xuất CSV
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-[#131C2A] border border-slate-200/80 dark:border-slate-800 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-[#0B111A] border-b border-slate-200 dark:border-slate-800 text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-3">Thời gian</th>
                <th className="px-4 py-3">Mã lệnh</th>
                <th className="px-4 py-3">Dự án / Task</th>
                <th className="px-4 py-3">Hành động & Tham số</th>
                <th className="px-4 py-3">Người thực hiện</th>
                <th className="px-4 py-3">Trạng thái ACK</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {logs.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    Chưa có lệnh điều khiển nào được ghi nhận.
                  </td>
                </tr>
              )}
              {logs.map((l) => (
                <tr key={l.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                  <td className="px-4 py-3 font-mono whitespace-nowrap">
                    {new Date(l.createdAt).toLocaleString('vi-VN')}
                  </td>
                  <td className="px-4 py-3 font-mono font-semibold">{l.commandId}</td>
                  <td className="px-4 py-3">
                    <div className="font-semibold">{l.projectId}</div>
                    <div className="text-slate-400 font-mono">{l.taskId}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-semibold">{l.action}</div>
                    <div className="font-mono text-[11px] text-slate-500 truncate max-w-[260px]">{l.valueJson}</div>
                  </td>
                  <td className="px-4 py-3">{l.userName}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`font-semibold ${
                        l.ackStatus === 'Hoàn thành'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : l.ackStatus === 'Thất bại'
                          ? 'text-red-600'
                          : 'text-amber-600'
                      }`}
                    >
                      {l.ackStatus}
                    </span>
                    {l.errorMessage && <div className="text-[11px] text-red-500">{l.errorMessage}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export const NotificationsCenterView: React.FC<{
  snapshot: RealtimeSnapshot;
  userId: string;
  onMarkAllRead: () => void;
}> = ({ snapshot, userId, onMarkAllRead }) => {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Bell className="w-6 h-6 text-[#0F62FE]" /> Trung tâm Thông báo & Cảnh báo
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Cảnh báo va chạm, quá nhiệt, hết giờ nướng và thay đổi phân quyền hệ thống.
          </p>
        </div>
        <button
          type="button"
          onClick={onMarkAllRead}
          className="h-10 px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#131C2A] text-sm font-semibold flex items-center gap-1.5 cursor-pointer"
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-600" /> Đánh dấu tất cả đã đọc
        </button>
      </div>

      <div className="space-y-3">
        {snapshot.notifications.map((n) => {
          const isRead = n.readBy.includes(userId);
          return (
            <div
              key={n.id}
              className={`p-4 rounded-xl bg-white dark:bg-[#131C2A] border ${
                n.severity === 'danger'
                  ? 'border-red-300 dark:border-red-900'
                  : n.severity === 'warning'
                  ? 'border-amber-300 dark:border-amber-900'
                  : 'border-slate-200/80 dark:border-slate-800'
              } ${isRead ? 'opacity-75' : ''}`}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span
                  className={`text-sm font-bold ${
                    n.severity === 'danger'
                      ? 'text-red-600 dark:text-red-400'
                      : n.severity === 'warning'
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-[#0F62FE] dark:text-blue-400'
                  }`}
                >
                  {n.title}
                </span>
                <span className="text-xs font-mono text-slate-400">
                  {new Date(n.createdAt).toLocaleString('vi-VN')}
                </span>
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-300">{n.message}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const UsersPermissionsView: React.FC<{
  currentUser: UserProfile;
  snapshot: RealtimeSnapshot;
}> = ({ currentUser, snapshot }) => {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [permissions, setPermissions] = useState<PermissionRecord[]>([]);
  const [newAccount, setNewAccount] = useState({
    phoneOrEmail: '',
    fullName: '',
    password: '',
    role: 'student' as UserRole,
  });
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const res = await apiFetch<{ users: UserProfile[]; permissions: PermissionRecord[] }>('/api/users');
      setUsers(res.users);
      setPermissions(res.permissions);
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Không tải được danh sách người dùng.');
    }
  }

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    setStatusMsg(null);
    try {
      const res = await apiFetch<{ user: UserProfile; permissions: PermissionRecord[] }>('/api/users', {
        method: 'POST',
        body: JSON.stringify(newAccount),
      });
      setUsers((prev) => [...prev, res.user]);
      setPermissions(res.permissions);
      setNewAccount({ phoneOrEmail: '', fullName: '', password: '', role: 'student' });
      setStatusMsg(`Đã tạo tài khoản ${res.user.fullName}.`);
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Lỗi tạo tài khoản.');
    }
  }

  async function updatePerm(perm: PermissionRecord, patch: Partial<PermissionRecord>) {
    try {
      const updated = { ...perm, ...patch };
      const res = await apiFetch<{ permissions: PermissionRecord[] }>('/api/permissions', {
        method: 'PUT',
        body: JSON.stringify(updated),
      });
      setPermissions(res.permissions);
      setStatusMsg('Đã cập nhật phân quyền người dùng.');
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Không thể cập nhật phân quyền.');
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Shield className="w-6 h-6 text-[#0F62FE]" /> Người dùng & Phân quyền RBAC
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Admin toàn quyền cấu hình và tạo tài khoản; Giáo viên cấp quyền điều khiển dự án/task cho Học sinh.
        </p>
      </div>

      {statusMsg && (
        <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 text-sm text-blue-800 dark:text-blue-200">
          {statusMsg}
        </div>
      )}

      {currentUser.role === 'admin' && (
        <form
          onSubmit={handleCreateUser}
          className="p-5 rounded-2xl bg-white dark:bg-[#131C2A] border border-slate-200/80 dark:border-slate-800 space-y-3"
        >
          <h2 className="text-sm font-bold flex items-center gap-1.5">
            <UserPlus className="w-4 h-4 text-[#0F62FE]" /> Tạo tài khoản mới
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <input
              type="text"
              required
              placeholder="SĐT hoặc Email"
              value={newAccount.phoneOrEmail}
              onChange={(e) => setNewAccount({ ...newAccount, phoneOrEmail: e.target.value })}
              className="h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B111A] text-sm"
            />
            <input
              type="text"
              required
              placeholder="Họ và tên"
              value={newAccount.fullName}
              onChange={(e) => setNewAccount({ ...newAccount, fullName: e.target.value })}
              className="h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B111A] text-sm"
            />
            <input
              type="password"
              required
              placeholder="Mật khẩu (>=6 ký tự)"
              value={newAccount.password}
              onChange={(e) => setNewAccount({ ...newAccount, password: e.target.value })}
              className="h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B111A] text-sm"
            />
            <select
              value={newAccount.role}
              onChange={(e) => setNewAccount({ ...newAccount, role: e.target.value as UserRole })}
              className="h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B111A] text-sm"
            >
              <option value="student">Học sinh</option>
              <option value="teacher">Giáo viên</option>
              <option value="admin">Admin</option>
            </select>
            <button
              type="submit"
              className="h-10 rounded-lg bg-[#0F62FE] text-white text-sm font-semibold cursor-pointer"
            >
              Tạo tài khoản
            </button>
          </div>
        </form>
      )}

      <div className="space-y-4">
        {users.map((u) => {
          const userPerms = permissions.filter((p) => p.userId === u.id);
          return (
            <div
              key={u.id}
              className="p-5 rounded-2xl bg-white dark:bg-[#131C2A] border border-slate-200/80 dark:border-slate-800 space-y-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-base font-bold">{u.fullName}</div>
                  <div className="text-xs font-mono text-slate-500">
                    {u.phoneOrEmail} · Vai trò: {u.role.toUpperCase()}
                  </div>
                </div>
                {u.role === 'student' && (
                  <span className="text-xs text-amber-600 dark:text-amber-400 font-medium flex items-center gap-1">
                    <Lock className="w-3.5 h-3.5" /> Mặc định khóa thay đổi ngưỡng an toàn
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {snapshot.projects.map((proj) => {
                  const p = userPerms.find((item) => item.projectId === proj.id) || {
                    id: `perm_${u.id}_${proj.id}`,
                    userId: u.id,
                    projectId: proj.id,
                    canView: true,
                    canControl: true,
                    canChangeSafety: false,
                    allowedTaskIds: [],
                  };
                  return (
                    <div
                      key={proj.id}
                      className="p-3 rounded-xl bg-slate-50 dark:bg-[#0B111A] border border-slate-200/70 dark:border-slate-800 space-y-2 text-xs"
                    >
                      <div className="font-bold text-sm">{proj.name}</div>
                      <label className="flex items-center justify-between cursor-pointer">
                        <span>Xem thông số</span>
                        <input
                          type="checkbox"
                          checked={p.canView}
                          disabled={u.role === 'admin'}
                          onChange={(e) => updatePerm(p, { canView: e.target.checked })}
                        />
                      </label>
                      <label className="flex items-center justify-between cursor-pointer">
                        <span>Điều khiển thiết bị</span>
                        <input
                          type="checkbox"
                          checked={p.canControl}
                          disabled={u.role === 'admin'}
                          onChange={(e) => updatePerm(p, { canControl: e.target.checked })}
                        />
                      </label>
                      <label className="flex items-center justify-between cursor-pointer">
                        <span>Sửa giới hạn an toàn</span>
                        <input
                          type="checkbox"
                          checked={p.canChangeSafety}
                          disabled={u.role === 'admin' || currentUser.role !== 'admin'}
                          onChange={(e) => updatePerm(p, { canChangeSafety: e.target.checked })}
                        />
                      </label>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const SettingsAccountView: React.FC<{
  user: UserProfile;
  darkMode: boolean;
  onToggleDark: () => void;
  installPrompt: { prompt: () => Promise<void> } | null;
  onLogout: () => void;
}> = ({ user, darkMode, onToggleDark, installPrompt, onLogout }) => {
  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Cài đặt & Tài khoản</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Tùy chỉnh giao diện, cài đặt ứng dụng di động PWA và thông tin phiên làm việc.
        </p>
      </div>

      <div className="p-5 rounded-2xl bg-white dark:bg-[#131C2A] border border-slate-200/80 dark:border-slate-800 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-base font-bold">{user.fullName}</div>
            <div className="text-xs font-mono text-slate-500">{user.phoneOrEmail} · Vai trò: {user.role}</div>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="h-10 px-4 rounded-xl border border-red-200 dark:border-red-900 text-red-600 text-sm font-semibold cursor-pointer"
          >
            Đăng xuất
          </button>
        </div>

        <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold">Chế độ giao diện</div>
            <div className="text-xs text-slate-500">Chuyển đổi giữa nền Sáng và Tối</div>
          </div>
          <button
            type="button"
            onClick={onToggleDark}
            className="h-10 px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold cursor-pointer"
          >
            {darkMode ? 'Đang dùng Nền Tối' : 'Đang dùng Nền Sáng'}
          </button>
        </div>

        <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Smartphone className="w-5 h-5 text-[#0F62FE]" />
            <div>
              <div className="text-sm font-semibold">Ứng dụng di động Android / iOS (PWA & Flutter)</div>
              <div className="text-xs text-slate-500">
                Cài đặt TP STEM Control lên màn hình chính hoặc biên dịch mã nguồn Flutter đính kèm.
              </div>
            </div>
          </div>
          {installPrompt && (
            <button
              type="button"
              onClick={() => installPrompt.prompt()}
              className="h-10 px-4 rounded-xl bg-[#0F62FE] text-white text-sm font-semibold cursor-pointer"
            >
              Cài đặt ngay
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
