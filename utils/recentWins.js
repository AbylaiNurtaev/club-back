/**
 * Последние 10 выигрышей по клубу для отображения на экранах.
 * Формат сообщения: "+7 771 *** 3738 выиграл Название приза"
 */

const MAX_RECENT = 10;
const recentByClub = new Map();

function maskPhone(phone) {
  if (!phone || typeof phone !== 'string') return '+7 *** *** **';
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '+7 *** *** **';
  const after7 = digits.startsWith('7') || digits.startsWith('8') ? digits.slice(1) : digits;
  const first = after7.slice(0, 3);
  const last = after7.slice(-4);
  return `+7 ${first} *** ${last}`;
}

function addRecentWin(clubId, phone, prizeName) {
  const key = String(clubId);
  const list = recentByClub.get(key) || [];
  const masked = maskPhone(phone);
  const text = `${masked} выиграл ${prizeName || 'Приз'}`;
  list.push({ maskedPhone: masked, prizeName: prizeName || 'Приз', text });
  if (list.length > MAX_RECENT) list.shift();
  recentByClub.set(key, list);
  return list;
}

function getRecentWins(clubId) {
  const key = String(clubId);
  const list = recentByClub.get(key) || [];
  return list.slice(-MAX_RECENT);
}

module.exports = {
  maskPhone,
  addRecentWin,
  getRecentWins,
};
