const express = require('express');
const cors = require('cors');
const emailjs = require('emailjs-com');
const WebSocket = require('ws');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Порт для Render
const PORT = process.env.PORT || 3000;

// Разрешаем CORS для всех доменов
app.use(cors({
  origin: ['http://localhost:8081', 'https://anongram-app.com', 'exp://*'],
  credentials: true
}));

app.use(express.json());

// Инициализация EmailJS
emailjs.init('LfvlC9bOj9c-YHSWTbrof');

// Глобальное хранилище (в продакшене заменить на Redis)
global.data = {
  users: [
    {
      id: 1,
      email: 'admin@anongram.com',
      username: 'Admin',
      code: '654321',
      level: 100,
      coins: 9999,
      profession: 'Системный Админ',
      isOnline: false,
      lastSeen: Date.now()
    },
    {
      id: 2, 
      email: 'user1@test.com',
      username: 'UserOne',
      code: '111222',
      level: 1,
      coins: 100,
      profession: 'Новичок',
      isOnline: false,
      lastSeen: Date.now()
    },
    {
      id: 3,
      email: 'user2@test.com', 
      username: 'UserTwo',
      code: '333444',
      level: 1,
      coins: 100,
      profession: 'Новичок',
      isOnline: false,
      lastSeen: Date.now()
    },
    {
      id: 4,
      email: 'user3@test.com',
      username: 'UserThree', 
      code: '555666',
      level: 1,
      coins: 100,
      profession: 'Новичок',
      isOnline: false,
      lastSeen: Date.now()
    }
  ],
  messages: [],
  professions: [
    { id: 1, name: 'Художник', level: 1, description: 'Создание стикеров и оформления' },
    { id: 2, name: 'Фотограф', level: 1, description: 'Фотоотчеты и мемы' },
    { id: 3, name: 'Писатель', level: 1, description: 'Посты и статьи' },
    { id: 4, name: 'Мемодел', level: 1, description: 'Развлекательный контент' },
    { id: 5, name: 'Библиотекарь', level: 1, description: 'Модерация файлов' },
    { id: 6, name: 'Тестер', level: 1, description: 'Тестирование функций' }
  ],
  verificationCodes: {},
  connections: new Map() // WebSocket соединения
};

// Функция отправки кода через EmailJS
async function sendVerificationCode(email, code) {
  try {
    console.log('📧 Отправка кода на:', email, 'Код:', code);
    
    const templateParams = {
      to_email: email,
      verification_code: code,
      from_name: 'Anongram',
      reply_to: 'anongram321@gmail.com'
    };

    const result = await emailjs.send(
      'service_190j47r',
      'template_qrtcabw', 
      templateParams
    );
    
    console.log('✅ Код отправлен на', email);
    return { success: true };
  } catch (error) {
    console.error('❌ Ошибка отправки:', error);
    return { success: false, error: error.text };
  }
}

// API Routes

// Health check для Render
app.get('/', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Anongram Server Running',
    timestamp: new Date().toISOString(),
    users: global.data.users.length
  });
});

// Отправка кода подтверждения
app.post('/api/send-code', async (req, res) => {
  const { email } = req.body;
  
  if (!email) {
    return res.status(400).json({ error: 'Email обязателен' });
  }

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  
  global.data.verificationCodes[email] = {
    code: code,
    expires: Date.now() + 10 * 60 * 1000
  };

  const result = await sendVerificationCode(email, code);
  
  if (result.success) {
    res.json({ 
      success: true, 
      message: 'Код отправлен на вашу почту',
      debug_code: process.env.NODE_ENV === 'development' ? code : undefined
    });
  } else {
    res.status(500).json({ 
      error: 'Ошибка отправки кода',
      details: result.error 
    });
  }
});

