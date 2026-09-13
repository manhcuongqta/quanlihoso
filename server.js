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

  const { username, password, fullName, email, role, roles, departmentId, phone, driveFolderUrl } = req.body;
  if (!username || !password || !fullName) {
    return res.status(400).json({ success: false, message: 'Vui lòng điền đầy đủ các thông tin bắt buộc' });
  }

  const userRoles = Array.isArray(roles) && roles.length > 0 ? roles : [role || 'giaovien'];
  const primaryRole = userRoles.includes('admin') ? 'admin' : userRoles.includes('bgh') ? 'bgh' : userRoles.includes('totruong') ? 'totruong' : userRoles[0];

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
    role: primaryRole,
    roles: userRoles,
    departmentId: departmentId || null,
    phone: phone || '',
    avatar: '',
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
  const { username, fullName, email, role, roles, departmentId, phone, password, driveFolderUrl } = req.body;
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

  if (roles && Array.isArray(roles) && roles.length > 0) {
    user.roles = roles;
    user.role = roles.includes('admin') ? 'admin' : roles.includes('bgh') ? 'bgh' : roles.includes('totruong') ? 'totruong' : roles[0];
  } else if (role) {
    user.role = role;
    if (!user.roles) user.roles = [role];
  }
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

  res.status(404).send('Không tìm thấy tệp public/index.html');
});

// Start Server
app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`TRANG WEB QUẢN LÝ HỒ SƠ GIÁO VIÊN TRƯỜNG HỌC ĐÃ SẴN SÀNG!`);
  console.log(`Truy cập địa chỉ: http://localhost:${PORT}`);
  console.log(`=======================================================`);
});
