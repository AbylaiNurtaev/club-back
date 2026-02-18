const User = require('../models/User');
const Referral = require('../models/Referral');
const Transaction = require('../models/Transaction');

const REFERRAL_POINTS = Number(process.env.REFERRAL_POINTS) || 50;
const REFERRAL_MAX_PER_MONTH = Number(process.env.REFERRAL_MAX_PER_MONTH) || 20;

/**
 * Реферальная ссылка: https://t.me/<bot>?start=ref_<userId>
 * payload из Telegram = "ref_<userId>" (24 hex ObjectId).
 * Возвращает User реферера или null.
 */
async function resolveRefPayload(refPayload) {
  if (!refPayload || typeof refPayload !== 'string') return null;
  const s = refPayload.trim();
  if (!s.startsWith('ref_')) return null;
  const userId = s.slice(4);
  if (!userId || userId.length !== 24) return null;
  const user = await User.findById(userId);
  return user;
}

/**
 * Привязать реферера к новому пользователю (только если ещё нет referrerId).
 * Антифрод: self-referral запрещён, один реферер на пользователя.
 * Создаёт запись Referral со status 'pending'.
 */
async function attachReferrer(referredUser, refPayload) {
  if (!referredUser || referredUser.referrerId) return false;
  const referrer = await resolveRefPayload(refPayload);
  if (!referrer) return false;
  if (referrer._id.toString() === referredUser._id.toString()) return false; // self-referral
  referredUser.referrerId = referrer._id;
  await referredUser.save();
  await Referral.findOneAndUpdate(
    { referrerId: referrer._id, referredUserId: referredUser._id },
    { $setOnInsert: { referrerId: referrer._id, referredUserId: referredUser._id, status: 'pending' } },
    { upsert: true }
  );
  return true;
}

/**
 * Вызвать после успешного платного спина. Если это первый платный спин пользователя
 * и у него есть реферер — одобряем реферал и начисляем баллы (с учётом лимита 20/месяц).
 */
async function tryApproveReferral(referredUserId) {
  const user = await User.findById(referredUserId);
  if (!user || !user.referrerId) return;

  const paidSpinsCount = await require('../models/Spin').countDocuments({
    userId: referredUserId,
    cost: { $gt: 0 },
  });
  if (paidSpinsCount !== 1) return; // только за первый платный спин

  const referral = await Referral.findOne({
    referrerId: user.referrerId,
    referredUserId: referredUserId,
    status: 'pending',
  });
  if (!referral) return;

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const approvedThisMonth = await Referral.countDocuments({
    referrerId: user.referrerId,
    status: 'approved',
    approvedAt: { $gte: startOfMonth },
  });
  if (approvedThisMonth >= REFERRAL_MAX_PER_MONTH) return;

  referral.status = 'approved';
  referral.approvedAt = now;
  referral.pointsAwarded = REFERRAL_POINTS;
  await referral.save();

  const referrer = await User.findById(user.referrerId);
  if (referrer) {
    referrer.balance = (referrer.balance || 0) + REFERRAL_POINTS;
    await referrer.save();
    await Transaction.create({
      userId: referrer._id,
      type: 'referral_bonus',
      amount: REFERRAL_POINTS,
      description: 'Бонус за приглашённого друга (1-й спин)',
    });
  }
}

function getReferralCode(userId) {
  return `ref_${userId}`;
}

function getReferralLink(userId) {
  const bot = process.env.TELEGRAM_BOT_USERNAME;
  if (!bot) return null;
  return `https://t.me/${bot.replace(/^@/, '')}?start=ref_${userId}`;
}

module.exports = {
  REFERRAL_POINTS,
  REFERRAL_MAX_PER_MONTH,
  resolveRefPayload,
  attachReferrer,
  tryApproveReferral,
  getReferralCode,
  getReferralLink,
};
