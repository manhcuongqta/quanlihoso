const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const { loadDB, saveDB } = require('./db');
const { formatDriveUrls, extractDriveId, uploadToGoogleDriveViaScript } = require('./driveService');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Storage config for local file uploads (which get uploaded to Google Drive API or converted)
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, 'uploads');
    const fs = require('fs');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});
const upload = multer({ storage: storage });

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Middleware Helper: Auth & User Context
function getUserFromHeader(req) {
  const userId = req.headers['x-user-id'];
  const db = loadDB();
  if (userId) {
    const user = db.users.find(u => u.id === userId);
    if (user) return user;
  }
  // Default fallback user (Admin for testing if not set)
  return db.users.find(u => u.role === 'admin') || db.users[0];
}

// ----------------------------------------------------
// API ROUTES
// ----------------------------------------------------

// Auth Login
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const db = loadDB();
  const user = db.users.find(u => u.username === username && u.passwordHash === password);
  
  if (!user) {
    return res.status(401).json({ success: false, message: 'Tên đăng nhập hoặc mật khẩu không chính xác' });
  }

  // Return user info without password
  const { passwordHash, ...userInfo } = user;
  res.json({
    success: true,
    user: userInfo,
    token: `token_${user.id}_${Date.now()}`
  });
});

// Get Current User Profile
app.get('/api/auth/me', (req, res) => {
  const user = getUserFromHeader(req);
  const { passwordHash, ...userInfo } = user;
  res.json({ success: true, user: userInfo });
});

// Auth: Change Password
app.post('/api/auth/change-password', (req, res) => {
  const currentUser = getUserFromHeader(req);
  const { oldPassword, newPassword } = req.body;

  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ success: false, message: 'Mật khẩu mới phải có ít nhất 4 ký tự' });
  }

  const db = loadDB();
  const user = db.users.find(u => u.id === currentUser.id);

  if (!user) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy thông tin tài khoản' });
  }

  if (oldPassword && user.passwordHash !== oldPassword) {
    return res.status(400).json({ success: false, message: 'Mật khẩu hiện tại không chính xác' });
  }

  user.passwordHash = newPassword;
  saveDB(db);

  res.json({ success: true, message: 'Đã đổi mật khẩu thành công!' });
});

// Get All Departments
app.get('/api/departments', (req, res) => {
  const db = loadDB();
  res.json({ success: true, departments: db.departments });
});

// Get All Categories (System + Custom)
app.get('/api/categories', (req, res) => {
  const db = loadDB();
  res.json({ success: true, categories: db.categories });
});

// Admin: Add New Category
app.post('/api/categories', (req, res) => {
  const currentUser = getUserFromHeader(req);
  if (currentUser.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Chỉ Admin mới có quyền tạo mục hồ sơ mới' });
  }

  const { name, icon, description, departmentId } = req.body;
  if (!name) {
    return res.status(400).json({ success: false, message: 'Tên danh mục không được để trống' });
  }

  const db = loadDB();
  const newId = 'cat_' + Date.now();
  const newCat = {
    id: newId,
    name,
    icon: icon || 'Folder',
    type: 'custom',
    isCustom: true,
    description: description || '',
    departmentId: departmentId || null,
    createdAt: new Date().toISOString()
  };

  db.categories.push(newCat);
  saveDB(db);

  res.json({ success: true, category: newCat, message: 'Đã tạo mục hồ sơ mới thành công' });
});

// Admin: Update Category (Name, Description, Icon)
app.put('/api/categories/:id', (req, res) => {
  const currentUser = getUserFromHeader(req);
  if (currentUser.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Chỉ Admin mới có quyền sửa danh mục' });
  }

  const catId = req.params.id;
  const { name, description, icon } = req.body;
  const db = loadDB();
  const cat = db.categories.find(c => c.id === catId);

  if (!cat) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy danh mục' });
  }

  if (name && name.trim()) cat.name = name.trim();
  if (description !== undefined) cat.description = description.trim();
  if (icon) cat.icon = icon;

  saveDB(db);
  res.json({ success: true, category: cat, message: 'Đã cập nhật thông tin danh mục thành công' });
});

// Admin: Delete Custom Category
app.delete('/api/categories/:id', (req, res) => {
  const currentUser = getUserFromHeader(req);
  if (currentUser.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Chỉ Admin mới có quyền xóa danh mục' });
  }

  const catId = req.params.id;
  const db = loadDB();
  const index = db.categories.findIndex(c => c.id === catId);

  if (index === -1) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy danh mục' });
  }

  if (!db.categories[index].isCustom) {
    return res.status(400).json({ success: false, message: 'Không thể xóa các danh mục mặc định của hệ thống' });
  }

  db.categories.splice(index, 1);
  saveDB(db);

  res.json({ success: true, message: 'Đã xóa danh mục thành công' });
});

// Get User Accounts List (Admin & BGH)
app.get('/api/users', (req, res) => {
  const currentUser = getUserFromHeader(req);
  if (currentUser.role !== 'admin' && currentUser.role !== 'bgh') {
    return res.status(403).json({ success: false, message: 'Không có quyền truy cập danh sách tài khoản' });
  }

  const db = loadDB();
  const usersClean = db.users.map(({ passwordHash, ...u }) => u);
  res.json({ success: true, users: usersClean });
});

// Admin: Create New User Account
app.post('/api/users', (req, res) => {
  const currentUser = getUserFromHeader(req);
  if (currentUser.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Chỉ Admin mới có quyền tạo tài khoản' });
  }

  const { username, password, fullName, email, role, departmentId, phone, driveFolderUrl } = req.body;
  if (!username || !password || !fullName || !role) {
    return res.status(400).json({ success: false, message: 'Vui lòng điền đầy đủ các thông tin bắt buộc' });
  }

  const db = loadDB();
  if (db.users.some(u => u.username === username)) {
    return res.status(400).json({ success: false, message: 'Tên đăng nhập đã tồn tại trong hệ thống' });
  }

  const newUser = {
    id: 'usr_' + Date.now(),
    username,
    passwordHash: password,
    fullName,
    email: email || `${username}@school.edu.vn`,
    role, // 'admin', 'bgh', 'totruong', 'giaovien'
    departmentId: departmentId || null,
    phone: phone || '',
    avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${username}`,
    createdAt: new Date().toISOString()
  };

  db.users.push(newUser);

  // Auto create member folder for new teacher/staff
  if (!db.teacherFolders) db.teacherFolders = [];
  const newFolder = {
    id: 'tf_' + newUser.id,
    name: `Thư mục Hồ sơ & Giáo án - ${newUser.fullName}`,
    teacherId: newUser.id,
    teacherName: newUser.fullName,
    departmentId: newUser.departmentId || 'to1',
    driveFolderUrl: driveFolderUrl || (db.driveConfig.folderId ? `https://drive.google.com/drive/u/3/folders/${db.driveConfig.folderId}` : ''),
    createdAt: new Date().toISOString()
  };
  db.teacherFolders.push(newFolder);

  saveDB(db);

  const { passwordHash, ...userInfo } = newUser;
  res.json({ success: true, user: userInfo, message: 'Đã tạo tài khoản và tự động khởi tạo Thư mục Google Drive cho Giáo viên thành công!' });
});

