const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Чистая база данных
let data = {
  users: [],
  messages: [],
  professions: [
    { id: 1, name: 'Художник', level: 1 },
    { id: 2, name: 'Фотограф', level: 1 },
    { id: 3, name: 'Писатель', level: 1 },
    { id: 4, name: 'Мемодел', level: 1 },
    { id: 5, name: 'Библиотекарь', level: 1 },
    { id: 6, name: 'Тестер', level: 1 }
  ],
  verificationCodes: {}, // Для 2FA кодов
  sessions: {} // Активные сессии
};

// Генерация 6-значного кода
function generateVerificationCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// WebSocket
wss.on('connection', (ws) => {
  console.log('🔗 Новое WebSocket подключение');
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(data));
        }
      });
    } catch (error) {
      console.error('Ошибка WebSocket:', error);
    }
  });
});

// API Routes
app.get('/', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Anongram Server',
    users: data.users.length,
    online: Object.keys(data.sessions).length
  });
});

// Регистрация нового пользователя
app.post('/api/register', (req, res) => {
  const { username, code } = req.body;
  
  console.log('📝 Регистрация:', username);
  
  if (!username || !code) {
    return res.status(400).json({ error: 'Заполните никнейм и код доступа' });
  }

  if (username.length < 3) {
    return res.status(400).json({ error: 'Никнейм должен быть не менее 3 символов' });
  }

  if (code.length < 6) {
    return res.status(400).json({ error: 'Код доступа должен быть не менее 6 символов' });
  }

  // Проверяем занят ли никнейм
  const usernameExists = data.users.find(user => 
    user.username.toLowerCase() === username.toLowerCase()
  );
  if (usernameExists) {
    return res.status(400).json({ error: 'Этот никнейм уже занят' });
  }

  // Проверяем занят ли код доступа
  const codeExists = data.users.find(user => user.code === code);
  if (codeExists) {
    return res.status(400).json({ error: 'Этот код доступа уже используется' });
  }

  // Создаем пользователя
  const newUser = {
    id: data.users.length + 1,
    username: username,
    code: code,
    level: 1,
    coins: 100,
    profession: 'Новичок',
    twoFACode: generateVerificationCode(), // Код для 2FA
    devices: [], // Список устройств
    createdAt: new Date().toISOString()
  };

  data.users.push(newUser);
  
  console.log('✅ Новый пользователь:', username, '2FA код:', newUser.twoFACode);
  
  res.json({ 
    success: true, 
    user: {
      id: newUser.id,
      username: newUser.username,
      level: newUser.level,
      coins: newUser.coins,
      profession: newUser.profession
    },
    twoFACode: newUser.twoFACode // Отправляем 2FA код
  });
});

// Первый этап входа - проверка кода доступа
app.post('/api/login', (req, res) => {
  const { username, code } = req.body;
  
  console.log('🔐 Попытка входа:', username);
  
  if (!username || !code) {
    return res.status(400).json({ error: 'Заполните никнейм и код доступа' });
  }

  // Ищем пользователя
  const user = data.users.find(u => 
    u.username.toLowerCase() === username.toLowerCase() && 
    u.code === code
  );

  if (!user) {
    return res.status(400).json({ error: 'Неверный никнейм или код доступа' });
  }

  // Генерируем временный код для 2FA
  const tempCode = generateVerificationCode();
  data.verificationCodes[username] = {
    code: tempCode,
    userId: user.id,
    expires: Date.now() + 10 * 60 * 1000 // 10 минут
  };

  console.log('📱 2FA код для', username, ':', tempCode);
  
  res.json({ 
    success: true,
    requires2FA: true,
    message: 'Требуется подтверждение входа',
    twoFACode: tempCode // Отправляем код для подтверждения
  });
});

