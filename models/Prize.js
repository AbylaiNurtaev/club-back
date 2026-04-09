const mongoose = require('mongoose');

const prizeSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  description: {
    type: String,
  },
  type: {
    type: String,
    enum: ['balance', 'points', 'product', 'other'],
    required: true,
  },
  /** ID товара в SmartShell (entity_id для GOOD); обязателен для type === 'product' */
  productEntityId: {
    type: Number,
    default: null,
  },
  value: {
    type: Number, // Сумма начисления (баланс/баллы), количество для товара (шт.), для other не используется
  },
  image: {
    type: String, // URL изображения
  },
  backgroundImage: {
    type: String, // URL фона картинкой (задаётся в админке)
  },
  dropChance: {
    type: Number, // Процент выпадения (0–100), число с плавающей точкой
    required: true,
    default: 0,
  },
  slotIndex: {
    type: Number, // Индекс слота в рулетке (0-34)
    required: true,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  totalQuantity: {
    type: Number, // Общее количество призов (null = безлимит)
    default: null,
  },
  remainingQuantity: {
    type: Number, // Оставшееся количество
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('Prize', prizeSchema);
