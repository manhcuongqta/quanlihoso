# HƯỚNG DẪN ĐƯA TRANG WEB QUẢN LÝ HỒ SƠ GIÁO VIÊN LÊN INTERNET

Để đưa trang web từ máy cục bộ (`localhost:3000`) lên Internet cho giáo viên và nhà trường cùng truy cập từ xa (trên máy tính khác, điện thoại, máy tính bảng), bạn có thể lựa chọn 1 trong các cách sau:

---

## ⚡ CÁCH 1: TẠO ĐƯỜNG DẪN INTERNET TRỰC TIẾP (Dùng ngay, không cần tài khoản)

Cách này cho phép bạn tạo ngay một đường dẫn công khai `https://...` từ máy tính hiện tại của bạn để gửi cho giáo viên/BGH truy cập thử nghiệm từ bất kỳ đâu.

### Các bước thực hiện:
1. Đảm bảo server đang chạy trên máy (`node server.js` tại cổng 3000).
2. Mở một cửa sổ Terminal/PowerShell thứ hai và gõ lệnh:
   ```powershell
   npx localtunnel --port 3000
   ```
3. Terminal sẽ cấp cho bạn một đường dẫn công khai dạng:
   `https://school-docs-xxxx.loca.lt`
4. Bạn gửi link này cho giáo viên truy cập trực tiếp trên điện thoại hoặc máy tính khác!

*(Lưu ý: Nhập địa chỉ IP công khai của máy chủ khi localtunnel yêu cầu xác thực lần đầu).*

---

## 🌐 CÁCH 2: TRIỂN KHAI TRỰC TUYẾN VĨNH VIỄN (MIỄN PHÍ) LÊN RENDER.COM / RAILWAY

Để trang web hoạt động 24/7 trên Internet mà không cần bật máy tính cá nhân:

### 1. Đưa mã nguồn lên GitHub:
- Tạo một thư viện (Repository) mới trên GitHub.
- Đẩy toàn bộ thư mục `quan-ly-ho-so-giao-vien` lên GitHub.

### 2. Triển khai miễn phí trên Render.com:
1. Đăng ký tài khoản miễn phí tại [Render.com](https://render.com).
2. Chọn **New +** -> **Web Service**.
3. Kết nối với tài khoản GitHub và chọn kho mã nguồn `quan-ly-ho-so-giao-vien`.
4. Cấu hình cài đặt:
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
5. Bấm **Create Web Service**. 
6. Sau 1-2 phút, Render sẽ cấp cho bạn đường dẫn truy cập 24/7 vĩnh viễn dạng:
   **`https://quan-ly-ho-so-giao-vien.onrender.com`**

---

## 🏢 CÁCH 3: TRIỂN KHAI TRÊN MÁY CHỦ / TÊN MIỀN RƯỢNG CỦA NHÀ TRƯỜNG (`.edu.vn`)

Nếu nhà trường có máy chủ Windows Server / Linux hoặc tên miền riêng (VD: `hoso.thcs-nguyenvantroi.edu.vn`):

1. **Cài đặt PM2** (Quản lý tiến trình chạy ẩn 24/7 trên server):
   ```powershell
   npm install -g pm2
   pm2 start server.js --name "quan-ly-ho-so"
   pm2 startup
   pm2 save
   ```
2. **Cấu hình Nginx / IIS / Cloudflare**:
   - Trỏ tên miền `hoso.truonghoc.edu.vn` về IP máy chủ.
   - Cấu hình Reverse Proxy chuyển hướng tên miền về cổng `3000`.
   - Bật chứng chỉ bảo mật SSL/HTTPS (Let's Encrypt) miễn phí.
