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
