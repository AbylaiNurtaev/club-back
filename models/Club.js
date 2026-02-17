const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const clubSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  ownerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  clubId: {
    type: String,
    unique: true,
    required: true,
  },
  qrToken: {
    type: String,
    unique: true,
    required: true,
    default: () => uuidv4(),
  },
  /** Код из 6 цифр для ввода на телефоне, если нет QR (уникальный) */
  pinCode: {
    type: String,
    unique: true,
    sparse: true,
    trim: true,
    match: /^\d{6}$/,
  },
  qrCode: {
    type: String, // Base64 или URL QR-кода
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  address: {
    type: String,
  },
  city: {
    type: String,
    trim: true,
    default: '',
  },
  /** Геолокация клуба (для проверки дистанции перед спином) */
  latitude: { type: Number },
  longitude: { type: Number },
  managerFio: {
    type: String,
    trim: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('Club', clubSchema);
