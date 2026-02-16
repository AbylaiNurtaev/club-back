const express = require('express');
const router = express.Router();
const {
  getMe,
  getBalance,
  getTransactions,
  getClubByQR,
  getRecentWinsHandler,
  spin,
  spinByPhone,
  getPrizes,
  getRoulettePrizes,
  attachClub,
} = require('../controllers/playerController');
const { protect } = require('../middleware/auth');

// Публичные роуты (club_id можно передать в path или в query ?club=)
router.get('/club-by-qr/:qrToken', getClubByQR);
router.get('/club', getClubByQR);
router.get('/recent-wins', getRecentWinsHandler);
router.get('/roulette-prizes', getRoulettePrizes);
router.post('/spin-by-phone', spinByPhone);

// Защищенные роуты
router.get('/me', protect, getMe);
router.get('/balance', protect, getBalance);
router.get('/transactions', protect, getTransactions);
router.get('/prizes', protect, getPrizes);
router.post('/spin', protect, spin);
router.post('/attach-club', protect, attachClub);

module.exports = router;
