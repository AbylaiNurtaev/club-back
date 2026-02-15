const Prize = require('../models/Prize');

// Функция для выбора приза на основе вероятностей
const spinRoulette = async () => {
  try {
    // Получаем только призы, участвующие в рулетке (isActive: true)
    const prizes = await Prize.find({ isActive: true }).sort({ slotIndex: 1 });

    if (prizes.length === 0) {
      throw new Error('Нет активных призов в системе');
    }

    // Исключаем призы с нулевым остатком (если задан лимит)
    const availablePrizes = prizes.filter(
      (p) => p.totalQuantity === null || p.totalQuantity === undefined || p.remainingQuantity > 0
    );
    const pool = availablePrizes.length > 0 ? availablePrizes : prizes;

    const totalChance = pool.reduce((sum, prize) => sum + (prize.dropChance || 0), 0);
    if (totalChance <= 0) {
      return pool[0];
    }

    // Случайное число в диапазоне [0, totalChance), чтобы вероятности были пропорциональны
    const random = Math.random() * totalChance;

    let cumulativeChance = 0;
    for (const prize of pool) {
      cumulativeChance += prize.dropChance || 0;
      if (random < cumulativeChance) {
        return prize;
      }
    }

    return pool[pool.length - 1];
  } catch (error) {
    throw error;
  }
};

module.exports = { spinRoulette };
