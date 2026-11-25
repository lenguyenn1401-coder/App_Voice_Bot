import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  Cpu,
  Download,
  Edit3,
  MessageSquare,
  MessageSquarePlus,
  Mic,
  MicOff,
  Play,
  Radio,
  Search,
  Send,
  ShieldAlert,
  Sliders,
  Square,
  Terminal,
  Trash2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { apiFetch, triggerHaptic } from '../lib/api';
import type {
  ChatMessage,
  Conversation,
  PendingCalendarProposal,
  PendingVoiceCommand,
  RealtimeSnapshot,
  VoiceBotMode,
  VoiceBotPreferences,
} from '../types';
import { VoiceBotCalendarPanel } from './VoiceBotCalendarPanel';
import { VoiceBotFlasherPanel } from './VoiceBotFlasherPanel';
import { VoiceBotHardwarePanel } from './VoiceBotHardwarePanel';

interface VoiceBotViewProps {
  snapshot: RealtimeSnapshot;
  onBack: () => void;
  onSnapshotUpdate: (snap: RealtimeSnapshot) => void;
}

type VoiceBotTab = 'chat' | 'hardware' | 'calendar' | 'flasher';

const MODES: Array<{ id: VoiceBotMode; label: string; desc: string }> = [
  { id: 'chat', label: 'Trò chuyện tự do', desc: 'Giao tiếp tự nhiên với trợ lý robot' },
  { id: 'stem_qa', label: 'Hỏi đáp kiến thức STEM', desc: 'Giải thích điện tử, lập trình, vật lý' },
  { id: 'english', label: 'Học tiếng Anh', desc: 'Luyện hội thoại tiếng Anh chủ đề STEM' },
  { id: 'story', label: 'Kể chuyện', desc: 'Kể chuyện khoa học & sáng tạo' },
  { id: 'quiz', label: 'Đố vui', desc: 'Thử thách câu hỏi trắc nghiệm STEM' },
  { id: 'device_cmd', label: 'Ra lệnh điều khiển thiết bị', desc: 'Điều khiển ESP32-S3, Xe STEM & Bếp nướng' },
];

const QUICK_COMMANDS = [
  'Hôm nay tôi có lịch gì?',
  'Xe tiến lên.',
  'Quay servo sang trái.',
  'Bật đèn báo trạng thái.',
  'Đọc nhiệt độ bếp nướng.',
  'Bật quạt làm mát.',
  'Bật bếp nướng lên 200 độ.',
];

interface BrowserSpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

