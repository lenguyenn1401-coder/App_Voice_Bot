import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:web_socket_channel/web_socket_channel.dart';

void main() {
  runApp(const TpStemMobileApp());
}

class TpStemMobileApp extends StatefulWidget {
  const TpStemMobileApp({super.key});

  @override
  State<TpStemMobileApp> createState() => _TpStemMobileAppState();
}

class _TpStemMobileAppState extends State<TpStemMobileApp> {
  ThemeMode _themeMode = ThemeMode.light;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'TP STEM Control',
      debugShowCheckedModeBanner: false,
      themeMode: _themeMode,
      theme: ThemeData(
        colorSchemeSeed: const Color(0xFF0F62FE),
        useMaterial3: true,
        brightness: Brightness.light,
      ),
      darkTheme: ThemeData(
        colorSchemeSeed: const Color(0xFF0F62FE),
        useMaterial3: true,
        brightness: Brightness.dark,
      ),
      home: RootMobileShell(
        onToggleTheme: () {
          setState(() {
            _themeMode = _themeMode == ThemeMode.light ? ThemeMode.dark : ThemeMode.light;
          });
        },
      ),
    );
  }
}

class RootMobileShell extends StatefulWidget {
  final VoidCallback onToggleTheme;
  const RootMobileShell({super.key, required this.onToggleTheme});

  @override
  State<RootMobileShell> createState() => _RootMobileShellState();
}

class _RootMobileShellState extends State<RootMobileShell> {
  static const String baseUrl = String.fromEnvironment('API_BASE_URL', defaultValue: 'http://10.0.2.2:3000');

  int _tabIndex = 0;
  String? _token;
  Map<String, dynamic>? _snapshot;
  WebSocketChannel? _channel;

  Future<void> _demoLogin(String role) async {
    final res = await http.post(
      Uri.parse('$baseUrl/api/auth/demo-login'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'role': role}),
    );
    if (res.statusCode == 200) {
      final data = jsonDecode(res.body) as Map<String, dynamic>;
      _token = data['token'] as String?;
      _connectWs();
      setState(() {});
    }
  }

  void _connectWs() {
    final wsUrl = baseUrl.replaceFirst('http', 'ws');
    _channel?.sink.close();
    _channel = WebSocketChannel.connect(Uri.parse('$wsUrl/ws?token=${_token ?? ''}'));
    _channel!.stream.listen((event) {
      final decoded = jsonDecode(event.toString()) as Map<String, dynamic>;
      if (decoded['event'] == 'state_update') {
        setState(() {
          _snapshot = decoded['payload'] as Map<String, dynamic>;
        });
      }
    });
  }

  Future<void> _sendCommand(String projectId, String taskId, String action, Map<String, dynamic> value, {bool confirmDangerous = false}) async {
    HapticFeedback.lightImpact();
    await http.post(
      Uri.parse('$baseUrl/api/commands'),
      headers: {
        'Content-Type': 'application/json',
        if (_token != null) 'Authorization': 'Bearer $_token',
      },
      body: jsonEncode({
        'projectId': projectId,
        'taskId': taskId,
        'action': action,
        'value': value,
        'confirmDangerous': confirmDangerous,
      }),
    );
  }

  @override
  void dispose() {
    _channel?.sink.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_token == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('TP STEM Control')),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.memory, size: 56, color: Color(0xFF0F62FE)),
                const SizedBox(height: 16),
                const Text('Đăng nhập TP STEM Control', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
                const SizedBox(height: 20),
                ElevatedButton(onPressed: () => _demoLogin('admin'), child: const Text('Vào nhanh với Admin')),
                const SizedBox(height: 8),
                OutlinedButton(onPressed: () => _demoLogin('teacher'), child: const Text('Vào nhanh với Giáo viên')),
                const SizedBox(height: 8),
                OutlinedButton(onPressed: () => _demoLogin('student'), child: const Text('Vào nhanh với Học sinh')),
              ],
            ),
          ),
        ),
      );
    }

    final tabs = [
      _buildHomeCards(context),
      _buildHomeCards(context),
      _buildNotificationsView(),
      _buildHistoryView(),
      _buildAccountView(),
    ];

    return Scaffold(
      appBar: AppBar(
        title: const Text('TP STEM Control'),
        actions: [
          IconButton(onPressed: widget.onToggleTheme, icon: const Icon(Icons.brightness_6)),
        ],
      ),
      body: tabs[_tabIndex],
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tabIndex,
        onDestinationSelected: (i) => setState(() => _tabIndex = i),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.home_outlined), label: 'Trang chủ'),
          NavigationDestination(icon: Icon(Icons.grid_view_outlined), label: 'Dự án'),
          NavigationDestination(icon: Icon(Icons.notifications_outlined), label: 'Thông báo'),
          NavigationDestination(icon: Icon(Icons.history), label: 'Lịch sử'),
          NavigationDestination(icon: Icon(Icons.person_outline), label: 'Tài khoản'),
        ],
      ),
    );
  }

  Widget _buildHomeCards(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        _projectCard(
          title: 'Voice Bot AI',
          subtitle: 'Trò chuyện, hỏi đáp và điều khiển robot bằng giọng nói',
          buttonLabel: 'Mở Voice Bot',
          icon: Icons.mic,
          onOpen: () => Navigator.push(context, MaterialPageRoute(builder: (_) => _VoiceBotMobilePage(onSend: _sendCommand))),
        ),
        const SizedBox(height: 12),
        _projectCard(
          title: 'Xe STEM',
          subtitle: 'Điều khiển hướng di chuyển, tốc độ, động cơ và servo',
          buttonLabel: 'Điều khiển xe',
          icon: Icons.directions_car,
          onOpen: () => Navigator.push(context, MaterialPageRoute(builder: (_) => _StemCarMobilePage(onSend: _sendCommand))),
        ),
        const SizedBox(height: 12),
        _projectCard(
          title: 'Bếp nướng thông minh',
          subtitle: 'Theo dõi nhiệt độ và điều khiển quá trình nướng',
          buttonLabel: 'Mở bếp nướng',
          icon: Icons.local_fire_department,
          onOpen: () => Navigator.push(context, MaterialPageRoute(builder: (_) => _SmartGrillMobilePage(snapshot: _snapshot, onSend: _sendCommand))),
        ),
      ],
    );
  }

  Widget _projectCard({
    required String title,
    required String subtitle,
    required String buttonLabel,
    required IconData icon,
    required VoidCallback onOpen,
  }) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(icon, color: const Color(0xFF0F62FE)),
                const SizedBox(width: 10),
                Text(title, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
              ],
            ),
            const SizedBox(height: 8),
            Text(subtitle),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: FilledButton(onPressed: onOpen, child: Text(buttonLabel)),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildNotificationsView() {
    final items = (_snapshot?['notifications'] as List<dynamic>?) ?? [];
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: items.length,
      itemBuilder: (_, i) {
        final item = items[i] as Map<String, dynamic>;
        return Card(
          child: ListTile(
            title: Text(item['title'].toString()),
            subtitle: Text(item['message'].toString()),
          ),
        );
      },
    );
  }

  Widget _buildHistoryView() {
    final items = (_snapshot?['recentCommands'] as List<dynamic>?) ?? [];
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: items.length,
      itemBuilder: (_, i) {
        final item = items[i] as Map<String, dynamic>;
        return Card(
          child: ListTile(
            title: Text('${item['projectId']} · ${item['action']}'),
            subtitle: Text('${item['ackStatus']} · ${item['createdAt']}'),
          ),
        );
      },
    );
  }

  Widget _buildAccountView() {
    return Center(
      child: FilledButton.tonal(
        onPressed: () => setState(() => _token = null),
        child: const Text('Đăng xuất'),
      ),
    );
  }
}

