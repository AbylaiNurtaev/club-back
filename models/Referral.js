const mongoose = require('mongoose');

const referralSchema = new mongoose.Schema({
  referrerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  referredUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  status: {
    type: String,
    enum: ['pending', 'approved'],
    default: 'pending',
  },
  approvedAt: { type: Date },
  pointsAwarded: { type: Number, default: 0 },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

referralSchema.index({ referrerId: 1, referredUserId: 1 }, { unique: true });
referralSchema.index({ referrerId: 1, status: 1, approvedAt: 1 });

module.exports = mongoose.model('Referral', referralSchema);
