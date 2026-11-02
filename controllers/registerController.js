const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const User = require('../models/user');
const PendingRegistration = require('../models/PendingRegistration');
const sendMail = require('../sendMail');
const { makeReferralCode } = require('../services/referrals');

const OTP_TTL_MS = 5 * 60 * 1000;
const RESEND_WAIT_MS = 30 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const REGISTER_FLASH_KEY = 'registerFlash';
const REGISTER_VALUES_KEY = 'registerValues';
const hashOtp = (otp) => crypto.createHash('sha256').update(otp).digest('hex');
const makeOtp = () => crypto.randomInt(100000, 1000000).toString();

const renderRegister = (req, res) => {
  const error = req.session[REGISTER_FLASH_KEY] || null;
  const values = req.session[REGISTER_VALUES_KEY] || {};
  delete req.session[REGISTER_FLASH_KEY];
  delete req.session[REGISTER_VALUES_KEY];
  res.render('register', {
    error,
    name: values.name || '',
    email: values.email || '',
    referralCode: values.referralCode || String(req.query.ref || '').trim().toUpperCase()
  });
};

const register = async (req, res, next) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const confirmPassword = String(req.body.confirmPassword || '');
  const referralCode = String(req.body.referralCode || '').trim().toUpperCase();

  if (Object.prototype.hasOwnProperty.call(req.body, 'isAdmin')) {
    return res.status(400).render('register', {
      error: 'Invalid registration request.', name, email, referralCode
    });
  }

  if (!name || !email || !password || !confirmPassword) {
    req.session[REGISTER_FLASH_KEY] = 'Please fill all details to create your account.';
    req.session[REGISTER_VALUES_KEY] = { name, email, referralCode };
    return req.session.save((error) => {
      if (error) return next(error);
      return res.redirect('/register');
    });
  }

  if (!name || name.length > 100 || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8 || password !== confirmPassword) {
    return res.status(400).render('register', {
      error: 'Enter a valid name/email, use a password with at least 8 characters, and make sure both passwords match.', name, email, referralCode
    });
  }
  try {
    if (await User.findOne({ email })) {
      return res.status(409).render('register', { error: 'An account with this email already exists. Please log in.', name, email, referralCode });
    }
    let referrer = null;
    if (referralCode) {
      referrer = await User.findOne({ referralCode, isBlocked: { $ne: true } }).select('_id').lean();
      if (!referrer) return res.status(400).render('register', { error: 'That referral code is not valid.', name, email, referralCode });
    }

    const otp = makeOtp();
    const passwordHash = await bcrypt.hash(password, 12);
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);
    const pending = await PendingRegistration.findOneAndUpdate(
      { email },
      { $set: { name, email, password: passwordHash, referredBy: referrer?._id || null, otpHash: hashOtp(otp), expiresAt, resendAvailableAt: new Date(Date.now() + RESEND_WAIT_MS), attempts: 0 } },
      { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
    );

    try {
      await sendMail(email, otp, name);
    } catch (mailError) {
      await PendingRegistration.deleteOne({ _id: pending._id });
      console.error('OTP email error:', mailError.message);
      return res.status(503).render('register', {
        error: mailError.message.includes('not configured')
          ? 'Email setup is incomplete. Add Gmail details in config/emailConfig.js, then try again.'
          : 'Could not send the verification email. Check the Gmail App Password and try again.',
        name, email
      });
    }

    return res.render('opt', { email, error: null, message: null, expiresAt: expiresAt.getTime(), resendAvailableAt: Date.now() + RESEND_WAIT_MS });
  } catch (error) {
    return next(error);
  }
};

const renderOtpError = async (res, email, error, status = 400, message = null) => {
  const pending = await PendingRegistration.findOne({ email }).lean();
  return res.status(status).render('opt', {
    email,
    error,
    message,
    expiresAt: pending ? new Date(pending.expiresAt).getTime() : Date.now(),
    resendAvailableAt: pending ? new Date(pending.resendAvailableAt).getTime() : Date.now()
  });
};

const verifyOTP = async (req, res, next) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const otp = String(req.body.otp || '').trim();
  if (!email || !/^\d{6}$/.test(otp)) return renderOtpError(res, email, 'Enter the six-digit OTP.');

  try {
    const pending = await PendingRegistration.findOne({ email });
    if (!pending || pending.expiresAt.getTime() <= Date.now()) {
      if (pending) await PendingRegistration.deleteOne({ _id: pending._id });
      return renderOtpError(res, email, 'This code expired. Please register again.');
    }
    if (pending.attempts >= MAX_OTP_ATTEMPTS) {
      await PendingRegistration.deleteOne({ _id: pending._id });
      return res.status(429).render('register', { error: 'Too many incorrect OTP attempts. Please register again.', name: pending.name, email });
    }
    const supplied = Buffer.from(hashOtp(otp), 'hex');
    const expected = Buffer.from(pending.otpHash, 'hex');
    const matches = supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
    if (!matches) {
      pending.attempts += 1;
      await pending.save();
      return renderOtpError(res, email, `Incorrect OTP. Attempts remaining: ${Math.max(0, MAX_OTP_ATTEMPTS - pending.attempts)}.`);
    }

    await User.create({
      name: pending.name, email: pending.email, password: pending.password,
      emailVerified: true, isAdmin: false, referralCode: makeReferralCode(), referredBy: pending.referredBy || null
    });
    await PendingRegistration.deleteOne({ _id: pending._id });
    return res.render('success');
  } catch (error) {
    if (error.code === 11000) return res.status(409).render('register', { error: 'This email already has an account. Please log in.', name: '', email });
    return next(error);
  }
};

const resendOTP = async (req, res, next) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  try {
    const pending = await PendingRegistration.findOne({ email });
    if (!pending || pending.expiresAt.getTime() <= Date.now()) {
      if (pending) await PendingRegistration.deleteOne({ _id: pending._id });
      return res.status(400).render('register', { error: 'Registration expired. Please sign up again.', name: '', email });
    }
    if (pending.resendAvailableAt.getTime() > Date.now()) {
      return renderOtpError(res, email, 'Please wait until the resend timer finishes.');
    }

    const otp = makeOtp();
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);
    try {
      await sendMail(email, otp, pending.name);
    } catch (mailError) {
      console.error('Resend OTP email error:', mailError.message);
      return renderOtpError(res, email, 'Could not resend the email. Check config/emailConfig.js and try again.', 503);
    }
    pending.otpHash = hashOtp(otp);
    pending.expiresAt = expiresAt;
    pending.resendAvailableAt = new Date(Date.now() + RESEND_WAIT_MS);
    pending.attempts = 0;
    await pending.save();
    return res.render('opt', { email, error: null, message: 'A new verification code has been sent.', expiresAt: expiresAt.getTime(), resendAvailableAt: pending.resendAvailableAt.getTime() });
  } catch (error) {
    return next(error);
  }
};

module.exports = { renderRegister, register, verifyOTP, resendOTP };
