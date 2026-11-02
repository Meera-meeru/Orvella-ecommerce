const User = require('../models/user');

module.exports = async (req, res, next) => {
  if (!req.session || req.session.isAdmin !== true || !req.session.adminUserId) {
    return res.redirect('/admin/login?message=' + encodeURIComponent('Administrator sign-in is required.'));
  }
  try {
    const admin = await User.findOne({
      _id: req.session.adminUserId,
      isAdmin: true,
      isBlocked: { $ne: true }
    }).select('_id').lean();
    if (admin) return next();

    delete req.session.isAdmin;
    delete req.session.adminUserId;
    delete req.session.adminEmail;
    return req.session.save((error) => {
      if (error) return next(error);
      return res.redirect('/admin/login?message=' + encodeURIComponent('Administrator access is no longer available.'));
    });
  } catch (error) {
    return next(error);
  }
};
