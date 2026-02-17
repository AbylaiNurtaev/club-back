const express = require('express');
const router = express.Router();
const {
  registerClub,
  getMyClub,
  updateMyClubTheme,
  getClubPlayers,
  getPlayersStats,
  getPrizeClaims,
  confirmPrizeClaim,
  manageClubTime,
  getReports,
  getSpinsToday,
} = require('../controllers/clubController');
const { protect, authorize } = require('../middleware/auth');

// Публичные роуты (удалены, используйте /api/auth/login)

// Защищенные роуты для клубов
router.get('/me', protect, authorize('club', 'admin'), getMyClub);
router.patch('/me', protect, authorize('club', 'admin'), updateMyClubTheme);
router.get('/players', protect, authorize('club', 'admin'), getClubPlayers);
router.get('/players/stats', protect, authorize('club', 'admin'), getPlayersStats);
router.get('/prize-claims', protect, authorize('club', 'admin'), getPrizeClaims);
router.put('/prize-claims/:claimId/confirm', protect, authorize('club', 'admin'), confirmPrizeClaim);
router.put('/prize-claims/:claimId/club-time', protect, authorize('club', 'admin'), manageClubTime);
router.get('/reports', protect, authorize('club', 'admin'), getReports);
router.get('/spins-today', protect, authorize('club', 'admin'), getSpinsToday);

// Роуты только для админа
router.post('/register', protect, authorize('admin'), registerClub);

module.exports = router;
