// Runs before any module is imported in each test file, so src/config/env.ts sees test values.
process.env.NODE_ENV = 'test';
process.env.MONGO_URI = process.env.MONGO_URI_TEST ?? 'mongodb://127.0.0.1:27017/myfinance-test';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.JWT_ACCESS_SECRET = 'test-secret-that-is-definitely-longer-than-32-chars';
// Fast hashing keeps the suite quick; production uses the default cost.
process.env.BCRYPT_ROUNDS = '4';
process.env.AUTH_RATE_LIMIT_MAX = '1000';
