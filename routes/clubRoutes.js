const express = require('express');
const router = express.Router();
const {
  registerClub,
  getMyClub,
  updateMyClubTheme,
  uploadQrBackground,
  getClubPlayers,
  getClubPlayersByClubId,
  getPlayersStats,
  getPrizeClaims,
  confirmPrizeClaim,
  manageClubTime,
  getReports,
  getSpinsToday,
} = require('../controllers/clubController');
const { protect, authorize } = require('../middleware/auth');
const { uploadQrBackground: multerQrBg, uploadQrBackgroundToS3 } = require('../utils/s3Upload');

// Защищенные роуты для клубов
router.get('/me', protect, authorize('club', 'admin'), getMyClub);
router.patch('/me', protect, authorize('club', 'admin'), updateMyClubTheme);
router.post('/me/qr-background', protect, authorize('club', 'admin'), multerQrBg.single('file'), uploadQrBackgroundToS3, uploadQrBackground);
router.get('/players', protect, authorize('club', 'admin'), getClubPlayers);
router.get('/players/stats', protect, authorize('club', 'admin'), getPlayersStats);
// Публичный: список игроков клуба по clubId (для подстановки имён в spin/recentWins)
router.get('/:clubId/players', getClubPlayersByClubId);
router.get('/prize-claims', protect, authorize('club', 'admin'), getPrizeClaims);
router.put('/prize-claims/:claimId/confirm', protect, authorize('club', 'admin'), confirmPrizeClaim);
router.put('/prize-claims/:claimId/club-time', protect, authorize('club', 'admin'), manageClubTime);
router.get('/reports', protect, authorize('club', 'admin'), getReports);
router.get('/spins-today', protect, authorize('club', 'admin'), getSpinsToday);

// Роуты только для админа
router.post('/register', protect, authorize('admin'), registerClub);

module.exports = router;
