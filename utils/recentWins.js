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

/**
 * @param {string} phone - телефон игрока
 * @param {string} prizeName - название приза
 * @param {string} [playerName] - имя игрока
 * @param {string|Object} [userId] - id игрока (для подстановки имени по списку клуба)
 */
function addRecentWin(phone, prizeName, playerName, userId) {
  const masked = maskPhone(phone);
  const prize = prizeName || 'Приз';
  const text = `${masked} выиграл ${prize}`;
  const nameStr = (playerName && String(playerName).trim()) ? String(playerName).trim() : '';
  const playerId = nameStr ? { name: nameStr } : (userId ? { id: userId } : undefined);
  recentWins.push({
    prizeName: prize,
    maskedPhone: masked,
    text,
    ...(nameStr && { name: nameStr, playerName: nameStr }),
    ...(playerId && { playerId }),
  });
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
