const express = require('express');
const router = express.Router();
const {
  getPackages,
  createOrder,
  webhookCheck,
  webhookPay,
  webhookFail,
  getOrderStatus,
} = require('../controllers/paymentController');
const { protect } = require('../middleware/auth');

// Публичные: пакеты (не требуют авторизации — можно показывать до входа)
router.get('/packages', getPackages);

// Webhook от TipTop Pay (публичный, проверяется HMAC внутри контроллера)
router.post('/tiptop/check', webhookCheck);
router.post('/tiptop/pay',   webhookPay);
router.post('/tiptop/fail',  webhookFail);

// Защищённые: создать заказ и проверить его статус
router.post('/create-order',         protect, createOrder);
router.get('/order/:externalId',     protect, getOrderStatus);

module.exports = router;
