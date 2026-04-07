const express = require('express');
const router = express.Router();
const { login, register, sendApplicationByEmail } = require('../controllers/authController');

// Публичные роуты
router.post('/login', login);
router.post('/register', register);
router.post('/submit-request', sendApplicationByEmail);

module.exports = router;
