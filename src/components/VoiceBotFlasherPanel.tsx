import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Code2,
  Copy,
  Cpu,
  Download,
  FileCode2,
  Terminal,
  Trash2,
  Upload,
} from 'lucide-react';
import type { DisplayMode } from '../types';

interface SerialPortLike {
  open: (options: { baudRate: number }) => Promise<void>;
  close: () => Promise<void>;
  readable?: { getReader: () => ReadableStreamDefaultReader<Uint8Array> };
  writable?: { getWriter: () => WritableStreamDefaultWriter<Uint8Array> };
}

interface NavigatorSerial {
  serial?: {
    requestPort: () => Promise<SerialPortLike>;
  };
}

interface FirmwareProfile {
  id: 'ai-chatbot-s3' | 'stem-display-alt';
  name: string;
  chip: string;
  mem: string;
  offset: string;
  badge: string;
}

const FW_PROFILES: FirmwareProfile[] = [
  {
    id: 'ai-chatbot-s3',
    name: 'AI Chatbot ESP32-S3 (Chuẩn)',
    chip: 'ESP32-S3 LX7',
    mem: '16MB · Octal',
    offset: '0x0000',
    badge: 'ESP32-S3 · 16MB',
  },
  {
    id: 'stem-display-alt',
    name: 'STEM Multi-Display ESP32-S3',
    chip: 'ESP32-S3 Multi',
    mem: '16MB · QIO/Octal',
    offset: '0x10000',
    badge: 'Multi-Display · 16MB',
  },
];

