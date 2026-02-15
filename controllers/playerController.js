const mongoose = require('mongoose');
const User = require('../models/User');
const Club = require('../models/Club');
const Spin = require('../models/Spin');
const Prize = require('../models/Prize');
const Transaction = require('../models/Transaction');
const PrizeClaim = require('../models/PrizeClaim');
const generateToken = require('../utils/generateToken');
const { spinRoulette } = require('../utils/roulette');

// @desc    Регистрация игрока
// @route   POST /api/players/register
// @access  Public
const registerPlayer = async (req, res) => {
  try {
    const { phone, code } = req.body;

    if (!phone || !code) {
      return res.status(400).json({ message: 'Телефон и код обязательны' });
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
      password: 'default', // Временный пароль, можно изменить
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
      balance: user.balance,
      role: user.role,
      token: generateToken(user._id),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Авторизация игрока
// @route   POST /api/players/login
// @access  Public
const loginPlayer = async (req, res) => {
  try {
    const { phone, code } = req.body;

    if (!phone || !code) {
      return res.status(400).json({ message: 'Телефон и код обязательны' });
    }

    // Проверка кода (пока всегда 0000)
    if (code !== '0000') {
      return res.status(401).json({ message: 'Неверный код' });
    }

    const user = await User.findOne({ phone });

    if (!user) {
      return res.status(401).json({ message: 'Пользователь не найден' });
    }

    if (user.role !== 'player') {
      return res.status(403).json({ message: 'Доступ запрещен' });
    }

    res.json({
      _id: user._id,
      phone: user.phone,
      balance: user.balance,
      role: user.role,
      clubId: user.clubId,
      token: generateToken(user._id),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Получить информацию о текущем игроке
// @route   GET /api/players/me
// @access  Private
const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .select('-password')
      .populate('clubId', 'name clubId');

    res.json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Получить баланс игрока
// @route   GET /api/players/balance
// @access  Private
const getBalance = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    res.json({ balance: user.balance });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Получить историю транзакций
// @route   GET /api/players/transactions
// @access  Private
const getTransactions = async (req, res) => {
  try {
    const transactions = await Transaction.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .populate('relatedSpinId');

    res.json(transactions);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Получить клуб по club_id / qrToken / clubId (для ссылки из QR)
// @route   GET /api/players/club-by-qr/:qrToken  или  GET /api/players/club?club=...
// @access  Public
const getClubByQR = async (req, res) => {
  try {
    const token = req.params.qrToken || req.query.club;
    if (!token) {
      return res.status(400).json({ message: 'Передайте club_id, qrToken или clubId (в path или ?club=)' });
    }

    const conditions = [
      { qrToken: token, isActive: true },
      { clubId: token, isActive: true },
    ];
    if (mongoose.Types.ObjectId.isValid(token) && String(new mongoose.Types.ObjectId(token)) === String(token)) {
      conditions.push({ _id: new mongoose.Types.ObjectId(token), isActive: true });
    }

    const club = await Club.findOne({ $or: conditions });

    if (!club) {
      return res.status(404).json({ message: 'Клуб не найден' });
    }

    res.json({
      _id: club._id,
      name: club.name,
      clubId: club.clubId,
      qrToken: club.qrToken,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Прокрутить рулетку
// @route   POST /api/players/spin
// @access  Private
const spin = async (req, res) => {
  try {
    const { clubId: clubParam } = req.body;

    if (!clubParam) {
      return res.status(400).json({ message: 'ID клуба обязателен' });
    }

    // Разрешаем клуб по _id (Mongo), по clubId (строка) или по qrToken (из ссылки QR)
    let club = null;
    if (mongoose.Types.ObjectId.isValid(clubParam) && String(new mongoose.Types.ObjectId(clubParam)) === String(clubParam)) {
      club = await Club.findById(clubParam);
    }
    if (!club) {
      club = await Club.findOne({
        $or: [
          { clubId: clubParam },
          { qrToken: clubParam },
        ],
        isActive: true,
      });
    }
    if (!club || !club.isActive) {
      return res.status(404).json({ message: 'Клуб не найден или неактивен' });
    }

    const user = await User.findById(req.user._id);

    // Проверка баланса
    const spinCost = 20;
    if (user.balance < spinCost) {
      return res.status(400).json({ message: 'Недостаточно баллов для прокрутки' });
    }

    // Выбор приза
    const prize = await spinRoulette();

    // Проверка наличия приза
    if (prize.totalQuantity !== null && prize.remainingQuantity <= 0) {
      return res.status(400).json({ message: 'Приз закончился' });
    }

    // Создание спина
    const spin = await Spin.create({
      userId: user._id,
      clubId: club._id,
      prizeId: prize._id,
      cost: spinCost,
      status: 'confirmed',
    });

    // Списание баллов
    user.balance -= spinCost;
    await user.save();

    // Создание транзакции на списание
    await Transaction.create({
      userId: user._id,
      type: 'spin_cost',
      amount: -spinCost,
      description: `Списание за прокрутку рулетки`,
      relatedSpinId: spin._id,
    });

    // Обработка приза
    let prizeTransaction = null;
    if (prize.type === 'points') {
      // Начисление баллов
      user.balance += prize.value;
      await user.save();
      
      prizeTransaction = await Transaction.create({
        userId: user._id,
        type: 'prize_points',
        amount: prize.value,
        description: `Выигрыш: ${prize.name}`,
        relatedSpinId: spin._id,
      });
    } else if (prize.type === 'club_time') {
      // Приз сразу присваивается игроку, подтверждение не требуется
      await PrizeClaim.create({
        userId: user._id,
        spinId: spin._id,
        prizeId: prize._id,
        clubId: club._id,
        status: 'completed',
        confirmedAt: new Date(),
        clubTimeMinutes: prize.value,
      });
    } else {
      // Физический приз и др. — сразу присваиваются, подтверждение не требуется
      await PrizeClaim.create({
        userId: user._id,
        spinId: spin._id,
        prizeId: prize._id,
        clubId: club._id,
        status: 'completed',
        confirmedAt: new Date(),
      });
    }

    // Уменьшение количества приза
    if (prize.totalQuantity !== null) {
      prize.remainingQuantity = Math.max(0, prize.remainingQuantity - 1);
      await prize.save();
    }

    // Получаем полную информацию о призе с изображением
    const prizeInfo = await Prize.findById(prize._id).select('name description type value image dropChance slotIndex');

    res.json({
      spin: {
        _id: spin._id,
        prize: {
          _id: prizeInfo._id,
          name: prizeInfo.name,
          description: prizeInfo.description,
          type: prizeInfo.type,
          value: prizeInfo.value,
          image: prizeInfo.image, // URL изображения из S3
          slotIndex: prizeInfo.slotIndex,
        },
        cost: spinCost,
        createdAt: spin.createdAt,
      },
      newBalance: user.balance,
      prizeTransaction,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Получить выигранные призы
// @route   GET /api/players/prizes
// @access  Private
const getPrizes = async (req, res) => {
  try {
    const prizeClaims = await PrizeClaim.find({ userId: req.user._id })
      .populate('prizeId', 'name description type value image')
      .populate('clubId', 'name')
      .populate('spinId', 'createdAt')
      .sort({ createdAt: -1 });

    res.json(prizeClaims);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Получить все призы для рулетки
// @route   GET /api/players/roulette-prizes
// @access  Public
const getRoulettePrizes = async (req, res) => {
  try {
    const prizes = await Prize.find({ isActive: true })
      .select('name description type value image dropChance slotIndex')
      .sort({ slotIndex: 1 });

    res.json(prizes);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Привязать игрока к клубу
// @route   POST /api/players/attach-club
// @access  Private
const attachClub = async (req, res) => {
  try {
    const { clubId } = req.body;

    if (!clubId) {
      return res.status(400).json({ message: 'ID клуба обязателен' });
    }

    const club = await Club.findById(clubId);
    if (!club || !club.isActive) {
      return res.status(404).json({ message: 'Клуб не найден' });
    }

    const user = await User.findById(req.user._id);
    user.clubId = club._id;
    await user.save();

    res.json({ message: 'Игрок привязан к клубу', clubId: club._id });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  registerPlayer,
  loginPlayer,
  getMe,
  getBalance,
  getTransactions,
  getClubByQR,
  spin,
  getPrizes,
  getRoulettePrizes,
  attachClub,
};
