/**
 * Последние 10 выигрышей по всем клубам для отображения на экранах.
 * Формат сообщения: "+7 771 *** 3738 выиграл Название приза"
 */

const MAX_RECENT = 10;
const recentWins = [];

function maskPhone(phone) {
  if (!phone || typeof phone !== 'string') return '+7 *** *** **';
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '+7 *** *** **';
  const after7 = digits.startsWith('7') || digits.startsWith('8') ? digits.slice(1) : digits;
  const first = after7.slice(0, 3);
  const last = after7.slice(-4);
  return `+7 ${first} *** ${last}`;
}

function addRecentWin(phone, prizeName) {
  const masked = maskPhone(phone);
  const text = `${masked} выиграл ${prizeName || 'Приз'}`;
  recentWins.push({ maskedPhone: masked, prizeName: prizeName || 'Приз', text });
  if (recentWins.length > MAX_RECENT) recentWins.shift();
  return recentWins.slice();
}

function getRecentWins() {
  return recentWins.slice();
}

module.exports = {
  maskPhone,
  addRecentWin,
  getRecentWins,
};