// Admin: Update User Account
app.put('/api/users/:id', (req, res) => {
  const currentUser = getUserFromHeader(req);
  if (currentUser.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Chỉ Admin mới có quyền cập nhật tài khoản' });
  }

  const userId = req.params.id;
  const { username, fullName, email, role, departmentId, phone, password, driveFolderUrl } = req.body;
  const db = loadDB();
  const user = db.users.find(u => u.id === userId);

  if (!user) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy người dùng' });
  }

  if (username && username.trim()) {
    const cleanUsername = username.trim();
    if (db.users.some(u => u.username === cleanUsername && u.id !== userId)) {
      return res.status(400).json({ success: false, message: 'Tên đăng nhập đã được sử dụng bởi tài khoản khác' });
    }
    user.username = cleanUsername;
  }

  if (fullName) user.fullName = fullName.trim();
  if (email) user.email = email.trim();
  if (role) user.role = role;
  if (departmentId !== undefined) user.departmentId = departmentId;
  if (phone !== undefined) user.phone = phone.trim();
  if (password) user.passwordHash = password;

  // Sync teacher member folder
  if (!db.teacherFolders) db.teacherFolders = [];
  let tf = db.teacherFolders.find(f => f.teacherId === userId);
  if (tf) {
    if (fullName) {
      tf.name = `Thư mục Hồ sơ & Giáo án - ${fullName.trim()}`;
      tf.teacherName = fullName.trim();
    }
    if (departmentId !== undefined) tf.departmentId = departmentId;
    if (driveFolderUrl !== undefined) tf.driveFolderUrl = driveFolderUrl.trim();
  } else {
    tf = {
      id: 'tf_' + userId,
      name: `Thư mục Hồ sơ & Giáo án - ${user.fullName}`,
      teacherId: userId,
      teacherName: user.fullName,
      departmentId: user.departmentId || 'to1',
      driveFolderUrl: (driveFolderUrl !== undefined ? driveFolderUrl.trim() : '') || (db.driveConfig.folderId ? `https://drive.google.com/drive/u/3/folders/${db.driveConfig.folderId}` : ''),
      createdAt: new Date().toISOString()
    };
    db.teacherFolders.push(tf);
  }

  saveDB(db);
  const { passwordHash, ...userInfo } = user;
  res.json({ success: true, user: userInfo, message: 'Đã cập nhật thông tin tài khoản và đồng bộ Thư mục Google Drive!' });
});

// Helper for Vietnamese slug/username generation: hovaten.qc
function removeVietnameseTones(str) {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
}

function generateUsernameFromFullName(fullName, existingUsers = []) {
  const base = removeVietnameseTones(fullName) || 'giaovien';
  let candidate = base + '.qc';
  let counter = 1;
  while (existingUsers.some(u => u.username === candidate)) {
    candidate = `${base}${counter}.qc`;
    counter++;
  }
  return candidate;
}

// Admin: Bulk Create Teacher Accounts (Auto username: hovaten.qc)
app.post('/api/users/bulk', (req, res) => {
  const currentUser = getUserFromHeader(req);
  if (currentUser.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Chỉ Admin mới có quyền khởi tạo tài khoản hàng loạt' });
  }

  const { teachers } = req.body; // Array of { fullName, departmentId, username, password, driveFolderUrl }
  if (!Array.isArray(teachers) || teachers.length === 0) {
    return res.status(400).json({ success: false, message: 'Danh sách giáo viên không hợp lệ' });
  }

  const db = loadDB();
  if (!db.teacherFolders) db.teacherFolders = [];

  const createdUsers = [];
  let count = 0;

  teachers.forEach(t => {
    if (!t.fullName || !t.fullName.trim()) return;
    const name = t.fullName.trim();
    const finalUsername = (t.username && t.username.trim()) ? t.username.trim() : generateUsernameFromFullName(name, db.users);
    
    // Skip if username already exists
    if (db.users.some(u => u.username === finalUsername)) {
      return;
    }

    const newUser = {
      id: 'usr_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      username: finalUsername,
      passwordHash: t.password || '123456',
      fullName: name,
      email: `${finalUsername}@school.edu.vn`,
      role: t.role || 'giaovien',
      departmentId: t.departmentId || 'to1',
      phone: t.phone || '',
      avatar: '',
      createdAt: new Date().toISOString()
    };

    db.users.push(newUser);

    const newFolder = {
      id: 'tf_' + newUser.id,
      name: `Thư mục Hồ sơ & Giáo án - ${newUser.fullName}`,
      teacherId: newUser.id,
      teacherName: newUser.fullName,
      departmentId: newUser.departmentId,
      driveFolderUrl: t.driveFolderUrl || (db.driveConfig.folderId ? `https://drive.google.com/drive/u/3/folders/${db.driveConfig.folderId}` : ''),
      createdAt: new Date().toISOString()
    };
    db.teacherFolders.push(newFolder);

    const { passwordHash, ...userInfo } = newUser;
    createdUsers.push(userInfo);
    count++;
  });

  saveDB(db);
  res.json({
    success: true,
    count,
    createdUsers,
    message: `Đã tạo thành công ${count} tài khoản giáo viên mới với cấu trúc hovaten.qc!`
  });
});

// Update Profile & Avatar for Logged-In User
app.put('/api/auth/profile', (req, res) => {
  const currentUser = getUserFromHeader(req);
  const { avatar, phone, email } = req.body;
  const db = loadDB();
  const user = db.users.find(u => u.id === currentUser.id);

  if (!user) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy thông tin tài khoản' });
  }

  if (avatar !== undefined) user.avatar = avatar.trim();
  if (phone !== undefined) user.phone = phone.trim();
  if (email !== undefined) user.email = email.trim();

  saveDB(db);
  const { passwordHash, ...userInfo } = user;
  res.json({ success: true, user: userInfo, message: 'Cập nhật ảnh đại diện & thông tin cá nhân thành công!' });
});

// Admin: Delete User Account
app.delete('/api/users/:id', (req, res) => {
  const currentUser = getUserFromHeader(req);
  if (currentUser.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Chỉ Admin mới có quyền xóa tài khoản' });
  }

  const userId = req.params.id;
  if (userId === currentUser.id) {
    return res.status(400).json({ success: false, message: 'Không thể tự xóa tài khoản đang đăng nhập' });
  }

  const db = loadDB();
  const index = db.users.findIndex(u => u.id === userId);

  if (index === -1) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản' });
  }

  db.users.splice(index, 1);
  saveDB(db);

  res.json({ success: true, message: 'Đã xóa tài khoản thành công' });
});

// ----------------------------------------------------
// DOCUMENT MANAGEMENT ENDPOINTS (STRICT RBAC)
// ----------------------------------------------------

// Get Documents List based on Role Permissions
app.get('/api/documents', (req, res) => {
  const currentUser = getUserFromHeader(req);
  const { categoryId, departmentId, search, schoolYear, teacherFolderId } = req.query;
  const db = loadDB();

  let docs = [...db.documents];

  // --- STRICT ACCESS CONTROL (RBAC) ---
  // 1. Giáo viên: CHỈ ĐƯỢC XEM HỒ SƠ CỦA CHÍNH MÌNH (khi chọn Hồ sơ cá nhân) hoặc các hồ sơ dùng chung nhà trường/đội/đoàn
  if (currentUser.role === 'giaovien') {
    docs = docs.filter(d => {
      // Nếu là hồ sơ cá nhân -> chỉ xem của mình
      if (d.categoryId === 'personal') {
        return d.teacherId === currentUser.id;
      }
      // Hồ sơ nhà trường, đội, đoàn -> tất cả xem được
      if (['school', 'doi', 'doan'].includes(d.categoryId)) {
        return true;
      }
      // Hồ sơ tổ -> xem nếu thuộc cùng tổ
      if (d.categoryId === 'group') {
        return d.departmentId === currentUser.departmentId;
      }
      // Các mục tùy chỉnh khác -> nếu là hồ sơ cá nhân thì chỉ thấy của mình
      return d.teacherId === currentUser.id || d.departmentId === currentUser.departmentId;
    });
  } 
  // 2. Tổ trưởng: XEM ĐƯỢC TẤT CẢ HỒ SƠ CỦA TỔ MÌNH
  else if (currentUser.role === 'totruong') {
    docs = docs.filter(d => {
      if (['school', 'doi', 'doan'].includes(d.categoryId)) {
        return true;
      }
      // Xem hồ sơ cá nhân hoặc hồ sơ tổ thuộc đúng departmentId của Tổ trưởng
      return d.departmentId === currentUser.departmentId || d.teacherId === currentUser.id;
    });
  }
  // 3. Ban Giám Hiệu (bgh) & Admin: XEM TẤT CẢ HỒ SƠ CỦA TOÀN TRƯỜNG

  // --- FILTERS ---
  if (categoryId) {
    docs = docs.filter(d => d.categoryId === categoryId);
  }

  if (departmentId) {
    docs = docs.filter(d => d.departmentId === departmentId);
  }

  if (schoolYear) {
    docs = docs.filter(d => d.schoolYear === schoolYear);
  }

  if (teacherFolderId) {
    docs = docs.filter(d => d.teacherFolderId === teacherFolderId);
  }

  if (search) {
    const q = search.toLowerCase();
    docs = docs.filter(d => 
      d.title.toLowerCase().includes(q) ||
      d.teacherName.toLowerCase().includes(q) ||
      d.fileName.toLowerCase().includes(q)
    );
  }

  // Sort newest first
  docs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

  res.json({
    success: true,
    documents: docs,
    total: docs.length,
    userRole: currentUser.role,
    userDepartmentId: currentUser.departmentId
  });
});

