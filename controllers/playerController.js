const mongoose = require('mongoose');
const User = require('../models/User');
const Club = require('../models/Club');
const Spin = require('../models/Spin');
const Prize = require('../models/Prize');
const Transaction = require('../models/Transaction');
const PrizeClaim = require('../models/PrizeClaim');
const generateToken = require('../utils/generateToken');
const { spinRoulette } = require('../utils/roulette');
const { addRecentWin, getRecentWins } = require('../utils/recentWins');
const { isWithinSpinRadius, MAX_SPIN_DISTANCE_M, distanceMeters } = require('../utils/geo');
const { attachReferrer, tryApproveReferral, getReferralCode, getReferralLink, REFERRAL_POINTS } = require('../utils/referralService');

// Блокировка рулетки по клубу: 7 сек результаты + 15 сек анимация + запас ≈ 23 сек
const ROULETTE_COOLDOWN_MS = 23 * 1000;

// Тестовый bypass геолокации: для номера +76666666666 можно крутить рулетку без проверки нахождения в клубе.
// Включить: SPIN_GEO_BYPASS_ENABLED=true в .env. Отключить — убрать или поставить false.
const SPIN_GEO_BYPASS_ENABLED = process.env.SPIN_GEO_BYPASS_ENABLED === 'true';
const GEO_BYPASS_PHONE_NORMALIZED = '76666666666';
function isGeoBypassPhone(phone) {
  if (!SPIN_GEO_BYPASS_ENABLED || !phone) return false;
  const n = String(phone).replace(/\D/g, '').replace(/^8/, '7');
  return n === GEO_BYPASS_PHONE_NORMALIZED;
}

// @desc    Регистрация игрока
// @route   POST /api/players/register
// @access  Public
// Body: phone, code, name, ref? — ref = payload из Telegram (например ref_<userId>)
const registerPlayer = async (req, res) => {
  try {
    const { phone, code, name, ref: refPayload } = req.body;

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

    // Реферал: привязать пригласившего (антифрод: self-referral и один реферер — внутри attachReferrer)
    if (refPayload) await attachReferrer(user, refPayload);

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
      name: user.name,
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

    const data = user.toObject ? user.toObject() : user;
    if (user.role === 'player') {
      data.referralCode = await getReferralCode(user);
      data.referralLink = await getReferralLink(user);
      data.referralPointsPerFriend = REFERRAL_POINTS;
    }
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Обновить профиль текущего игрока (имя)
// @route   PATCH /api/players/me
// @access  Private
const updateMe = async (req, res) => {
  try {
    const { name } = req.body;
    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ message: 'Имя не может быть пустым' });
      }
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'Пользователь не найден' });
    }

    if (name !== undefined) user.name = name.trim();
    await user.save();

    const updated = await User.findById(user._id)
      .select('-password')
      .populate('clubId', 'name clubId');
    res.json(updated);
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

