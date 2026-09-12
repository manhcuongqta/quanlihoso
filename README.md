# HỆ THỐNG QUẢN LÝ HỒ SƠ GIÁO VIÊN TRƯỜNG HỌC (TÍCH HỢP GOOGLE DRIVE)

Hệ thống web quản lý hồ sơ giáo viên dành cho nhà trường, cho phép lưu trữ tất cả hồ sơ gửi đến lên **Google Drive**, phân quyền chặt chẽ theo vai trò (Giáo viên, Tổ trưởng, Ban Giám Hiệu, Admin), tổ chức danh mục linh hoạt.

---

## 🌟 TÍNH NĂNG NỔI BẬT

### 1. Phân quyền bảo mật chặt chẽ (RBAC)
- **Giáo viên**: Chỉ xem và quản lý được **hồ sơ cá nhân của chính mình**. Không thể xem hồ sơ của giáo viên khác.
- **Tổ trưởng chuyên môn**: Xem toàn bộ hồ sơ của các giáo viên thuộc **Tổ chuyên môn** do mình quản lý.
- **Ban Giám Hiệu (BGH)**: Xem toàn bộ hồ sơ tất cả các tổ và danh mục trong toàn trường.
- **Quản trị viên (Admin)**: 
  - Tạo tài khoản cho giáo viên, phân gán tổ chuyên môn và cấp quyền.
  - Tự tạo thêm các mục/danh mục hồ sơ mới linh hoạt.
  - Cấu hình thư mục lưu trữ Google Drive API / Service Account.

### 2. Cấu trúc Danh mục Hồ sơ Chuẩn
- **Hồ sơ nhà trường**: Các văn bản chỉ đạo, quy chế, kế hoạch năm học.
- **Hồ sơ tổ**: Kế hoạch hoạt động tổ chuyên môn, biên bản họp.
- **Hồ sơ cá nhân**: Gồm submenu đầy đủ theo các tổ chuyên môn:
  - **Tổ 1** (Khối 1)
  - **Tổ 2** (Khối 2)
  - **Tổ 3** (Khối 3)
  - **Tổ 4** (Khối 4)
  - **Tổ 5** (Khối 5)
  - **Tổ Năng khiếu** (Âm nhạc, Mỹ thuật, Thể dục, Tin học, Ngoại ngữ)
- **Hồ sơ đội**: Hoạt động Đội TNTP Hồ Chí Minh.
- **Hồ sơ đoàn**: Hoạt động Đoàn TNCS Hồ Chí Minh.
- **Danh mục tự khởi tạo**: Admin có thể tự thêm mục mới bất kỳ lúc nào.

### 3. Tích hợp Google Drive
- Giáo viên gửi hồ sơ trực tiếp từ giao diện web đẩy lên thư mục Google Drive của trường.
- Hỗ trợ chèn link Google Drive trực tiếp.
- Trình xem trước (Preview) tài liệu PDF/Word trên Google Drive ngay tại trang web.

---

## 🚀 HƯỚNG DẪN KHỞI CHẠY HỆ THỐNG

### Chạy bằng Node.js:
1. Mở Terminal / PowerShell tại thư mục dự án:
   ```bash
   cd C:\Users\manhc\.gemini\antigravity\scratch\quan-ly-ho-so-giao-vien
   ```
2. Cài đặt thư viện dependencies:
   ```bash
   npm install
   ```
3. Khởi chạy server:
   ```bash
   npm start
   ```
4. Truy cập trình duyệt tại địa chỉ: **`http://localhost:3000`**

---

## 🔑 ĐĂNG NHẬP MẪU ĐỂ KIỂM TRA PHÂN QUYỀN

Trên thanh tiêu đề của trang web có bộ **Chuyển tài khoản nhanh** để trải nghiệm quyền truy cập:

| Tên tài khoản | Mật khẩu | Họ và tên | Vai trò | Phạm vi xem hồ sơ |
|---|---|---|---|---|
| `admin` | `admin123` | Quản trị viên | Admin | Toàn bộ hệ thống + Tạo tài khoản & danh mục |
| `bgh` | `bgh123` | ThS. Nguyễn Văn Minh | Ban Giám Hiệu | Tất cả hồ sơ toàn trường |
| `totruong1` | `123456` | Trần Thị Mai | Tổ trưởng Tổ 1 | Tất cả hồ sơ thuộc **Tổ 1** |
| `totruong2` | `123456` | Lê Văn Bình | Tổ trưởng Tổ 2 | Tất cả hồ sơ thuộc **Tổ 2** |
| `giaovien1` | `123456` | Nguyễn Văn An | Giáo viên Tổ 1 | **Chỉ hồ sơ cá nhân của Nguyễn Văn An** |
| `giaovien2` | `123456` | Phạm Thị Thảo | Giáo viên Tổ 1 | **Chỉ hồ sơ cá nhân của Phạm Thị Thảo** |
| `giaovien_nk` | `123456` | Vũ Quốc Cường | Giáo viên Tổ Năng khiếu | **Chỉ hồ sơ cá nhân của Vũ Quốc Cường** |

---

## 🛠 HƯỚNG DẪN CẤU HÌNH GOOGLE DRIVE CHO ADMIN

1. Đăng nhập bằng tài khoản **Admin**.
2. Bấm vào nút **"Cấu hình Google Drive"** ở Menu bên trái.
3. Điền **Folder ID** của thư mục Google Drive trường học (Lấy từ URL thư mục Drive: `https://drive.google.com/drive/folders/YOUR_FOLDER_ID`).
4. (Tùy chọn) Cung cấp Service Account Email để tự động hóa quyền lưu trữ.