// Upload New Document (to Google Drive / Server)
app.post('/api/documents', upload.single('file'), async (req, res) => {
  const currentUser = getUserFromHeader(req);
  const { title, categoryId, departmentId, driveLink, schoolYear, semester, notes, teacherFolderId } = req.body;

  if (!title || !categoryId) {
    return res.status(400).json({ success: false, message: 'Vui lòng cung cấp tiêu đề và danh mục hồ sơ' });
  }

  const db = loadDB();
  if (!db.teacherFolders) db.teacherFolders = [];

  // Find or auto-create teacher member folder for current user
  let teacherFolder = db.teacherFolders.find(f => f.teacherId === currentUser.id);
  if (!teacherFolder) {
    teacherFolder = {
      id: 'tf_' + currentUser.id,
      name: `Thư mục Giáo án & Hồ sơ - ${currentUser.fullName}`,
      teacherId: currentUser.id,
      teacherName: currentUser.fullName,
      departmentId: departmentId || currentUser.departmentId || 'to1',
      driveFolderUrl: db.driveConfig.folderId ? `https://drive.google.com/drive/u/3/folders/${db.driveConfig.folderId}` : '',
      createdAt: new Date().toISOString()
    };
    db.teacherFolders.push(teacherFolder);
  }

  let fileName = 'Hồ sơ đính kèm.pdf';
  let fileSize = '1.5 MB';
  let localFileRelativePath = null;
  let driveUrls = null;

  if (req.file) {
    fileName = req.file.originalname;
    fileSize = (req.file.size / (1024 * 1024)).toFixed(2) + ' MB';
    localFileRelativePath = `/uploads/${req.file.filename}`;

    // Extract target Google Drive folder ID
    const extractedFolder = extractDriveId(teacherFolder.driveFolderUrl || db.driveConfig.folderId);
    const targetFolderId = extractedFolder ? extractedFolder.id : db.driveConfig.folderId;

    // Attempt real upload to Google Drive via Google Apps Script endpoint if configured
    if (db.driveConfig && db.driveConfig.gasDeploymentUrl && targetFolderId) {
      const realDriveResult = await uploadToGoogleDriveViaScript(
        req.file.path,
        fileName,
        targetFolderId,
        db.driveConfig.gasDeploymentUrl
      );
      if (realDriveResult) {
        driveUrls = realDriveResult;
      }
    }
  }

  if (!driveUrls) {
    let driveInput = driveLink || teacherFolder.driveFolderUrl || (db.driveConfig.folderId ? `https://drive.google.com/drive/u/3/folders/${db.driveConfig.folderId}` : '');
    driveUrls = formatDriveUrls(driveInput, fileName, localFileRelativePath);
  }

  const newDoc = {
    id: 'doc_' + Date.now(),
    title,
    categoryId,
    departmentId: departmentId || currentUser.departmentId || 'to1',
    teacherId: currentUser.id,
    teacherName: currentUser.fullName,
    teacherFolderId: teacherFolder.id,
    fileName,
    fileSize,
    localFileUrl: localFileRelativePath,
    driveViewUrl: driveUrls.driveViewUrl,
    driveDownloadUrl: driveUrls.driveDownloadUrl,
    driveEmbedUrl: driveUrls.driveEmbedUrl,
    status: 'approved', // Auto approve or set to 'pending' if required
    schoolYear: schoolYear || '2026-2027',
    semester: semester || 'Học kỳ I',
    notes: notes || '',
    uploadedAt: new Date().toISOString()
  };

  db.documents.push(newDoc);
  saveDB(db);

  res.json({
    success: true,
    document: newDoc,
    message: `Đã nộp hồ sơ vào Thư mục (${teacherFolder.name}) thành công!`
  });
});

// Update Document Status (Approve/Reject)
app.put('/api/documents/:id/status', (req, res) => {
  const currentUser = getUserFromHeader(req);
  if (!['bgh', 'totruong', 'admin'].includes(currentUser.role)) {
    return res.status(403).json({ success: false, message: 'Không có quyền duyệt hồ sơ' });
  }

  const { status, notes } = req.body;
  const db = loadDB();
  const doc = db.documents.find(d => d.id === req.params.id);

  if (!doc) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy hồ sơ' });
  }

  if (status) doc.status = status;
  if (notes !== undefined) doc.notes = notes;

  saveDB(db);
  res.json({ success: true, document: doc, message: 'Đã cập nhật trạng thái duyệt hồ sơ' });
});

// Delete Document
app.delete('/api/documents/:id', (req, res) => {
  const currentUser = getUserFromHeader(req);
  const db = loadDB();
  const index = db.documents.findIndex(d => d.id === req.params.id);

  if (index === -1) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy hồ sơ' });
  }

  const doc = db.documents[index];
  // Only owner or Admin/BGH can delete
  if (doc.teacherId !== currentUser.id && !['admin', 'bgh'].includes(currentUser.role)) {
    return res.status(403).json({ success: false, message: 'Bạn không có quyền xóa hồ sơ này' });
  }

  db.documents.splice(index, 1);
  saveDB(db);

  res.json({ success: true, message: 'Đã xóa hồ sơ thành công' });
});

// Google Drive Config API
app.get('/api/drive/config', (req, res) => {
  const db = loadDB();
  res.json({ success: true, config: db.driveConfig });
});

app.post('/api/drive/config', (req, res) => {
  const currentUser = getUserFromHeader(req);
  if (currentUser.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Chỉ Admin mới có quyền cấu hình Google Drive' });
  }

  const { folderId, serviceAccountEmail, syncMode, apiKey, gasDeploymentUrl } = req.body;
  const db = loadDB();

  db.driveConfig = {
    folderId: folderId || db.driveConfig.folderId,
    serviceAccountEmail: serviceAccountEmail || db.driveConfig.serviceAccountEmail,
    syncMode: syncMode || db.driveConfig.syncMode,
    apiKey: apiKey !== undefined ? apiKey : db.driveConfig.apiKey,
    gasDeploymentUrl: gasDeploymentUrl !== undefined ? gasDeploymentUrl : (db.driveConfig.gasDeploymentUrl || ''),
    updatedAt: new Date().toISOString()
  };

  saveDB(db);
  res.json({ success: true, config: db.driveConfig, message: 'Đã lưu cấu hình Google Drive' });
});

// ----------------------------------------------------
// SCHOOL YEARS API
// ----------------------------------------------------
app.get('/api/school-years', (req, res) => {
  const db = loadDB();
  res.json({ success: true, schoolYears: db.schoolYears || ['2026-2027'] });
});

app.post('/api/school-years', (req, res) => {
  const currentUser = getUserFromHeader(req);
  if (currentUser.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Chỉ Admin mới có quyền thêm năm học mới' });
  }

  const { year } = req.body;
  if (!year || !year.trim()) {
    return res.status(400).json({ success: false, message: 'Vui lòng nhập định dạng năm học (VD: 2026-2027)' });
  }

  const db = loadDB();
  if (!db.schoolYears) db.schoolYears = ['2026-2027'];
  const formatted = year.trim();

  if (db.schoolYears.includes(formatted)) {
    return res.status(400).json({ success: false, message: 'Năm học này đã có trong hệ thống' });
  }

  db.schoolYears.unshift(formatted);
  saveDB(db);
  res.json({ success: true, schoolYears: db.schoolYears, message: `Đã thêm năm học mới: ${formatted}` });
});