// Второй этап - подтверждение 2FA
app.post('/api/verify-2fa', (req, res) => {
  const { username, code, twoFACode } = req.body;
  
  console.log('🔒 Подтверждение 2FA для:', username);
  
  if (!username || !code || !twoFACode) {
    return res.status(400).json({ error: 'Заполните все поля' });
  }

  // Проверяем временный код
  const verification = data.verificationCodes[username];
  if (!verification || verification.code !== twoFACode) {
    return res.status(400).json({ error: 'Неверный код подтверждения' });
  }

  if (Date.now() > verification.expires) {
    delete data.verificationCodes[username];
    return res.status(400).json({ error: 'Код подтверждения устарел' });
  }

  const user = data.users.find(u => u.id === verification.userId);
  if (!user) {
    return res.status(400).json({ error: 'Пользователь не найден' });
  }

  // Создаем сессию
  const sessionId = Math.random().toString(36).substring(2);
  data.sessions[sessionId] = {
    userId: user.id,
    username: user.username,
    createdAt: new Date().toISOString(),
    device: req.headers['user-agent'] || 'Unknown'
  };

  // Добавляем устройство если его нет
  const deviceExists = user.devices.find(device => device.sessionId === sessionId);
  if (!deviceExists) {
    user.devices.push({
      sessionId: sessionId,
      lastLogin: new Date().toISOString(),
      userAgent: req.headers['user-agent'] || 'Unknown'
    });
  }

  // Удаляем временный код
  delete data.verificationCodes[username];

  console.log('✅ Успешный вход:', user.username, 'Сессия:', sessionId);
  
  res.json({ 
    success: true, 
    user: {
      id: user.id,
      username: user.username,
      level: user.level,
      coins: user.coins,
      profession: user.profession
    },
    sessionId: sessionId
  });
});

// Проверка сессии
app.post('/api/check-session', (req, res) => {
  const { sessionId } = req.body;
  
  if (!sessionId) {
    return res.status(400).json({ error: 'Сессия не найдена' });
  }

  const session = data.sessions[sessionId];
  if (!session) {
    return res.status(400).json({ error: 'Сессия устарела' });
  }

  const user = data.users.find(u => u.id === session.userId);
  if (!user) {
    return res.status(400).json({ error: 'Пользователь не найден' });
  }

  res.json({ 
    success: true, 
    user: {
      id: user.id,
      username: user.username,
      level: user.level,
      coins: user.coins,
      profession: user.profession
    }
  });
});

// Получение списка пользователей
app.get('/api/users', (req, res) => {
  const users = data.users.map(user => ({
    id: user.id,
    username: user.username,
    level: user.level,
    profession: user.profession
  }));
  res.json(users);
});

// Получение профессий
app.get('/api/professions', (req, res) => {
  res.json(data.professions);
});

// Выбор профессии
app.post('/api/select-profession', (req, res) => {
  const { userId, professionId } = req.body;
  
  const user = data.users.find(u => u.id === userId);
  const profession = data.professions.find(p => p.id === professionId);
  
  if (!user || !profession) {
    return res.status(400).json({ error: 'Пользователь или профессия не найдены' });
  }
  
  user.profession = profession.name;
  res.json({ success: true, profession: profession.name });
});

// Отправка сообщения
app.post('/api/send-message', (req, res) => {
  const { userId, text, chatId } = req.body;
  
  const user = data.users.find(u => u.id === userId);
  if (!user) {
    return res.status(400).json({ error: 'Пользователь не найден' });
  }
  
  const message = {
    id: data.messages.length + 1,
    userId: userId,
    username: user.username,
    text: text,
    chatId: chatId || 'global',
    timestamp: Date.now()
  };
  
  data.messages.push(message);
  
  // Рассылаем через WebSocket
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        type: 'new_message',
        message: message
      }));
    }
  });
  
  res.json({ success: true, message: message });
});

// Получение сообщений
app.get('/api/messages/:chatId', (req, res) => {
  const { chatId } = req.params;
  const messages = data.messages
    .filter(msg => msg.chatId === chatId)
    .slice(-50);
  res.json(messages);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
  console.log(`🔐 Система 2FA включена`);
  console.log(`👥 Готовых аккаунтов: 0`);
});
