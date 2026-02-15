const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Настройка S3 клиента
const s3Client = new S3Client({
  region: process.env.AWS_S3_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY,
    secretAccessKey: process.env.AWS_SECRET_KEY,
  },
});

// Кастомное хранилище для multer с AWS SDK v3
const storage = multer.memoryStorage();

// Настройка multer
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
  fileFilter: function (req, file, cb) {
    // Разрешаем только изображения
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Разрешены только изображения (jpeg, jpg, png, gif, webp)'));
    }
  },
});

// Middleware для загрузки в S3
const uploadToS3 = async (req, res, next) => {
  if (!req.file) {
    return next();
  }

  try {
    const ext = path.extname(req.file.originalname);
    const filename = `prizes/${uuidv4()}${ext}`;

    const command = new PutObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: filename,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
      // ACL убран, так как bucket не поддерживает ACL
      // Публичный доступ должен быть настроен через bucket policy
    });

    await s3Client.send(command);

    // Сохраняем URL файла в req.file.location
    req.file.location = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_S3_REGION}.amazonaws.com/${filename}`;
    
    next();
  } catch (error) {
    console.error('Ошибка при загрузке в S3:', error);
    return res.status(500).json({ message: 'Ошибка при загрузке изображения' });
  }
};

// Функция для удаления файла из S3
const deleteFromS3 = async (imageUrl) => {
  try {
    if (!imageUrl) return;

    // Извлекаем ключ из URL
    // URL формат: https://bucket-name.s3.region.amazonaws.com/prizes/filename.ext
    const url = new URL(imageUrl);
    const key = url.pathname.substring(1); // Убираем первый слэш

    const command = new DeleteObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: key,
    });

    await s3Client.send(command);
    console.log(`Файл ${key} удален из S3`);
  } catch (error) {
    console.error('Ошибка при удалении файла из S3:', error);
  }
};

// Получить URL файла из S3
const getS3Url = (key) => {
  return `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_S3_REGION}.amazonaws.com/${key}`;
};

module.exports = {
  upload,
  uploadToS3,
  deleteFromS3,
  getS3Url,
  s3Client,
};
