import React, { useState } from 'react';
import {
  Activity,
  Bell,
  Car,
  Cpu,
  Flame,
  FolderKanban,
  History,
  Home,
  LayoutGrid,
  LogOut,
  Menu,
  Mic,
  Moon,
  Search,
  Settings,
  Sun,
  User,
  Users,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import type { NotificationItem, ProjectId, UserProfile } from '../types';

export type NavSection =
  | 'home'
  | 'projects'
  | 'project_voicebot'
  | 'project_car'
  | 'project_grill'
  | 'devices'
  | 'sensors'
  | 'history'
  | 'notifications'
  | 'users'
  | 'settings';

interface AppShellProps {
  user: UserProfile;
  activeNav: NavSection;
  onNavigate: (nav: NavSection) => void;
  searchQuery: string;
  onSearchChange: (val: string) => void;
  wsConnected: boolean;
  darkMode: boolean;
  onToggleDark: () => void;
  notifications: NotificationItem[];
  onMarkAllRead: () => void;
  onLogout: () => void;
  children: React.ReactNode;
}

const ROLE_LABELS: Record<UserProfile['role'], string> = {
  admin: 'Admin',
  teacher: 'Giáo viên',
  student: 'Học sinh',
};

export const AppShell: React.FC<AppShellProps> = ({
  user,
  activeNav,
  onNavigate,
  searchQuery,
  onSearchChange,
  wsConnected,
  darkMode,
  onToggleDark,
  notifications,
  onMarkAllRead,
  onLogout,
  children,
}) => {
  const [notifOpen, setNotifOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const unreadCount = notifications.filter((n) => !n.readBy.includes(user.id)).length;

  const sidebarItems: Array<{ id: NavSection; label: string; icon: React.ReactNode; roles?: UserProfile['role'][] }> = [
    { id: 'home', label: 'Tổng quan', icon: <Home className="w-4 h-4" /> },
    { id: 'projects', label: 'Dự án & Task', icon: <FolderKanban className="w-4 h-4" /> },
    { id: 'devices', label: 'Thiết bị ESP32', icon: <Cpu className="w-4 h-4" /> },
    { id: 'sensors', label: 'Dữ liệu cảm biến', icon: <Activity className="w-4 h-4" /> },
    { id: 'history', label: 'Lịch sử hoạt động', icon: <History className="w-4 h-4" /> },
    { id: 'notifications', label: 'Thông báo', icon: <Bell className="w-4 h-4" /> },
    { id: 'users', label: 'Người dùng & Quyền', icon: <Users className="w-4 h-4" />, roles: ['admin', 'teacher'] },
    { id: 'settings', label: 'Cài đặt', icon: <Settings className="w-4 h-4" /> },
  ];

  const projectShortcuts: Array<{ id: ProjectId; nav: NavSection; label: string; icon: React.ReactNode }> = [
    { id: 'voicebot', nav: 'project_voicebot', label: 'Voice Bot AI', icon: <Mic className="w-4 h-4" /> },
    { id: 'car', nav: 'project_car', label: 'Xe STEM', icon: <Car className="w-4 h-4" /> },
    { id: 'grill', nav: 'project_grill', label: 'Bếp nướng thông minh', icon: <Flame className="w-4 h-4" /> },
  ];

  const visibleSidebarItems = sidebarItems.filter((it) => !it.roles || it.roles.includes(user.role));

  return (
    <div className="min-h-screen flex flex-col bg-[#F4F6FA] dark:bg-[#0B111A] text-slate-900 dark:text-slate-100">
      {/* Top Header */}
      <header className="sticky top-0 z-30 h-16 bg-white/95 dark:bg-[#131C2A]/95 backdrop-blur border-b border-slate-200/80 dark:border-slate-800 px-3 sm:px-5 flex items-center justify-between gap-3">
        {/* Left: Logo + Mobile Menu Toggle */}
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Mở menu điều hướng"
            className="lg:hidden w-10 h-10 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-200 cursor-pointer"
          >
            <Menu className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={() => onNavigate('home')}
            className="flex items-center gap-2.5 text-left cursor-pointer"
          >
            <div className="w-9 h-9 rounded-lg bg-[#0F62FE] text-white flex items-center justify-center shrink-0">
              <Cpu className="w-5 h-5" />
            </div>
            <div className="truncate">
              <div className="text-sm sm:text-base font-bold tracking-tight leading-tight">TP STEM Control</div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 hidden sm:block">
                Quản lý & Điều khiển Thời gian thực
              </div>
            </div>
          </button>
        </div>

        {/* Center: Search bar */}
        <div className="hidden md:flex flex-1 max-w-md mx-4">
          <div className="relative w-full">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                onSearchChange(e.target.value);
                if (activeNav !== 'home' && activeNav !== 'projects') {
                  onNavigate('home');
                }
              }}
              placeholder="Tìm kiếm dự án STEM..."
              className="w-full h-9 pl-9 pr-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B111A] text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#0F62FE]"
            />
          </div>
        </div>

        {/* Right: Status, Notifications, Dark Mode, Avatar */}
        <div className="flex items-center gap-2">
          {/* System Connection Status */}
          <div
            className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium ${
              wsConnected
                ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
                : 'border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300'
            }`}
          >
            {wsConnected ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
            <span>{wsConnected ? 'Hệ thống trực tuyến' : 'Mất kết nối WS'}</span>
          </div>

          {/* Notifications Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setNotifOpen(!notifOpen)}
              aria-label="Thông báo"
              className="relative w-10 h-10 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              <Bell className="w-4 h-4" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>

            {notifOpen && (
              <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white dark:bg-[#131C2A] border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-50 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                  <span className="text-sm font-semibold">Thông báo hệ thống</span>
                  <button
                    type="button"
                    onClick={() => {
                      onMarkAllRead();
                      setNotifOpen(false);
                    }}
                    className="text-xs font-medium text-[#0F62FE] dark:text-blue-400 hover:underline cursor-pointer"
                  >
                    Đánh dấu đã đọc
                  </button>
                </div>
                <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                  {notifications.slice(0, 6).map((n) => (
                    <div key={n.id} className="px-4 py-3 text-sm">
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <span
                          className={`text-xs font-semibold ${
                            n.severity === 'danger'
                              ? 'text-red-600 dark:text-red-400'
                              : n.severity === 'warning'
                              ? 'text-amber-600 dark:text-amber-400'
                              : 'text-emerald-600 dark:text-emerald-400'
                          }`}
                        >
                          {n.title}
                        </span>
                        <span className="text-[11px] font-mono text-slate-400">
                          {new Date(n.createdAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-400">{n.message}</p>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setNotifOpen(false);
                    onNavigate('notifications');
                  }}
                  className="w-full py-2.5 text-xs font-semibold text-center text-[#0F62FE] dark:text-blue-400 bg-slate-50 dark:bg-slate-900/50 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Xem tất cả thông báo
                </button>
              </div>
            )}
          </div>

          {/* Dark Mode Toggle */}
          <button
            type="button"
            onClick={onToggleDark}
            aria-label="Chuyển chế độ sáng tối"
            className="w-10 h-10 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
          >
            {darkMode ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
          </button>

          {/* User Avatar */}
          <div className="flex items-center gap-2 pl-2 border-l border-slate-200 dark:border-slate-800">
            <div
              className="w-9 h-9 rounded-lg text-white font-bold text-xs flex items-center justify-center shrink-0"
              style={{ backgroundColor: user.avatarColor || '#0F62FE' }}
              title={user.fullName}
            >
              {user.fullName.slice(0, 2).toUpperCase()}
            </div>
            <div className="hidden xl:block text-left">
              <div className="text-xs font-semibold leading-tight truncate max-w-[140px]">{user.fullName}</div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">{ROLE_LABELS[user.role]}</div>
            </div>
            <button
              type="button"
              onClick={onLogout}
              title="Đăng xuất"
              aria-label="Đăng xuất"
              className="w-9 h-9 rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 flex items-center justify-center cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Layout */}
      <div className="flex-1 flex max-w-[1600px] w-full mx-auto">
        {/* Desktop Sidebar */}
        <aside className="hidden lg:flex w-64 shrink-0 flex-col justify-between border-r border-slate-200/80 dark:border-slate-800 bg-white dark:bg-[#131C2A] p-4">
          <div className="space-y-6">
            <nav className="space-y-1">
              <div className="px-3 mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Điều hướng chính
              </div>
              {visibleSidebarItems.map((item) => {
                const active = activeNav === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onNavigate(item.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                      active
                        ? 'bg-[#0F62FE] text-white'
                        : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/70'
                    }`}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>

            <nav className="space-y-1">
              <div className="px-3 mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Truy cập nhanh dự án
              </div>
              {projectShortcuts.map((proj) => {
                const active = activeNav === proj.nav;
                return (
                  <button
                    key={proj.id}
                    type="button"
                    onClick={() => onNavigate(proj.nav)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                      active
                        ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/70'
                    }`}
                  >
                    {proj.icon}
                    <span>{proj.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>

          <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#0B111A] border border-slate-200 dark:border-slate-800 text-xs">
            <div className="font-semibold text-slate-700 dark:text-slate-200 mb-0.5">
              Vai trò: {ROLE_LABELS[user.role]}
            </div>
            <div className="text-slate-500 dark:text-slate-400 truncate">{user.phoneOrEmail}</div>
          </div>
        </aside>

        {/* Mobile Drawer */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-50 lg:hidden flex">
            <div className="fixed inset-0 bg-black/50" onClick={() => setMobileMenuOpen(false)} />
            <div className="relative w-72 max-w-[85vw] bg-white dark:bg-[#131C2A] h-full p-4 flex flex-col justify-between z-10 overflow-y-auto">
              <div>
                <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-200 dark:border-slate-800">
                  <span className="font-bold text-base">TP STEM Control</span>
                  <button
                    type="button"
                    onClick={() => setMobileMenuOpen(false)}
                    className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="space-y-1">
                  {visibleSidebarItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        onNavigate(item.id);
                        setMobileMenuOpen(false);
                      }}
                      className={`w-full min-h-[44px] flex items-center gap-3 px-3 rounded-lg text-sm font-medium ${
                        activeNav === item.id
                          ? 'bg-[#0F62FE] text-white'
                          : 'text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {item.icon}
                      <span>{item.label}</span>
                    </button>
                  ))}
                </div>
              </div>
              <button
                type="button"
                onClick={onLogout}
                className="w-full min-h-[44px] flex items-center justify-center gap-2 rounded-lg border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 text-sm font-semibold"
              >
                <LogOut className="w-4 h-4" />
                Đăng xuất
              </button>
            </div>
          </div>
        )}

        {/* Content Area */}
        <main className="flex-1 min-w-0 p-4 sm:p-6 pb-24 lg:pb-8">{children}</main>
      </div>

      {/* Mobile 5-Tab Bottom Navigation */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white/95 dark:bg-[#131C2A]/95 backdrop-blur border-t border-slate-200 dark:border-slate-800 grid grid-cols-5 safe-pb">
        {[
          { id: 'home' as NavSection, label: 'Trang chủ', icon: <Home className="w-5 h-5" /> },
          { id: 'projects' as NavSection, label: 'Dự án', icon: <LayoutGrid className="w-5 h-5" /> },
          { id: 'notifications' as NavSection, label: 'Thông báo', icon: <Bell className="w-5 h-5" />, badge: unreadCount },
          { id: 'history' as NavSection, label: 'Lịch sử', icon: <History className="w-5 h-5" /> },
          { id: 'settings' as NavSection, label: 'Tài khoản', icon: <User className="w-5 h-5" /> },
        ].map((tab) => {
          const isActive =
            activeNav === tab.id ||
            (tab.id === 'projects' &&
              (activeNav === 'project_voicebot' || activeNav === 'project_car' || activeNav === 'project_grill'));
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onNavigate(tab.id)}
              className={`relative min-h-[56px] flex flex-col items-center justify-center gap-1 text-[11px] font-medium cursor-pointer ${
                isActive ? 'text-[#0F62FE] dark:text-blue-400' : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              <div className="relative">
                {tab.icon}
                {tab.badge && tab.badge > 0 ? (
                  <span className="absolute -top-1.5 -right-2 min-w-[16px] h-[16px] px-1 rounded-full bg-red-600 text-white text-[9px] font-bold flex items-center justify-center">
                    {tab.badge > 9 ? '9+' : tab.badge}
                  </span>
                ) : null}
              </div>
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
};
