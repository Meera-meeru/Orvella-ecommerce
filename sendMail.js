const nodemailer = require('nodemailer');
const ejs = require('ejs');
const path = require('path');
const emailConfig = require('./config/emailConfig');

const isConfigured = () => emailConfig.user && emailConfig.appPassword &&
  !emailConfig.user.startsWith('YOUR_') && !emailConfig.appPassword.startsWith('PASTE_');

const createTransporter = () => {
  if (!isConfigured()) {
    throw new Error('Email is not configured. Add your Gmail address and Gmail App Password in config/emailConfig.js.');
  }
  return nodemailer.createTransport({
    service: emailConfig.service,
    auth: { user: emailConfig.user, pass: emailConfig.appPassword }
  });
};

async function sendMail(email, otp, name) {
  const transporter = createTransporter();
  const html = await ejs.renderFile(path.join(__dirname, 'views', 'emails', 'otp.ejs'), {
    name: name || 'Orvella customer', otp, expiryMinutes: 5
  });
  await transporter.sendMail({
    from: `Orvella <${emailConfig.user}>`,
    to: email,
    subject: 'Your Orvella email verification code',
    text: `Your Orvella verification code is ${otp}. It expires in 5 minutes. Do not share this code.`,
    html
  });
}

sendMail.sendPasswordReset = async (email, resetUrl) => {
  const transporter = createTransporter();
  await transporter.sendMail({
    from: `Orvella <${emailConfig.user}>`,
    to: email,
    subject: 'Reset your Orvella password',
    text: `Use this link to reset your Orvella password. It expires in 30 minutes: ${resetUrl}`,
    html: `<p>We received a request to reset your Orvella password.</p><p><a href="${resetUrl}">Reset password</a></p><p>This link expires in 30 minutes. Ignore this email if you did not request a reset.</p>`
  });
};

module.exports = sendMail;