export const VoiceBotFlasherPanel: React.FC<{
  selectedDeviceId: string;
  displayMode: DisplayMode;
  volume: number;
  backlight: number;
  telemetry: { wifiRssi: number; freePsramKb: number; cpuTempC: number };
}> = ({ selectedDeviceId, displayMode, volume, backlight, telemetry }) => {
  const hasWebSerial = typeof navigator !== 'undefined' && 'serial' in navigator;
  const inIframe = typeof window !== 'undefined' && window.self !== window.top;

  const [profileId, setProfileId] = useState<FirmwareProfile['id']>('ai-chatbot-s3');
  const activeProfile = useMemo(
    () => FW_PROFILES.find((p) => p.id === profileId) || FW_PROFILES[0],
    [profileId]
  );

  const [baudrate, setBaudrate] = useState(460800);
  const [offsetHex, setOffsetHex] = useState('0x0000');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isFlashing, setIsFlashing] = useState(false);
  const [flashStatus, setFlashStatus] = useState('');
  const [flashPct, setFlashPct] = useState(0);
  const [flashBytes, setFlashBytes] = useState('0 / 0 bytes');
  const [flashLogs, setFlashLogs] = useState<string>('');

  // Serial Monitor state
  const [monConnected, setMonConnected] = useState(false);
  const [monLogs, setMonLogs] = useState(
    'Nhấn "Mở cổng Serial" để kết nối USB UART (115,200 baud), hoặc bấm "Log mẫu" để xem chu trình khởi động kit ESP32-S3...'
  );
  const [monCmd, setMonCmd] = useState('');
  const [copiedSnippet, setCopiedSnippet] = useState(false);

  const monPortRef = useRef<SerialPortLike | null>(null);
  const monReaderRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const monReadingRef = useRef(false);

  function appendMon(text: string) {
    setMonLogs((prev) => {
      const base = prev.startsWith('Nhấn "Mở cổng Serial"') ? '' : prev;
      const combined = base + text;
      return combined.length > 24000 ? combined.slice(-18000) : combined;
    });
  }

  function appendFlash(line: string) {
    setFlashLogs((prev) => {
      const combined = prev + line + '\n';
      return combined.length > 20000 ? combined.slice(-16000) : combined;
    });
  }

  async function disconnectMonitor() {
    monReadingRef.current = false;
    if (monReaderRef.current) {
      try {
        await monReaderRef.current.cancel();
      } catch {
        // ignore
      }
      try {
        monReaderRef.current.releaseLock();
      } catch {
        // ignore
      }
      monReaderRef.current = null;
    }
    if (monPortRef.current) {
      try {
        await monPortRef.current.close();
      } catch {
        // ignore
      }
      monPortRef.current = null;
    }
    setMonConnected(false);
  }

  async function handleToggleMonitor() {
    if (monConnected) {
      await disconnectMonitor();
      appendMon('\n[Serial] Đã đóng cổng COM.\n');
      return;
    }
    const serialApi = (navigator as unknown as NavigatorSerial).serial;
    if (!serialApi) {
      appendMon('\n[Lỗi] Trình duyệt không hỗ trợ Web Serial API. Hãy dùng Chrome/Edge trên máy tính.\n');
      return;
    }
    try {
      const port = await serialApi.requestPort();
      await port.open({ baudRate: 115200 });
      monPortRef.current = port;
      monReadingRef.current = true;
      setMonConnected(true);
      appendMon('\n[Serial] Đã mở cổng COM @ 115,200 bps.\n');

      const decoder = new TextDecoder();
      while (port.readable && monReadingRef.current) {
        const reader = port.readable.getReader();
        monReaderRef.current = reader;
        try {
          while (monReadingRef.current) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value) appendMon(decoder.decode(value, { stream: true }));
          }
        } catch (err) {
          appendMon(`\n[Serial lỗi đọc]: ${err instanceof Error ? err.message : String(err)}\n`);
          break;
        } finally {
          reader.releaseLock();
          monReaderRef.current = null;
        }
      }
    } catch (err) {
      await disconnectMonitor();
      appendMon(`\n[Serial]: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }

  async function handleSendSerialCmd(e: React.FormEvent) {
    e.preventDefault();
    const cmd = monCmd.trim();
    if (!cmd || !monPortRef.current?.writable) return;
    const writer = monPortRef.current.writable.getWriter();
    try {
      await writer.write(new TextEncoder().encode(`${cmd}\r\n`));
      appendMon(`\n> ${cmd}\n`);
      setMonCmd('');
    } finally {
      writer.releaseLock();
    }
  }

  function handleSampleLogs() {
    const devId = selectedDeviceId || 'esp32s3-stem-01';
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://tp-stem.local';
    const sample = [
      'ESP-ROM:esp32s3-20210327',
      `I (12) boot: ESP-IDF v5.3 · TP STEM Control (${activeProfile.id})`,
      `I (48) spiram: Octal PSRAM initialized · free=${telemetry.freePsramKb}KB`,
      'I (105) st7789: SPI 240x240 CLK=9 MOSI=10 RST=18 DC=8 CS=14 BL=13',
      `I (112) st7789: Backlight=${backlight}% · Mode=${displayMode}`,
      `I (140) i2s_audio: Mic(WS=4,SCK=5,DIN=6) 16kHz | MAX98357A(LRC=16,BCLK=15,DOUT=7) vol=${volume}%`,
      `I (410) wifi: connected · RSSI=${telemetry.wifiRssi}dBm · Temp=${telemetry.cpuTempC.toFixed(1)}C`,
      `I (520) ota: POST ${origin}/xiaozhi/ota/ [device=${devId}] -> 200 OK`,
      `I (680) reminder_client: Polling ${origin}/device/reminders -> READY`,
    ].join('\n');
    appendMon(`\n${sample}\n`);
  }

  async function handleFlashFirmware() {
    if (isFlashing) return;
    const serialApi = (navigator as unknown as NavigatorSerial).serial;
    if (!serialApi) {
      setFlashStatus('Trình duyệt không hỗ trợ Web Serial API. Hãy dùng Chrome/Edge trên máy tính.');
      return;
    }
    if (!selectedFile) {
      setFlashStatus('Vui lòng chọn tệp firmware (.bin) trước khi nạp.');
      return;
    }
    const address = Number.parseInt(offsetHex.trim(), 16);
    if (!Number.isFinite(address) || address < 0) {
      setFlashStatus('Địa chỉ offset không hợp lệ (ví dụ: 0x0000 hoặc 0x10000).');
      return;
    }

    setIsFlashing(true);
    setFlashLogs('');
    setFlashPct(0);
    setFlashBytes(`0 / ${selectedFile.size} bytes`);
    setFlashStatus('Đang chọn cổng COM và tải esptool-js@0.7.1...');

    let transport: {
      setDTR: (v: boolean) => Promise<void>;
      setRTS: (v: boolean) => Promise<void>;
      disconnect: () => Promise<void>;
    } | null = null;

    try {
      await disconnectMonitor();
      const espModuleUrl = 'https://unpkg.com/esptool-js@0.7.1/bundle.js';
      const [{ ESPLoader, Transport }, fileBuf] = await Promise.all([
        import(/* @vite-ignore */ espModuleUrl) as Promise<{
          ESPLoader: new (opts: Record<string, unknown>) => {
            main: () => Promise<void>;
            writeFlash: (opts: Record<string, unknown>) => Promise<void>;
          };
          Transport: new (port: SerialPortLike, trace: boolean) => typeof transport;
        }>,
        selectedFile.arrayBuffer(),
      ]);

      const port = await serialApi.requestPort();
      transport = new Transport(port, true);
      const terminal = {
        clean: () => setFlashLogs(''),
        writeLine: (line: string) => appendFlash(line),
        write: (chunk: string) => setFlashLogs((prev) => prev + chunk),
      };

      const esploader = new ESPLoader({ transport, baudrate, terminal });
      setFlashStatus('Đang kết nối bootloader ESP32-S3...');
      await esploader.main();

      const bytes = new Uint8Array(fileBuf);
      let binary = '';
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }

      setFlashStatus(`Đang nạp ${selectedFile.name} tại ${offsetHex}...`);
      await esploader.writeFlash({
        fileArray: [{ data: binary, address }],
        flashSize: 'keep',
        eraseAll: false,
        compress: true,
        reportProgress: (_idx: number, written: number, total: number) => {
          const pct = total ? Math.round((written / total) * 100) : 0;
          setFlashPct(pct);
          setFlashBytes(`${written} / ${total} bytes`);
        },
      });

      setFlashStatus('Nạp firmware thành công! Đang khởi động lại mạch...');
      if (transport) {
        await transport.setDTR(false);
        await transport.setRTS(true);
        await new Promise((r) => setTimeout(r, 120));
        await transport.setRTS(false);
      }
    } catch (err) {
      setFlashStatus('Nạp firmware chưa hoàn tất.');
      appendFlash(`[Lỗi]: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (transport) {
        try {
          await transport.disconnect();
        } catch {
          // ignore
        }
      }
      setIsFlashing(false);
    }
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:3000';
  const devId = selectedDeviceId || 'esp32s3-stem-01';
  const firmwareSnippet = `// TP STEM Control · Firmware Config (${devId})
#pragma once
#define CHATBOT_SERVER_URL "${origin}"
#define STEM_DEVICE_ID     "${devId}"
#define STEM_DISPLAY_MODE  "${displayMode}"
// Endpoints:
// OTA & WebSocket: POST ${origin}/xiaozhi/ota/
// Reminder Poll:   GET  ${origin}/device/reminders?device_id=${devId}
// Telemetry Push:  POST ${origin}/device/telemetry`;

  return (
    <div className="space-y-5">
      {(!hasWebSerial || inIframe) && (
        <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            {!hasWebSerial
              ? 'Trình duyệt hiện tại hoặc thiết bị di động chưa hỗ trợ Web Serial USB. Bạn vẫn có thể bấm "Log mẫu", sao chép cấu hình Firmware và điều khiển qua Wi-Fi.'
              : 'Nếu trình duyệt chặn chọn cổng COM trong iframe xem trước, hãy mở ứng dụng ở tab Chrome/Edge riêng để nạp USB trực tiếp.'}
          </span>
        </div>
      )}

      {/* Row 1: USB Flasher + Serial Monitor */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Flasher Block */}
        <div className="p-5 rounded-xl bg-white dark:bg-[#131C2A] border border-slate-200/80 dark:border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold flex items-center gap-2">
              <Upload className="w-4 h-4 text-[#0F62FE]" /> Nạp Firmware USB (.bin)
            </h3>
            <span className="px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-950/40 text-[#0F62FE] text-[11px] font-mono font-bold">
              {activeProfile.badge}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {FW_PROFILES.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setProfileId(p.id);
                  setOffsetHex(p.offset);
                }}
                className={`p-2.5 rounded-lg border text-left cursor-pointer ${
                  profileId === p.id
                    ? 'border-[#0F62FE] bg-blue-50/70 dark:bg-blue-950/40 text-[#0F62FE]'
                    : 'border-slate-200 dark:border-slate-800'
                }`}
              >
                <div className="text-xs font-bold">{p.name}</div>
                <div className="text-[11px] font-mono text-slate-500">
                  {p.chip} · {p.mem} · Offset {p.offset}
                </div>
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1">Tốc độ Baud</label>
              <select
                value={baudrate}
                onChange={(e) => setBaudrate(Number(e.target.value))}
                className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B111A] text-sm font-mono"
              >
                <option value={460800}>460800 (Khuyên dùng)</option>
                <option value={921600}>921600 (Tốc độ cao)</option>
                <option value={115200}>115200 (Ổn định)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Hex Offset</label>
              <input
                type="text"
                value={offsetHex}
                onChange={(e) => setOffsetHex(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B111A] text-sm font-mono"
              />
            </div>
          </div>

          <div className="p-3 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B111A] flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-mono text-slate-600 dark:text-slate-300 truncate">
              {selectedFile
                ? `${selectedFile.name} (${(selectedFile.size / 1024 / 1024).toFixed(2)} MB)`
                : 'Chưa chọn tệp firmware (.bin)'}
            </span>
            <input
              type="file"
              accept=".bin"
              onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
              className="text-xs"
            />
          </div>

          <button
            type="button"
            disabled={isFlashing}
            onClick={handleFlashFirmware}
            className="w-full h-11 rounded-xl bg-[#0F62FE] hover:bg-blue-700 text-white text-sm font-semibold cursor-pointer disabled:opacity-50"
          >
            {isFlashing ? 'Đang nạp Firmware...' : 'Nạp Firmware (.bin) qua cổng COM'}
          </button>

          {(flashStatus || flashLogs) && (
            <div className="p-3 rounded-xl bg-slate-900 text-slate-100 space-y-2 text-xs">
              <div className="font-semibold">{flashStatus}</div>
              <div className="w-full h-2 rounded-full bg-slate-700 overflow-hidden">
                <div className="h-full bg-[#0F62FE] transition-all" style={{ width: `${flashPct}%` }} />
              </div>
              <div className="flex justify-between font-mono text-[11px] text-slate-400">
                <span>{flashBytes}</span>
                <span>{flashPct}%</span>
              </div>
              {flashLogs && (
                <pre className="max-h-36 overflow-y-auto font-mono text-[11px] text-emerald-300 whitespace-pre-wrap">
                  {flashLogs}
                </pre>
              )}
            </div>
          )}
        </div>

        {/* Serial Monitor Block */}
        <div className="p-5 rounded-xl bg-white dark:bg-[#131C2A] border border-slate-200/80 dark:border-slate-800 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold flex items-center gap-2">
              <Terminal className="w-4 h-4 text-[#0F62FE]" /> Serial Monitor (115,200 bps)
            </h3>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleSampleLogs}
                className="h-8 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium cursor-pointer"
              >
                Log mẫu
              </button>
              <button
                type="button"
                onClick={() => setMonLogs('')}
                className="h-8 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium flex items-center gap-1 cursor-pointer"
              >
                <Trash2 className="w-3 h-3" /> Xóa
              </button>
              <button
                type="button"
                onClick={handleToggleMonitor}
                className={`h-8 px-3 rounded-lg text-xs font-semibold cursor-pointer ${
                  monConnected ? 'bg-red-600 text-white' : 'bg-[#0F62FE] text-white'
                }`}
              >
                {monConnected ? 'Ngắt kết nối' : 'Mở cổng Serial'}
              </button>
            </div>
          </div>

          <pre className="h-64 p-3 rounded-xl bg-[#0B111A] text-emerald-300 font-mono text-xs overflow-auto whitespace-pre-wrap border border-slate-800">
            {monLogs}
          </pre>

          <form onSubmit={handleSendSerialCmd} className="flex items-center gap-2">
            <input
              type="text"
              value={monCmd}
              onChange={(e) => setMonCmd(e.target.value)}
              placeholder="Nhập lệnh UART gửi xuống mạch (vd: status, reboot)..."
              className="flex-1 h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B111A] text-xs font-mono"
            />
            <button
              type="submit"
              disabled={!monConnected || !monCmd.trim()}
              className="h-10 px-4 rounded-lg bg-[#0F62FE] text-white text-xs font-semibold disabled:opacity-40 cursor-pointer"
            >
              Gửi
            </button>
          </form>
        </div>
      </div>

      {/* Row 2: 4-Step Guide + Driver Links + Firmware Config Generator */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="p-5 rounded-xl bg-white dark:bg-[#131C2A] border border-slate-200/80 dark:border-slate-800 space-y-3">
          <h3 className="text-sm font-bold flex items-center gap-2">
            <Cpu className="w-4 h-4 text-[#0F62FE]" /> Hướng dẫn nạp & xử lý lỗi kết nối (4 bước)
          </h3>
          <div className="space-y-2.5 text-xs">
            <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-[#0B111A]">
              <b>1. Dùng cáp USB truyền dữ liệu (Data Cable):</b> Cắm vào cổng USB-UART hoặc USB-OTG trên ESP32-S3.
            </div>
            <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-[#0B111A]">
              <b>2. Chọn tệp .bin và cổng COM:</b> Chọn CH340 / CP210x / USB JTAG Serial và bấm "Nạp Firmware".
            </div>
            <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-[#0B111A]">
              <b>3. Nếu báo Timeout khi bắt tay mạch:</b> Nhấn giữ <b>BOOT (GPIO0)</b>, bấm nhả <b>RST</b>, rồi thả <b>BOOT</b>.
            </div>
            <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-[#0B111A]">
              <b>4. Kiểm tra Wi-Fi & Token:</b> Mở Serial Monitor 115,200 baud để theo dõi IP và polling nhắc lịch.
            </div>
          </div>

          <div className="pt-2 flex flex-wrap gap-2">
            <a
              href="https://www.wch-ic.com/downloads/CH341SER_EXE.html"
              target="_blank"
              rel="noopener noreferrer"
              className="h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium inline-flex items-center gap-1 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <Download className="w-3.5 h-3.5" /> Driver CH340/CH341
            </a>
            <a
              href="https://www.silabs.com/developers/usb-to-uart-bridge-vcp-drivers"
              target="_blank"
              rel="noopener noreferrer"
              className="h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium inline-flex items-center gap-1 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <Download className="w-3.5 h-3.5" /> Driver CP210x
            </a>
            <a
              href="https://www.wch-ic.com/downloads/CH9102SER_EXE.html"
              target="_blank"
              rel="noopener noreferrer"
              className="h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium inline-flex items-center gap-1 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <Download className="w-3.5 h-3.5" /> Driver CH9102
            </a>
          </div>
        </div>

        <div className="p-5 rounded-xl bg-white dark:bg-[#131C2A] border border-slate-200/80 dark:border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold flex items-center gap-2">
              <FileCode2 className="w-4 h-4 text-[#0F62FE]" /> Cấu hình Firmware (chatbot_local_config.h)
            </h3>
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(firmwareSnippet);
                  setCopiedSnippet(true);
                  setTimeout(() => setCopiedSnippet(false), 2000);
                } catch {
                  // ignore
                }
              }}
              className="h-8 px-3 rounded-lg bg-[#0F62FE] text-white text-xs font-semibold flex items-center gap-1 cursor-pointer"
            >
              {copiedSnippet ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedSnippet ? 'Đã sao chép' : 'Sao chép'}</span>
            </button>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
            <Code2 className="w-3.5 h-3.5" /> Thông số endpoint sẵn sàng để dán vào firmware/board/chatbot_local_config.h:
          </p>
          <pre className="p-3.5 rounded-xl bg-[#0B111A] text-blue-200 font-mono text-xs overflow-x-auto border border-slate-800">
            {firmwareSnippet}
          </pre>
        </div>
      </div>
    </div>
  );
};
