const User = require('../models/User');
const Club = require('../models/Club');
const Transaction = require('../models/Transaction');
const generateToken = require('../utils/generateToken');

// @desc    Единый вход для всех ролей
// @route   POST /api/auth/login
// @access  Public
const login = async (req, res) => {
  try {
    const { phone, code } = req.body;

    if (!phone || !code) {
      return res.status(400).json({ message: 'Телефон и код обязательны' });
    }

    // Проверка кода (пока всегда 0000)
    if (code !== '0000') {
      return res.status(401).json({ message: 'Неверный код' });
    }

    // Ищем пользователя
    let user = await User.findOne({ phone });

    if (!user) {
      // Если пользователь не найден, создаем игрока
      user = await User.create({
        phone,
        password: 'default',
        role: 'player',
        balance: 15, // Бонус за регистрацию
      });

      // Создание транзакции для бонуса регистрации
      await Transaction.create({
        userId: user._id,
        type: 'registration_bonus',
        amount: 15,
        description: 'Бонус за регистрацию',
      });
    }

    // Подготавливаем ответ в зависимости от роли
    const response = {
      _id: user._id,
      phone: user.phone,
      name: user.name,
      role: user.role,
      token: generateToken(user._id),
    };

    // Для игрока добавляем баланс и clubId
    if (user.role === 'player') {
      response.balance = user.balance;
      response.clubId = user.clubId;
    }

    // Для клуба добавляем информацию о клубе
    if (user.role === 'club') {
      const club = await Club.findOne({ ownerId: user._id });
      if (club) {
        response.club = club;
      }
    }

    res.json(response);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Регистрация игрока (опционально, можно использовать login)
// @route   POST /api/auth/register
// @access  Public
const register = async (req, res) => {
  try {
    const { phone, code, name } = req.body;

    if (!phone || !code) {
      return res.status(400).json({ message: 'Телефон и код обязательны' });
    }
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ message: 'Имя обязательно' });
    }

    // Проверка кода (пока всегда 0000)
    if (code !== '0000') {
      return res.status(400).json({ message: 'Неверный код' });
    }

    // Проверка, существует ли пользователь
    const userExists = await User.findOne({ phone });
    if (userExists) {
      return res.status(400).json({ message: 'Пользователь с таким телефоном уже существует' });
    }

    // Создание пользователя
    const user = await User.create({
      phone,
      name: name.trim(),
      password: 'default',
      role: 'player',
      balance: 15, // Бонус за регистрацию
    });

    // Создание транзакции для бонуса регистрации
    await Transaction.create({
      userId: user._id,
      type: 'registration_bonus',
      amount: 15,
      description: 'Бонус за регистрацию',
    });

    res.status(201).json({
      _id: user._id,
      phone: user.phone,
      name: user.name,
      balance: user.balance,
      role: user.role,
      token: generateToken(user._id),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  login,
  register,
};
