const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const dotenv = require('dotenv');
const cors = require('cors');
const connectDB = require('./config/database');
const Club = require('./models/Club');
const mongoose = require('mongoose');

// Загрузка переменных окружения
dotenv.config();

// Проверка наличия обязательных переменных
if (!process.env.MONGO_URI) {
  console.error('❌ Ошибка: MONGO_URI не найден в .env файле');
  console.log('💡 Создайте файл .env в корне проекта со следующим содержимым:');
  console.log('   MONGO_URI=your-mongodb-connection-string');
  console.log('   JWT_SECRET=your-secret-key');
  console.log('   PORT=3000');
  process.exit(1);
}

// Подключение к базе данных
connectDB();

const app = express();

// За прокси Railway/nginx: иначе сокеты и протокол могут определяться неверно
app.set('trust proxy', 1);

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  },
  allowEIO3: true,
  transports: ['polling', 'websocket'],
  pingTimeout: 60000,
  pingInterval: 25000,
});

app.set('io', io);

// CORS-заголовки вручную (на случай если cors() не сработает за прокси)
function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD');
  res.setHeader('Access-Control-Allow-Headers', '*');
}

// Маршрутизация на уровне сервера: /socket.io → Socket.IO, остальное → Express
server.removeAllListeners('request');
server.on('request', (req, res) => {
  setCorsHeaders(res);
  const path = ((req.url || '').split('?')[0] || '').replace(/^\/+|\/+$/g, '') || '/';
  const isSocketIo = path === 'socket.io' || path.startsWith('socket.io/');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  if (isSocketIo) {
    io.engine.handleRequest(req, res);
  } else {
    app(req, res);
  }
});

// Подключение к комнате клуба по clubId (Mongo _id, clubId или qrToken)
io.on('connection', (socket) => {
  const clubIdOrToken = socket.handshake.query?.clubId;
  if (!clubIdOrToken) return;

  const resolveClub = async () => {
    if (mongoose.Types.ObjectId.isValid(clubIdOrToken) && String(new mongoose.Types.ObjectId(clubIdOrToken)) === String(clubIdOrToken)) {
      const byId = await Club.findOne({ _id: new mongoose.Types.ObjectId(clubIdOrToken), isActive: true });
      if (byId) return byId;
    }
    return Club.findOne({
      $or: [{ clubId: clubIdOrToken }, { qrToken: clubIdOrToken }],
      isActive: true,
    });
  };

  resolveClub()
    .then((club) => {
      if (!club) return;
      const room = `club:${club._id}`;
      socket.join(room);
    })
    .catch(() => {});
});

// Middleware — CORS без ограничений, с любого origin
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'],
  allowedHeaders: '*',
  credentials: false,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Роуты
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/players', require('./routes/playerRoutes'));
app.use('/api/clubs', require('./routes/clubRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));

// Тестовый роут
app.get('/', (req, res) => {
  res.json({ message: 'API работает' });
});

// Проверка, что запросы доходят до приложения (если /socket.io 404 — смотреть настройки прокси Railway)
app.get('/ws-health', (req, res) => {
  res.status(200).json({ ok: true, message: 'WebSocket app reachable' });
});

// Обработка ошибок
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    message: 'Что-то пошло не так!',
    error: process.env.NODE_ENV === 'development' ? err.message : {}
  });
});

// 404
app.use((req, res) => {
  res.status(404).json({
    message: 'Маршрут не найден',
    path: req.url?.split('?')[0] || req.path,
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
