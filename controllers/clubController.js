const User = require('../models/User');
const Club = require('../models/Club');
const Spin = require('../models/Spin');
const PrizeClaim = require('../models/PrizeClaim');
const Transaction = require('../models/Transaction');
const generateToken = require('../utils/generateToken');
const QRCode = require('qrcode');
const { deleteFromS3 } = require('../utils/s3Upload');

// @desc    Регистрация клуба (только админ)
// @route   POST /api/clubs/register
// @access  Private/Admin
const registerClub = async (req, res) => {
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

    // Проверка существования пользователя с таким телефоном
    let owner = await User.findOne({ phone });
    
    if (!owner) {
      // Создаем пользователя-владельца клуба
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

    // Генерируем уникальный clubId
    const clubId = `club_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Уникальный 6-значный код для ввода на телефоне (если нет QR)
    let pinCode;
    for (let i = 0; i < 20; i++) {
      pinCode = String(Math.floor(100000 + Math.random() * 900000));
      const exists = await Club.findOne({ pinCode });
      if (!exists) break;
    }
    if (!pinCode) pinCode = String(Date.now()).slice(-6);

    // Создаем клуб
    const club = await Club.create({
      name,
      ownerId: owner._id,
      clubId,
      pinCode,
      latitude: lat,
      longitude: lng,
      address,
      city: city || '',
      managerFio: managerFio || undefined,
    });

    // Генерируем QR-код
    const qrData = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/spin?club=${club.qrToken}`;
    const qrCode = await QRCode.toDataURL(qrData);

    club.qrCode = qrCode;
    await club.save();

    res.status(201).json({
      club: {
        _id: club._id,
        name: club.name,
        clubId: club.clubId,
        qrToken: club.qrToken,
        pinCode: club.pinCode,
        qrCode: club.qrCode,
        latitude: club.latitude,
        longitude: club.longitude,
        address: club.address,
        city: club.city,
        managerFio: club.managerFio,
      },
      owner: {
        _id: owner._id,
        phone: owner.phone,
        token: generateToken(owner._id),
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Получить информацию о клубе
// @route   GET /api/clubs/me
// @access  Private/Club
const getMyClub = async (req, res) => {
  try {
    const club = await Club.findOne({ ownerId: req.user._id })
      .populate('ownerId', 'phone');

    if (!club) {
      return res.status(404).json({ message: 'Клуб не найден' });
    }

    // Для старых клубов без pinCode — сгенерировать при первом заходе
    if (!club.pinCode) {
      let pinCode;
      for (let i = 0; i < 20; i++) {
        pinCode = String(Math.floor(100000 + Math.random() * 900000));
        const exists = await Club.findOne({ pinCode });
        if (!exists) break;
      }
      if (pinCode) {
        club.pinCode = pinCode;
        await club.save();
      }
    }

    res.json(club);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Ключи темы страницы QR (для валидации и мержа)
const QR_PAGE_THEME_KEYS = [
  'pageBg', 'spinContainerBg', 'spinnerLabel', 'spinnerValue', 'pointer', 'trackBg',
  'cardBg', 'cardBorder', 'cardText', 'cardPlaceholderBg', 'selectedCardBorder',
  'winsChatBg', 'winsChatText', 'fullscreenBtnBg', 'fullscreenBtnText', 'fullscreenBtnBorder',
  'resultOverlayBg', 'resultContentBg', 'resultTitle', 'resultPrizeText',
  'loadingText', 'retryBtnBg', 'retryBtnText',
];

// @desc    Обновить тему текущего клуба (PATCH /clubs/me)
// @route   PATCH /api/clubs/me
// @access  Private/Club
const updateMyClubTheme = async (req, res) => {
  try {
    const club = await Club.findOne({ ownerId: req.user._id });
    if (!club) {
      return res.status(404).json({ message: 'Клуб не найден' });
    }
    const { theme, qrPageTheme } = req.body;

    if (theme !== undefined && theme !== null) {
      club.theme = {
        primary: theme.primary != null ? String(theme.primary).trim() : undefined,
        primaryDark: theme.primaryDark != null ? String(theme.primaryDark).trim() : undefined,
        accent: theme.accent != null ? String(theme.accent).trim() : undefined,
      };
    }

    if (qrPageTheme !== undefined && qrPageTheme !== null && typeof qrPageTheme === 'object') {
      club.qrPageTheme = club.qrPageTheme || {};
      for (const key of QR_PAGE_THEME_KEYS) {
        if (qrPageTheme[key] != null) {
          club.qrPageTheme[key] = String(qrPageTheme[key]).trim();
        }
      }
    }

    if (req.body.qrPageBackground !== undefined) {
      if (req.body.qrPageBackground === null) {
        if (club.qrPageBackground && club.qrPageBackground.url) {
          try { await deleteFromS3(club.qrPageBackground.url); } catch (e) { /* ignore */ }
        }
        club.qrPageBackground = undefined;
      } else if (req.body.qrPageBackground && typeof req.body.qrPageBackground === 'object') {
        const { url, opacity } = req.body.qrPageBackground;
        if (url === '' || url === null || url === undefined) {
          if (club.qrPageBackground && club.qrPageBackground.url) {
            try { await deleteFromS3(club.qrPageBackground.url); } catch (e) { /* ignore */ }
          }
          club.qrPageBackground = undefined;
        } else {
          const newUrl = String(url).trim();
          if (club.qrPageBackground && club.qrPageBackground.url && club.qrPageBackground.url !== newUrl) {
            try { await deleteFromS3(club.qrPageBackground.url); } catch (e) { /* ignore */ }
          }
          club.qrPageBackground = club.qrPageBackground || {};
          club.qrPageBackground.url = newUrl;
          if (opacity != null && !Number.isNaN(Number(opacity))) {
            club.qrPageBackground.opacity = Math.max(0, Math.min(1, Number(opacity)));
          }
        }
      }
    }

    await club.save();
    res.json(club);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Загрузить фон страницы QR (изображение/видео в S3)
// @route   POST /api/clubs/me/qr-background
// @access  Private/Club
// Body: multipart/form-data, поле "file" — PNG, GIF, MP4, WebM, макс. 10 МБ
const uploadQrBackground = async (req, res) => {
  try {
    if (!req.file || !req.file.location) {
      return res.status(400).json({ message: 'Отправьте файл в поле file (PNG, GIF, MP4 или WebM, макс. 10 МБ)' });
    }
    res.status(200).json({ url: req.file.location });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Получить всех игроков клуба (кто крутил рулетку этого клуба)
// @route   GET /api/clubs/players
// @access  Private/Club
const getClubPlayers = async (req, res) => {
  try {
    const club = await Club.findOne({ ownerId: req.user._id });

    if (!club) {
      return res.status(404).json({ message: 'Клуб не найден' });
    }

    const spinUserIds = await Spin.distinct('userId', { clubId: club._id });
    if (spinUserIds.length === 0) {
      return res.json([]);
    }

    const players = await User.find({ _id: { $in: spinUserIds }, role: 'player' })
      .select('phone balance createdAt')
      .sort({ createdAt: -1 });

    res.json(players);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Получить статистику игроков (по спинам в этом клубе)
// @route   GET /api/clubs/players/stats
// @access  Private/Club
const getPlayersStats = async (req, res) => {
  try {
    const club = await Club.findOne({ ownerId: req.user._id });

    if (!club) {
      return res.status(404).json({ message: 'Клуб не найден' });
    }

    const totalPlayers = await Spin.distinct('userId', { clubId: club._id }).then((ids) => ids.length);

    const spins = await Spin.find({ clubId: club._id });
    const totalSpins = spins.length;
    const totalSpent = spins.reduce((sum, spin) => sum + (spin.cost || 0), 0);

    res.json({
      totalPlayers,
      totalSpins,
      totalSpent,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Получить заявки на призы (с пагинацией)
// @route   GET /api/clubs/prize-claims
// @access  Private/Club
// @query   page — страница (default: 1), limit — на странице (default: 20, max: 100)
const getPrizeClaims = async (req, res) => {
  try {
    const club = await Club.findOne({ ownerId: req.user._id });
    
    if (!club) {
      return res.status(404).json({ message: 'Клуб не найден' });
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const [claims, total] = await Promise.all([
      PrizeClaim.find({ clubId: club._id })
        .populate('userId', 'phone')
        .populate('prizeId', 'name description type value')
        .populate('spinId', 'createdAt')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      PrizeClaim.countDocuments({ clubId: club._id }),
    ]);

    res.json({
      items: claims,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Подтвердить выдачу физического приза
// @route   PUT /api/clubs/prize-claims/:claimId/confirm
// @access  Private/Club
const confirmPrizeClaim = async (req, res) => {
  try {
    const { claimId } = req.params;
    const { notes } = req.body;

    const club = await Club.findOne({ ownerId: req.user._id });
    
    if (!club) {
      return res.status(404).json({ message: 'Клуб не найден' });
    }

    const claim = await PrizeClaim.findOne({ 
      _id: claimId, 
      clubId: club._id 
    });

    if (!claim) {
      return res.status(404).json({ message: 'Заявка не найдена' });
    }

    claim.status = 'confirmed';
    claim.confirmedBy = req.user._id;
    claim.confirmedAt = new Date();
    if (notes) claim.notes = notes;

    await claim.save();

    res.json({ message: 'Приз подтвержден', claim });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Управление временем в клубе
// @route   PUT /api/clubs/prize-claims/:claimId/club-time
// @access  Private/Club
const manageClubTime = async (req, res) => {
  try {
    const { claimId } = req.params;
    const { action } = req.body; // 'activate' или 'complete'

    const club = await Club.findOne({ ownerId: req.user._id });
    
    if (!club) {
      return res.status(404).json({ message: 'Клуб не найден' });
    }

    const claim = await PrizeClaim.findOne({ 
      _id: claimId, 
      clubId: club._id,
      'prizeId.type': 'club_time',
    });

    if (!claim) {
      return res.status(404).json({ message: 'Заявка на время в клубе не найдена' });
    }

    if (action === 'activate') {
      claim.status = 'confirmed';
      claim.confirmedBy = req.user._id;
      claim.confirmedAt = new Date();
    } else if (action === 'complete') {
      claim.status = 'completed';
    }

    await claim.save();

    res.json({ message: 'Время в клубе обновлено', claim });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Получить отчеты по активности
// @route   GET /api/clubs/reports
// @access  Private/Club
const getReports = async (req, res) => {
  try {
    const club = await Club.findOne({ ownerId: req.user._id });
    
    if (!club) {
      return res.status(404).json({ message: 'Клуб не найден' });
    }

    const { startDate, endDate } = req.query;
    const query = { clubId: club._id };

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const spins = await Spin.find(query)
      .populate('userId', 'phone')
      .populate('prizeId', 'name description type value image slotIndex');
    const claims = await PrizeClaim.find(query)
      .populate('prizeId', 'name type value');

    res.json({
      spins,
      claims,
      totalSpins: spins.length,
      totalClaims: claims.length,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Количество спинов за сегодня для текущего клуба
// @route   GET /api/clubs/spins-today
// @access  Private/Club
const getSpinsToday = async (req, res) => {
  try {
    const club = await Club.findOne({ ownerId: req.user._id });

    if (!club) {
      return res.status(404).json({ message: 'Клуб не найден' });
    }

    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);

    const spinsToday = await Spin.countDocuments({
      clubId: club._id,
      createdAt: { $gte: startOfDay, $lte: endOfDay },
    });

    res.json({
      date: startOfDay.toISOString().slice(0, 10),
      spinsToday,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Регистрация/вход для клуба
// @route   POST /api/clubs/login
// @access  Public
const loginClub = async (req, res) => {
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
      return res.status(401).json({ message: 'Пользователь не найден' });
    }

    if (user.role !== 'club') {
      return res.status(403).json({ message: 'Доступ запрещен' });
    }

    const club = await Club.findOne({ ownerId: user._id });

    res.json({
      _id: user._id,
      phone: user.phone,
      role: user.role,
      club: club,
      token: generateToken(user._id),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  registerClub,
  getMyClub,
  updateMyClubTheme,
  uploadQrBackground,
  getClubPlayers,
  getPlayersStats,
  getPrizeClaims,
  confirmPrizeClaim,
  manageClubTime,
  getReports,
  getSpinsToday,
  loginClub,
};