typedef SendCmdFn = Future<void> Function(String projectId, String taskId, String action, Map<String, dynamic> value, {bool confirmDangerous});

class _VoiceBotMobilePage extends StatelessWidget {
  final SendCmdFn onSend;
  const _VoiceBotMobilePage({required this.onSend});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Voice Bot AI')),
      body: Center(
        child: FilledButton.icon(
          onPressed: () => onSend('voicebot', 'vb_ai_cmd', 'set_activity', {'activityState': 'Đang nghe'}),
          icon: const Icon(Icons.mic),
          label: const Text('Nhấn để nói'),
        ),
      ),
    );
  }
}

class _StemCarMobilePage extends StatelessWidget {
  final SendCmdFn onSend;
  const _StemCarMobilePage({required this.onSend});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Điều khiển xe STEM')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            FilledButton(
              style: FilledButton.styleFrom(backgroundColor: Colors.red),
              onPressed: () => onSend('car', 'car_drive', 'emergency_stop', {}),
              child: const Text('DỪNG KHẨN CẤP'),
            ),
            const SizedBox(height: 24),
            GestureDetector(
              onTapDown: (_) => onSend('car', 'car_drive', 'move', {'direction': 'forward', 'speed': 55}),
              onTapUp: (_) => onSend('car', 'car_drive', 'stop', {}),
              child: const CircleAvatar(radius: 44, child: Icon(Icons.arrow_upward, size: 32)),
            ),
          ],
        ),
      ),
    );
  }
}

class _SmartGrillMobilePage extends StatelessWidget {
  final Map<String, dynamic>? snapshot;
  final SendCmdFn onSend;
  const _SmartGrillMobilePage({required this.snapshot, required this.onSend});

  @override
  Widget build(BuildContext context) {
    final grill = (snapshot?['grill'] as Map<String, dynamic>?) ?? {};
    return Scaffold(
      appBar: AppBar(title: const Text('Bếp nướng thông minh')),
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('${grill['currentTempC'] ?? 32}°C', style: const TextStyle(fontSize: 42, fontWeight: FontWeight.bold)),
            const SizedBox(height: 16),
            FilledButton(
              style: FilledButton.styleFrom(backgroundColor: Colors.red),
              onPressed: () => onSend('grill', 'grill_alert', 'emergency_stop', {}),
              child: const Text('DỪNG KHẨN CẤP BẾP'),
            ),
          ],
        ),
      ),
    );
  }
}
