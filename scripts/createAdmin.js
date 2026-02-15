const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('../models/User');

// Загрузка переменных окружения
dotenv.config();

const createAdmin = async () => {
  try {
    // Подключение к базе данных
    if (!process.env.MONGO_URI) {
      console.error('❌ MONGO_URI не установлен в .env файле');
      process.exit(1);
    }

    await mongoose.connect(process.env.MONGO_URI);

    console.log('✅ Подключено к MongoDB');

    const phone = '+77777777777';

    // Проверяем, существует ли уже администратор с таким номером
    let admin = await User.findOne({ phone });

    if (admin) {
      if (admin.role === 'admin') {
        console.log(`✅ Администратор с номером ${phone} уже существует`);
        console.log(`   ID: ${admin._id}`);
      } else {
        // Обновляем роль на admin
        admin.role = 'admin';
        await admin.save();
        console.log(`✅ Роль пользователя ${phone} изменена на администратора`);
        console.log(`   ID: ${admin._id}`);
      }
    } else {
      // Создаем нового администратора
      admin = await User.create({
        phone,
        password: 'default',
        role: 'admin',
      });
      console.log(`✅ Администратор создан успешно`);
      console.log(`   Телефон: ${admin.phone}`);
      console.log(`   ID: ${admin._id}`);
      console.log(`   Роль: ${admin.role}`);
    }

    console.log('\n💡 Для входа используйте:');
    console.log(`   Телефон: ${phone}`);
    console.log(`   Код: 0000`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Ошибка при создании администратора:', error.message);
    process.exit(1);
  }
};

createAdmin();
