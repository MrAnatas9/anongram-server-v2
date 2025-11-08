const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// In-memory database
let db = {
  users: [],
  messages: [],
  verificationCodes: [],
  professions: [
    { id: 1, name: '🎨 Художник', level: 1 },
    { id: 2, name: '📷 Фотограф', level: 1 },
    { id: 3, name: '✍️ Писатель', level: 1 },
    { id: 4, name: '😂 Мемодел', level: 1 },
    { id: 5, name: '📚 Библиотекарь', level: 1 },
    { id: 6, name: '🧪 Тестер', level: 1 }
  ]
};

// Email configuration
const emailConfig = {
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER || 'anongram.app@gmail.com',
    pass: process.env.EMAIL_PASS || 'wqjk tvem xabc yzdf'
  }
};

// ИСПРАВЛЕНО: createTransporter -> createTransport
const emailTransporter = nodemailer.createTransport(emailConfig);

// Utility functions
async function sendVerificationCode(email, code) {
  try {
    await emailTransporter.sendMail({
      from: 'Anongram <anongram.app@gmail.com>',
      to: email,
      subject: '🔐 Код подтверждения Anongram',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #667eea;">Добро пожаловать в Anongram! 🚀</h2>
          <p>Ваш код подтверждения:</p>
          <div style="background: #f8f9fa; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; color: #667eea; border-radius: 10px; margin: 20px 0;">
            ${code}
          </div>
          <p>Введите этот код в приложении для завершения регистрации.</p>
          <p style="color: #666; font-size: 14px;">Код действителен в течение 10 минут.</p>
        </div>
      `
    });
    console.log(`✅ Код ${code} отправлен на ${email}`);
    return true;
  } catch (error) {
    console.log('❌ Ошибка отправки email:', error);
    return false;
  }
}

// API Routes

// Health check
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: '🚀 Anongram Server v2.0',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
    endpoints: {
      'POST /api/auth/send-code': 'Отправить код на почту',
      'POST /api/auth/verify': 'Подтвердить код',
      'POST /api/auth/login': 'Войти',
      'GET /api/users': 'Список пользователей',
      'GET /api/system': 'Системная информация',
      'POST /api/profession': 'Выбор профессии'
    },
    adminCodes: ['654321'],
    userCodes: ['111222', '333444', '555666']
  });
});

// Send verification code
app.post('/api/auth/send-code', async (req, res) => {
  try {
    const { email, nickname } = req.body;

    if (!email || !nickname) {
      return res.status(400).json({ 
        success: false, 
        error: 'Email и никнейм обязательны' 
      });
    }

    // Check existing user
    const existingUser = db.users.find(u => 
      u.email === email || u.nickname === nickname
    );
    
    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: 'Пользователь с таким email или никнеймом уже существует'
      });
    }

    // Generate code
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    // Save code
    db.verificationCodes = db.verificationCodes.filter(c => c.email !== email);
    db.verificationCodes.push({
      email,
      code,
      nickname,
      createdAt: new Date().toISOString()
    });

    // Send email
    const emailSent = await sendVerificationCode(email, code);
    
    if (emailSent) {
      res.json({
        success: true,
        message: '📧 Код отправлен на вашу почту',
        email: email
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Ошибка отправки кода на почту'
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Внутренняя ошибка сервера'
    });
  }
});

// Verify code and register
app.post('/api/auth/verify', (req, res) => {
  try {
    const { email, code, nickname } = req.body;

    if (!email || !code || !nickname) {
      return res.status(400).json({
        success: false,
        error: 'Все поля обязательны'
      });
    }

    // Find verification code
    const verification = db.verificationCodes.find(v => 
      v.email === email && v.code === code
    );

    if (!verification) {
      return res.status(400).json({
        success: false,
        error: 'Неверный код подтверждения'
      });
    }

    // Check code expiration (10 minutes)
    const codeAge = Date.now() - new Date(verification.createdAt).getTime();
    if (codeAge > 10 * 60 * 1000) {
      db.verificationCodes = db.verificationCodes.filter(v => v.email !== email);
      return res.status(400).json({
        success: false,
        error: 'Код устарел'
      });
    }

    // Create new user
    const newUser = {
      id: uuidv4(),
      email,
      nickname,
      avatar: null,
      status: 'Новый пользователь Anongram',
      level: 1,
      xp: 0,
      anoncoins: 100,
      profession: null,
      isOnline: true,
      lastSeen: new Date().toISOString(),
      isAdmin: ['654321'].includes(code),
      createdAt: new Date().toISOString()
    };

    db.users.push(newUser);
    db.verificationCodes = db.verificationCodes.filter(v => v.email !== email);

    console.log(`🎉 Новый пользователь: ${nickname} (${email}) ${newUser.isAdmin ? '👑 ADMIN' : ''}`);

    res.json({
      success: true,
      message: 'Регистрация успешна! 🎉',
      user: {
        id: newUser.id,
        email: newUser.email,
        nickname: newUser.nickname,
        avatar: newUser.avatar,
        status: newUser.status,
        level: newUser.level,
        xp: newUser.xp,
        anoncoins: newUser.anoncoins,
        profession: newUser.profession,
        isAdmin: newUser.isAdmin,
        createdAt: newUser.createdAt
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Внутренняя ошибка сервера'
    });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email обязателен'
      });
    }

    const user = db.users.find(u => u.email === email);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'Пользователь не найден'
      });
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    
    db.verificationCodes = db.verificationCodes.filter(c => c.email !== email);
    db.verificationCodes.push({
      email,
      code,
      createdAt: new Date().toISOString()
    });

    const emailSent = await sendVerificationCode(email, code);
    
    if (emailSent) {
      res.json({
        success: true,
        message: '📧 Код для входа отправлен на вашу почту',
        email: email
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Ошибка отправки кода'
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Внутренняя ошибка сервера'
    });
  }
});

// Get users list
app.get('/api/users', (req, res) => {
  const users = db.users.map(user => ({
    id: user.id,
    nickname: user.nickname,
    avatar: user.avatar,
    status: user.status,
    level: user.level,
    profession: user.profession,
    isOnline: user.isOnline,
    lastSeen: user.lastSeen,
    isAdmin: user.isAdmin
  }));
  
  res.json({
    success: true,
    users: users,
    total: users.length
  });
});

// System information
app.get('/api/system', (req, res) => {
  const systemInfo = {
    server: {
      version: '2.0.0',
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    },
    statistics: {
      totalUsers: db.users.length,
      onlineUsers: db.users.filter(u => u.isOnline).length,
      totalMessages: db.messages.length,
      totalAnoncoins: db.users.reduce((sum, user) => sum + user.anoncoins, 0)
    },
    features: [
      'Аутентификация по коду из почты',
      'Система профессий по уровням',
      'Чат в реальном времени',
      'Экономика Anoncoin',
      'WebSocket соединения'
    ]
  };
  
  res.json({
    success: true,
    ...systemInfo
  });
});

// Select profession
app.post('/api/profession', (req, res) => {
  try {
    const { userId, professionId } = req.body;

    const user = db.users.find(u => u.id === userId);
    const profession = db.professions.find(p => p.id === professionId);

    if (!user || !profession) {
      return res.status(404).json({
        success: false,
        error: 'Пользователь или профессия не найдены'
      });
    }

    if (user.level < profession.level) {
      return res.status(400).json({
        success: false,
        error: `Недостаточный уровень. Требуется уровень ${profession.level}`
      });
    }

    user.profession = profession.name;
    
    res.json({
      success: true,
      message: `🎯 Теперь вы ${profession.name}!`,
      profession: profession.name
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Внутренняя ошибка сервера'
    });
  }
});

// WebSocket for real-time chat
io.on('connection', (socket) => {
  console.log('🔌 Новое подключение:', socket.id);

  socket.on('user:join', (userId) => {
    socket.join(userId);
    const user = db.users.find(u => u.id === userId);
    if (user) {
      user.isOnline = true;
      user.lastSeen = new Date().toISOString();
    }
    console.log(`👤 Пользователь ${userId} онлайн`);
    
    // Notify others
    socket.broadcast.emit('user:status', {
      userId,
      isOnline: true
    });
  });

  socket.on('message:send', (data) => {
    const { senderId, receiverId, text, type = 'text' } = data;
    
    const newMessage = {
      id: uuidv4(),
      senderId,
      receiverId,
      text,
      type,
      timestamp: new Date().toISOString(),
      read: false
    };

    db.messages.push(newMessage);

    // Send to receiver
    socket.to(receiverId).emit('message:new', newMessage);
    // Confirm to sender
    socket.emit('message:new', newMessage);

    console.log(`💬 Сообщение от ${senderId} к ${receiverId}`);

    // Add XP for message
    const sender = db.users.find(u => u.id === senderId);
    if (sender) {
      sender.xp += 10;
      const newLevel = Math.floor(sender.xp / 100) + 1;
      if (newLevel > sender.level) {
        const oldLevel = sender.level;
        sender.level = newLevel;
        sender.anoncoins += newLevel * 10;
        
        console.log(`🎉 Уровень UP! ${sender.nickname}: ${oldLevel} → ${newLevel}`);
        
        socket.emit('user:levelup', {
          oldLevel,
          newLevel,
          reward: newLevel * 10
        });
      }
    }
  });

  socket.on('message:read', (messageId) => {
    const message = db.messages.find(m => m.id === messageId);
    if (message) {
      message.read = true;
    }
  });

  socket.on('disconnect', () => {
    console.log('🔌 Отключение:', socket.id);
  });
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`
✨ ===================================================
🚀 ANONGRAM SERVER v2.0 ЗАПУЩЕН!
📍 Порт: ${PORT}
🌐 URL: https://anongram-server.onrender.com
📧 Email: ${emailConfig.auth.user}
💬 WebSocket: Готов
💰 Anoncoin: Активен
🎯 Профессии: ${db.professions.length}
✨ ===================================================

📋 Тестовые коды:
   👑 Админ: 654321
   👥 Пользователи: 111222, 333444, 555666

🔗 API Endpoints:
   GET  /              - Информация о сервере
   POST /api/auth/send-code - Отправить код
   POST /api/auth/verify    - Подтвердить код
   POST /api/auth/login     - Вход
   GET  /api/users          - Список пользователей  
   GET  /api/system         - Системная информация
   POST /api/profession     - Выбор профессии
  `);
});
