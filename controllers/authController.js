const bcrypt = require('bcryptjs');
const User = require('../models/user');

const renderLogin = (req, res) => res.render('login', { error: null, message: req.query.message || null });

const login = async (req, res, next) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!email || !password) return res.status(400).render('login', { error: 'Enter your email and password.', message: null });

  try {
    const user = await User.findOne({ email }).select('+password');
    if (!user || !user.password) {
      return res.status(401).render('login', { error: 'Invalid email or password.', message: null });
    }
    let passwordMatches = await bcrypt.compare(password, user.password);
    // Compatibility for accounts created by the original demo, which stored passwords as plain text.
    // Successful legacy login immediately upgrades that password to a bcrypt hash.
    if (!passwordMatches && user.password === password) {
      user.password = await bcrypt.hash(password, 12);
      await user.save();
      passwordMatches = true;
    }
    if (!passwordMatches) return res.status(401).render('login', { error: 'Invalid email or password.', message: null });
    if (user.isAdmin) {
      return res.status(403).render('login', { error: 'Please use the administrator sign-in page.', message: null });
    }
    if (user.isBlocked) return res.status(403).render('login', { error: 'Your account is blocked. Contact the store administrator.', message: null });
    if (user.emailVerified === false) return res.status(403).render('login', { error: 'Please verify your email before logging in.', message: null });

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
};

const logout = (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie('shoply.user.sid');
    res.redirect('/');
  });
};

module.exports = { renderLogin, login, logout };
