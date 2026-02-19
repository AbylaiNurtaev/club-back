const crypto = require('crypto');
const mongoose = require('mongoose');
const User = require('../models/User');
const Referral = require('../models/Referral');
const Transaction = require('../models/Transaction');
const Spin = require('../models/Spin');

const REFERRAL_POINTS = Number(process.env.REFERRAL_POINTS) || 5;
const REFERRAL_MAX_PER_MONTH = Number(process.env.REFERRAL_MAX_PER_MONTH) || 20;

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // без 0,O,1,I,L — меньше путаницы
const CODE_LENGTH = 6;

function generateRandomCode() {
  let code = '';
  const bytes = crypto.randomBytes(CODE_LENGTH);
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_CHARS[bytes[i] % CODE_CHARS.length];
  }
  return code;
}

/**
 * Создать уникальный 6-значный реферальный код. При коллизии — повторить.
 */
async function generateUniqueReferralCode() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateRandomCode();
    const exists = await User.exists({ referralCode: code });
    if (!exists) return code;
  }
  throw new Error('Не удалось сгенерировать уникальный реферальный код');
}

/**
 * Убедиться, что у пользователя есть referralCode; при отсутствии — сгенерировать и сохранить.
 * Возвращает 6-значный код (строка).
 */
async function ensureUserReferralCode(user) {
  if (user.referralCode) return user.referralCode;
  const code = await generateUniqueReferralCode();
  user.referralCode = code;
  await user.save();
  return code;
}

/**
 * Найти реферера по payload. Поддерживает:
 * - "ref_ABC123" (6-значный код) или "ref_<24 hex>" (старый userId для обратной совместимости);
 * - "ABC123" (только код, без префикса).
 * Возвращает User реферера или null.
 */
async function resolveRefPayload(refPayload) {
  if (!refPayload || typeof refPayload !== 'string') return null;
  const s = refPayload.trim().toUpperCase();
  if (!s) return null;

  let afterRef = null;
  if (s.startsWith('REF_')) {
    afterRef = s.slice(4);
  }

  if (afterRef !== null) {
    if (afterRef.length === 24 && /^[a-f0-9]+$/i.test(afterRef)) {
      const user = await User.findById(afterRef);
      return user;
    }
    if (afterRef.length === CODE_LENGTH) {
      return User.findOne({ referralCode: afterRef });
    }
    return null;
  }

  if (s.length === CODE_LENGTH) {
    return User.findOne({ referralCode: s });
  }
  return null;
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
const DEBUG_REFERRAL = process.env.DEBUG_REFERRAL === '1' || process.env.DEBUG_REFERRAL === 'true';

async function tryApproveReferral(referredUserId) {
  const refId = mongoose.Types.ObjectId.isValid(referredUserId) ? new mongoose.Types.ObjectId(referredUserId) : referredUserId;
  const user = await User.findById(refId).select('referrerId');
  if (!user) {
    if (DEBUG_REFERRAL) console.warn('[referral] tryApproveReferral: user not found', referredUserId);
    return;
  }
  if (!user.referrerId) {
    if (DEBUG_REFERRAL) console.warn('[referral] tryApproveReferral: no referrerId for user', referredUserId);
    return;
  }

  const paidSpinsCount = await Spin.countDocuments({
    userId: refId,
    cost: { $gt: 0 },
  });
  if (paidSpinsCount !== 1) {
    if (DEBUG_REFERRAL) console.warn('[referral] tryApproveReferral: paidSpinsCount !== 1', { referredUserId, paidSpinsCount });
    return;
  }

  const referral = await Referral.findOne({
    referrerId: user.referrerId,
    referredUserId: refId,
    status: 'pending',
  });
  if (!referral) {
    if (DEBUG_REFERRAL) console.warn('[referral] tryApproveReferral: no pending referral', { referredUserId, referrerId: user.referrerId });
    return;
  }

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const approvedThisMonth = await Referral.countDocuments({
    referrerId: user.referrerId,
    status: 'approved',
    approvedAt: { $gte: startOfMonth },
  });
  if (approvedThisMonth >= REFERRAL_MAX_PER_MONTH) {
    if (DEBUG_REFERRAL) console.warn('[referral] tryApproveReferral: monthly limit reached', { referrerId: user.referrerId, approvedThisMonth });
    return;
  }

  referral.status = 'approved';
  referral.approvedAt = now;
  referral.pointsAwarded = REFERRAL_POINTS;
  await referral.save();

  // Атомное начисление баллов (защита от гонки при одновременных первых спинах двух приглашённых)
  const referrer = await User.findByIdAndUpdate(
    user.referrerId,
    { $inc: { balance: REFERRAL_POINTS } },
    { new: true }
  );
  if (referrer) {
    await Transaction.create({
      userId: referrer._id,
      type: 'referral_bonus',
      amount: REFERRAL_POINTS,
      description: 'Бонус за приглашённого друга (1-й спин)',
    });
  }
}

/**
 * Получить 6-значный реферальный код пользователя (при отсутствии — сгенерировать).
 * @param {Object} user — документ User (с _id и опционально referralCode)
 */
async function getReferralCode(user) {
  const u = user.referralCode ? user : await User.findById(user._id || user);
  if (!u) return null;
  return ensureUserReferralCode(u);
}

/**
 * Получить реферальную ссылку (t.me/bot?start=ref_<код>).
 */
async function getReferralLink(user) {
  const bot = process.env.TELEGRAM_BOT_USERNAME;
  if (!bot) return null;
  const code = await getReferralCode(user);
  if (!code) return null;
  return `https://t.me/${bot.replace(/^@/, '')}?start=ref_${code}`;
}

module.exports = {
  REFERRAL_POINTS,
  REFERRAL_MAX_PER_MONTH,
  resolveRefPayload,
  attachReferrer,
  tryApproveReferral,
  ensureUserReferralCode,
  getReferralCode,
  getReferralLink,
};
