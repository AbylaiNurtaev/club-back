const express = require('express');
const router = express.Router();
const { getCompanyLogo } = require('../controllers/adminController');

// Публичный эндпоинт — логотип компании (без авторизации)
router.get('/logo', getCompanyLogo);

module.exports = router;
