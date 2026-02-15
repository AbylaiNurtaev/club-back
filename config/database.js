const mongoose = require('mongoose');

const getOptions = () => ({
  serverSelectionTimeoutMS: 5000,
  maxPoolSize: 10,
  minPoolSize: 1,
});

const connectDB = async () => {
  try {
    if (!process.env.MONGO_URI) {
      console.error('❌ MONGO_URI не установлен в .env файле');
      console.log('💡 Создайте файл .env и добавьте: MONGO_URI=your-mongodb-connection-string');
      process.exit(1);
    }

    const conn = await mongoose.connect(process.env.MONGO_URI, getOptions());
    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);

    if (!connectDB.listenersSet) {
      connectDB.listenersSet = true;
      mongoose.connection.on('error', (err) => {
        console.error('❌ MongoDB connection error:', err);
      });
      mongoose.connection.on('disconnected', () => {
        console.warn('⚠️  MongoDB disconnected — переподключение через 5 сек...');
        setTimeout(() => {
          if (mongoose.connection.readyState === 0) {
            connectDB().catch((e) => console.error('❌ Повторное подключение не удалось:', e.message));
          }
        }, 5000);
      });
      mongoose.connection.on('reconnected', () => {
        console.log('✅ MongoDB переподключен');
      });
    }
  } catch (error) {
    console.error('❌ Ошибка подключения к MongoDB:');
    console.error(`   ${error.message}`);
    console.log('\n💡 Проверьте:');
    console.log('   1. Правильность MONGO_URI в .env файле');
    console.log('   2. Запущен ли MongoDB сервер');
    console.log('   3. Доступность сети для подключения');
    console.log('\n   Пример MONGO_URI: mongodb://localhost:27017/pc-platform');
    console.log('   Или для MongoDB Atlas: mongodb+srv://user:pass@cluster.mongodb.net/dbname');
    process.exit(1);
  }
};

module.exports = connectDB;
