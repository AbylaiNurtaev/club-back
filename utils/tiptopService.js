const crypto = require('crypto');

const API_KEY = process.env.TIP_TOP_API_KEY;

/**
 * Пакеты пополнения: id → { points, amountKzt, label }
 * Цена указана в тенге (KZT).
 */
const TOPUP_PACKAGES = [
  { id: 'pack_50',  points: 50,  amountKzt: 500,  label: '50 баллов — 500 ₸' },
  { id: 'pack_150', points: 150, amountKzt: 1200, label: '150 баллов — 1 200 ₸' },
  { id: 'pack_300', points: 300, amountKzt: 2000, label: '300 баллов — 2 000 ₸' },
];

/**
 * Найти пакет по id.
 * @param {string} id
 * @returns {{ id, points, amountKzt, label } | undefined}
 */
function getPackageById(id) {
  return TOPUP_PACKAGES.find((p) => p.id === id);
}

/**
 * Проверка HMAC подписи входящего уведомления от TipTop Pay.
 * TipTop отправляет заголовок X-Content-HMAC (HMAC-SHA256 тела запроса, base64).
 *
 * @param {string} rawBody  — сырое тело запроса (строка)
 * @param {string} signature — значение заголовка X-Content-HMAC
 * @returns {boolean}
 */
function verifyTiptopHmac(rawBody, signature) {
  if (!API_KEY) {
    console.warn('[tiptop] TIP_TOP_API_KEY не задан — проверка HMAC пропущена');
    return true;
  }
  if (!signature) return false;

  const expected = crypto
    .createHmac('sha256', API_KEY)
    .update(rawBody, 'utf8')
    .digest('base64');

  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

module.exports = { TOPUP_PACKAGES, getPackageById, verifyTiptopHmac };
