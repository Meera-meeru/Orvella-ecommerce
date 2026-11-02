const appConfig = require('./appConfig');

module.exports = {
  clientId: process.env.GOOGLE_CLIENT_ID || '',
  clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  redirectUri: new URL('/auth/google/callback', appConfig.publicBaseUrl).toString()
};
