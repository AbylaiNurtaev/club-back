# PC Backend - Платформа компьютерных клубов с рулеткой

Backend система для управления компьютерными клубами с системой рулетки и призов.

## Технологии

- Node.js
- Express.js
- MongoDB (Mongoose)
- JWT для аутентификации
- QRCode для генерации QR-кодов

## Установка

1. Установите зависимости:
```bash
npm install
```

2. Создайте файл `.env` на основе `.env.example`:
```bash
PORT=3000
MONGO_URI=your-mongodb-connection-string
JWT_SECRET=your-secret-key
NODE_ENV=development
FRONTEND_URL=http://localhost:3000
AWS_ACCESS_KEY=your-aws-access-key
AWS_SECRET_KEY=your-aws-secret-key
AWS_BUCKET_NAME=your-bucket-name
AWS_S3_REGION=your-region
```

3. Запустите сервер:
```bash
npm run dev
```

## Структура проекта

```
pc-back/
├── config/
│   └── database.js          # Подключение к MongoDB
├── controllers/
│   ├── adminController.js   # Контроллеры для администратора
│   ├── clubController.js    # Контроллеры для клубов
│   └── playerController.js  # Контроллеры для игроков
├── middleware/
│   └── auth.js              # Middleware для аутентификации
├── models/
│   ├── User.js              # Модель пользователя
│   ├── Club.js              # Модель клуба
│   ├── Prize.js             # Модель приза
│   ├── Spin.js              # Модель спина
│   ├── Transaction.js       # Модель транзакции
│   └── PrizeClaim.js        # Модель заявки на приз
├── routes/
│   ├── adminRoutes.js       # Роуты администратора
│   ├── clubRoutes.js        # Роуты клубов
│   └── playerRoutes.js      # Роуты игроков
├── utils/
│   ├── generateToken.js     # Генерация JWT токена
│   └── roulette.js          # Логика рулетки
├── server.js                # Основной файл сервера
└── package.json
```

## Роли пользователей

### Игрок (Player)
- Регистрация и авторизация по телефону (код: 0000)
- Получение 10 баллов при регистрации
- Прокрутка рулетки за 20 баллов
- Просмотр баланса и истории транзакций
- Просмотр выигранных призов
- Сканирование QR-кода клуба

### Клуб (Club)
- Личный кабинет
- Просмотр игроков клуба
- Статистика игроков
- Подтверждение выдачи физических призов
- Управление временем в клубе
- Просмотр отчетов

### Администратор (Admin)
- Управление клубами (создание, редактирование, удаление)
- Управление пользователями
- Создание и управление призами (до 25 слотов)
- Настройка процента выпадения призов
- Просмотр аналитики
- Управление лимитами и фондом призов
- Просмотр логов

## API Endpoints

### Аутентификация (единый вход для всех ролей)

**POST /api/auth/login** - Вход для всех ролей (игрок, клуб, админ)
```json
// Request
{ "phone": "+79991234567", "code": "0000" }

// Response (для игрока)
{
  "_id": "...",
  "phone": "+79991234567",
  "balance": 10,
  "role": "player",
  "clubId": null,
  "token": "jwt_token"
}

// Response (для клуба)
{
  "_id": "...",
  "phone": "+79991234567",
  "role": "club",
  "club": { "name": "Клуб", "clubId": "club_123" },
  "token": "jwt_token"
}

// Response (для админа)
{
  "_id": "...",
  "phone": "+79991234567",
  "role": "admin",
  "token": "jwt_token"
}
```

**POST /api/auth/register** - Регистрация игрока (опционально)
```json
// Request
{ "phone": "+79991234567", "code": "0000" }

// Response
{
  "_id": "...",
  "phone": "+79991234567",
  "balance": 10,
  "role": "player",
  "token": "jwt_token"
}
```

### Игроки

**POST /api/players/register** - Регистрация игрока (устаревший, используйте /api/auth/login)
```json
// Request
{ "phone": "+79991234567", "code": "0000" }

// Response
{
  "_id": "...",
  "phone": "+79991234567",
  "balance": 10,
  "role": "player",
  "token": "jwt_token"
}
```

**POST /api/players/login** - Авторизация игрока (устаревший, используйте /api/auth/login)

**GET /api/players/me** - Информация о текущем игроке
```json
// Headers: Authorization: Bearer {token}
// Response
{
  "_id": "...",
  "phone": "+79991234567",
  "balance": 10,
  "role": "player",
  "clubId": { "name": "Клуб", "clubId": "club_123" }
}
```

**GET /api/players/balance** - Баланс игрока
```json
// Response
{ "balance": 10 }
```

**GET /api/players/transactions** - История транзакций
```json
// Response
[
  {
    "_id": "...",
    "type": "registration_bonus",
    "amount": 10,
    "description": "Бонус за регистрацию",
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
]
```

