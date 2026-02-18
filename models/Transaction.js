const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  type: {
    type: String,
    enum: ['registration_bonus', 'spin_cost', 'prize_points', 'prize_club_time', 'manual_adjustment', 'referral_bonus'],
    required: true,
  },
  amount: {
    type: Number,
    required: true,
  },
  description: {
    type: String,
  },
  relatedSpinId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Spin',
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('Transaction', transactionSchema);
