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
  /** Палитра клуба для фронта */
  theme: {
    primary: { type: String, trim: true },
    primaryDark: { type: String, trim: true },
    accent: { type: String, trim: true },
  },
  /** Тема страницы QR рулетки (hex/rgba строки). Фронт мержит с дефолтом. */
  qrPageTheme: {
    pageBg: { type: String, trim: true },
    spinContainerBg: { type: String, trim: true },
    spinnerLabel: { type: String, trim: true },
    spinnerValue: { type: String, trim: true },
    pointer: { type: String, trim: true },
    trackBg: { type: String, trim: true },
    cardBg: { type: String, trim: true },
    cardBorder: { type: String, trim: true },
    cardText: { type: String, trim: true },
    cardPlaceholderBg: { type: String, trim: true },
    selectedCardBorder: { type: String, trim: true },
    winsChatBg: { type: String, trim: true },
    winsChatText: { type: String, trim: true },
    fullscreenBtnBg: { type: String, trim: true },
    fullscreenBtnText: { type: String, trim: true },
    fullscreenBtnBorder: { type: String, trim: true },
    resultOverlayBg: { type: String, trim: true },
    resultContentBg: { type: String, trim: true },
    resultTitle: { type: String, trim: true },
    resultPrizeText: { type: String, trim: true },
    loadingText: { type: String, trim: true },
    retryBtnBg: { type: String, trim: true },
    retryBtnText: { type: String, trim: true },
  },
  /** Фон страницы QR (изображение/видео из S3). url — ссылка, opacity 0–1. */
  qrPageBackground: {
    url: { type: String, trim: true },
    opacity: { type: Number, min: 0, max: 1 },
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('Club', clubSchema);