// @desc    Получить клуб по club_id / qrToken / clubId / pinCode (6 цифр для ввода без QR)
// @route   GET /api/players/club-by-qr/:qrToken  или  GET /api/players/club?club=...
// @access  Public
const getClubByQR = async (req, res) => {
  try {
    const token = req.params.qrToken || req.query.club;
    if (!token) {
      return res.status(400).json({ message: 'Передайте club_id, qrToken, clubId или pinCode (6 цифр)' });
    }

    const conditions = [
      { qrToken: token, isActive: true },
      { clubId: token, isActive: true },
    ];
    if (/^\d{6}$/.test(String(token).trim())) {
      conditions.push({ pinCode: String(token).trim(), isActive: true });
    }
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
      pinCode: club.pinCode,
      latitude: club.latitude,
      longitude: club.longitude,
      theme: club.theme,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Общая логика спина (клуб уже найден, юзер уже есть)
async function doSpin(user, club, req, res) {
  const lastSpin = await Spin.findOne({ clubId: club._id }).sort({ createdAt: -1 }).lean();
  if (lastSpin) {
    const elapsed = Date.now() - new Date(lastSpin.createdAt).getTime();
    if (elapsed < ROULETTE_COOLDOWN_MS) {
      const retryAfterSeconds = Math.ceil((ROULETTE_COOLDOWN_MS - elapsed) / 1000);
      return res.status(429).json({
        message: 'Рулетка занята, попробуйте позже',
        code: 'ROULETTE_BUSY',
        retryAfterSeconds,
      });
    }
  }

  const spinCost = 20;
  if (user.balance < spinCost) {
    return res.status(400).json({ message: 'Недостаточно баллов для прокрутки' });
  }

  const prize = await spinRoulette();
  if (prize.totalQuantity !== null && prize.remainingQuantity <= 0) {
    return res.status(400).json({ message: 'Приз закончился' });
  }

  const spin = await Spin.create({
    userId: user._id,
    clubId: club._id,
    prizeId: prize._id,
    cost: spinCost,
    status: 'confirmed',
  });

  user.balance -= spinCost;
  await user.save();

  await Transaction.create({
    userId: user._id,
    type: 'spin_cost',
    amount: -spinCost,
    description: `Списание за прокрутку рулетки`,
    relatedSpinId: spin._id,
  });

  let prizeTransaction = null;
  if (prize.type === 'points') {
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
    await PrizeClaim.create({
      userId: user._id,
      spinId: spin._id,
      prizeId: prize._id,
      clubId: club._id,
      status: 'completed',
      confirmedAt: new Date(),
    });
  }

  if (prize.totalQuantity !== null) {
    prize.remainingQuantity = Math.max(0, prize.remainingQuantity - 1);
    await prize.save();
  }

  const prizeInfo = await Prize.findById(prize._id).select('name description type value image dropChance slotIndex');
  const playerName = (user.name && String(user.name).trim()) ? String(user.name).trim() : '';
  const playerIdPayload = playerName ? { name: playerName } : undefined;
  const spinPayload = {
    _id: spin._id,
    prize: {
      _id: prizeInfo._id,
      name: prizeInfo.name,
      description: prizeInfo.description,
      type: prizeInfo.type,
      value: prizeInfo.value,
      image: prizeInfo.image,
      slotIndex: prizeInfo.slotIndex,
    },
    cost: spinCost,
    createdAt: spin.createdAt,
    playerPhone: user.phone,
    playerName,
    name: playerName,
    playerId: playerIdPayload,
  };

  addRecentWin(user.phone, prizeInfo.name, user.name);
  const recentWinsList = getRecentWins();

  const io = req.app.get('io');
  if (io) {
    io.to(`club:${club._id}`).emit('spin', { ...spinPayload, recentWins: recentWinsList });
  }

  // Реферал: после первого платного спина — одобрить и начислить баллы рефереру (лимит 20/мес)
  tryApproveReferral(user._id).catch((err) => {
    console.error('[referral] tryApproveReferral failed:', err?.message || err);
  });

  return res.json({
    spin: spinPayload,
    newBalance: user.balance,
    prizeTransaction,
  });
}

async function resolveClub(clubParam) {
  if (!clubParam) return null;
  if (mongoose.Types.ObjectId.isValid(clubParam) && String(new mongoose.Types.ObjectId(clubParam)) === String(clubParam)) {
    const c = await Club.findById(clubParam);
    if (c) return c;
  }
  const cond = [{ clubId: clubParam }, { qrToken: clubParam }];
  if (/^\d{6}$/.test(String(clubParam).trim())) cond.push({ pinCode: String(clubParam).trim() });
  return Club.findOne({ $or: cond, isActive: true });
}

// Проверка геолокации перед спином: если у клуба заданы координаты, пользователь должен быть в радиусе 200 м
function checkGeoBeforeSpin(club, latitude, longitude, res) {
  if (club.latitude == null || club.longitude == null) return null;
  const lat = latitude != null ? Number(latitude) : null;
  const lng = longitude != null ? Number(longitude) : null;
  if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) {
    return res.status(400).json({
      message: 'Передайте latitude и longitude (ваша геолокация) для проверки нахождения в клубе',
    });
  }
  if (!isWithinSpinRadius(club.latitude, club.longitude, lat, lng)) {
    return res.status(400).json({
      message: `Вы слишком далеко от клуба. Подойдите ближе (в пределах ${MAX_SPIN_DISTANCE_M} м).`,
    });
  }
  return null;
}

// Найти ближайший клуб в радиусе 200 м от точки (по гео можно крутить без кода клуба)
async function findNearestClubByGeo(userLat, userLon) {
  const clubs = await Club.find({
    isActive: true,
    latitude: { $ne: null },
    longitude: { $ne: null },
  }).lean();
  const lat = Number(userLat);
  const lng = Number(userLon);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  let nearest = null;
  let minDist = 201;
  for (const c of clubs) {
    const d = distanceMeters(c.latitude, c.longitude, lat, lng);
    if (d <= 200 && d < minDist) {
      minDist = d;
      nearest = c;
    }
  }
  return nearest ? await Club.findById(nearest._id) : null;
}

// @desc    Прокрутить рулетку (по токену игрока)
// @route   POST /api/players/spin
// @access  Private
const spin = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    const { clubId: clubParam, latitude, longitude } = req.body;
    let club = null;
    if (clubParam) {
      club = await resolveClub(clubParam);
      if (!club || !club.isActive) {
        return res.status(404).json({ message: 'Клуб не найден или неактивен' });
      }
      if (!isGeoBypassPhone(user?.phone)) {
        const geoErr = checkGeoBeforeSpin(club, latitude, longitude, res);
        if (geoErr) return geoErr;
      }
    } else {
      if (latitude == null || longitude == null) {
        return res.status(400).json({ message: 'Передайте latitude и longitude (геолокация) или clubId' });
      }
      club = await findNearestClubByGeo(latitude, longitude);
      if (!club) {
        return res.status(400).json({ message: 'Вы не в радиусе ни одного клуба (в пределах 200 м)' });
      }
    }
    return doSpin(user, club, req, res);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Прокрутить рулетку по телефону (без токена). Клуб можно не передавать — определится по геолокации (в радиусе 200 м).
// @route   POST /api/players/spin-by-phone
// @access  Public
const spinByPhone = async (req, res) => {
  try {
    const { clubId: clubParam, phone, latitude, longitude } = req.body;
    if (!phone) {
      return res.status(400).json({ message: 'Телефон обязателен' });
    }
    const normalized = String(phone).replace(/\D/g, '').replace(/^8/, '7');
    const bypassGeo = isGeoBypassPhone(phone);
    let club = null;
    if (clubParam) {
      club = await resolveClub(clubParam);
      if (!club || !club.isActive) {
        return res.status(404).json({ message: 'Клуб не найден или неактивен' });
      }
      if (!bypassGeo) {
        const geoErr = checkGeoBeforeSpin(club, latitude, longitude, res);
        if (geoErr) return geoErr;
      }
    } else {
      if (bypassGeo) {
        club = await Club.findOne({ isActive: true });
        if (!club) {
          return res.status(404).json({ message: 'Нет активных клубов' });
        }
      } else {
        if (latitude == null || longitude == null) {
          return res.status(400).json({ message: 'Передайте latitude и longitude (геолокация)' });
        }
        club = await findNearestClubByGeo(latitude, longitude);
        if (!club) {
          return res.status(400).json({ message: 'Вы не в радиусе ни одного клуба (в пределах 200 м)' });
        }
      }
    }
    const user = await User.findOne({
      $or: [{ phone: normalized }, { phone: '+' + normalized }],
    });
    if (!user) {
      return res.status(404).json({ message: 'Пользователь с таким телефоном не найден' });
    }
    if (user.role !== 'player') {
      return res.status(403).json({ message: 'Этот телефон не зарегистрирован как игрок' });
    }
    return doSpin(user, club, req, res);
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

// @desc    Последние 10 выигрышей по всем клубам для экранов (публично)
// @route   GET /api/players/recent-wins
// @access  Public
const getRecentWinsHandler = async (req, res) => {
  try {
    res.json(getRecentWins());
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
  updateMe,
  getBalance,
  getTransactions,
  getClubByQR,
  getRecentWinsHandler,
  spin,
  spinByPhone,
  getPrizes,
  getRoulettePrizes,
  attachClub,
};
