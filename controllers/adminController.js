const User = require('../models/User');
const Club = require('../models/Club');
const Prize = require('../models/Prize');
const Spin = require('../models/Spin');
const Transaction = require('../models/Transaction');
const PrizeClaim = require('../models/PrizeClaim');
const generateToken = require('../utils/generateToken');
const QRCode = require('qrcode');
const { deleteFromS3 } = require('../utils/s3Upload');

// @desc    Регистрация/вход администратора
// @route   POST /api/admin/login
// @access  Public
const loginAdmin = async (req, res) => {
  try {
    const { phone, code } = req.body;

    if (!phone || !code) {
      return res.status(400).json({ message: 'Телефон и код обязательны' });
    }

    if (code !== '0000') {
      return res.status(401).json({ message: 'Неверный код' });
    }

    let user = await User.findOne({ phone });

    if (!user) {
      // Создаем администратора, если его нет
      user = await User.create({
        phone,
        password: 'default',
        role: 'admin',
      });
    } else if (user.role !== 'admin') {
      return res.status(403).json({ message: 'Доступ запрещен' });
    }

    res.json({
      _id: user._id,
      phone: user.phone,
      role: user.role,
      token: generateToken(user._id),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Создать клуб
// @route   POST /api/admin/clubs
// @access  Private/Admin
const createClub = async (req, res) => {
  try {
    const { name, phone, address, city, managerFio, latitude, longitude } = req.body;

    if (!name || !phone) {
      return res.status(400).json({ message: 'Название и телефон обязательны' });
    }
    const lat = latitude != null ? Number(latitude) : null;
    const lng = longitude != null ? Number(longitude) : null;
    if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) {
      return res.status(400).json({ message: 'Укажите latitude и longitude (геолокация клуба)' });
    }

    let owner = await User.findOne({ phone });
    
    if (!owner) {
      owner = await User.create({
        phone,
        password: 'default',
        role: 'club',
      });
    } else if (owner.role !== 'club') {
      return res.status(400).json({ message: 'Пользователь с таким телефоном уже существует с другой ролью' });
    }

    // Проверка, есть ли у пользователя уже клуб
    const existingClub = await Club.findOne({ ownerId: owner._id });
    if (existingClub) {
      return res.status(400).json({ message: 'У пользователя уже есть клуб' });
    }

    const clubId = `club_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const club = await Club.create({
      name,
      ownerId: owner._id,
      clubId,
      latitude: lat,
      longitude: lng,
      address,
      city: city || '',
      managerFio: managerFio || undefined,
    });

    const qrData = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/spin?club=${club.qrToken}`;
    const qrCode = await QRCode.toDataURL(qrData);

    club.qrCode = qrCode;
    await club.save();

    res.status(201).json(club);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Получить все клубы (с количеством игроков по каждому)
// @route   GET /api/admin/clubs
// @access  Private/Admin
const getClubs = async (req, res) => {
  try {
    const clubs = await Club.find()
      .populate('ownerId', 'phone')
      .sort({ createdAt: -1 })
      .lean();

    const clubIds = clubs.map((c) => c._id);
    const playerCounts = await User.aggregate([
      { $match: { role: 'player', clubId: { $in: clubIds } } },
      { $group: { _id: '$clubId', count: { $sum: 1 } } },
    ]);
    const countByClubId = Object.fromEntries(
      playerCounts.map((p) => [String(p._id), p.count])
    );

    const clubsWithPlayers = clubs.map((club) => ({
      ...club,
      playerCount: countByClubId[String(club._id)] ?? 0,
    }));

    res.json(clubsWithPlayers);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Обновить клуб
// @route   PUT /api/admin/clubs/:id
// @access  Private/Admin
const updateClub = async (req, res) => {
  try {
    const { name, address, city, isActive, managerFio, latitude, longitude } = req.body;

    const club = await Club.findById(req.params.id);
    if (!club) {
      return res.status(404).json({ message: 'Клуб не найден' });
    }

    if (name) club.name = name;
    if (address !== undefined) club.address = address;
    if (city !== undefined) club.city = city;
    if (isActive !== undefined) club.isActive = isActive;
    if (managerFio !== undefined) club.managerFio = managerFio;
    if (latitude !== undefined) club.latitude = Number(latitude);
    if (longitude !== undefined) club.longitude = Number(longitude);

    await club.save();

    res.json(club);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Удалить клуб
// @route   DELETE /api/admin/clubs/:id
// @access  Private/Admin
const deleteClub = async (req, res) => {
  try {
    const club = await Club.findById(req.params.id);
    if (!club) {
      return res.status(404).json({ message: 'Клуб не найден' });
    }

    await club.deleteOne();

    res.json({ message: 'Клуб удален' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Получить всех пользователей (с количеством выигранных призов для игроков)
// @route   GET /api/admin/users
// @access  Private/Admin
const getUsers = async (req, res) => {
  try {
    const { role } = req.query;
    const matchStage = role ? { $match: { role } } : { $match: {} };

    const users = await User.aggregate([
      matchStage,
      { $sort: { createdAt: -1 } },
      {
        $lookup: {
          from: 'prizeclaims',
          localField: '_id',
          foreignField: 'userId',
          as: 'prizeClaims',
        },
      },
      {
        $addFields: {
          prizeCount: { $size: '$prizeClaims' },
        },
      },
      { $project: { prizeClaims: 0, password: 0 } },
      {
        $lookup: {
          from: 'clubs',
          localField: 'clubId',
          foreignField: '_id',
          as: 'clubId',
          pipeline: [{ $project: { name: 1 } }],
        },
      },
      { $unwind: { path: '$clubId', preserveNullAndEmptyArrays: true } },
    ]);

    res.json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Получить одного пользователя: профиль, визиты по клубам (когда, сколько раз), история баланса
// @route   GET /api/admin/users/:id
// @access  Private/Admin
const getUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'Пользователь не найден' });
    }

    const userObj = user.toObject();

    // Текущий клуб (если привязан)
    if (user.clubId) {
      const club = await Club.findById(user.clubId).select('name clubId address');
      userObj.club = club;
    } else {
      userObj.club = null;
    }

    // История посещений по клубам: из Spin — клуб, дата/время каждого визита, всего визитов
    const spins = await Spin.find({ userId: user._id })
      .sort({ createdAt: -1 })
      .populate('clubId', 'name clubId')
      .lean();

    const visitsByClub = {};
    for (const spin of spins) {
      const club = spin.clubId;
      if (!club || !club._id) continue;
      const cid = String(club._id);
      if (!visitsByClub[cid]) {
        visitsByClub[cid] = {
          clubId: club._id,
          clubName: club.name,
          clubSlug: club.clubId,
          visits: [],
          totalVisits: 0,
        };
      }
      visitsByClub[cid].visits.push({ createdAt: spin.createdAt });
      visitsByClub[cid].totalVisits += 1;
    }
    userObj.visitHistory = Object.values(visitsByClub).sort(
      (a, b) => b.totalVisits - a.totalVisits
    );

    // История баланса за всё время — все транзакции
    const transactions = await Transaction.find({ userId: user._id })
      .sort({ createdAt: -1 })
      .populate('relatedSpinId')
      .lean();
    userObj.balanceHistory = transactions;

    res.json(userObj);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Обновить пользователя
// @route   PUT /api/admin/users/:id
// @access  Private/Admin
const updateUser = async (req, res) => {
  try {
    const { balance, isActive, clubId } = req.body;

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'Пользователь не найден' });
    }

    if (balance !== undefined) {
      const oldBalance = user.balance;
      user.balance = balance;
      
      // Создаем транзакцию для изменения баланса
      await Transaction.create({
        userId: user._id,
        type: 'manual_adjustment',
        amount: balance - oldBalance,
        description: 'Ручная корректировка баланса администратором',
      });
    }
    if (isActive !== undefined) user.isActive = isActive;
    if (clubId !== undefined) user.clubId = clubId;

    await user.save();

    res.json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Удалить пользователя
// @route   DELETE /api/admin/users/:id
// @access  Private/Admin
const deleteUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'Пользователь не найден' });
    }

    await user.deleteOne();

    res.json({ message: 'Пользователь удален' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Создать приз
// @route   POST /api/admin/prizes
// @access  Private/Admin
const createPrize = async (req, res) => {
  try {
    const { name, description, type, value, dropChance, slotIndex, totalQuantity } = req.body;

    if (!name || !type || dropChance === undefined || slotIndex === undefined) {
      return res.status(400).json({ message: 'Не все обязательные поля заполнены' });
    }

    if (slotIndex < 0 || slotIndex > 24) {
      return res.status(400).json({ message: 'Индекс слота должен быть от 0 до 24' });
    }

    if (dropChance < 0 || dropChance > 100) {
      return res.status(400).json({ message: 'Вероятность должна быть от 0 до 100' });
    }

    // Проверка, что слот не занят
    const existingPrize = await Prize.findOne({ slotIndex, isActive: true });
    if (existingPrize) {
      return res.status(400).json({ message: 'Слот уже занят другим призом' });
    }

    // Получаем URL загруженного изображения
    const image = req.file ? req.file.location : null;

    const prize = await Prize.create({
      name,
      description,
      type,
      value,
      image,
      dropChance,
      slotIndex,
      totalQuantity: totalQuantity || null,
      remainingQuantity: totalQuantity || null,
    });

    res.status(201).json(prize);
  } catch (error) {
    // Если была загружена картинка, но произошла ошибка, удаляем её
    if (req.file && req.file.location) {
      await deleteFromS3(req.file.location);
    }
    res.status(500).json({ message: error.message });
  }
};

// @desc    Получить все призы
// @route   GET /api/admin/prizes
// @access  Private/Admin
const getPrizes = async (req, res) => {
  try {
    const prizes = await Prize.find().sort({ slotIndex: 1 });

    res.json(prizes);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Обновить приз
// @route   PUT /api/admin/prizes/:id
// @access  Private/Admin
const updatePrize = async (req, res) => {
  try {
    const { name, description, type, value, dropChance, slotIndex, isActive, totalQuantity } = req.body;

    const prize = await Prize.findById(req.params.id);
    if (!prize) {
      // Если была загружена новая картинка, удаляем её
      if (req.file && req.file.location) {
        await deleteFromS3(req.file.location);
      }
      return res.status(404).json({ message: 'Приз не найден' });
    }

    if (slotIndex !== undefined && slotIndex !== prize.slotIndex) {
      // Проверка, что новый слот не занят
      const existingPrize = await Prize.findOne({ slotIndex, isActive: true, _id: { $ne: prize._id } });
      if (existingPrize) {
        // Если была загружена новая картинка, удаляем её
        if (req.file && req.file.location) {
          await deleteFromS3(req.file.location);
        }
        return res.status(400).json({ message: 'Слот уже занят другим призом' });
      }
    }

    // Если загружено новое изображение
    if (req.file && req.file.location) {
      // Удаляем старое изображение из S3
      if (prize.image) {
        await deleteFromS3(prize.image);
      }
      prize.image = req.file.location;
    }

    if (name) prize.name = name;
    if (description !== undefined) prize.description = description;
    if (type) prize.type = type;
    if (value !== undefined) prize.value = value;
    if (dropChance !== undefined) prize.dropChance = dropChance;
    if (slotIndex !== undefined) prize.slotIndex = slotIndex;
    if (isActive !== undefined) prize.isActive = isActive === true || isActive === 'true';
    if (totalQuantity !== undefined) {
      prize.totalQuantity = totalQuantity;
      // Если уменьшаем общее количество, корректируем оставшееся
      if (totalQuantity !== null && prize.remainingQuantity > totalQuantity) {
        prize.remainingQuantity = totalQuantity;
      }
    }

    await prize.save();

    res.json(prize);
  } catch (error) {
    // Если была загружена картинка, но произошла ошибка, удаляем её
    if (req.file && req.file.location) {
      await deleteFromS3(req.file.location);
    }
    res.status(500).json({ message: error.message });
  }
};

// @desc    Удалить приз
// @route   DELETE /api/admin/prizes/:id
// @access  Private/Admin
const deletePrize = async (req, res) => {
  try {
    const prize = await Prize.findById(req.params.id);
    if (!prize) {
      return res.status(404).json({ message: 'Приз не найден' });
    }

    // Удаляем изображение из S3
    if (prize.image) {
      await deleteFromS3(prize.image);
    }

    await prize.deleteOne();

    res.json({ message: 'Приз удален' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Полная аналитика по городам: по каждому городу — кол-во клубов и детальные данные по каждому клубу
// @route   GET /api/admin/analytics/by-city
// @access  Private/Admin
const getAnalyticsByCity = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const spinQuery = {};
    if (startDate || endDate) {
      spinQuery.createdAt = {};
      if (startDate) spinQuery.createdAt.$gte = new Date(startDate);
      if (endDate) spinQuery.createdAt.$lte = new Date(endDate);
    }

    const clubs = await Club.find().populate('ownerId', 'phone').lean();
    const clubIds = clubs.map((c) => c._id);

    const [playerCounts, spinStats, prizeClaimCounts] = await Promise.all([
      User.aggregate([
        { $match: { role: 'player', clubId: { $in: clubIds } } },
        { $group: { _id: '$clubId', count: { $sum: 1 } } },
      ]),
      Spin.aggregate([
        ...(Object.keys(spinQuery).length ? [{ $match: spinQuery }] : []),
        { $group: { _id: '$clubId', count: { $sum: 1 }, totalSpent: { $sum: '$cost' } } },
      ]),
      PrizeClaim.aggregate([
        { $match: { clubId: { $in: clubIds } } },
        { $group: { _id: '$clubId', count: { $sum: 1 } } },
      ]),
    ]);

    const playerByClub = Object.fromEntries(playerCounts.map((p) => [String(p._id), p.count]));
    const spinByClub = Object.fromEntries(
      spinStats.map((s) => [String(s._id), { count: s.count, totalSpent: s.totalSpent }])
    );
    const claimsByClub = Object.fromEntries(prizeClaimCounts.map((c) => [String(c._id), c.count]));

    const clubsWithStats = clubs.map((club) => {
      const cid = String(club._id);
      const spinData = spinByClub[cid] || { count: 0, totalSpent: 0 };
      return {
        _id: club._id,
        name: club.name,
        clubId: club.clubId,
        address: club.address,
        city: club.city || '',
        managerFio: club.managerFio,
        isActive: club.isActive,
        ownerPhone: club.ownerId?.phone,
        playerCount: playerByClub[cid] ?? 0,
        spinsCount: spinData.count,
        totalSpent: spinData.totalSpent,
        prizeClaimsCount: claimsByClub[cid] ?? 0,
      };
    });

    const byCity = {};
    for (const c of clubsWithStats) {
      const cityName = (c.city && String(c.city).trim()) || 'Без города';
      if (!byCity[cityName]) {
        byCity[cityName] = { city: cityName, clubCount: 0, clubs: [], totalPlayers: 0, totalSpins: 0, totalSpent: 0 };
      }
      byCity[cityName].clubCount += 1;
      byCity[cityName].clubs.push(c);
      byCity[cityName].totalPlayers += c.playerCount;
      byCity[cityName].totalSpins += c.spinsCount;
      byCity[cityName].totalSpent += c.totalSpent;
    }

    const cities = Object.values(byCity).sort((a, b) => b.clubCount - a.clubCount);

    res.json({
      summary: {
        totalCities: cities.length,
        totalClubs: clubs.length,
      },
      byCity: cities,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Детальная аналитика по одному клубу
// @route   GET /api/admin/analytics/club/:id
// @access  Private/Admin
const getClubAnalytics = async (req, res) => {
  try {
    const club = await Club.findById(req.params.id).populate('ownerId', 'phone').lean();
    if (!club) {
      return res.status(404).json({ message: 'Клуб не найден' });
    }

    const [playerCount, spinStats, prizeClaimCount, recentSpins] = await Promise.all([
      User.countDocuments({ role: 'player', clubId: club._id }),
      Spin.aggregate([
        { $match: { clubId: club._id } },
        { $group: { _id: null, count: { $sum: 1 }, totalSpent: { $sum: '$cost' } } },
      ]).then((r) => r[0] || { count: 0, totalSpent: 0 }),
      PrizeClaim.countDocuments({ clubId: club._id }),
      Spin.find({ clubId: club._id })
        .populate('userId', 'phone')
        .populate('prizeId', 'name type')
        .sort({ createdAt: -1 })
        .limit(50)
        .lean(),
    ]);

    res.json({
      club: {
        _id: club._id,
        name: club.name,
        clubId: club.clubId,
        address: club.address,
        city: club.city || '',
        managerFio: club.managerFio,
        isActive: club.isActive,
        ownerPhone: club.ownerId?.phone,
      },
      analytics: {
        playerCount,
        spinsCount: spinStats.count,
        totalSpent: spinStats.totalSpent,
        prizeClaimsCount: prizeClaimCount,
      },
      recentSpins,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Получить аналитику
// @route   GET /api/admin/analytics
// @access  Private/Admin
const getAnalytics = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const query = {};

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const totalUsers = await User.countDocuments({ role: 'player' });
    const totalClubs = await Club.countDocuments();
    const totalSpins = await Spin.countDocuments(query);
    const totalPrizes = await Prize.countDocuments();
    
    const spins = await Spin.find(query).populate('prizeId', 'name type');
    const totalSpent = spins.reduce((sum, spin) => sum + spin.cost, 0);

    // Статистика по призам
    const prizeStats = await Spin.aggregate([
      { $match: query },
      { $group: { _id: '$prizeId', count: { $sum: 1 } } },
      { $lookup: { from: 'prizes', localField: '_id', foreignField: '_id', as: 'prize' } },
      { $unwind: '$prize' },
      { $project: { prizeName: '$prize.name', count: 1 } },
    ]);

    // Статистика по клубам
    const clubStats = await Spin.aggregate([
      { $match: query },
      { $group: { _id: '$clubId', count: { $sum: 1 } } },
      { $lookup: { from: 'clubs', localField: '_id', foreignField: '_id', as: 'club' } },
      { $unwind: '$club' },
      { $project: { clubName: '$club.name', count: 1 } },
    ]);

    res.json({
      totalUsers,
      totalPlayers: totalUsers,
      totalClubs,
      totalSpins,
      totalPrizes,
      totalSpent,
      prizeStats,
      clubStats,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Управление лимитами и фондом призов
// @route   PUT /api/admin/prize-fund
// @access  Private/Admin
const updatePrizeFund = async (req, res) => {
  try {
    const { prizeId, totalQuantity, remainingQuantity } = req.body;

    if (!prizeId) {
      return res.status(400).json({ message: 'ID приза обязателен' });
    }

    const prize = await Prize.findById(prizeId);
    if (!prize) {
      return res.status(404).json({ message: 'Приз не найден' });
    }

    if (totalQuantity !== undefined) {
      prize.totalQuantity = totalQuantity;
      if (remainingQuantity === undefined) {
        prize.remainingQuantity = totalQuantity;
      }
    }
    if (remainingQuantity !== undefined) {
      prize.remainingQuantity = remainingQuantity;
    }

    await prize.save();

    res.json(prize);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Получить логи
// @route   GET /api/admin/logs
// @access  Private/Admin
const getLogs = async (req, res) => {
  try {
    const { type, startDate, endDate } = req.query;
    const query = {};

    if (type) query.type = type;
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const transactions = await Transaction.find(query)
      .populate('userId', 'phone role')
      .populate('relatedSpinId')
      .sort({ createdAt: -1 })
      .limit(1000);

    const spins = await Spin.find(query)
      .populate('userId', 'phone')
      .populate('clubId', 'name')
      .populate('prizeId', 'name')
      .sort({ createdAt: -1 })
      .limit(1000);

    res.json({
      transactions,
      spins,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  loginAdmin,
  createClub,
  getClubs,
  updateClub,
  deleteClub,
  getUsers,
  getUserById,
  updateUser,
  deleteUser,
  createPrize,
  getPrizes,
  updatePrize,
  deletePrize,
  getAnalytics,
  getAnalyticsByCity,
  getClubAnalytics,
  updatePrizeFund,
  getLogs,
};
