const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Защита роутов - проверка токена
const protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = await User.findById(decoded.id).select('-password');
      
      if (!req.user) {
        return res.status(401).json({ message: 'Пользователь не найден' });
      }

      // Проверка бана пользователя
      if (req.user.isBanned) {
        const now = new Date();
        if (req.user.banUntil && req.user.banUntil <= now) {
          // Срок бана истёк — автоматически разбаниваем
          req.user.isBanned = false;
          req.user.isActive = true;
          req.user.banUntil = null;
          req.user.banReason = '';
          await req.user.save();
        } else {
          return res.status(403).json({
            message: req.user.banUntil
              ? `Аккаунт заблокирован до ${req.user.banUntil.toLocaleString('ru-RU')}`
              : 'Аккаунт заблокирован бессрочно',
          });
        }
      }

      next();
    } catch (error) {
      return res.status(401).json({ message: 'Не авторизован, токен недействителен' });
    }
  } else {
    return res.status(401).json({ message: 'Не авторизован, нет токена' });
  }
};

// Проверка роли
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ 
        message: `Роль ${req.user.role} не имеет доступа к этому ресурсу` 
      });
    }
    next();
  };
};

module.exports = { protect, authorize };