app.delete('/api/school-years/:year', (req, res) => {
  const currentUser = getUserFromHeader(req);
  if (currentUser.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Chỉ Admin mới có quyền xóa năm học' });
  }

  const targetYear = req.params.year;
  const db = loadDB();
  if (!db.schoolYears) db.schoolYears = ['2026-2027'];

  const index = db.schoolYears.indexOf(targetYear);
  if (index === -1) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy năm học' });
  }

  db.schoolYears.splice(index, 1);
  saveDB(db);
  res.json({ success: true, schoolYears: db.schoolYears, message: `Đã xóa năm học ${targetYear}` });
});

// ----------------------------------------------------
// TEACHER MEMBER FOLDERS API
// ----------------------------------------------------
app.get('/api/teacher-folders', (req, res) => {
  const currentUser = getUserFromHeader(req);
  const { departmentId, teacherId } = req.query;
  const db = loadDB();
  let folders = db.teacherFolders || [];

  if (currentUser && currentUser.role === 'giaovien') {
    folders = folders.filter(f => f.teacherId === currentUser.id);
  } else {
    if (departmentId) {
      folders = folders.filter(f => f.departmentId === departmentId);
    }
    if (teacherId) {
      folders = folders.filter(f => f.teacherId === teacherId);
    }
  }

  res.json({ success: true, teacherFolders: folders });
});

app.post('/api/teacher-folders', (req, res) => {
  const currentUser = getUserFromHeader(req);
  const { name, teacherId, departmentId, driveFolderUrl } = req.body;

  if (!name || !departmentId) {
    return res.status(400).json({ success: false, message: 'Vui lòng cung cấp tên thư mục và tổ chuyên môn' });
  }

  const db = loadDB();
  const teacherObj = db.users.find(u => u.id === teacherId);

  const newFolder = {
    id: 'tf_' + Date.now(),
    name,
    teacherId: teacherId || currentUser.id,
    teacherName: teacherObj ? teacherObj.fullName : (currentUser.fullName || 'Giáo viên'),
    departmentId,
    driveFolderUrl: driveFolderUrl || (db.driveConfig.folderId ? `https://drive.google.com/drive/u/3/folders/${db.driveConfig.folderId}` : ''),
    createdAt: new Date().toISOString()
  };

  if (!db.teacherFolders) db.teacherFolders = [];
  db.teacherFolders.push(newFolder);
  saveDB(db);

  res.json({ success: true, teacherFolder: newFolder, message: 'Đã tạo thư mục thành viên mới thành công' });
});

app.delete('/api/teacher-folders/:id', (req, res) => {
  const currentUser = getUserFromHeader(req);
  if (!['admin', 'totruong', 'bgh'].includes(currentUser.role)) {
    return res.status(403).json({ success: false, message: 'Không có quyền xóa thư mục thành viên' });
  }

  const db = loadDB();
  if (!db.teacherFolders) db.teacherFolders = [];
  const index = db.teacherFolders.findIndex(f => f.id === req.params.id);

  if (index === -1) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy thư mục' });
  }

  db.teacherFolders.splice(index, 1);
  saveDB(db);

  res.json({ success: true, message: 'Đã xóa thư mục thành viên thành công' });
});

// Admin / Totruong: Update Teacher Member Folder Name & Drive Link
app.put('/api/teacher-folders/:id', (req, res) => {
  const currentUser = getUserFromHeader(req);
  if (!['admin', 'totruong', 'bgh'].includes(currentUser.role)) {
    return res.status(403).json({ success: false, message: 'Bạn không có quyền sửa thư mục này' });
  }

  const folderId = req.params.id;
  const { name, driveFolderUrl } = req.body;
  const db = loadDB();
  if (!db.teacherFolders) db.teacherFolders = [];

  const folder = db.teacherFolders.find(f => f.id === folderId);
  if (!folder) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy thư mục' });
  }

  if (name) folder.name = name.trim();
  if (driveFolderUrl !== undefined) folder.driveFolderUrl = driveFolderUrl.trim();

  saveDB(db);
  res.json({ success: true, folder, message: 'Đã cập nhật tên và đường dẫn thư mục thành công!' });
});

// Upload Profile Avatar Image File From Computer
app.post('/api/auth/profile/avatar', upload.single('avatarFile'), (req, res) => {
  const currentUser = getUserFromHeader(req);
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'Vui lòng chọn tệp hình ảnh từ máy tính' });
  }

  const db = loadDB();
  const user = db.users.find(u => u.id === currentUser.id);
  if (!user) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy thông tin tài khoản' });
  }

  const avatarUrl = '/uploads/' + req.file.filename;
  user.avatar = avatarUrl;
  saveDB(db);

  const { passwordHash, ...userInfo } = user;
  res.json({ success: true, user: userInfo, avatarUrl, message: 'Đã tải lên và cập nhật ảnh đại diện từ máy tính thành công!' });
});

// Auto-sync new logo if available in uploads
try {
  const fs = require('fs');
  const uploadedLogo = 'C:/Users/manhc/.gemini/antigravity/brain/f094e6ff-cfee-456b-9091-0b364a0cea47/.user_uploaded/media_1789203770428.jpg';
  const targetLogo = path.join(__dirname, 'public', 'logo.jpg');
  if (fs.existsSync(uploadedLogo)) {
    fs.copyFileSync(uploadedLogo, targetLogo);
  }
} catch (e) {}

