import React, { useState } from 'react';
import { Cpu, Eye, EyeOff, Lock, Moon, Phone, ShieldCheck, Sun, UserCheck, UserPlus } from 'lucide-react';
import { apiFetch, setAuthToken } from '../lib/api';
import type { PermissionRecord, UserProfile, UserRole } from '../types';

interface LoginScreenProps {
  darkMode: boolean;
  onToggleDark: () => void;
  onSuccess: (user: UserProfile, permissions: PermissionRecord[]) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ darkMode, onToggleDark, onSuccess }) => {
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [identifier, setIdentifier] = useState('0968230902');
  const [password, setPassword] = useState('Nguyenanh1');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (tab === 'login') {
        const res = await apiFetch<{ user: UserProfile; permissions: PermissionRecord[]; token: string }>(
          '/api/auth/login',
          {
            method: 'POST',
            body: JSON.stringify({ identifier, password }),
          }
        );
        setAuthToken(res.token);
        onSuccess(res.user, res.permissions);
      } else {
        const res = await apiFetch<{ user: UserProfile; permissions: PermissionRecord[]; token: string }>(
          '/api/auth/register',
          {
            method: 'POST',
            body: JSON.stringify({
              phoneOrEmail: identifier,
              fullName,
              password,
              confirmPassword,
            }),
          }
        );
        setAuthToken(res.token);
        onSuccess(res.user, res.permissions);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Đăng nhập thất bại.');
    } finally {
      setLoading(false);
    }
  }

  async function handleDemoLogin(role: UserRole) {
    setError(null);
    setLoading(true);
    try {
      const res = await apiFetch<{ user: UserProfile; permissions: PermissionRecord[]; token: string }>(
        '/api/auth/demo-login',
        {
          method: 'POST',
          body: JSON.stringify({ role }),
        }
      );
      setAuthToken(res.token);
      onSuccess(res.user, res.permissions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể đăng nhập nhanh.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col justify-between bg-[#F4F6FA] dark:bg-[#0B111A] px-4 py-6 sm:px-6">
      <div className="max-w-5xl w-full mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#0F62FE] text-white flex items-center justify-center shadow-sm">
            <Cpu className="w-5 h-5" />
          </div>
          <div>
            <div className="text-base font-bold tracking-tight text-slate-900 dark:text-slate-100">
              TP STEM Control
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Hệ thống Quản lý & Điều khiển STEM IoT Thời gian thực
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onToggleDark}
          aria-label="Chuyển chế độ sáng/tối"
          className="h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#131C2A] text-slate-700 dark:text-slate-200 flex items-center gap-2 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
        >
          {darkMode ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-600" />}
          <span className="hidden sm:inline">{darkMode ? 'Chế độ sáng' : 'Chế độ tối'}</span>
        </button>
      </div>

      <div className="max-w-4xl w-full mx-auto my-8 grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Left Info & Quick Role Demo */}
        <div className="lg:col-span-5 bg-white dark:bg-[#131C2A] border border-slate-200/80 dark:border-slate-800 rounded-xl p-6 flex flex-col justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-[#0F62FE] dark:text-blue-400 mb-2">
              Nền tảng Phòng Lab STEM
            </div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 tracking-tight mb-3">
              Điều khiển 3 dự án phần cứng đồng bộ Web & Di động
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-6">
              Truy cập tập trung Voice Bot AI, Xe STEM và Bếp nướng thông minh với cơ chế xác thực lệnh thời gian thực và bảo vệ an toàn phần cứng.
            </p>
          </div>

          <div className="space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Đăng nhập nhanh theo vai trò kiểm thử
            </div>
            <div className="grid grid-cols-1 gap-2.5">
              <button
                type="button"
                disabled={loading}
                onClick={() => handleDemoLogin('admin')}
                className="w-full min-h-[48px] px-3.5 py-2.5 rounded-lg border border-blue-200 dark:border-blue-900/60 bg-blue-50/70 dark:bg-blue-950/30 hover:bg-blue-100/80 dark:hover:bg-blue-900/40 text-left flex items-center justify-between transition-colors cursor-pointer"
              >
                <div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">Admin (Quản trị viên)</div>
                  <div className="text-xs font-mono text-slate-600 dark:text-slate-400">0968230902 · Toàn quyền hệ thống</div>
                </div>
                <ShieldCheck className="w-5 h-5 text-[#0F62FE] dark:text-blue-400 shrink-0" />
              </button>

              <button
                type="button"
                disabled={loading}
                onClick={() => handleDemoLogin('teacher')}
                className="w-full min-h-[48px] px-3.5 py-2.5 rounded-lg border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/30 hover:bg-emerald-100/80 dark:hover:bg-emerald-900/40 text-left flex items-center justify-between transition-colors cursor-pointer"
              >
                <div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">Giáo viên STEM</div>
                  <div className="text-xs font-mono text-slate-600 dark:text-slate-400">0912345678 · Vận hành & Cấp quyền</div>
                </div>
                <UserCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              </button>

              <button
                type="button"
                disabled={loading}
                onClick={() => handleDemoLogin('student')}
                className="w-full min-h-[48px] px-3.5 py-2.5 rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/30 hover:bg-amber-100/80 dark:hover:bg-amber-900/40 text-left flex items-center justify-between transition-colors cursor-pointer"
              >
                <div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">Học sinh</div>
                  <div className="text-xs font-mono text-slate-600 dark:text-slate-400">0987654321 · Task được phân công</div>
                </div>
                <UserPlus className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
              </button>
            </div>
          </div>
        </div>

        {/* Right Form */}
        <div className="lg:col-span-7 bg-white dark:bg-[#131C2A] border border-slate-200/80 dark:border-slate-800 rounded-xl p-6 sm:p-8 flex flex-col justify-center">
          <div className="flex border-b border-slate-200 dark:border-slate-800 mb-6">
            <button
              type="button"
              onClick={() => {
                setTab('login');
                setError(null);
              }}
              className={`pb-3 px-4 text-sm font-semibold border-b-2 transition-colors cursor-pointer ${
                tab === 'login'
                  ? 'border-[#0F62FE] text-[#0F62FE] dark:text-blue-400'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              Đăng nhập tài khoản
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('register');
                setIdentifier('');
                setPassword('');
                setConfirmPassword('');
                setError(null);
              }}
              className={`pb-3 px-4 text-sm font-semibold border-b-2 transition-colors cursor-pointer ${
                tab === 'register'
                  ? 'border-[#0F62FE] text-[#0F62FE] dark:text-blue-400'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              Tạo tài khoản mới
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {tab === 'register' && (
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Họ và tên
                </label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Ví dụ: Nguyễn Minh Tuấn"
                  className="w-full h-11 px-3.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B111A] text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F62FE]"
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Số điện thoại hoặc Email
              </label>
              <div className="relative">
                <Phone className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  required
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="0968230902 hoặc email@tpstem.vn"
                  className="w-full h-11 pl-10 pr-3.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B111A] text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F62FE]"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Mật khẩu
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type={showPass ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Nhập mật khẩu"
                  className="w-full h-11 pl-10 pr-11 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B111A] text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F62FE]"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  aria-label="Hiện/ẩn mật khẩu"
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {tab === 'register' && (
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Xác nhận mật khẩu
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type={showPass ? 'text' : 'password'}
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Nhập lại mật khẩu"
                    className="w-full h-11 pl-10 pr-3.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B111A] text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F62FE]"
                  />
                </div>
              </div>
            )}

            {error && (
              <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-sm text-red-700 dark:text-red-300">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full h-11 rounded-lg bg-[#0F62FE] hover:bg-blue-700 text-white font-semibold text-sm transition-colors disabled:opacity-60 cursor-pointer"
            >
              {loading
                ? 'Đang xử lý...'
                : tab === 'login'
                ? 'Đăng nhập vào TP STEM Control'
                : 'Tạo tài khoản và đăng nhập'}
            </button>
          </form>
        </div>
      </div>

      <div className="max-w-5xl w-full mx-auto text-center text-xs text-slate-500 dark:text-slate-400">
        TP STEM Control · Hỗ trợ Desktop Web, Mobile PWA & Giao thức thời gian thực WebSocket/MQTT
      </div>
    </div>
  );
};
