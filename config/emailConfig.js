module.exports = {
  service: 'gmail',
  user: process.env.EMAIL_USER || '',
  appPassword: process.env.EMAIL_APP_PASSWORD || ''
};
