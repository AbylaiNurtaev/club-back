const express = require('express');
const router = express.Router();
const {
  createClub,
  getClubs,
  updateClub,
  deleteClub,
  getUsers,
  getUserById,
  updateUser,
  deleteUser,
  banUser,
  unbanUser,
  createPrize,
  getPrizes,
  updatePrize,
  deletePrize,
  getAnalytics,
  getAnalyticsByCity,
  getClubAnalytics,
  updatePrizeFund,
  getLogs,
  getCompanyLogo,
  upsertCompanyLogo,
  deleteCompanyLogo,
} = require('../controllers/adminController');
const { protect, authorize } = require('../middleware/auth');
const { upload, uploadToS3 } = require('../utils/s3Upload');

// Публичные роуты (удалены, используйте /api/auth/login)

// Все роуты требуют авторизации и роли admin
router.use(protect);
router.use(authorize('admin'));

// Управление клубами
router.post('/clubs', createClub);
router.get('/clubs', getClubs);
router.put('/clubs/:id', updateClub);
router.delete('/clubs/:id', deleteClub);

// Управление пользователями
router.get('/users', getUsers);
router.get('/users/:id', getUserById);
router.put('/users/:id', updateUser);
router.delete('/users/:id', deleteUser);
router.post('/users/:id/ban', banUser);
router.post('/users/:id/unban', unbanUser);

// Управление призами
router.post('/prizes', upload.single('image'), uploadToS3, createPrize);
router.get('/prizes', getPrizes);
router.put('/prizes/:id', upload.single('image'), uploadToS3, updatePrize);
router.delete('/prizes/:id', deletePrize);

// Аналитика и управление
router.get('/analytics', getAnalytics);
router.get('/analytics/by-city', getAnalyticsByCity);
router.get('/analytics/club/:id', getClubAnalytics);
router.put('/prize-fund', updatePrizeFund);
router.get('/logs', getLogs);

// Логотип компании
router.get('/company/logo', getCompanyLogo);
router.post('/company/logo', upload.single('image'), uploadToS3, upsertCompanyLogo);
router.delete('/company/logo', deleteCompanyLogo);

module.exports = router;
