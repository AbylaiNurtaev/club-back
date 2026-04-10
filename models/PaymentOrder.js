const mongoose = require('mongoose');

const paymentOrderSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  // Уникальный идентификатор заказа — передаётся в TipTop Pay как externalId/InvoiceId
  externalId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  // Пакет баллов
  points: {
    type: Number,
    required: true,
  },
  // Сумма в тенге
  amountKzt: {
    type: Number,
    required: true,
  },
  status: {
    type: String,
    enum: ['pending', 'paid', 'failed'],
    default: 'pending',
  },
  // Номер транзакции TipTop Pay (приходит в webhook)
  tiptopTransactionId: {
    type: String,
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    // Автоматически удалять незавершённые заказы через 2 часа
    expires: 60 * 60 * 2,
  },
  paidAt: {
    type: Date,
    default: null,
  },
});

module.exports = mongoose.model('PaymentOrder', paymentOrderSchema);