**Сценарий: QR → рулетка → списание 20 баллов**
1. Пользователь сканирует QR клуба → на фронте открывается страница с `club_id` (в URL: `?club=...` или path).
2. Фронт вызывает **GET /api/players/club** с `?club=<club_id>` (или **GET /api/players/club-by-qr/:qrToken**) — получает данные клуба и показывает рулетку.
3. Игрок крутит рулетку → фронт вызывает **POST /api/players/spin** с заголовком `Authorization: Bearer <token>` и телом `{ "clubId": "<club_id или qrToken>" }`. Бэкенд списывает **20 баллов** с баланса и возвращает выпавший приз и новый баланс.

**GET /api/players/club-by-qr/:qrToken** или **GET /api/players/club?club=...** — получить клуб по club_id / qrToken / clubId (для страницы после скана QR)
```json
// Response
{
  "_id": "...",
  "name": "Клуб",
  "clubId": "club_123",
  "qrToken": "uuid_token"
}
```

**GET /api/players/roulette-prizes** - Получить все призы для рулетки
```json
// Response
[
  {
    "_id": "...",
    "name": "100 баллов",
    "description": "Описание",
    "type": "points",
    "value": 100,
    "image": "https://bucket.s3.region.amazonaws.com/prizes/uuid.jpg",
    "dropChance": 10,
    "slotIndex": 0
  }
]
```

**POST /api/players/spin** - Прокрутить рулетку
```json
// Request
{ "clubId": "club_id" }

// Response
{
  "spin": {
    "_id": "...",
    "prize": {
      "_id": "...",
      "name": "100 баллов",
      "description": "Описание",
      "type": "points",
      "value": 100,
      "image": "https://bucket.s3.region.amazonaws.com/prizes/uuid.jpg",
      "slotIndex": 0
    },
    "cost": 20,
    "createdAt": "2024-01-01T00:00:00.000Z"
  },
  "newBalance": 90
}
```

**GET /api/players/prizes** - Выигранные призы
```json
// Response
[
  {
    "_id": "...",
    "prizeId": { "name": "Приз", "type": "physical" },
    "clubId": { "name": "Клуб" },
    "status": "pending",
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
]
```

**POST /api/players/attach-club** - Привязать к клубу
```json
// Request
{ "clubId": "club_id" }

// Response
{ "message": "Игрок привязан к клубу", "clubId": "club_id" }
```

### Клубы

**POST /api/clubs/login** - Авторизация клуба (устаревший, используйте /api/auth/login)

**GET /api/clubs/me** - Информация о клубе
```json
// Response
{
  "_id": "...",
  "name": "Клуб",
  "clubId": "club_123",
  "qrToken": "uuid_token",
  "qrCode": "data:image/png;base64,...",
  "address": "Адрес"
}
```

**GET /api/clubs/players** - Игроки клуба
```json
// Response
[
  {
    "_id": "...",
    "phone": "+79991234567",
    "balance": 10,
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
]
```

**GET /api/clubs/players/stats** - Статистика игроков
```json
// Response
{
  "totalPlayers": 50,
  "totalSpins": 200,
  "totalSpent": 4000
}
```

**GET /api/clubs/prize-claims** - Заявки на призы
```json
// Response
[
  {
    "_id": "...",
    "userId": { "phone": "+79991234567" },
    "prizeId": { "name": "Приз", "type": "physical" },
    "status": "pending",
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
]
```

**PUT /api/clubs/prize-claims/:claimId/confirm** - Подтвердить приз
```json
// Request
{ "notes": "Выдан" }

// Response
{
  "message": "Приз подтвержден",
  "claim": { "status": "confirmed", ... }
}
```

**PUT /api/clubs/prize-claims/:claimId/club-time** - Управление временем в клубе
```json
// Request
{ "action": "activate" }

// Response
{
  "message": "Время в клубе обновлено",
  "claim": { "status": "confirmed", ... }
}
```

**GET /api/clubs/reports** - Отчеты по активности
```json
// Query: ?startDate=2024-01-01&endDate=2024-01-31
// Response
{
  "spins": [...],
  "claims": [...],
  "totalSpins": 200,
  "totalClaims": 50
}
```

### Администратор

**POST /api/admin/login** - Авторизация администратора (устаревший, используйте /api/auth/login)

**POST /api/admin/clubs** - Создать клуб
```json
// Request
{ "name": "Клуб", "phone": "+79991234567", "address": "Адрес" }

// Response
{
  "_id": "...",
  "name": "Клуб",
  "clubId": "club_123",
  "qrToken": "uuid_token",
  "qrCode": "data:image/png;base64,..."
}
```

