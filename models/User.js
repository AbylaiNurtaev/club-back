const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  phone: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  name: {
    type: String,
    trim: true,
    default: '',
  },
  password: {
    type: String,
    required: true,
  },
  role: {
    type: String,
    enum: ['player', 'club', 'admin'],
    default: 'player',
  },
  balance: {
    type: Number,
    default: 0,
  },
  clubId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Club',
    default: null,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  isBanned: {
    type: Boolean,
    default: false,
  },
  banUntil: {
    type: Date,
    default: null,
  },
  banReason: {
    type: String,
    trim: true,
    default: '',
  },
  /** Кто пригласил (реферер). Один раз, не перезаписывается. */
  referrerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  /** Уникальный 6-значный реферальный код (делится с друзьями). */
  referralCode: {
    type: String,
    unique: true,
    sparse: true,
    trim: true,
    minlength: 6,
    maxlength: 6,
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Хеширование пароля перед сохранением
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) {
    return next();
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Метод для сравнения паролей
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
