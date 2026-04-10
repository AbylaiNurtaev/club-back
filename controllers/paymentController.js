const { v4: uuidv4 } = require('uuid');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const PaymentOrder = require('../models/PaymentOrder');
const { TOPUP_PACKAGES, getPackageById, verifyTiptopHmac } = require('../utils/tiptopService');

// ─── GET /api/payments/packages ──────────────────────────────────────────────
// Список доступных пакетов пополнения баланса
const getPackages = (req, res) => {
  res.json({ packages: TOPUP_PACKAGES });
};

// ─── POST /api/payments/create-order ─────────────────────────────────────────
// Создать заказ и вернуть параметры для запуска виджета TipTop Pay
// Body: { packageId }
const createOrder = async (req, res) => {
  try {
    const { packageId } = req.body;
    if (!packageId) {
      return res.status(400).json({ message: 'Не указан packageId' });
    }

    const pkg = getPackageById(packageId);
    if (!pkg) {
      return res.status(400).json({ message: 'Неверный packageId' });
    }

    const userId = req.user._id;
    const externalId = uuidv4();

    await PaymentOrder.create({
      userId,
      externalId,
      points: pkg.points,
      amountKzt: pkg.amountKzt,
      status: 'pending',
    });

    // Параметры, которые фронтенд передаёт в виджет TipTop Pay
    res.status(201).json({
      externalId,
      widgetParams: {
        publicTerminalId: process.env.TIP_TOP_PUBLIC_KEY,
        amount: pkg.amountKzt,
        currency: 'KZT',
        culture: 'ru-RU',
        description: pkg.label,
        externalId,
        userInfo: {
          accountId: String(userId),
        },
      },
    });
  } catch (err) {
    console.error('[payment] createOrder error:', err);
    res.status(500).json({ message: 'Внутренняя ошибка сервера' });
  }
};

// ─── POST /api/payments/tiptop/check ─────────────────────────────────────────
// TipTop Pay: Check-уведомление (перед списанием)
// Проверяем, что заказ существует и не просрочен
const webhookCheck = async (req, res) => {
  try {
    const rawBody = req.rawBody || JSON.stringify(req.body);
    const signature = req.headers['x-content-hmac'] || req.headers['content-hmac'];

    if (!verifyTiptopHmac(rawBody, signature)) {
      console.warn('[tiptop/check] Неверная HMAC подпись');
      return res.json({ code: 13 });
    }

    const invoiceId = req.body.InvoiceId;
    if (!invoiceId) {
      return res.json({ code: 10 });
    }

    const order = await PaymentOrder.findOne({ externalId: invoiceId });
    if (!order) {
      return res.json({ code: 10 }); // неверный номер заказа
    }
    if (order.status !== 'pending') {
      return res.json({ code: 13 }); // уже обработан
    }

    return res.json({ code: 0 });
  } catch (err) {
    console.error('[tiptop/check] error:', err);
    return res.json({ code: 13 });
  }
};

// ─── POST /api/payments/tiptop/pay ───────────────────────────────────────────
// TipTop Pay: Pay-уведомление (оплата прошла успешно)
// Пополняем баланс пользователя
const webhookPay = async (req, res) => {
  try {
    const rawBody = req.rawBody || JSON.stringify(req.body);
    const signature = req.headers['x-content-hmac'] || req.headers['content-hmac'];

    if (!verifyTiptopHmac(rawBody, signature)) {
      console.warn('[tiptop/pay] Неверная HMAC подпись');
      return res.json({ code: 0 }); // отвечаем 0, но не зачисляем
    }

    const { InvoiceId, TransactionId, Amount, Status } = req.body;

    if (!InvoiceId) {
      return res.json({ code: 0 });
    }

    // Идемпотентность: ищем по externalId
    const order = await PaymentOrder.findOne({ externalId: InvoiceId });
    if (!order) {
      console.warn(`[tiptop/pay] Заказ не найден: externalId=${InvoiceId}`);
      return res.json({ code: 0 });
    }

    if (order.status === 'paid') {
      // Уже обработан — просто подтверждаем
      return res.json({ code: 0 });
    }

    // Проверяем статус платежа
    if (Status !== 'Completed' && Status !== 'Authorized') {
      console.warn(`[tiptop/pay] Неожиданный статус: ${Status}, заказ ${InvoiceId}`);
      order.status = 'failed';
      await order.save();
      return res.json({ code: 0 });
    }

    // Зачисляем баллы пользователю
    const user = await User.findById(order.userId);
    if (!user) {
      console.error(`[tiptop/pay] Пользователь не найден: userId=${order.userId}`);
      return res.json({ code: 0 });
    }

    user.balance += order.points;
    await user.save();

    order.status = 'paid';
    order.tiptopTransactionId = String(TransactionId || '');
    order.paidAt = new Date();
    await order.save();

    await Transaction.create({
      userId: user._id,
      type: 'top_up',
      amount: order.points,
      description: `Пополнение баланса: ${order.points} баллов за ${order.amountKzt} ₸ (TipTop #${TransactionId})`,
    });

    console.log(`[tiptop/pay] Зачислено ${order.points} баллов пользователю ${user.phone}`);
    return res.json({ code: 0 });
  } catch (err) {
    console.error('[tiptop/pay] error:', err);
    return res.json({ code: 0 });
  }
};

// ─── POST /api/payments/tiptop/fail ──────────────────────────────────────────
// TipTop Pay: Fail-уведомление (оплата отклонена)
const webhookFail = async (req, res) => {
  try {
    const rawBody = req.rawBody || JSON.stringify(req.body);
    const signature = req.headers['x-content-hmac'] || req.headers['content-hmac'];

    if (!verifyTiptopHmac(rawBody, signature)) {
      console.warn('[tiptop/fail] Неверная HMAC подпись');
      return res.json({ code: 0 });
    }

    const { InvoiceId, Reason } = req.body;
    if (InvoiceId) {
      await PaymentOrder.updateOne(
        { externalId: InvoiceId, status: 'pending' },
        { status: 'failed' }
      );
      console.log(`[tiptop/fail] Заказ ${InvoiceId} отклонён: ${Reason}`);
    }

    return res.json({ code: 0 });
  } catch (err) {
    console.error('[tiptop/fail] error:', err);
    return res.json({ code: 0 });
  }
};

// ─── GET /api/payments/order/:externalId ─────────────────────────────────────
// Проверка статуса заказа фронтендом (поллинг после оплаты)
const getOrderStatus = async (req, res) => {
  try {
    const order = await PaymentOrder.findOne({
      externalId: req.params.externalId,
      userId: req.user._id,
    }).select('externalId status points amountKzt paidAt');

    if (!order) {
      return res.status(404).json({ message: 'Заказ не найден' });
    }

    res.json({ order });
  } catch (err) {
    console.error('[payment] getOrderStatus error:', err);
    res.status(500).json({ message: 'Внутренняя ошибка сервера' });
  }
};

module.exports = {
  getPackages,
  createOrder,
  webhookCheck,
  webhookPay,
  webhookFail,
  getOrderStatus,
};
