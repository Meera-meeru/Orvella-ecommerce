const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const googleConfig = require('../config/googleConfig');
const appConfig = require('../config/appConfig');
const User = require('../models/user');
const PasswordReset = require('../models/PasswordReset');
const sendMail = require('../sendMail');
const { renderLogin, login, logout } = require('../controllers/authController');

const router = express.Router();
const googleConfigured = googleConfig.clientId && googleConfig.clientSecret &&
  !googleConfig.clientId.startsWith('PASTE_') && !googleConfig.clientSecret.startsWith('PASTE_');

router.get('/login', renderLogin);
router.post('/login', login);
router.post('/logout', logout);
router.get('/forgot-password', (req, res) => res.render('forgot-password', { message: null, error: null }));
router.post('/forgot-password', async (req, res, next) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).render('forgot-password', { message: null, error: 'Enter a valid email address.' });
  }
  try {
    const user = await User.findOne({ email, isBlocked: false, isAdmin: { $ne: true } });
    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      await PasswordReset.findOneAndUpdate(
        { user: user._id },
        { tokenHash, expiresAt: new Date(Date.now() + 30 * 60 * 1000) },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      const resetUrl = new URL('/reset-password', appConfig.publicBaseUrl);
      resetUrl.searchParams.set('token', token);
      await sendMail.sendPasswordReset(email, resetUrl.toString());
    }
    res.render('forgot-password', { message: 'If that email belongs to an account, password reset instructions have been sent.', error: null });
  } catch (error) { next(error); }
});
router.get('/reset-password', async (req, res, next) => {
  const token = String(req.query.token || '');
  if (!/^[a-f0-9]{64}$/.test(token)) {
    return res.status(400).render('reset-password', { token: '', error: 'This reset link is invalid or expired.' });
  }
  try {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const reset = await PasswordReset.findOne({ tokenHash, expiresAt: { $gt: new Date() } });
    if (!reset) return res.status(400).render('reset-password', { token: '', error: 'This reset link is invalid or expired.' });
    res.render('reset-password', { token, error: null });
  } catch (error) { next(error); }
});
router.post('/reset-password', async (req, res, next) => {
  const token = String(req.body.token || '');
  const password = String(req.body.password || '');
  const confirmPassword = String(req.body.confirmPassword || '');
  if (!/^[a-f0-9]{64}$/.test(token) || password.length < 8 || password !== confirmPassword) {
    return res.status(400).render('reset-password', { token, error: 'Use a password with at least 8 characters and make sure both entries match.' });
  }
  try {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const reset = await PasswordReset.findOne({ tokenHash, expiresAt: { $gt: new Date() } });
    if (!reset) return res.status(400).render('reset-password', { token: '', error: 'This reset link is invalid or expired.' });
    const user = await User.findById(reset.user).select('+password');
    if (!user || user.isBlocked) return res.status(400).render('reset-password', { token: '', error: 'This reset link is invalid or expired.' });
    user.password = await bcrypt.hash(password, 12);
    await user.save();
    await PasswordReset.deleteOne({ _id: reset._id });
    res.redirect('/login?message=' + encodeURIComponent('Password updated. Please sign in.'));
  } catch (error) { next(error); }
});

router.get('/auth/google', (req, res) => {
  if (!googleConfigured) return res.redirect('/login?message=' + encodeURIComponent('Google sign-in setup is required in config/googleConfig.js.'));
  const state = crypto.randomBytes(24).toString('hex');
  req.session.googleOAuthState = state;
  const params = new URLSearchParams({
    client_id: googleConfig.clientId,
    redirect_uri: googleConfig.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account'
  });
  res.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + params.toString());
});

router.get('/auth/google/callback', async (req, res, next) => {
  if (!googleConfigured) return res.redirect('/login?message=' + encodeURIComponent('Google sign-in is not configured yet.'));
  if (!req.query.code || !req.query.state || req.query.state !== req.session.googleOAuthState) {
    return res.status(400).send('Invalid Google sign-in state. Please try again.');
  }
  delete req.session.googleOAuthState;
  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(req.query.code),
        client_id: googleConfig.clientId,
        client_secret: googleConfig.clientSecret,
        redirect_uri: googleConfig.redirectUri,
        grant_type: 'authorization_code'
      })
    });
    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenData.access_token) return res.redirect('/login?message=' + encodeURIComponent('Google sign-in failed. Please try again.'));

    const profileResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const profile = await profileResponse.json();
    if (!profileResponse.ok || !profile.email || !profile.verified_email) {
      return res.redirect('/login?message=' + encodeURIComponent('Google did not provide a verified email address.'));
    }

    const email = String(profile.email).toLowerCase();
    let user = await User.findOne({ $or: [{ googleId: String(profile.id) }, { email }] });
    if (user && user.isAdmin) {
      return res.redirect('/login?message=' + encodeURIComponent('Administrator accounts cannot sign in with Google.'));
    }
    if (user && user.isBlocked) return res.redirect('/login?message=' + encodeURIComponent('Your account is blocked. Contact the store administrator.'));
    if (!user) {
      user = await User.create({ name: profile.name || email.split('@')[0], email, googleId: String(profile.id), emailVerified: true, isAdmin: false });
    } else {
      if (!user.googleId) user.googleId = String(profile.id);
      user.emailVerified = true;
      if (!user.name && profile.name) user.name = profile.name;
      await user.save();
    }

    req.session.regenerate((error) => {
      if (error) return next(error);
      req.session.userId = String(user._id);
      req.session.userName = user.name;
      req.session.save((saveError) => {
        if (saveError) return next(saveError);
        res.redirect('/');
      });
    });
  } catch (error) { next(error); }
});

module.exports = router;