export const VoiceBotView: React.FC<VoiceBotViewProps> = ({
  snapshot,
  onBack,
  onSnapshotUpdate,
}) => {
  const { voicebot, recentCommands } = snapshot;

  const [activeTab, setActiveTab] = useState<VoiceBotTab>('chat');
  const [selectedDeviceId, setSelectedDeviceId] = useState('esp32s3-stem-01');

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [continuousMode, setContinuousMode] = useState(false);
  const [historySearch, setHistorySearch] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [editingTitle, setEditingTitle] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState('');
  const [pendingConfirm, setPendingConfirm] = useState<PendingVoiceCommand | null>(null);
  const [pendingCalendar, setPendingCalendar] = useState<PendingCalendarProposal | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);

  // Assistant Preferences Modal
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [prefs, setPrefs] = useState<VoiceBotPreferences | null>(null);
  const [prefName, setPrefName] = useState(voicebot.assistantName || 'Trợ lý STEM');
  const [prefStyle, setPrefStyle] = useState(voicebot.stylePrompt || '');
  const [prefModel, setPrefModel] = useState(voicebot.model || 'gemini-4-hydrogen');
  const [prefVoice, setPrefVoice] = useState(voicebot.ttsVoice || 'Kore');
  const [savingPrefs, setSavingPrefs] = useState(false);

  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const continuousRef = useRef(false);
  continuousRef.current = continuousMode;

  useEffect(() => {
    loadConversations();
    loadPreferences();
  }, []);

  useEffect(() => {
    if (activeConvId) {
      loadMessages(activeConvId);
    }
  }, [activeConvId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isSending, pendingCalendar]);

  async function loadPreferences() {
    try {
      const p = await apiFetch<VoiceBotPreferences>('/api/preferences');
      setPrefs(p);
      setPrefName(p.assistantName);
      setPrefStyle(p.stylePrompt);
      setPrefModel(p.model);
      setPrefVoice(p.voice);
    } catch {
      // ignore
    }
  }

  async function handleSavePreferences(e: React.FormEvent) {
    e.preventDefault();
    setSavingPrefs(true);
    setErrorMsg(null);
    try {
      const updated = await apiFetch<VoiceBotPreferences>('/api/preferences', {
        method: 'PUT',
        body: JSON.stringify({
          assistantName: prefName,
          stylePrompt: prefStyle,
          model: prefModel,
          voice: prefVoice,
        }),
      });
      setPrefs(updated);
      setPrefsOpen(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Không thể lưu tùy chỉnh trợ lý.');
    } finally {
      setSavingPrefs(false);
    }
  }

  async function loadConversations() {
    try {
      const res = await apiFetch<{ conversations: Conversation[] }>('/api/voicebot/conversations');
      setConversations(res.conversations);
      if (res.conversations.length > 0 && !activeConvId) {
        setActiveConvId(res.conversations[0].id);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Không tải được lịch sử hội thoại.');
    }
  }

  async function loadMessages(convId: string) {
    try {
      const res = await apiFetch<{ messages: ChatMessage[] }>(`/api/voicebot/conversations/${convId}/messages`);
      setMessages(res.messages);
    } catch {
      setMessages([]);
    }
  }

  async function sendCommand(action: string, value: Record<string, unknown>, taskId = 'vb_ai_cmd') {
    setErrorMsg(null);
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
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Lỗi gửi lệnh Voice Bot.');
    }
  }

  function speakText(text: string) {
    if (!voicebot.speakerEnabled || voicebot.muted || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = voicebot.language === 'en' ? 'en-US' : 'vi-VN';
      utter.volume = Math.max(0, Math.min(1, voicebot.volume / 100));
      utter.rate = voicebot.speechRate;
      utter.pitch = voicebot.voiceGender === 'female' ? 1.15 : 0.85;
      window.speechSynthesis.speak(utter);
    } catch {
      // Ignore synthesis error
    }
  }

  function stopSpeaking() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    sendCommand('set_activity', { activityState: 'Đang chờ' });
  }

  async function handleAsk(text: string, source: 'voice' | 'keyboard' = 'keyboard') {
    const trimmed = text.trim();
    if (!trimmed || isSending) return;
    setErrorMsg(null);
    setIsSending(true);
    if (source === 'keyboard') setInputText('');

    try {
      const res = await apiFetch<{
        conversationId: string;
        userMessage: ChatMessage;
        botMessage: ChatMessage;
        pendingConfirmation: PendingVoiceCommand | null;
        calendarProposal: PendingCalendarProposal | null;
        snapshot: RealtimeSnapshot;
      }>('/api/voicebot/ask', {
        method: 'POST',
        body: JSON.stringify({
          conversationId: activeConvId,
          text: trimmed,
          source,
          mode: voicebot.mode,
          language: voicebot.language,
        }),
      });

      if (res.conversationId !== activeConvId) {
        setActiveConvId(res.conversationId);
      }
      setMessages((prev) => [...prev, res.userMessage, res.botMessage]);
      onSnapshotUpdate(res.snapshot);
      if (res.pendingConfirmation) {
        setPendingConfirm(res.pendingConfirmation);
      }
      if (res.calendarProposal) {
        setPendingCalendar(res.calendarProposal);
      }
      speakText(res.botMessage.text);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Không thể gửi câu hỏi.');
    } finally {
      setIsSending(false);
    }
  }

  async function confirmPendingCommand() {
    if (!pendingConfirm) return;
    const cmd = pendingConfirm;
    setPendingConfirm(null);
    try {
      const res = await apiFetch<{ snapshot: RealtimeSnapshot }>('/api/commands', {
        method: 'POST',
        body: JSON.stringify({
          projectId: cmd.projectId,
          taskId: cmd.taskId,
          action: cmd.action,
          value: cmd.value,
          confirmDangerous: true,
        }),
      });
      onSnapshotUpdate(res.snapshot);
      triggerHaptic([30, 40, 30]);
      await handleAsk(`Đã xác nhận thực hiện: ${cmd.humanLabel}`, 'keyboard');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Không thể xác nhận lệnh.');
    }
  }

  async function confirmPendingCalendar() {
    if (!pendingCalendar?.event) return;
    const proposal = pendingCalendar;
    setPendingCalendar(null);
    try {
      await apiFetch('/api/events', {
        method: 'POST',
        body: JSON.stringify(proposal.event),
      });
      triggerHaptic([20, 30, 20]);
      setMessages((prev) => [
        ...prev,
        {
          id: `cal_${Date.now()}`,
          conversationId: activeConvId,
          sender: 'bot',
          text: `Đã lưu lịch thực hành "${proposal.event!.title}" (${proposal.event!.date}, ${proposal.event!.start}–${proposal.event!.end}) và đồng bộ xuống ESP32-S3.`,
          source: 'keyboard',
          mode: voicebot.mode,
          linkedCommandId: null,
          createdAt: new Date().toISOString(),
        },
      ]);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Không thể lưu lịch đề xuất.');
    }
  }

  function startSpeechRecognition(continuous: boolean) {
    if (!voicebot.micEnabled) {
      setErrorMsg('Micro đang tắt. Vui lòng bật Micro trước khi thu âm.');
      return;
    }
    const SpeechRec =
      (window as unknown as { SpeechRecognition?: new () => BrowserSpeechRecognition; webkitSpeechRecognition?: new () => BrowserSpeechRecognition })
        .SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => BrowserSpeechRecognition }).webkitSpeechRecognition;

    if (!SpeechRec) {
      setErrorMsg('Trình duyệt này chưa hỗ trợ Web Speech Recognition; vui lòng nhập câu hỏi bằng bàn phím.');
      return;
    }

    try {
      recognitionRef.current?.stop();
    } catch {
      // ignore
    }

    const rec = new SpeechRec();
    rec.lang = voicebot.language === 'en' ? 'en-US' : 'vi-VN';
    rec.continuous = continuous;
    rec.interimResults = false;
    rec.onresult = (ev) => {
      const last = ev.results[ev.results.length - 1];
      const transcript = last?.[0]?.transcript;
      if (transcript) {
        handleAsk(transcript, 'voice');
      }
    };
    rec.onerror = () => {
      setIsListening(false);
      setContinuousMode(false);
      sendCommand('set_activity', { activityState: 'Đang chờ' });
    };
    rec.onend = () => {
      if (continuousRef.current) {
        try {
          rec.start();
        } catch {
          setIsListening(false);
          setContinuousMode(false);
        }
      } else {
        setIsListening(false);
        sendCommand('set_activity', { activityState: 'Đang chờ' });
      }
    };
    recognitionRef.current = rec;
    setIsListening(true);
    triggerHaptic(20);
    sendCommand('set_activity', { activityState: 'Đang nghe' });
    try {
      rec.start();
    } catch {
      setIsListening(false);
    }
  }

  function stopSpeechRecognition() {
    setContinuousMode(false);
    setIsListening(false);
    try {
      recognitionRef.current?.stop();
    } catch {
      // ignore
    }
    sendCommand('set_activity', { activityState: 'Đang chờ' });
  }

  async function handleNewConversation() {
    const res = await apiFetch<{ conversation: Conversation }>('/api/voicebot/conversations', {
      method: 'POST',
      body: JSON.stringify({
        title: `Hội thoại ${new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`,
        mode: voicebot.mode,
        language: voicebot.language,
      }),
    });
    setConversations((prev) => [res.conversation, ...prev]);
    setActiveConvId(res.conversation.id);
    setMessages([]);
  }

  async function handleRenameConversation(id: string) {
    if (!titleDraft.trim()) return;
    await apiFetch(`/api/voicebot/conversations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: titleDraft.trim() }),
    });
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, title: titleDraft.trim() } : c)));
    setEditingTitle(null);
  }

  async function handleDeleteConversation(id: string) {
    await apiFetch(`/api/voicebot/conversations/${id}`, { method: 'DELETE' });
    const remaining = conversations.filter((c) => c.id !== id);
    setConversations(remaining);
    if (activeConvId === id) {
      setActiveConvId(remaining[0]?.id || '');
      if (remaining.length === 0) setMessages([]);
    }
  }

  async function handleClearMessages() {
    if (!activeConvId) return;
    await apiFetch(`/api/voicebot/conversations/${activeConvId}/messages`, { method: 'DELETE' });
    setMessages([]);
  }

  function handleExportConversation() {
    const conv = conversations.find((c) => c.id === activeConvId);
    const lines = [
      `TP STEM Control — Xuất lịch sử Voice Bot AI`,
      `Cuộc hội thoại: ${conv?.title || activeConvId}`,
      `Ngày xuất: ${new Date().toLocaleString('vi-VN')}`,
      '----------------------------------------',
      ...messages.map(
        (m) => `[${new Date(m.createdAt).toLocaleString('vi-VN')}] ${m.sender === 'user' ? 'Người dùng' : voicebot.assistantName}: ${m.text}`
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `voicebot-${activeConvId || 'chat'}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const filteredConversations = useMemo(() => {
    return conversations.filter((c) => {
      const matchDate = !dateFilter || c.createdAt.slice(0, 10) === dateFilter;
      const matchText = !historySearch.trim() || c.title.toLowerCase().includes(historySearch.toLowerCase());
      return matchDate && matchText;
    });
  }, [conversations, dateFilter, historySearch]);

  const visibleMessages = useMemo(() => {
    if (!historySearch.trim()) return messages;
    const q = historySearch.toLowerCase();
    return messages.filter((m) => m.text.toLowerCase().includes(q));
  }, [messages, historySearch]);

  const voiceCommandsHistory = useMemo(
    () => recentCommands.filter((c) => c.projectId === 'car' || c.projectId === 'grill' || c.projectId === 'voicebot').slice(0, 8),
    [recentCommands]
  );

  return (
    <div className="space-y-5">
      {/* Top Sub-page Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#131C2A] text-sm font-medium flex items-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Trang chủ</span>
          </button>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Voice Bot AI — {voicebot.assistantName}</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Trợ lý giọng nói · Điều khiển ESP32-S3 ST7789/MAX98357A/GPIO · Lịch tuần GMT+7 · Nạp Firmware USB
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPrefsOpen(true)}
            className="h-10 px-3.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#131C2A] text-sm font-medium flex items-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
          >
            <Sliders className="w-4 h-4 text-[#0F62FE]" />
            <span>Tùy chỉnh trợ lý</span>
          </button>
          {activeTab === 'chat' && (
            <button
              type="button"
              onClick={() => setShowHistoryPanel(!showHistoryPanel)}
              className="h-10 px-3.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#131C2A] text-sm font-medium cursor-pointer xl:hidden"
            >
              {showHistoryPanel ? 'Ẩn lịch sử' : 'Lịch sử & Lệnh'}
            </button>
          )}
        </div>
      </div>

      {/* 1. KHU VỰC TRẠNG THÁI */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="p-3.5 rounded-xl bg-white dark:bg-[#131C2A] border border-slate-200/80 dark:border-slate-800">
          <div className="text-xs text-slate-500 dark:text-slate-400">Trạng thái Bot</div>
          <div className={`mt-1 text-sm font-bold flex items-center gap-1.5 ${voicebot.online ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600'}`}>
            <span className={`w-2 h-2 rounded-full ${voicebot.online ? 'bg-emerald-500' : 'bg-red-500'}`} />
            {voicebot.online ? 'Online' : 'Offline'}
          </div>
        </div>
        <div className="p-3.5 rounded-xl bg-white dark:bg-[#131C2A] border border-slate-200/80 dark:border-slate-800">
          <div className="text-xs text-slate-500 dark:text-slate-400">Micro & Loa</div>
          <div className="mt-1 text-sm font-bold">
            {voicebot.micEnabled ? 'Mic Bật' : 'Mic Tắt'} · {voicebot.muted ? 'Tắt tiếng' : `Loa ${voicebot.volume}%`}
          </div>
        </div>
        <div className="p-3.5 rounded-xl bg-white dark:bg-[#131C2A] border border-slate-200/80 dark:border-slate-800">
          <div className="text-xs text-slate-500 dark:text-slate-400">Hoạt động</div>
          <div className="mt-1 text-sm font-bold text-[#0F62FE] dark:text-blue-400">
            {isListening ? 'Đang nghe' : isSending ? 'Đang xử lý' : voicebot.activityState}
          </div>
        </div>
        <div className="p-3.5 rounded-xl bg-white dark:bg-[#131C2A] border border-slate-200/80 dark:border-slate-800">
          <div className="text-xs text-slate-500 dark:text-slate-400">ST7789 LCD</div>
          <div className="mt-1 text-sm font-mono font-bold tabular-nums">
            {voicebot.backlight}% · {voicebot.displayMode}
          </div>
        </div>
        <div className="p-3.5 rounded-xl bg-white dark:bg-[#131C2A] border border-slate-200/80 dark:border-slate-800">
          <div className="text-xs text-slate-500 dark:text-slate-400">Model & Giọng TTS</div>
          <div className="mt-1 text-xs font-mono font-bold truncate">
            {voicebot.model} · {voicebot.ttsVoice}
          </div>
        </div>
        <div className="p-3.5 rounded-xl bg-white dark:bg-[#131C2A] border border-slate-200/80 dark:border-slate-800">
          <div className="text-xs text-slate-500 dark:text-slate-400">Kết nối ESP32-S3</div>
          <div className="mt-1 text-sm font-mono font-bold truncate">{voicebot.connectionQuality}</div>
        </div>
      </div>

      {/* Sub-Tabs Navigation */}
      <div className="flex flex-wrap gap-2 p-1.5 rounded-xl bg-white dark:bg-[#131C2A] border border-slate-200/80 dark:border-slate-800">
        {[
          { id: 'chat' as VoiceBotTab, label: 'Hội thoại & AI', icon: MessageSquare },
          { id: 'hardware' as VoiceBotTab, label: 'Phần cứng ESP32-S3 & GPIO', icon: Cpu },
          { id: 'calendar' as VoiceBotTab, label: 'Lịch tuần & Nhắc lịch', icon: Calendar },
          { id: 'flasher' as VoiceBotTab, label: 'Nạp Firmware & Serial', icon: Terminal },
        ].map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`min-h-[42px] px-4 rounded-lg text-xs sm:text-sm font-semibold flex items-center gap-2 transition-colors cursor-pointer ${
                active
                  ? 'bg-[#0F62FE] text-white'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {errorMsg && (
        <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-sm text-red-700 dark:text-red-300 flex items-center justify-between">
          <span>{errorMsg}</span>
          <button type="button" onClick={() => setErrorMsg(null)} className="text-xs underline ml-3 cursor-pointer">
            Đóng
          </button>
        </div>
      )}

      {/* TAB 1: CHAT & VOICE CONVERSATION */}
      {activeTab === 'chat' && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
          {/* Left/Center: Modes + Conversation + Controls */}
          <div className="xl:col-span-8 space-y-4">
            {/* 4. CHẾ ĐỘ HOẠT ĐỘNG */}
            <div className="p-4 rounded-xl bg-white dark:bg-[#131C2A] border border-slate-200/80 dark:border-slate-800">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">
                Chế độ hoạt động Voice Bot
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {MODES.map((m) => {
                  const active = voicebot.mode === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => sendCommand('set_voice_options', { mode: m.id })}
                      className={`p-2.5 rounded-lg border text-left transition-colors cursor-pointer ${
                        active
                          ? 'border-[#0F62FE] bg-blue-50/80 dark:bg-blue-950/40 text-[#0F62FE] dark:text-blue-300'
                          : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                      }`}
                    >
                      <div className="text-xs font-bold">{m.label}</div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{m.desc}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 2. KHU VỰC HỘI THOẠI */}
            <div className="bg-white dark:bg-[#131C2A] border border-slate-200/80 dark:border-slate-800 rounded-xl flex flex-col h-[430px]">
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold">
                  {conversations.find((c) => c.id === activeConvId)?.title || 'Hội thoại trực tiếp'}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (voicebot.lastReply) speakText(voicebot.lastReply);
                    }}
                    className="h-8 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium flex items-center gap-1 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5" /> Phát lại
                  </button>
                  <button
                    type="button"
                    onClick={stopSpeaking}
                    className="h-8 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium flex items-center gap-1 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    <Square className="w-3.5 h-3.5" /> Ngắt lời
                  </button>
                  <button
                    type="button"
                    onClick={handleClearMessages}
                    className="h-8 px-2.5 rounded-lg border border-red-200 dark:border-red-900 text-xs font-medium text-red-600 dark:text-red-400 flex items-center gap-1 hover:bg-red-50 dark:hover:bg-red-950/30 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Xóa hội thoại
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {visibleMessages.length === 0 && (
                  <div className="h-full flex items-center justify-center text-sm text-slate-400 text-center px-6">
                    Nhấn giữ nút "Giữ để nói", hỏi lịch thực hành hôm nay hoặc nhập lệnh điều khiển thiết bị bên dưới.
                  </div>
                )}
                {visibleMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}
                  >
                    <div
                      className={`max-w-[82%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-line ${
                        msg.sender === 'user'
                          ? 'bg-[#0F62FE] text-white rounded-br-sm'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-bl-sm'
                      }`}
                    >
                      {msg.source === 'voice' && msg.sender === 'user' && (
                        <div className="text-[10px] uppercase tracking-wider opacity-80 mb-0.5 flex items-center gap-1">
                          <Mic className="w-3 h-3" /> Giọng nói → Văn bản
                        </div>
                      )}
                      {msg.text}
                    </div>
                    <span className="mt-1 text-[11px] font-mono text-slate-400">
                      {new Date(msg.createdAt).toLocaleTimeString('vi-VN', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                      {msg.linkedCommandId ? ` · Lệnh ${msg.linkedCommandId}` : ''}
                    </span>
                  </div>
                ))}
                {isSending && (
                  <div className="flex items-start">
                    <div className="px-4 py-2.5 rounded-2xl rounded-bl-sm bg-slate-100 dark:bg-slate-800 text-sm text-slate-600 dark:text-slate-300 animate-pulse">
                      {voicebot.assistantName} đang xử lý...
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              {/* Pending Calendar Proposal Confirmation Banner */}
              {pendingCalendar && (
                <div className="mx-4 mb-2 p-3 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div>
                    <div className="font-bold text-[#0F62FE] dark:text-blue-300">Xác nhận thay đổi lịch thực hành</div>
                    <div className="text-slate-700 dark:text-slate-200">{pendingCalendar.summary}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setPendingCalendar(null)}
                      className="h-8 px-3 rounded-lg border border-slate-300 dark:border-slate-700 cursor-pointer"
                    >
                      Hủy đề xuất
                    </button>
                    <button
                      type="button"
                      onClick={confirmPendingCalendar}
                      className="h-8 px-3 rounded-lg bg-[#0F62FE] text-white font-semibold cursor-pointer"
                    >
                      Xác nhận lưu lịch
                    </button>
                  </div>
                </div>
              )}

              {/* Quick Voice Command Samples */}
              <div className="px-4 py-2 border-t border-slate-100 dark:border-slate-800 flex items-center gap-2 overflow-x-auto">
                <span className="text-[11px] font-semibold text-slate-400 shrink-0">Lệnh mẫu:</span>
                {QUICK_COMMANDS.map((cmd) => (
                  <button
                    key={cmd}
                    type="button"
                    onClick={() => handleAsk(cmd, 'voice')}
                    className="shrink-0 px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-blue-950/40 text-xs text-slate-700 dark:text-slate-300 cursor-pointer"
                  >
                    “{cmd}”
                  </button>
                ))}
              </div>

              {/* Keyboard Input */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleAsk(inputText, 'keyboard');
                }}
                className="p-3 border-t border-slate-200 dark:border-slate-800 flex items-center gap-2"
              >
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder="Hỏi lịch thực hành, kiến thức ESP32-S3 hoặc ra lệnh thiết bị..."
                  className="flex-1 h-11 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B111A] text-sm focus:outline-none focus:ring-2 focus:ring-[#0F62FE]"
                />
                <button
                  type="submit"
                  disabled={isSending || !inputText.trim()}
                  className="h-11 px-4 rounded-xl bg-[#0F62FE] hover:bg-blue-700 text-white text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  <Send className="w-4 h-4" />
                  <span className="hidden sm:inline">Gửi</span>
                </button>
              </form>
            </div>

            {/* 3. ĐIỀU KHIỂN VOICE BOT */}
            <div className="p-4 rounded-xl bg-white dark:bg-[#131C2A] border border-slate-200/80 dark:border-slate-800 space-y-4">
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onPointerDown={() => {
                    setContinuousMode(false);
                    startSpeechRecognition(false);
                  }}
                  onPointerUp={() => {
                    if (!continuousMode) stopSpeechRecognition();
                  }}
                  onPointerLeave={() => {
                    if (isListening && !continuousMode) stopSpeechRecognition();
                  }}
                  className={`min-h-[46px] px-4 rounded-xl font-semibold text-sm flex items-center gap-2 transition-colors select-none cursor-pointer ${
                    isListening && !continuousMode
                      ? 'bg-red-600 text-white'
                      : 'bg-[#0F62FE] hover:bg-blue-700 text-white'
                  }`}
                >
                  <Mic className="w-4 h-4" />
                  <span>{isListening && !continuousMode ? 'Đang thu... (Thả để gửi)' : 'Nhấn giữ để nói'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (continuousMode) {
                      stopSpeechRecognition();
                    } else {
                      setContinuousMode(true);
                      startSpeechRecognition(true);
                    }
                  }}
                  className={`min-h-[46px] px-4 rounded-xl border text-sm font-semibold flex items-center gap-2 cursor-pointer ${
                    continuousMode
                      ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                      : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  <Radio className="w-4 h-4" />
                  <span>{continuousMode ? 'Đang nghe liên tục' : 'Nghe liên tục (1 chạm)'}</span>
                </button>

                <button
                  type="button"
                  onClick={stopSpeechRecognition}
                  className="min-h-[46px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium cursor-pointer"
                >
                  Dừng thu âm
                </button>

                <button
                  type="button"
                  onClick={() => sendCommand('toggle_mic', { enabled: !voicebot.micEnabled }, 'vb_mic')}
                  className={`min-h-[46px] px-3.5 rounded-xl border text-sm font-medium flex items-center gap-1.5 cursor-pointer ${
                    voicebot.micEnabled
                      ? 'border-slate-200 dark:border-slate-700'
                      : 'border-red-300 bg-red-50 dark:bg-red-950/30 text-red-600'
                  }`}
                >
                  {voicebot.micEnabled ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
                  <span>{voicebot.micEnabled ? 'Tắt Micro' : 'Bật Micro'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => sendCommand('toggle_speaker', { enabled: !voicebot.speakerEnabled }, 'vb_speaker')}
                  className={`min-h-[46px] px-3.5 rounded-xl border text-sm font-medium flex items-center gap-1.5 cursor-pointer ${
                    voicebot.speakerEnabled
                      ? 'border-slate-200 dark:border-slate-700'
                      : 'border-red-300 bg-red-50 dark:bg-red-950/30 text-red-600'
                  }`}
                >
                  {voicebot.speakerEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                  <span>{voicebot.speakerEnabled ? 'Tắt Loa' : 'Bật Loa'}</span>
                </button>
              </div>

              {/* Audio & Language Controls */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-3 border-t border-slate-100 dark:border-slate-800">
                <div>
                  <div className="flex justify-between text-xs font-medium mb-1">
                    <span>Âm lượng loa</span>
                    <span className="font-mono">{voicebot.volume}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={voicebot.volume}
                    onChange={(e) => sendCommand('set_volume', { volume: Number(e.target.value) }, 'vb_speaker')}
                    className="w-full accent-[#0F62FE]"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs font-medium mb-1">
                    <span>Tốc độ nói</span>
                    <span className="font-mono">{voicebot.speechRate.toFixed(2)}x</span>
                  </div>
                  <input
                    type="range"
                    min={0.7}
                    max={1.5}
                    step={0.05}
                    value={voicebot.speechRate}
                    onChange={(e) => sendCommand('set_voice_options', { speechRate: Number(e.target.value) })}
                    className="w-full accent-[#0F62FE]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium mb-1">Giọng đọc</label>
                  <select
                    value={voicebot.voiceGender}
                    onChange={(e) => sendCommand('set_voice_options', { voiceGender: e.target.value })}
                    className="w-full h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B111A] text-xs"
                  >
                    <option value="female">Giọng Nữ</option>
                    <option value="male">Giọng Nam</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium mb-1">Ngôn ngữ</label>
                  <select
                    value={voicebot.language}
                    onChange={(e) => sendCommand('set_voice_options', { language: e.target.value })}
                    className="w-full h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B111A] text-xs"
                  >
                    <option value="vi">Tiếng Việt</option>
                    <option value="en">English</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* 5. LỊCH SỬ HỘI THOẠI & LỆNH THIẾT BỊ */}
          <div className={`xl:col-span-4 space-y-4 ${showHistoryPanel ? 'block' : 'hidden xl:block'}`}>
            <div className="p-4 rounded-xl bg-white dark:bg-[#131C2A] border border-slate-200/80 dark:border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold">Lịch sử hội thoại</h2>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleExportConversation}
                    title="Xuất hội thoại"
                    className="h-8 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs flex items-center gap-1 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" /> Xuất
                  </button>
                  <button
                    type="button"
                    onClick={handleNewConversation}
                    className="h-8 px-2.5 rounded-lg bg-[#0F62FE] text-white text-xs font-medium flex items-center gap-1 cursor-pointer"
                  >
                    <MessageSquarePlus className="w-3.5 h-3.5" /> Mới
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={historySearch}
                    onChange={(e) => setHistorySearch(e.target.value)}
                    placeholder="Tìm nội dung..."
                    className="w-full h-9 pl-8 pr-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B111A] text-xs"
                  />
                </div>
                <input
                  type="date"
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value)}
                  className="w-full h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B111A] text-xs"
                />
              </div>

              <div className="space-y-2 max-h-64 overflow-y-auto">
                {filteredConversations.map((c) => (
                  <div
                    key={c.id}
                    onClick={() => setActiveConvId(c.id)}
                    className={`p-2.5 rounded-lg border cursor-pointer transition-colors ${
                      activeConvId === c.id
                        ? 'border-[#0F62FE] bg-blue-50/70 dark:bg-blue-950/30'
                        : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                    }`}
                  >
                    {editingTitle === c.id ? (
                      <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="text"
                          value={titleDraft}
                          onChange={(e) => setTitleDraft(e.target.value)}
                          className="flex-1 h-8 px-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => handleRenameConversation(c.id)}
                          className="px-2 h-8 rounded bg-[#0F62FE] text-white text-xs cursor-pointer"
                        >
                          Lưu
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-xs font-semibold truncate">{c.title}</div>
                          <div className="text-[11px] font-mono text-slate-400">
                            {new Date(c.updatedAt).toLocaleDateString('vi-VN')}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingTitle(c.id);
                              setTitleDraft(c.title);
                            }}
                            className="w-7 h-7 rounded flex items-center justify-center text-slate-400 hover:text-slate-700 cursor-pointer"
                            title="Đặt tên"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteConversation(c.id)}
                            className="w-7 h-7 rounded flex items-center justify-center text-slate-400 hover:text-red-600 cursor-pointer"
                            title="Xóa cuộc hội thoại"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="p-4 rounded-xl bg-white dark:bg-[#131C2A] border border-slate-200/80 dark:border-slate-800">
              <h2 className="text-sm font-bold mb-3">Lệnh thiết bị đã thực hiện</h2>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {voiceCommandsHistory.length === 0 && (
                  <div className="text-xs text-slate-400">Chưa có lệnh điều khiển nào được ghi nhận.</div>
                )}
                {voiceCommandsHistory.map((cmd) => (
                  <div
                    key={cmd.id}
                    className="p-2.5 rounded-lg bg-slate-50 dark:bg-[#0B111A] border border-slate-200/70 dark:border-slate-800 text-xs"
                  >
                    <div className="flex items-center justify-between font-semibold">
                      <span>
                        {cmd.projectId === 'car' ? 'Xe STEM' : cmd.projectId === 'grill' ? 'Bếp nướng' : 'ESP32-S3'} ·{' '}
                        {cmd.action}
                      </span>
                      <span
                        className={
                          cmd.ackStatus === 'Hoàn thành'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-red-600'
                        }
                      >
                        {cmd.ackStatus}
                      </span>
                    </div>
                    <div className="mt-0.5 font-mono text-[11px] text-slate-500 truncate">{cmd.valueJson}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: ESP32-S3 HARDWARE, LCD, GPIO & PAIRING */}
      {activeTab === 'hardware' && (
        <VoiceBotHardwarePanel
          voicebot={voicebot}
          onSnapshotUpdate={onSnapshotUpdate}
          selectedDeviceId={selectedDeviceId}
          onSelectDeviceId={setSelectedDeviceId}
        />
      )}

      {/* TAB 3: WEEKLY CALENDAR (GMT+7), DAY AGENDA & DEVICE REMINDERS */}
      {activeTab === 'calendar' && <VoiceBotCalendarPanel />}

      {/* TAB 4: WEB SERIAL FLASHER, SERIAL MONITOR & CONFIG GENERATOR */}
      {activeTab === 'flasher' && (
        <VoiceBotFlasherPanel
          selectedDeviceId={selectedDeviceId}
          displayMode={voicebot.displayMode}
          volume={voicebot.volume}
          backlight={voicebot.backlight}
          telemetry={voicebot.telemetry}
        />
      )}

      {/* Assistant Preferences Modal */}
      {prefsOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white dark:bg-[#131C2A] border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold">Tùy chỉnh trợ lý Voice Bot</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Tên gọi, phong cách phản hồi, model Gemini và giọng TTS trên loa.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPrefsOpen(false)}
                className="w-8 h-8 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-lg cursor-pointer"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSavePreferences} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold mb-1">Tên trợ lý</label>
                <input
                  type="text"
                  required
                  value={prefName}
                  onChange={(e) => setPrefName(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B111A] text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">Model xử lý ngôn ngữ</label>
                <select
                  value={prefModel}
                  onChange={(e) => setPrefModel(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B111A] text-sm font-mono"
                >
                  {(prefs?.models || ['gemini-4-hydrogen', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite', 'gemini-3.6-flash']).map(
                    (m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    )
                  )}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">Giọng đọc thiết bị (30 giọng Gemini TTS)</label>
                <select
                  value={prefVoice}
                  onChange={(e) => setPrefVoice(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B111A] text-sm"
                >
                  {(prefs?.voices || ['Kore', 'Zephyr', 'Puck', 'Charon', 'Aoede', 'Fenrir']).map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">Phong cách trả lời (System Style Prompt)</label>
                <textarea
                  rows={3}
                  value={prefStyle}
                  onChange={(e) => setPrefStyle(e.target.value)}
                  placeholder="Ví dụ: Xưng hô thân thiện, giải thích ngắn gọn dễ hiểu cho học sinh STEM."
                  className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B111A] text-sm"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setPrefsOpen(false)}
                  className="h-10 px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-sm cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={savingPrefs}
                  className="h-10 px-4 rounded-xl bg-[#0F62FE] text-white text-sm font-semibold cursor-pointer disabled:opacity-50"
                >
                  {savingPrefs ? 'Đang lưu...' : 'Lưu tùy chỉnh'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Dangerous Voice Command Confirmation Modal */}
      {pendingConfirm && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white dark:bg-[#131C2A] border border-amber-300 dark:border-amber-800 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-amber-600 dark:text-amber-400">
              <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-950 flex items-center justify-center shrink-0">
                <ShieldAlert className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Xác nhận lệnh thiết bị nguy hiểm
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">Kiểm tra an toàn trước khi thực thi</p>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-sm">
              <div className="font-bold text-slate-900 dark:text-slate-100 mb-1">{pendingConfirm.humanLabel}</div>
              <div className="text-xs text-slate-600 dark:text-slate-300 flex items-start gap-1.5">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <span>{pendingConfirm.reason}</span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setPendingConfirm(null)}
                className="h-10 px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium cursor-pointer"
              >
                Hủy lệnh
              </button>
              <button
                type="button"
                onClick={confirmPendingCommand}
                className="h-10 px-4 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold cursor-pointer"
              >
                Xác nhận thực hiện
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