**GET /api/admin/clubs** - Все клубы
```json
// Response
[
  {
    "_id": "...",
    "name": "Клуб",
    "ownerId": { "phone": "+79991234567" },
    "isActive": true
  }
]
```

**PUT /api/admin/clubs/:id** - Обновить клуб
```json
// Request
{ "name": "Новое название", "isActive": false }

// Response
{ "_id": "...", "name": "Новое название", "isActive": false, ... }
```

**DELETE /api/admin/clubs/:id** - Удалить клуб
```json
// Response
{ "message": "Клуб удален" }
```

**GET /api/admin/users** - Все пользователи
```json
// Query: ?role=player
// Response
[
  {
    "_id": "...",
    "phone": "+79991234567",
    "role": "player",
    "balance": 10,
    "clubId": { "name": "Клуб" }
  }
]
```

**PUT /api/admin/users/:id** - Обновить пользователя
```json
// Request
{ "balance": 100, "isActive": true }

// Response
{ "_id": "...", "balance": 100, "isActive": true, ... }
```

**DELETE /api/admin/users/:id** - Удалить пользователя
```json
// Response
{ "message": "Пользователь удален" }
```

**POST /api/admin/prizes** - Создать приз
```json
// Request (multipart/form-data)
// Поля: name, description, type, value, dropChance, slotIndex, totalQuantity
// Файл: image (jpeg, jpg, png, gif, webp, макс. 5MB)

// Response
{
  "_id": "...",
  "name": "100 баллов",
  "type": "points",
  "value": 100,
  "dropChance": 10,
  "slotIndex": 0,
  "image": "https://bucket.s3.region.amazonaws.com/prizes/uuid.jpg",
  "remainingQuantity": 100
}
```

**GET /api/admin/prizes** - Все призы
```json
// Response
[
  {
    "_id": "...",
    "name": "100 баллов",
    "type": "points",
    "dropChance": 10,
    "slotIndex": 0,
    "isActive": true
  }
]
```

**PUT /api/admin/prizes/:id** - Обновить приз
```json
// Request (multipart/form-data)
// Поля: name, description, type, value, dropChance, slotIndex, isActive, totalQuantity
// Файл (опционально): image (jpeg, jpg, png, gif, webp, макс. 5MB)

// Response
{ "_id": "...", "dropChance": 15, "isActive": false, "image": "https://...", ... }
```

**DELETE /api/admin/prizes/:id** - Удалить приз
```json
// Response
{ "message": "Приз удален" }
```

**GET /api/admin/analytics** - Аналитика
```json
// Query: ?startDate=2024-01-01&endDate=2024-01-31
// Response
{
  "totalUsers": 1000,
  "totalClubs": 50,
  "totalSpins": 5000,
  "totalPrizes": 25,
  "totalSpent": 100000,
  "prizeStats": [
    { "prizeName": "100 баллов", "count": 500 }
  ],
  "clubStats": [
    { "clubName": "Клуб", "count": 100 }
  ]
}
```

**PUT /api/admin/prize-fund** - Управление фондом призов
```json
// Request
{ "prizeId": "prize_id", "totalQuantity": 200, "remainingQuantity": 150 }

// Response
{
  "_id": "...",
  "totalQuantity": 200,
  "remainingQuantity": 150
}
```

**GET /api/admin/logs** - Логи
```json
// Query: ?type=spin_cost&startDate=2024-01-01
// Response
{
  "transactions": [
    {
      "_id": "...",
      "type": "spin_cost",
      "amount": -20,
      "userId": { "phone": "+79991234567" }
    }
  ],
  "spins": [
    {
      "_id": "...",
      "userId": { "phone": "+79991234567" },
      "clubId": { "name": "Клуб" },
      "prizeId": { "name": "Приз" }
    }
  ]
}
```

## Механика работы

1. Игрок регистрируется по телефону с кодом 0000
2. При регистрации получает 10 баллов
3. Игрок сканирует QR-код клуба
4. При прокрутке рулетки списывается 20 баллов
5. Система выбирает приз на основе вероятностей
6. Приз фиксируется в контексте клуба
7. Клуб подтверждает выдачу физических призов

## Типы призов

- `physical` - Физический приз (требует подтверждения клубом)
- `points` - Баллы (начисляются автоматически)
- `club_time` - Время в клубе (управляется клубом)
- `other` - Другие типы призов

## Загрузка изображений

Система поддерживает загрузку изображений призов в AWS S3. 

**Требования:**
- Форматы: JPEG, JPG, PNG, GIF, WEBP
- Максимальный размер: 5MB
- Поле для загрузки: `image` (multipart/form-data)

**При создании/обновлении приза:**
- Изображение автоматически загружается в S3
- URL изображения сохраняется в поле `image` приза
- При обновлении изображения старое автоматически удаляется из S3
- При удалении приза изображение также удаляется из S3
