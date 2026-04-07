const User = require('../models/User');
const Club = require('../models/Club');
const Transaction = require('../models/Transaction');
const generateToken = require('../utils/generateToken');
const { attachReferrer, ensureUserReferralCode } = require('../utils/referralService');
const APPLICATION_RECIPIENT_EMAIL = 'krutyev6@gmail.com';

// Приводим телефон к единому виду: +77771234567
const normalizePhone = (phone) => {
  if (!phone || typeof phone !== 'string') return '';
  const digits = phone.replace(/\D/g, '');
  if (!digits) return '';

  // Частый кейс локального ввода через 8XXXXXXXXXX -> +7XXXXXXXXXX
  if (digits.length === 11 && digits.startsWith('8')) {
    return `+7${digits.slice(1)}`;
  }
  return `+${digits}`;
};

// @desc    Вход. Тело только { phone, code }. Если пользователь есть — 200 + токен. Если нет — 404 + USER_NOT_FOUND (не создаём пользователя).
// @route   POST /api/auth/login
// @access  Public
const login = async (req, res) => {
  try {
    const { phone, code } = req.body;
    const normalizedPhone = normalizePhone(phone);

    if (!normalizedPhone || !code) {
      return res.status(400).json({ message: 'Телефон и код обязательны' });
    }

    // Проверка кода (пока всегда 0000)
    if (code !== '0000') {
      return res.status(401).json({ message: 'Неверный код' });
    }

    // Ищем пользователя. Если не найден — не создаём; бот запустит регистрацию (код друга → имя → register).
    const user = await User.findOne({
      phone: { $in: [normalizedPhone, String(phone || '').trim()] },
    });
    if (!user) {
      return res.status(404).json({
        message: 'Пользователь не найден. Зарегистрируйтесь.',
        code: 'USER_NOT_FOUND',
      });
    }

    // Проверка бана
    if (user.isBanned) {
      const now = new Date();
      if (user.banUntil && user.banUntil <= now) {
        // Срок бана истёк — автоматически разбаниваем
        user.isBanned = false;
        user.isActive = true;
        user.banUntil = null;
        user.banReason = '';
        await user.save();
      } else {
        return res.status(403).json({
          message: user.banUntil
            ? `Ваш аккаунт заблокирован до ${user.banUntil.toLocaleString('ru-RU')}`
            : 'Ваш аккаунт заблокирован бессрочно',
        });
      }
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

// @desc    Регистрация. Создание пользователя только здесь. Тело: { phone, code, name, ref? }. После проверки кода создаём пользователя, при необходимости привязываем ref, возвращаем токен и данные.
// @route   POST /api/auth/register
// @access  Public
const register = async (req, res) => {
  try {
    const { phone, code, name, ref: refPayload } = req.body;
    const normalizedPhone = normalizePhone(phone);

    if (!normalizedPhone || !code) {
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
    const userExists = await User.findOne({
      phone: { $in: [normalizedPhone, String(phone || '').trim()] },
    });
    if (userExists) {
      return res.status(400).json({ message: 'Пользователь с таким телефоном уже существует' });
    }

    // Создание пользователя
    const user = await User.create({
      phone: normalizedPhone,
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

    await ensureUserReferralCode(user);
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

const buildRowsFromPayload = (payload, parentKey = '') => {
  if (payload === null || payload === undefined) {
    return [{ key: parentKey || 'value', value: String(payload) }];
  }

  if (Array.isArray(payload)) {
    if (payload.length === 0) {
      return [{ key: parentKey || 'array', value: '[]' }];
    }
    return payload.flatMap((item, index) => {
      const key = parentKey ? `${parentKey}[${index}]` : `[${index}]`;
      return buildRowsFromPayload(item, key);
    });
  }

  if (typeof payload === 'object') {
    const entries = Object.entries(payload);
    if (entries.length === 0) {
      return [{ key: parentKey || 'object', value: '{}' }];
    }
    return entries.flatMap(([key, value]) => {
      const nestedKey = parentKey ? `${parentKey}.${key}` : key;
      return buildRowsFromPayload(value, nestedKey);
    });
  }

  return [{ key: parentKey || 'value', value: String(payload) }];
};

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const sendApplicationByEmail = async (req, res) => {
  try {
    const { title, payload, source } = req.body || {};
    const resendApiKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.RESEND_FROM_EMAIL;

    if (!resendApiKey || !fromEmail) {
      return res.status(500).json({
        message: 'Не настроены переменные RESEND_API_KEY и RESEND_FROM_EMAIL',
      });
    }

    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({
        message: 'Поле payload обязательно и должно быть объектом или массивом',
      });
    }

    const rows = buildRowsFromPayload(payload);
    const tableRowsHtml = rows
      .map(
        (row) =>
          `<tr><td style="padding:8px;border:1px solid #ddd;font-weight:600;">${escapeHtml(row.key)}</td><td style="padding:8px;border:1px solid #ddd;">${escapeHtml(row.value)}</td></tr>`
      )
      .join('');

    const safeTitle = title && String(title).trim() ? String(title).trim() : 'Новая заявка';
    const safeSource = source && String(source).trim() ? String(source).trim() : 'Не указан';
    const now = new Date().toLocaleString('ru-RU');

    const html = `
      <div style="font-family:Arial,sans-serif;line-height:1.4;">
        <h2>${escapeHtml(safeTitle)}</h2>
        <p><strong>Источник:</strong> ${escapeHtml(safeSource)}</p>
        <p><strong>Время:</strong> ${escapeHtml(now)}</p>
        <table style="border-collapse:collapse;width:100%;max-width:900px;">
          <thead>
            <tr>
              <th style="padding:8px;border:1px solid #ddd;text-align:left;background:#f3f4f6;">Поле</th>
              <th style="padding:8px;border:1px solid #ddd;text-align:left;background:#f3f4f6;">Значение</th>
            </tr>
          </thead>
          <tbody>
            ${tableRowsHtml}
          </tbody>
        </table>
      </div>
    `;

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [APPLICATION_RECIPIENT_EMAIL],
        subject: `[Заявка] ${safeTitle}`,
        html,
      }),
    });

    const responseData = await response.json();
    if (!response.ok) {
      return res.status(502).json({
        message: 'Не удалось отправить заявку на почту',
        details: responseData,
      });
    }

    return res.status(200).json({
      message: 'Заявка успешно отправлена',
      emailId: responseData.id,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

module.exports = {
  login,
  register,
  sendApplicationByEmail,
};