// Проверка кода и вход
app.post('/api/verify-code', (req, res) => {
  const { email, code } = req.body;
  
  // Проверка предустановленных пользователей
  const existingUser = global.data.users.find(user => user.email === email && user.code === code);
  if (existingUser) {
    existingUser.isOnline = true;
    existingUser.lastSeen = Date.now();
    
    // Уведомляем всех о онлайн статусе
    broadcast({ type: 'user_online', userId: existingUser.id });
    
    return res.json({ 
      success: true, 
      user: {
        id: existingUser.id,
        email: existingUser.email,
        username: existingUser.username,
        level: existingUser.level,
        coins: existingUser.coins,
        profession: existingUser.profession,
        isOnline: true
      }
    });
  }
  
  // Проверка кода из email
  if (!global.data.verificationCodes[email]) {
    return res.status(400).json({ error: 'Код не найден или устарел' });
  }
  
  const verification = global.data.verificationCodes[email];
  
  if (Date.now() > verification.expires) {
    delete global.data.verificationCodes[email];
    return res.status(400).json({ error: 'Код устарел' });
  }
  
  if (verification.code === code) {
    delete global.data.verificationCodes[email];
    
    const newUser = {
      id: global.data.users.length + 1,
      email: email,
      username: `User${global.data.users.length + 1}`,
      code: code,
      level: 1,
      coins: 100,
      profession: 'Новичок',
      isOnline: true,
      lastSeen: Date.now()
    };
    
    global.data.users.push(newUser);
    
    // Уведомляем о новом пользователе
    broadcast({ type: 'user_joined', user: newUser });
    
    res.json({ 
      success: true, 
      user: {
        id: newUser.id,
        email: newUser.email,
        username: newUser.username,
        level: newUser.level,
        coins: newUser.coins,
        profession: newUser.profession,
        isOnline: true
      }
    });
  } else {
    res.status(400).json({ error: 'Неверный код' });
  }
});

// Получение списка пользователей
app.get('/api/users', (req, res) => {
  const users = global.data.users.map(user => ({
    id: user.id,
    username: user.username,
    level: user.level,
    profession: user.profession,
    isOnline: user.isOnline,
    lastSeen: user.lastSeen
  }));
  res.json(users);
});

// Получение профессий
app.get('/api/professions', (req, res) => {
  res.json(global.data.professions);
});

// Выбор профессии
app.post('/api/select-profession', (req, res) => {
  const { userId, professionId } = req.body;
  
  const user = global.data.users.find(u => u.id === userId);
  const profession = global.data.professions.find(p => p.id === professionId);
  
  if (!user || !profession) {
    return res.status(400).json({ error: 'Пользователь или профессия не найдены' });
  }
  
  user.profession = profession.name;
  
  // Уведомляем об изменении профессии
  broadcast({ 
    type: 'profession_changed', 
    userId: user.id, 
    profession: profession.name 
  });
  
  res.json({ success: true, profession: profession.name });
});

// Система сообщений
app.post('/api/send-message', (req, res) => {
  const { userId, text, chatId } = req.body;
  
  const user = global.data.users.find(u => u.id === userId);
  if (!user) {
    return res.status(400).json({ error: 'Пользователь не найден' });
  }
  
  const message = {
    id: global.data.messages.length + 1,
    userId: userId,
    username: user.username,
    text: text,
    chatId: chatId || 'global',
    timestamp: Date.now(),
    reactions: []
  };
  
  global.data.messages.push(message);
  
  // Рассылаем сообщение всем через WebSocket
  broadcast({
    type: 'new_message',
    message: message
  });
  
  res.json({ success: true, message: message });
});

// Получение сообщений чата
app.get('/api/messages/:chatId', (req, res) => {
  const { chatId } = req.params;
  const messages = global.data.messages
    .filter(msg => msg.chatId === chatId)
    .slice(-50); // Последние 50 сообщений
  
  res.json(messages);
});

// Функция рассылки сообщений через WebSocket
function broadcast(data) {
  const message = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// WebSocket для реального чата
wss.on('connection', (ws) => {
  console.log('🔗 Новое WebSocket соединение');
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.log('📨 WebSocket сообщение:', data);
      
      // Обрабатываем разные типы сообщений
      switch (data.type) {
        case 'ping':
          ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          break;
        case 'user_typing':
          broadcast({
            type: 'user_typing',
            userId: data.userId,
            isTyping: data.isTyping
          });
          break;
        default:
          // Рассылка сообщения всем клиентам
          broadcast(data);
      }
    } catch (error) {
      console.error('Ошибка обработки WebSocket сообщения:', error);
    }
  });
  
  ws.on('close', () => {
    console.log('🔌 WebSocket соединение закрыто');
  });
});

// Старт сервера
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
  console.log(`🌐 Доступен по: http://0.0.0.0:${PORT}`);
  console.log(`📧 EmailJS настроен с сервисом: service_190j47r`);
  console.log(`👥 Пользователей: ${global.data.users.length}`);
  console.log(`💬 Сообщений: ${global.data.messages.length}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Получен SIGTERM, завершаем работу...');
  server.close(() => {
    console.log('✅ Сервер остановлен');
    process.exit(0);
  });
});

module.exports = app;
