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
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || '*',
    methods: ['GET', 'POST'],
  },
});

app.set('io', io);

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

// Middleware
app.use(cors());
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
  res.status(404).json({ message: 'Маршрут не найден' });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