// Admin API: Export Database Backup JSON
app.get('/api/admin/export-db', (req, res) => {
  const user = getUserFromHeader(req);
  if (user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Chỉ Admin mới có quyền xuất backup dữ liệu' });
  }
  const db = loadDB();
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename=database_quynh_chau_${Date.now()}.json`);
  res.send(JSON.stringify(db, null, 2));
});

// Admin API: Import Database Restore JSON
app.post('/api/admin/import-db', upload.single('dbFile'), (req, res) => {
  const user = getUserFromHeader(req);
  if (user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Chỉ Admin mới có quyền khôi phục dữ liệu' });
  }
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'Vui lòng chọn tệp JSON backup' });
  }
  try {
    const fs = require('fs');
    const raw = fs.readFileSync(req.file.path, 'utf8');
    const newDb = JSON.parse(raw);
    if (!newDb.users || !newDb.categories) {
      return res.status(400).json({ success: false, message: 'Tệp backup JSON không đúng cấu trúc' });
    }
    saveDB(newDb);
    try { fs.unlinkSync(req.file.path); } catch (e) {}
    res.json({ success: true, message: 'Khôi phục toàn bộ dữ liệu thành công!' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Lỗi đọc tệp JSON backup: ' + err.message });
  }
});

// Catch-all to serve single page app
app.get('*', (req, res) => {
  const fs = require('fs');
  const possiblePaths = [
    path.join(__dirname, 'public', 'index.html'),
    path.join(process.cwd(), 'public', 'index.html'),
    path.join(__dirname, 'index.html'),
    path.resolve('index.html')
  ];

  let foundPath = possiblePaths.find(p => fs.existsSync(p));

  if (foundPath) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.sendFile(foundPath);
  }

  // Self-contained Full Inline HTML Fallback
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hệ Thống Quản Lý Hồ Sơ Giáo Viên - Trường Học</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  <script src="https://unpkg.com/lucide@latest"></script>
  <style>body { font-family: 'Inter', sans-serif; background-color: #f8fafc; }</style>
</head>
<body class="text-slate-800 antialiased">
  <div id="app">
    <div class="min-h-screen flex items-center justify-center bg-slate-900 text-white">
      <div class="text-center">
        <div class="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
        <p class="text-lg font-medium">Đang tải Hệ thống Quản lý Hồ sơ Giáo viên...</p>
      </div>
    </div>
  </div>
  <script>
    const state = { currentUser: null, usersList: [], categories: [], departments: [], documents: [], activeCategory: 'personal', activeSubDepartment: 'to1', personalSubmenuOpen: true, searchQuery: '', selectedSchoolYear: '2025-2026', driveConfig: {}, activeModal: null, previewDoc: null, toast: null };
    function showToast(msg, type = 'success') { state.toast = { msg, type }; renderApp(); setTimeout(() => { state.toast = null; renderApp(); }, 4000); }
    function getRoleText(role) { switch (role) { case 'admin': return 'Quản trị viên (Admin)'; case 'bgh': return 'Ban Giám Hiệu (BGH)'; case 'totruong': return 'Tổ trưởng Chuyên môn'; case 'giaovien': return 'Giáo viên'; default: return role; } }
    function getRoleBadgeStyle(role) { switch (role) { case 'admin': return 'bg-purple-100 text-purple-700 border-purple-200'; case 'bgh': return 'bg-rose-100 text-rose-700 border-rose-200'; case 'totruong': return 'bg-amber-100 text-amber-800 border-amber-200'; case 'giaovien': return 'bg-blue-100 text-blue-700 border-blue-200'; default: return 'bg-slate-100 text-slate-700'; } }
    async function initData() { try { const [resCat, resDep, resDrive, resMe] = await Promise.all([ fetch('/api/categories').then(r => r.json()), fetch('/api/departments').then(r => r.json()), fetch('/api/drive/config').then(r => r.json()), fetch('/api/auth/me').then(r => r.json()) ]); if (resCat.success) state.categories = resCat.categories; if (resDep.success) state.departments = resDep.departments; if (resDrive.success) state.driveConfig = resDrive.config; if (resMe.success) { state.currentUser = resMe.user; await fetchUsersList(); await fetchDocuments(); } } catch (err) { showToast("Lỗi kết nối máy chủ", "error"); } renderApp(); }
    async function fetchUsersList() { if (!state.currentUser) return; try { const res = await fetch('/api/users', { headers: { 'x-user-id': state.currentUser.id } }); const data = await res.json(); if (data.success) state.usersList = data.users; } catch (err) {} }
    async function fetchDocuments() { if (!state.currentUser) return; try { let url = \`/api/documents?categoryId=\${state.activeCategory}&schoolYear=\${state.selectedSchoolYear}\`; if (state.activeCategory === 'personal' && state.activeSubDepartment) url += \`&departmentId=\${state.activeSubDepartment}\`; if (state.searchQuery) url += \`&search=\${encodeURIComponent(state.searchQuery)}\`; const res = await fetch(url, { headers: { 'x-user-id': state.currentUser.id } }); const data = await res.json(); if (data.success) state.documents = data.documents; } catch (err) {} }
    async function switchUser(userId) { const found = state.usersList.find(u => u.id === userId); if (found) { state.currentUser = found; showToast(\`Đã chuyển sang tài khoản: \${found.fullName} (\${getRoleText(found.role)})\`, 'info'); await fetchDocuments(); renderApp(); } }
    async function deleteDocument(docId) { if (!confirm("Bạn có chắc chắn muốn xóa hồ sơ này khỏi hệ thống?")) return; try { const res = await fetch(\`/api/documents/\${docId}\`, { method: 'DELETE', headers: { 'x-user-id': state.currentUser.id } }); const data = await res.json(); if (data.success) { showToast("Đã xóa hồ sơ thành công"); await fetchDocuments(); renderApp(); } else showToast(data.message, "error"); } catch (err) { showToast("Lỗi khi xóa", "error"); } }
    async function handleUploadSubmit(e) { e.preventDefault(); const form = e.target; const formData = new FormData(form); formData.append('categoryId', state.activeCategory); formData.append('departmentId', state.activeCategory === 'personal' ? state.activeSubDepartment : (state.currentUser.departmentId || 'to1')); try { const res = await fetch('/api/documents', { method: 'POST', headers: { 'x-user-id': state.currentUser.id }, body: formData }); const data = await res.json(); if (data.success) { showToast("Tải hồ sơ lên Google Drive thành công!"); state.activeModal = null; await fetchDocuments(); renderApp(); } else showToast(data.message, "error"); } catch (err) { showToast("Lỗi gửi dữ liệu", "error"); } }
    async function handleUserSubmit(e) { e.preventDefault(); const form = e.target; const body = { username: form.username.value, password: form.password.value, fullName: form.fullName.value, role: form.role.value, departmentId: form.departmentId.value, email: form.email.value }; try { const res = await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user-id': state.currentUser.id }, body: JSON.stringify(body) }); const data = await res.json(); if (data.success) { showToast(data.message); state.activeModal = null; await fetchUsersList(); renderApp(); } else showToast(data.message, "error"); } catch (err) { showToast("Lỗi tạo tài khoản", "error"); } }
    async function handleCategorySubmit(e) { e.preventDefault(); const form = e.target; const body = { name: form.name.value, description: form.description.value, icon: 'FolderPlus' }; try { const res = await fetch('/api/categories', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user-id': state.currentUser.id }, body: JSON.stringify(body) }); const data = await res.json(); if (data.success) { showToast(data.message); state.activeModal = null; await initData(); } else showToast(data.message, "error"); } catch (err) { showToast("Lỗi tạo danh mục", "error"); } }
    async function handleDriveSubmit(e) { e.preventDefault(); const form = e.target; const body = { folderId: form.folderId.value, serviceAccountEmail: form.serviceAccountEmail.value, syncMode: form.syncMode.value }; try { const res = await fetch('/api/drive/config', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user-id': state.currentUser.id }, body: JSON.stringify(body) }); const data = await res.json(); if (data.success) { showToast(data.message); state.driveConfig = data.config; state.activeModal = null; renderApp(); } else showToast(data.message, "error"); } catch (err) { showToast("Lỗi lưu cấu hình Google Drive", "error"); } }
    function renderApp() { const root = document.getElementById('app'); if (!root || !state.currentUser) return; const activeCatObj = state.categories.find(c => c.id === state.activeCategory) || { name: 'Hồ sơ', description: '' }; const activeDeptObj = state.departments.find(d => d.id === state.activeSubDepartment) || { name: state.activeSubDepartment }; root.innerHTML = \`<div class="min-h-screen flex flex-col bg-slate-100">\${state.toast ? \`<div class="fixed top-4 right-4 z-50 px-5 py-3 rounded-lg shadow-xl text-white font-medium flex items-center gap-3 \${state.toast.type === 'error' ? 'bg-rose-600' : state.toast.type === 'info' ? 'bg-blue-600' : 'bg-emerald-600'}"><i data-lucide="\${state.toast.type === 'error' ? 'alert-triangle' : 'check-circle'}" class="w-5 h-5"></i><span>\${state.toast.msg}</span></div>\` : ''}<header class="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-sm"><div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8"><div class="flex items-center justify-between h-16"><div class="flex items-center gap-3"><div class="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center font-bold text-xl shadow-md shadow-blue-500/20"><i data-lucide="graduation-cap" class="w-6 h-6"></i></div><div><h1 class="text-lg font-bold text-slate-900 leading-tight">QUẢN LÝ HỒ SƠ GIÁO VIÊN</h1><p class="text-xs text-slate-500 font-medium">Trường Học Thông Minh • Tích hợp Google Drive</p></div></div><div class="flex items-center gap-4"><div class="hidden md:flex items-center gap-2 bg-slate-100 p-1.5 rounded-xl border border-slate-200"><span class="text-xs font-semibold text-slate-500 px-2 flex items-center gap-1"><i data-lucide="users" class="w-3.5 h-3.5"></i> Chuyển tài khoản:</span><select id="userSwitcherSelect" class="bg-white text-xs font-medium text-slate-700 py-1 px-2.5 rounded-lg border border-slate-300 focus:outline-none cursor-pointer">\${state.usersList.map(u => \`<option value="\${u.id}" \${u.id === state.currentUser.id ? 'selected' : ''}>\${u.fullName} (\${getRoleText(u.role)})</option>\`).join('')}</select></div><div class="flex items-center gap-3 border-l border-slate-200 pl-4"><img src="\${state.currentUser.avatar || \`https://api.dicebear.com/7.x/avataaars/svg?seed=\${state.currentUser.username}\`}" class="w-9 h-9 rounded-full bg-slate-200 object-cover ring-2 ring-blue-500/20" /><div class="hidden sm:block text-left"><div class="text-sm font-semibold text-slate-800 leading-none mb-1">\${state.currentUser.fullName}</div><span class="inline-block px-2 py-0.5 text-[10px] font-bold rounded-full border \${getRoleBadgeStyle(state.currentUser.role)}">\${getRoleText(state.currentUser.role)}</span></div></div></div></div></div></header><div class="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 flex gap-6"><aside class="w-64 flex-shrink-0"><div class="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-4 sticky top-22"><div class="flex items-center justify-between px-2 mb-3"><span class="text-xs font-bold uppercase tracking-wider text-slate-400">Danh Mục Hồ Sơ</span>\${state.currentUser.role === 'admin' ? \`<button onclick="openModal('category')" class="text-xs text-blue-600 hover:text-blue-700 font-semibold flex items-center gap-1 bg-blue-50 px-2 py-1 rounded-md hover:bg-blue-100 transition"><i data-lucide="plus" class="w-3.5 h-3.5"></i> Thêm</button>\` : ''}</div><nav class="space-y-1"><button onclick="setCategory('school')" class="w-full flex items-center justify-between px-3 py-2.5 rounded-xl font-medium text-sm transition-all \${state.activeCategory === 'school' ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20' : 'text-slate-700 hover:bg-slate-100'}"><div class="flex items-center gap-2.5"><i data-lucide="building-2" class="w-4 h-4"></i><span>Hồ sơ nhà trường</span></div></button><button onclick="setCategory('group')" class="w-full flex items-center justify-between px-3 py-2.5 rounded-xl font-medium text-sm transition-all \${state.activeCategory === 'group' ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20' : 'text-slate-700 hover:bg-slate-100'}"><div class="flex items-center gap-2.5"><i data-lucide="users" class="w-4 h-4"></i><span>Hồ sơ tổ</span></div></button><div><button onclick="togglePersonalSubmenu()" class="w-full flex items-center justify-between px-3 py-2.5 rounded-xl font-medium text-sm transition-all \${state.activeCategory === 'personal' ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20' : 'text-slate-700 hover:bg-slate-100'}"><div class="flex items-center gap-2.5"><i data-lucide="folder-user" class="w-4 h-4"></i><span>Hồ sơ cá nhân</span></div><i data-lucide="\${state.personalSubmenuOpen ? 'chevron-down' : 'chevron-right'}" class="w-4 h-4 opacity-75"></i></button>\${state.personalSubmenuOpen ? \`<div class="mt-1 ml-4 pl-3 border-l-2 border-slate-200 space-y-1">\${state.departments.map(dept => \`<button onclick="setSubDepartment('\${dept.id}')" class="w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs font-medium transition-all \${state.activeCategory === 'personal' && state.activeSubDepartment === dept.id ? 'bg-blue-50 text-blue-700 font-bold border border-blue-200' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}"><span>\${dept.name}</span>\${state.currentUser.departmentId === dept.id ? \`<span class="w-2 h-2 rounded-full bg-emerald-500"></span>\` : ''}</button>\`).join('')}</div>\` : ''}</div><button onclick="setCategory('doi')" class="w-full flex items-center justify-between px-3 py-2.5 rounded-xl font-medium text-sm transition-all \${state.activeCategory === 'doi' ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20' : 'text-slate-700 hover:bg-slate-100'}"><div class="flex items-center gap-2.5"><i data-lucide="flag" class="w-4 h-4"></i><span>Hồ sơ đội</span></div></button><button onclick="setCategory('doan')" class="w-full flex items-center justify-between px-3 py-2.5 rounded-xl font-medium text-sm transition-all \${state.activeCategory === 'doan' ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20' : 'text-slate-700 hover:bg-slate-100'}"><div class="flex items-center gap-2.5"><i data-lucide="award" class="w-4 h-4"></i><span>Hồ sơ đoàn</span></div></button>\${state.categories.filter(c => c.isCustom).map(cat => \`<button onclick="setCategory('\${cat.id}')" class="w-full flex items-center justify-between px-3 py-2.5 rounded-xl font-medium text-sm transition-all \${state.activeCategory === cat.id ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20' : 'text-slate-700 hover:bg-slate-100'}"><div class="flex items-center gap-2.5"><i data-lucide="folder-plus" class="w-4 h-4"></i><span>\${cat.name}</span></div><span class="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-semibold">Mới</span></button>\`).join('')}</nav>\${state.currentUser.role === 'admin' ? \`<div class="mt-6 pt-4 border-t border-slate-200 space-y-2"><span class="text-[11px] font-bold uppercase tracking-wider text-purple-600 px-2 block">Công cụ Quản trị (Admin)</span><button onclick="openModal('user')" class="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 transition"><i data-lucide="user-plus" class="w-4 h-4"></i><span>Tạo tài khoản Giáo viên</span></button><button onclick="openModal('category')" class="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 transition"><i data-lucide="folder-plus" class="w-4 h-4"></i><span>Tự tạo Mục Hồ sơ mới</span></button><button onclick="openModal('drive')" class="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 transition"><i data-lucide="cloud-cog" class="w-4 h-4"></i><span>Cấu hình Google Drive</span></button></div>\` : ''}<div class="mt-6 p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-600"><div class="flex items-center gap-2 font-semibold text-slate-800 mb-1"><i data-lucide="hard-drive" class="w-4 h-4 text-emerald-600"></i><span>Trạng thái Google Drive</span></div><p class="text-[11px] text-slate-500 mb-2">Thư mục chung: <span class="font-mono text-slate-700 font-medium">/\${state.driveConfig.folderId || 'SCHOOL_FOLDER'}</span></p><div class="flex items-center gap-1.5 text-[10px] text-emerald-700 bg-emerald-50 px-2 py-1 rounded border border-emerald-200"><span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span><span>Kết nối Drive tự động hoạt động</span></div></div></div></aside><main class="flex-1 flex flex-col gap-5"><div class="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4"><div><div class="flex items-center gap-2 mb-1"><span class="text-xs font-bold uppercase tracking-wider text-blue-600 bg-blue-50 px-2.5 py-0.5 rounded-full border border-blue-200">\${state.activeCategory === 'personal' ? \`Hồ sơ cá nhân • \${activeDeptObj.name}\` : activeCatObj.name}</span><span class="text-xs font-medium text-slate-400">• Năm học \${state.selectedSchoolYear}</span></div><h2 class="text-2xl font-extrabold text-slate-900">\${state.activeCategory === 'personal' ? \`Danh Sách Hồ Sơ \${activeDeptObj.name}\` : activeCatObj.name}</h2><p class="text-sm text-slate-500 mt-1">\${activeCatObj.description || 'Quản lý, duyệt và xem trực tuyến các tài liệu hồ sơ chuyên môn của giáo viên trên Google Drive.'}</p></div><button onclick="openModal('upload')" class="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-5 py-2.5 rounded-xl shadow-lg shadow-blue-600/30 flex items-center gap-2 transition-all text-sm flex-shrink-0"><i data-lucide="cloud-upload" class="w-5 h-5"></i><span>Gửi hồ sơ lên Drive</span></button></div><div class="p-4 rounded-xl border flex items-start gap-3 text-sm \${state.currentUser.role === 'giaovien' ? 'bg-amber-50 border-amber-200 text-amber-900' : state.currentUser.role === 'totruong' ? 'bg-blue-50 border-blue-200 text-blue-900' : 'bg-emerald-50 border-emerald-200 text-emerald-900'}"><i data-lucide="\${state.currentUser.role === 'giaovien' ? 'shield-alert' : 'shield-check'}" class="w-5 h-5 flex-shrink-0 mt-0.5"></i><div><span class="font-bold">Quyền hạn truy cập (\${getRoleText(state.currentUser.role)}): </span>\${state.currentUser.role === 'giaovien' ? \`<span>Bảo mật cá nhân: Bạn <b>chỉ xem được các hồ sơ do chính mình gửi lên</b>. Hồ sơ của các giáo viên khác trong tổ được ẩn hoàn toàn để đảm bảo tính riêng tư.</span>\` : state.currentUser.role === 'totruong' ? \`<span>Bạn đang mở quyền Tổ trưởng: Có thể <b>xem tất cả hồ sơ của các giáo viên thuộc Tổ chuyên môn</b> mà bạn quản lý.</span>\` : \`<span>Quyền giám sát toàn trường: Bạn có quyền <b>xem, duyệt và quản lý toàn bộ hồ sơ</b> của tất cả giáo viên trong trường học.</span>\`}</div></div><div class="bg-white rounded-xl border border-slate-200/80 p-3 shadow-xs flex flex-wrap items-center justify-between gap-3"><div class="relative flex-1 min-w-[240px]"><i data-lucide="search" class="w-4 h-4 absolute left-3 top-3 text-slate-400"></i><input type="text" placeholder="Tìm kiếm tiêu đề hồ sơ, giáo viên, tên tệp..." value="\${state.searchQuery}" oninput="onSearchChange(event)" class="w-full bg-slate-50 text-sm pl-9 pr-4 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white" /></div><div class="flex items-center gap-2"><span class="text-xs font-semibold text-slate-500">Năm học:</span><select onchange="onYearChange(event)" class="bg-slate-50 text-xs font-semibold text-slate-700 py-2 px-3 rounded-lg border border-slate-200 focus:outline-none"><option value="2025-2026" \${state.selectedSchoolYear === '2025-2026' ? 'selected' : ''}>2025 - 2026</option><option value="2024-2025" \${state.selectedSchoolYear === '2024-2025' ? 'selected' : ''}>2024 - 2025</option></select></div></div>\${state.documents.length === 0 ? \`<div class="bg-white rounded-2xl border border-slate-200 p-12 text-center"><div class="w-16 h-16 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center mx-auto mb-4"><i data-lucide="folder-open" class="w-8 h-8"></i></div><h3 class="text-lg font-bold text-slate-800 mb-1">Chưa có hồ sơ nào trong mục này</h3><p class="text-sm text-slate-500 max-w-md mx-auto mb-6">\${state.currentUser.role === 'giaovien' ? 'Bạn chưa gửi hồ sơ nào lên Google Drive cho danh mục này. Hãy bấm nút gửi hồ sơ để tải tài liệu lên.' : 'Chưa có dữ liệu hồ sơ nào được gửi lên cho danh mục và tổ chuyên môn này.'}</p><button onclick="openModal('upload')" class="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-xl inline-flex items-center gap-2 shadow-md"><i data-lucide="upload" class="w-4 h-4"></i><span>Gửi hồ sơ ngay</span></button></div>\` : \`<div class="grid grid-cols-1 md:grid-cols-2 gap-4">\${state.documents.map(doc => { const canDelete = doc.teacherId === state.currentUser.id || ['admin', 'bgh'].includes(state.currentUser.role); return \`<div class="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-5 flex flex-col justify-between gap-4 group"><div><div class="flex items-center justify-between gap-2 mb-2"><span class="text-[11px] font-bold text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded-md border border-blue-200">\${state.departments.find(d => d.id === doc.departmentId)?.name || doc.departmentId}</span><div class="flex items-center gap-2"><span class="text-xs text-slate-400 flex items-center gap-1"><i data-lucide="calendar" class="w-3.5 h-3.5"></i>\${new Date(doc.uploadedAt).toLocaleDateString('vi-VN')}</span>\${canDelete ? \`<button onclick="deleteDocument('\${doc.id}')" class="text-slate-400 hover:text-rose-600 p-1 rounded hover:bg-rose-50" title="Xóa hồ sơ"><i data-lucide="trash-2" class="w-4 h-4"></i></button>\` : ''}</div></div><h4 class="text-base font-bold text-slate-900 group-hover:text-blue-600 transition-colors leading-snug mb-2">\${doc.title}</h4>\${doc.notes ? \`<p class="text-xs text-slate-500 bg-slate-50 p-2 rounded-lg border border-slate-100 mb-3 italic">"\${doc.notes}"</p>\` : ''}<div class="flex items-center gap-3 p-2.5 bg-slate-50 rounded-xl border border-slate-200/70"><div class="w-9 h-9 rounded-lg bg-rose-100 text-rose-600 flex items-center justify-center font-bold flex-shrink-0"><i data-lucide="file-text" class="w-5 h-5"></i></div><div class="flex-1 min-w-0"><p class="text-xs font-semibold text-slate-800 truncate">\${doc.fileName}</p><p class="text-[11px] text-slate-400 font-mono">\${doc.fileSize} • Google Drive Storage</p></div></div></div><div class="pt-3 border-t border-slate-100 flex items-center justify-between gap-2"><div class="flex items-center gap-2"><div class="w-7 h-7 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xs">\${doc.teacherName ? doc.teacherName.charAt(0) : 'G'}</div><div><p class="text-xs font-semibold text-slate-700 leading-none">\${doc.teacherName}</p><p class="text-[10px] text-slate-400">Giáo viên gửi</p></div></div><div class="flex items-center gap-2"><button onclick="openPreview('\${doc.id}')" class="bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1.5"><i data-lucide="eye" class="w-3.5 h-3.5"></i><span>Xem trước</span></button><a href="\${doc.driveViewUrl}" target="_blank" class="bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1.5 border border-blue-200"><i data-lucide="external-link" class="w-3.5 h-3.5"></i><span>Mở Drive</span></a></div></div></div>\`; }).join('')}</div>\`}</main></div>\${renderModals()}</div>\`; if (window.lucide) window.lucide.createIcons(); const switcher = document.getElementById('userSwitcherSelect'); if (switcher) { switcher.addEventListener('change', (e) => switchUser(e.target.value)); } }
    function renderModals() { if (!state.activeModal) return ''; if (state.activeModal === 'upload') { return \`<div class="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"><div class="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200"><div class="flex items-center justify-between pb-4 border-b border-slate-100"><h3 class="text-lg font-bold text-slate-900">Gửi Hồ Sơ Lên Google Drive</h3><button onclick="closeModal()" class="text-slate-400 hover:text-slate-600"><i data-lucide="x" class="w-5 h-5"></i></button></div><form onsubmit="handleUploadSubmit(event)" class="mt-4 space-y-4"><div><label class="block text-xs font-bold text-slate-700 mb-1">Tiêu đề hồ sơ (*)</label><input type="text" name="title" required placeholder="Kế hoạch giảng dạy Tiếng Việt Tuần 1" class="w-full text-sm px-3 py-2 rounded-xl border border-slate-300" /></div><div><label class="block text-xs font-bold text-slate-700 mb-1">Tệp đính kèm</label><input type="file" name="file" class="w-full text-xs border border-slate-200 rounded-xl p-1" /></div><div><label class="block text-xs font-bold text-slate-700 mb-1">Hoặc Dán Link Google Drive</label><input type="url" name="driveLink" placeholder="https://drive.google.com/file/d/.../view" class="w-full text-xs px-3 py-2 rounded-xl border border-slate-300 font-mono" /></div><div><label class="block text-xs font-bold text-slate-700 mb-1">Ghi chú</label><textarea name="notes" rows="2" class="w-full text-xs px-3 py-2 rounded-xl border border-slate-300"></textarea></div><div class="pt-3 border-t flex justify-end gap-3"><button type="button" onclick="closeModal()" class="px-4 py-2 text-xs font-semibold text-slate-600">Hủy</button><button type="submit" class="px-5 py-2 text-xs font-bold text-white bg-blue-600 rounded-xl">Tải lên Drive</button></div></form></div></div>\`; } if (state.activeModal === 'user') { return \`<div class="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"><div class="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200"><div class="flex items-center justify-between pb-4 border-b border-slate-100"><h3 class="text-lg font-bold text-slate-900">Tạo Tài Khoản Giáo Viên Mới</h3><button onclick="closeModal()" class="text-slate-400 hover:text-slate-600"><i data-lucide="x" class="w-5 h-5"></i></button></div><form onsubmit="handleUserSubmit(event)" class="mt-4 space-y-3"><div><label class="block text-xs font-bold text-slate-700 mb-1">Tên đăng nhập (*)</label><input type="text" name="username" required class="w-full text-xs px-3 py-2 rounded-xl border border-slate-300" /></div><div><label class="block text-xs font-bold text-slate-700 mb-1">Mật khẩu (*)</label><input type="password" name="password" value="123456" required class="w-full text-xs px-3 py-2 rounded-xl border border-slate-300" /></div><div><label class="block text-xs font-bold text-slate-700 mb-1">Họ và tên Giáo viên (*)</label><input type="text" name="fullName" required class="w-full text-xs px-3 py-2 rounded-xl border border-slate-300" /></div><div class="grid grid-cols-2 gap-3"><div><label class="block text-xs font-bold text-slate-700 mb-1">Vai trò (Role)</label><select name="role" class="w-full text-xs px-3 py-2 rounded-xl border border-slate-300"><option value="giaovien">Giáo viên</option><option value="totruong">Tổ trưởng</option><option value="bgh">Ban Giám Hiệu</option><option value="admin">Admin</option></select></div><div><label class="block text-xs font-bold text-slate-700 mb-1">Tổ chuyên môn</label><select name="departmentId" class="w-full text-xs px-3 py-2 rounded-xl border border-slate-300">\${state.departments.map(d => \`<option value="\${d.id}">\${d.name}</option>\`).join('')}</select></div></div><div><label class="block text-xs font-bold text-slate-700 mb-1">Email</label><input type="email" name="email" class="w-full text-xs px-3 py-2 rounded-xl border border-slate-300" /></div><div class="pt-3 border-t flex justify-end gap-2"><button type="button" onclick="closeModal()" class="px-4 py-2 text-xs text-slate-600">Hủy</button><button type="submit" class="px-5 py-2 text-xs font-bold text-white bg-purple-600 rounded-xl">Tạo tài khoản</button></div></form></div></div>\`; } if (state.activeModal === 'category') { return \`<div class="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"><div class="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200"><div class="flex items-center justify-between pb-4 border-b border-slate-100"><h3 class="text-lg font-bold text-slate-900">Tự Tạo Mục Hồ Sơ Mới</h3><button onclick="closeModal()" class="text-slate-400 hover:text-slate-600"><i data-lucide="x" class="w-5 h-5"></i></button></div><form onsubmit="handleCategorySubmit(event)" class="mt-4 space-y-3"><div><label class="block text-xs font-bold text-slate-700 mb-1">Tên mục hồ sơ mới (*)</label><input type="text" name="name" required placeholder="Hồ sơ Thi đua & Khen thưởng" class="w-full text-xs px-3 py-2 rounded-xl border border-slate-300" /></div><div><label class="block text-xs font-bold text-slate-700 mb-1">Mô tả</label><textarea name="description" rows="2" class="w-full text-xs px-3 py-2 rounded-xl border border-slate-300"></textarea></div><div class="pt-3 border-t flex justify-end gap-2"><button type="button" onclick="closeModal()" class="px-4 py-2 text-xs text-slate-600">Hủy</button><button type="submit" class="px-5 py-2 text-xs font-bold text-white bg-purple-600 rounded-xl">Tạo danh mục</button></div></form></div></div>\`; } if (state.activeModal === 'drive') { return \`<div class="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"><div class="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200"><div class="flex items-center justify-between pb-4 border-b border-slate-100"><h3 class="text-lg font-bold text-slate-900">Cấu Hình Google Drive</h3><button onclick="closeModal()" class="text-slate-400 hover:text-slate-600"><i data-lucide="x" class="w-5 h-5"></i></button></div><form onsubmit="handleDriveSubmit(event)" class="mt-4 space-y-3"><div><label class="block text-xs font-bold text-slate-700 mb-1">Folder ID Google Drive</label><input type="text" name="folderId" value="\${state.driveConfig.folderId || ''}" class="w-full text-xs px-3 py-2 rounded-xl border border-slate-300 font-mono" /></div><div><label class="block text-xs font-bold text-slate-700 mb-1">Service Account Email</label><input type="email" name="serviceAccountEmail" value="\${state.driveConfig.serviceAccountEmail || ''}" class="w-full text-xs px-3 py-2 rounded-xl border border-slate-300 font-mono" /></div><div><label class="block text-xs font-bold text-slate-700 mb-1">Chế độ đồng bộ</label><select name="syncMode" class="w-full text-xs px-3 py-2 rounded-xl border border-slate-300"><option value="hybrid">Linh hoạt (Tải trực tiếp & Link Drive)</option><option value="drive_api">Tự động đẩy qua Drive API</option></select></div><div class="pt-3 border-t flex justify-end gap-2"><button type="button" onclick="closeModal()" class="px-4 py-2 text-xs text-slate-600">Hủy</button><button type="submit" class="px-5 py-2 text-xs font-bold text-white bg-blue-600 rounded-xl">Lưu cấu hình</button></div></form></div></div>\`; } if (state.activeModal === 'preview' && state.previewDoc) { return \`<div class="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-xs flex items-center justify-center p-4"><div class="bg-white rounded-2xl max-w-4xl w-full h-[85vh] flex flex-col shadow-2xl overflow-hidden"><div class="p-4 bg-slate-900 text-white flex items-center justify-between"><div><h4 class="font-bold text-sm truncate max-w-md">\${state.previewDoc.title}</h4><p class="text-xs text-slate-400">\${state.previewDoc.fileName} • Người gửi: \${state.previewDoc.teacherName}</p></div><div class="flex items-center gap-3"><a href="\${state.previewDoc.driveViewUrl}" target="_blank" class="bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1.5"><i data-lucide="external-link" class="w-3.5 h-3.5"></i> Xem gốc trên Drive</a><button onclick="closeModal()" class="text-slate-400 hover:text-white"><i data-lucide="x" class="w-6 h-6"></i></button></div></div><div class="flex-1 bg-slate-100"><iframe src="\${state.previewDoc.driveEmbedUrl || state.previewDoc.driveViewUrl}" class="w-full h-full border-0"></iframe></div></div></div>\`; } return ''; }
    window.setCategory = async function(catId) { state.activeCategory = catId; await fetchDocuments(); renderApp(); };
    window.setSubDepartment = async function(deptId) { state.activeCategory = 'personal'; state.activeSubDepartment = deptId; await fetchDocuments(); renderApp(); };
    window.togglePersonalSubmenu = function() { state.personalSubmenuOpen = !state.personalSubmenuOpen; renderApp(); };
    window.onSearchChange = async function(e) { state.searchQuery = e.target.value; await fetchDocuments(); renderApp(); };
    window.onYearChange = async function(e) { state.selectedSchoolYear = e.target.value; await fetchDocuments(); renderApp(); };
    window.openModal = function(modalName) { state.activeModal = modalName; renderApp(); };
    window.closeModal = function() { state.activeModal = null; state.previewDoc = null; renderApp(); };
    window.openPreview = function(docId) { const doc = state.documents.find(d => d.id === docId); if (doc) { state.previewDoc = doc; state.activeModal = 'preview'; renderApp(); } };
    document.addEventListener('DOMContentLoaded', initData);
    if (document.readyState === 'complete' || document.readyState === 'interactive') initData();
  </script>
</body>
</html>`);
});

// Start Server
app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`TRANG WEB QUẢN LÝ HỒ SƠ GIÁO VIÊN TRƯỜNG HỌC ĐÃ SẴN SÀNG!`);
  console.log(`Truy cập địa chỉ: http://localhost:${PORT}`);
  console.log(`=======================================================`);
});
