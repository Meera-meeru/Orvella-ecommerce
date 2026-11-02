const session = require('express-session');
const MongoStore = require('connect-mongo');
const appConfig = require('./appConfig');

module.exports = session({
  name: 'shoply.user.sid',
  secret: appConfig.sessionSecret,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: appConfig.mongoUri,
    collectionName: 'customerSessions',
    ttl: 60 * 60 * 24 * 7
  }),
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
});
