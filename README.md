# App Stem IOT

Ứng dụng điều khiển thiết bị IoT **ESP32-S3**, quản lý lịch học/thực hành STEM, nhắc lịch và trợ lý AI Gemini — được xây dựng lại trên nền Node.js + Express + PWA từ mã nguồn firmware ESP32-S3 (`firmware/board`).

## Tính năng chính

- **Điều khiển thiết bị ESP32-S3 (`App Stem IOT`)**:
  - Điều chỉnh âm lượng loa **MAX98357A** (`0–100%`, tắt tiếng)
  - Điều chỉnh độ sáng đèn nền màn hình **ST7789 240×240** (`GPIO13`) và chế độ hiển thị (`Lịch học`, `Đồng hồ`, `Biểu cảm`, `Tạm nghỉ`)
  - Bật/tắt ngõ ra **GPIO STEM** (`Đèn báo trạng thái`, `Relay nguồn`, `Còi cảnh báo`) và góc quay **Servo** (`0°–180°`)
  - Xem sơ đồ chân phần cứng trích xuất trực tiếp từ `firmware/board/config.h` và ghép nối thiết bị mới qua `Device-Id` + Token
- **Lịch học & Nhắc việc theo tuần**: Thêm, sửa, xóa, sao chép tuần và phát thử nhắc lịch xuống thiết bị (`/device/reminders`, `/device/ack`)
- **Trợ lý AI Gemini**: Hỗ trợ hỏi đáp STEM, phần cứng ESP32-S3 và thao tác lịch có xác nhận 2 bước
- **Chuẩn PWA & Sẵn sàng đưa lên CH Play**: Hỗ trợ cài đặt ứng dụng trực tiếp (`manifest.webmanifest` + Service Worker `sw.js`) và đóng gói lên Google Play bằng Trusted Web Activity (TWA / Bubblewrap)

## Khởi chạy cục bộ

```bash
npm install
npm run dev
```

Mở trình duyệt tại `http://localhost:3000` (có sẵn nút **Vào nhanh với tài khoản Demo**).

Để bật Trợ lý AI Gemini, thêm biến môi trường vào tệp `.env`:

```env
GEMINI_API_KEY=your_api_key_here
PORT=3000
```
