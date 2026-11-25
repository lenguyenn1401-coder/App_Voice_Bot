import React, { useEffect, useRef, useState } from 'react';
import { AppShell, type NavSection } from './components/AppShell';
import { HomeView } from './components/HomeView';
import { LoginScreen } from './components/LoginScreen';
import {
  CommandHistoryView,
  DevicesMqttView,
  NotificationsCenterView,
  ProjectsTasksView,
  SensorsTelemetryView,
  SettingsAccountView,
  UsersPermissionsView,
} from './components/ManagementViews';
import { SmartGrillView } from './components/SmartGrillView';
import { StemCarView } from './components/StemCarView';
import { VoiceBotView } from './components/VoiceBotView';
import { apiFetch, getAuthToken, setAuthToken } from './lib/api';
import type { PermissionRecord, RealtimeSnapshot, UserProfile } from './types';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

export function App() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [permissions, setPermissions] = useState<PermissionRecord[]>([]);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [activeNav, setActiveNav] = useState<NavSection>('home');
  const [searchQuery, setSearchQuery] = useState('');
  const [snapshot, setSnapshot] = useState<RealtimeSnapshot | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem('tp_stem_dark') === '1';
    } catch {
      return false;
    }
  });

  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) root.classList.add('dark');
    else root.classList.remove('dark');
    try {
      localStorage.setItem('tp_stem_dark', darkMode ? '1' : '0');
    } catch {
      // ignore
    }
  }, [darkMode]);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  useEffect(() => {
    apiFetch<{ user: UserProfile; permissions: PermissionRecord[] }>('/api/auth/me')
      .then((res) => {
        setUser(res.user);
        setPermissions(res.permissions);
      })
      .catch(() => {
        setUser(null);
      })
      .finally(() => {
        setCheckingAuth(false);
      });
  }, []);

  // Load initial snapshot and connect WebSocket when logged in
  useEffect(() => {
    if (!user) {
      wsRef.current?.close();
      wsRef.current = null;
      setWsConnected(false);
      return;
    }

    let cancelled = false;
    let reconnectTimer: number | null = null;

    apiFetch<RealtimeSnapshot>('/api/snapshot')
      .then((snap) => {
        if (!cancelled) setSnapshot(snap);
      })
      .catch(() => {});

    const connectWs = () => {
      if (cancelled) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const token = getAuthToken();
      const qs = token ? `?token=${encodeURIComponent(token)}` : '';
      const ws = new WebSocket(`${proto}//${window.location.host}/ws${qs}`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!cancelled) setWsConnected(true);
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data));
          if (msg.event === 'state_update' && msg.payload) {
            setSnapshot(msg.payload as RealtimeSnapshot);
          }
        } catch {
          // ignore
        }
      };
      ws.onclose = () => {
        if (!cancelled) {
          setWsConnected(false);
          reconnectTimer = window.setTimeout(connectWs, 2500);
        }
      };
    };

    connectWs();

    return () => {
      cancelled = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [user]);

  async function handleLogout() {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    setAuthToken(null);
    setUser(null);
    setSnapshot(null);
    setActiveNav('home');
  }

  async function handleMarkAllRead() {
    try {
      await apiFetch('/api/notifications/read-all', { method: 'POST' });
      const snap = await apiFetch<RealtimeSnapshot>('/api/snapshot');
      setSnapshot(snap);
    } catch {
      // ignore
    }
  }

  if (checkingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F4F6FA] dark:bg-[#0B111A] text-sm text-slate-500">
        Đang tải hệ thống TP STEM Control...
      </div>
    );
  }

  if (!user) {
    return (
      <LoginScreen
        darkMode={darkMode}
        onToggleDark={() => setDarkMode(!darkMode)}
        onSuccess={(u, perms) => {
          setUser(u);
          setPermissions(perms);
          setActiveNav('home');
        }}
      />
    );
  }

  return (
    <AppShell
      user={user}
      activeNav={activeNav}
      onNavigate={setActiveNav}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      wsConnected={wsConnected}
      darkMode={darkMode}
      onToggleDark={() => setDarkMode(!darkMode)}
      notifications={snapshot?.notifications || []}
      onMarkAllRead={handleMarkAllRead}
      onLogout={handleLogout}
    >
      {!snapshot ? (
        <div className="py-16 text-center text-sm text-slate-500">Đang đồng bộ trạng thái thiết bị...</div>
      ) : (
        <>
          {activeNav === 'home' && (
            <HomeView
              snapshot={snapshot}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              onOpenProject={setActiveNav}
            />
          )}
          {activeNav === 'project_voicebot' && (
            <VoiceBotView
              snapshot={snapshot}
              onBack={() => setActiveNav('home')}
              onSnapshotUpdate={setSnapshot}
            />
          )}
          {activeNav === 'project_car' && (
            <StemCarView
              snapshot={snapshot}
              onBack={() => setActiveNav('home')}
              onSnapshotUpdate={setSnapshot}
            />
          )}
          {activeNav === 'project_grill' && (
            <SmartGrillView
              snapshot={snapshot}
              onBack={() => setActiveNav('home')}
              onSnapshotUpdate={setSnapshot}
            />
          )}
          {activeNav === 'projects' && (
            <ProjectsTasksView snapshot={snapshot} onOpenProject={setActiveNav} />
          )}
          {activeNav === 'devices' && (
            <DevicesMqttView snapshot={snapshot} onSnapshotUpdate={setSnapshot} />
          )}
          {activeNav === 'sensors' && <SensorsTelemetryView snapshot={snapshot} />}
          {activeNav === 'history' && <CommandHistoryView snapshot={snapshot} />}
          {activeNav === 'notifications' && (
            <NotificationsCenterView
              snapshot={snapshot}
              userId={user.id}
              onMarkAllRead={handleMarkAllRead}
            />
          )}
          {activeNav === 'users' && (
            <UsersPermissionsView currentUser={user} snapshot={snapshot} />
          )}
          {activeNav === 'settings' && (
            <SettingsAccountView
              user={user}
              darkMode={darkMode}
              onToggleDark={() => setDarkMode(!darkMode)}
              installPrompt={installPrompt}
              onLogout={handleLogout}
            />
          )}
        </>
      )}
    </AppShell>
  );
}

export default App;
