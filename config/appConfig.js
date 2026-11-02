const crypto = require('crypto');

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret && process.env.NODE_ENV === 'production') {
  throw new Error('Set SESSION_SECRET using the hosting platform secret manager before starting in production.');
}

module.exports = {
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/user',
  sessionSecret: sessionSecret || crypto.randomBytes(32).toString('hex'),
  publicBaseUrl: process.env.APP_BASE_URL || 'http://localhost:3000',
  port: Number(process.env.PORT) || 3000
};
