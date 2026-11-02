const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const sharp = require('sharp');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const User = require('../models/user');
const Category = require('../models/Category');
const Product = require('../models/Product');
const Order = require('../models/Order');
const Coupon = require('../models/Coupon');
const Offer = require('../models/Offer');
const { restoreOrderItems } = require('../services/inventory');
const { creditWallet } = require('../services/wallet');
const { rewardReferralForOrder } = require('../services/referrals');
const { releaseCouponForOrder } = require('../services/coupons');
const { getDateRange, getSalesReport, getDashboardAnalytics } = require('../services/salesReports');
const requireAdmin = require('../middleware/requireAdmin');

const router = express.Router();
const MIN_PRODUCT_IMAGES = 3;
const MAX_PRODUCT_IMAGES = 8;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: MAX_PRODUCT_IMAGES, fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp)$/.test(file.mimetype)) return cb(null, true);
    cb(new Error('Only JPG, PNG, and WEBP images are allowed.'));
  }
});
const uploadDir = path.join(__dirname, '..', 'public', 'uploads', 'products');

router.get('/login', (req, res) => {
  return res.render('admin-panel/login', { error: null, message: req.query.message || null });
});
router.post('/login', async (req, res, next) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!email || !password) {
    return res.status(400).render('admin-panel/login', { error: 'Enter your administrator email and password.', message: null });
  }
  try {
    const admin = await User.findOne({ email, isAdmin: true, isBlocked: { $ne: true } }).select('+password');
    if (!admin || !admin.password || !(await bcrypt.compare(password, admin.password))) {
      return res.status(401).render('admin-panel/login', { error: 'Invalid administrator email or password.', message: null });
    }
    return req.session.regenerate((error) => {
      if (error) return next(error);
      req.session.isAdmin = true;
      req.session.adminUserId = String(admin._id);
      req.session.adminEmail = admin.email;
      req.session.save((saveError) => {
        if (saveError) return next(saveError);
        return res.redirect('/admin/dashboard');
      });
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/logout', requireAdmin, (req, res) => {
  req.session.destroy((error) => {
    if (error) return res.status(500).send('Could not end the administrator session.');
    res.clearCookie('shoply.user.sid');
    res.redirect('/admin/login');
  });
});

router.use(requireAdmin);

router.get('/', (req, res) => res.redirect('/admin/dashboard'));
router.get('/dashboard', async (req, res, next) => {
  try {
    const year = Number(req.query.year) || new Date().getFullYear();
    if (!Number.isInteger(year) || year < 2000 || year > 2100) return res.status(400).send('Choose a valid dashboard year.');
    const [users, categories, products, orders, analytics, sales] = await Promise.all([
      User.countDocuments({ isAdmin: { $ne: true } }),
      Category.countDocuments({ isDeleted: { $ne: true } }),
      Product.countDocuments({ isDeleted: false }),
      Order.countDocuments(),
      getDashboardAnalytics(year),
      Order.aggregate([
        { $match: { paymentStatus: 'Paid', status: { $nin: ['Cancelled', 'Returned'] } } },
        { $group: { _id: null, amount: { $sum: '$total' }, count: { $sum: 1 }, discount: { $sum: '$discount' } } }
      ])
    ]);
    res.render('admin-panel/dashboard', {
      users, categories, products, orders, year, analytics,
      sales: sales[0] || { amount: 0, count: 0, discount: 0 }
    });
  } catch (e) { next(e); }
});

// USER MANAGEMENT. Raw collection updates preserve legacy user fields.
router.get('/users', async (req, res, next) => {
  try {
    const users = await User.find({ isAdmin: { $ne: true } }).select('name email createdAt').sort({ createdAt: -1 }).lean();
    const blockedDocs = await User.collection.find(
      { _id: { $in: users.map(u => u._id) }, isBlocked: true },
      { projection: { _id: 1 } }
    ).toArray();
    const blocked = new Set(blockedDocs.map(u => String(u._id)));
    res.render('admin-panel/users', { users, blocked, error: null });
  } catch (e) { next(e); }
});

router.post('/users/:id/block', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).send('Invalid user id');
    const result = await User.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(req.params.id), isAdmin: { $ne: true } },
      { $set: { isBlocked: true } }
    );
    if (!result.matchedCount) return res.status(404).send('Customer not found.');
    res.redirect('/admin/users');
  } catch (e) { next(e); }
});
router.post('/users/:id/unblock', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).send('Invalid user id');
    const result = await User.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(req.params.id), isAdmin: { $ne: true } },
      { $set: { isBlocked: false } }
    );
    if (!result.matchedCount) return res.status(404).send('Customer not found.');
    res.redirect('/admin/users');
  } catch (e) { next(e); }
});

router.get('/orders', async (req, res, next) => {
  try {
    const orders = await Order.find().populate('user', 'name email').sort({ createdAt: -1 }).lean();
    res.render('admin/orders', { orders, order: null, error: null });
  } catch (error) { next(error); }
});
router.get('/orders/:id', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).render('not-found', { message: 'Order not found.' });
    const order = await Order.findById(req.params.id).populate('user', 'name email').lean();
    if (!order) return res.status(404).render('not-found', { message: 'Order not found.' });
    res.render('admin/orders', { orders: null, order, error: null });
  } catch (error) { next(error); }
});
router.post('/orders/:id/status', async (req, res, next) => {
  const status = String(req.body.status || '');
  const statuses = ['Processing', 'Shipped', 'Delivered', 'Cancelled', 'Returned'];
  try {
    if (!mongoose.isValidObjectId(req.params.id) || !statuses.includes(status)) {
      return res.status(400).send('Invalid order status.');
    }
    const current = await Order.findById(req.params.id);
    if (!current) return res.status(404).send('Order not found.');
    const transitions = {
      'Payment Pending': ['Cancelled'],
      Placed: ['Processing', 'Shipped', 'Delivered', 'Cancelled'],
      Processing: ['Shipped', 'Delivered', 'Cancelled'],
      Shipped: ['Delivered'],
      Delivered: [],
      'Return Requested': ['Returned', 'Delivered']
    };
    if (!transitions[current.status]?.includes(status)) {
      return res.status(409).send('This order cannot move to that status.');
    }
    if (status === 'Cancelled') {
      const order = await Order.findOneAndUpdate(
        { _id: current._id, status: current.status },
        { $set: { status, cancelledAt: new Date() } },
        { new: true }
      );
      if (!order) return res.status(409).send('Order status changed. Refresh and try again.');
      await restoreOrderItems(order.items);
      if (order.couponCode) {
        const coupon = await Coupon.findOne({ code: order.couponCode }).select('_id').lean();
        if (coupon) {
          await releaseCouponForOrder({ couponId: coupon._id, orderId: order._id });
        }
      }
      if (order.paymentStatus === 'Paid') {
        await creditWallet({ userId: order.user, amount: order.total, key: `order-refund-${order._id}`, description: `Refund for cancelled order ${order.orderNumber}`, orderId: order._id });
        order.paymentStatus = 'Refunded';
        await order.save();
      }
      return res.redirect(`/admin/orders/${order._id}`);
    }
    if (status === 'Returned') {
      const order = await Order.findOneAndUpdate(
        { _id: current._id, status: 'Return Requested', returnStatus: 'Requested' },
        { $set: { status: 'Returned', returnStatus: current.paymentStatus === 'Paid' ? 'Refunded' : 'Approved' } },
        { new: true }
      );
      if (!order) return res.status(409).send('Return status changed. Refresh and try again.');
      await restoreOrderItems(order.items);
      if (order.paymentStatus === 'Paid') {
        await creditWallet({ userId: order.user, amount: order.total, key: `order-return-refund-${order._id}`, description: `Refund for returned order ${order.orderNumber}`, orderId: order._id });
        order.paymentStatus = 'Refunded';
        await order.save();
      }
      return res.redirect(`/admin/orders/${order._id}`);
    }
    if (status === 'Delivered') {
      const order = await Order.findOneAndUpdate(
        { _id: current._id, status: current.status },
        {
          $set: {
            status,
            deliveredAt: current.deliveredAt || new Date(),
            ...(current.paymentMethod === 'COD' ? { paymentStatus: 'Paid' } : {})
          }
        },
        { new: true }
      );
      if (!order) return res.status(409).send('Order status changed. Refresh and try again.');
      if (current.status === 'Return Requested') {
        order.returnStatus = 'Rejected';
        await order.save();
      }
      if (current.paymentMethod === 'COD') await rewardReferralForOrder(order);
      return res.redirect(`/admin/orders/${order._id}`);
    }
    const order = await Order.findOneAndUpdate(
      { _id: current._id, status: current.status },
      { $set: { status } },
      { new: true }
    );
    if (!order) return res.status(409).send('Order status changed. Refresh and try again.');
    res.redirect(`/admin/orders/${order._id}`);
  } catch (error) { next(error); }
});

router.get('/coupons', async (req, res, next) => {
  try {
    const coupons = await Coupon.find().sort({ createdAt: -1 }).lean();
    res.render('admin-panel/coupons', { coupons });
  } catch (error) { next(error); }
});
router.get('/coupons/new', async (req, res, next) => {
  try {
    const [products, categories] = await Promise.all([
      Product.find({ isDeleted: false }).select('name').sort({ name: 1 }).lean(),
      Category.find({ isDeleted: { $ne: true } }).select('name').sort({ name: 1 }).lean()
    ]);
    res.render('admin-panel/coupon-form', {
      coupon: { code: '', discountType: 'Percent', value: '', maxDiscount: 0, minimumOrder: 0, scope: 'All', product: '', category: '', startsAt: null, endsAt: null, usageLimit: 0 },
      products, categories, error: null
    });
  } catch (error) { next(error); }
});
router.post('/coupons', async (req, res, next) => {
  try {
    const coupon = {
      code: String(req.body.code || '').trim().toUpperCase(),
      discountType: String(req.body.discountType || ''),
      value: Number(req.body.value),
      maxDiscount: Number(req.body.maxDiscount || 0),
      minimumOrder: Number(req.body.minimumOrder || 0),
      scope: String(req.body.scope || 'All'),
      product: req.body.product || null,
      category: req.body.category || null,
      startsAt: req.body.startsAt ? new Date(req.body.startsAt) : null,
      endsAt: req.body.endsAt ? new Date(req.body.endsAt) : null,
      usageLimit: Number(req.body.usageLimit || 0)
    };
    const [products, categories] = await Promise.all([
      Product.find({ isDeleted: false }).select('name').sort({ name: 1 }).lean(),
      Category.find({ isDeleted: { $ne: true } }).select('name').sort({ name: 1 }).lean()
    ]);
    const validScope = coupon.scope === 'All' ||
      (coupon.scope === 'Product' && mongoose.isValidObjectId(coupon.product)) ||
      (coupon.scope === 'Category' && mongoose.isValidObjectId(coupon.category));
    if (!coupon.code || !['Percent', 'Fixed'].includes(coupon.discountType) ||
        !Number.isFinite(coupon.value) || coupon.value <= 0 ||
        (coupon.discountType === 'Percent' && coupon.value > 90) ||
        !Number.isFinite(coupon.maxDiscount) || coupon.maxDiscount < 0 ||
        !Number.isFinite(coupon.minimumOrder) || coupon.minimumOrder < 0 ||
        !Number.isInteger(coupon.usageLimit) || coupon.usageLimit < 0 || !validScope ||
        (coupon.startsAt && !Number.isFinite(coupon.startsAt.getTime())) ||
        (coupon.endsAt && !Number.isFinite(coupon.endsAt.getTime())) ||
        (coupon.startsAt && coupon.endsAt && coupon.startsAt >= coupon.endsAt)) {
      return res.status(400).render('admin-panel/coupon-form', { coupon, products, categories, error: 'Enter a valid code, discount, scope, usage limit, and date range.' });
    }
    await Coupon.create(coupon);
    res.redirect('/admin/coupons');
  } catch (error) {
    if (error.code === 11000) {
      const [products, categories] = await Promise.all([
        Product.find({ isDeleted: false }).select('name').lean(),
        Category.find({ isDeleted: { $ne: true } }).select('name').lean()
      ]);
      return res.status(400).render('admin-panel/coupon-form', { coupon: req.body, products, categories, error: 'A coupon with this code already exists.' });
    }
    next(error);
  }
});
router.post('/coupons/:id/toggle', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).send('Invalid coupon id.');
    const coupon = await Coupon.findById(req.params.id);
    if (!coupon) return res.status(404).send('Coupon not found.');
    coupon.isActive = !coupon.isActive;
    await coupon.save();
    res.redirect('/admin/coupons');
  } catch (error) { next(error); }
});

router.get('/offers', async (req, res, next) => {
  try {
    const offers = await Offer.find().populate('product', 'name').populate('category', 'name').sort({ createdAt: -1 }).lean();
    res.render('admin-panel/offers', { offers });
  } catch (error) { next(error); }
});
router.get('/offers/new', async (req, res, next) => {
  try {
    const [products, categories] = await Promise.all([
      Product.find({ isDeleted: false }).select('name').sort({ name: 1 }).lean(),
      Category.find({ isDeleted: { $ne: true } }).select('name').sort({ name: 1 }).lean()
    ]);
    res.render('admin-panel/offer-form', { products, categories, error: null });
  } catch (error) { next(error); }
});
router.post('/offers', async (req, res, next) => {
  try {
    const offer = {
      name: String(req.body.name || '').trim(),
      type: String(req.body.type || ''),
      product: req.body.product || null,
      category: req.body.category || null,
      discountPercent: Number(req.body.discountPercent || 1),
      rewardAmount: Number(req.body.rewardAmount || 100),
      startsAt: req.body.startsAt ? new Date(req.body.startsAt) : null,
      endsAt: req.body.endsAt ? new Date(req.body.endsAt) : null
    };
    const [products, categories] = await Promise.all([
      Product.find({ isDeleted: false }).select('name').sort({ name: 1 }).lean(),
      Category.find({ isDeleted: { $ne: true } }).select('name').sort({ name: 1 }).lean()
    ]);
    const validTarget = (offer.type === 'Product' && mongoose.isValidObjectId(offer.product)) ||
      (offer.type === 'Category' && mongoose.isValidObjectId(offer.category)) || offer.type === 'Referral';
    if (!offer.name || offer.name.length > 100 || !validTarget ||
        !Number.isFinite(offer.discountPercent) || offer.discountPercent < 1 || offer.discountPercent > 90 ||
        !Number.isFinite(offer.rewardAmount) || offer.rewardAmount < 1 ||
        (offer.startsAt && !Number.isFinite(offer.startsAt.getTime())) ||
        (offer.endsAt && !Number.isFinite(offer.endsAt.getTime())) ||
        (offer.startsAt && offer.endsAt && offer.startsAt >= offer.endsAt)) {
      return res.status(400).render('admin-panel/offer-form', { products, categories, error: 'Enter a valid offer, target, reward, and date range.' });
    }
    await Offer.create(offer);
    res.redirect('/admin/offers');
  } catch (error) { next(error); }
});
router.post('/offers/:id/toggle', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).send('Invalid offer id.');
    const offer = await Offer.findById(req.params.id);
    if (!offer) return res.status(404).send('Offer not found.');
    offer.isActive = !offer.isActive;
    await offer.save();
    res.redirect('/admin/offers');
  } catch (error) { next(error); }
});

router.get('/reports', async (req, res, next) => {
  try {
    const range = getDateRange(req.query);
    const report = await getSalesReport(range);
    res.render('admin-panel/reports', { ...report, range });
  } catch (error) {
    if (error.message.includes('date range')) return res.status(400).send(error.message);
    next(error);
  }
});
router.get('/reports/export.xlsx', async (req, res, next) => {
  try {
    const range = getDateRange(req.query);
    const report = await getSalesReport(range);
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sales');
    sheet.columns = [
      { header: 'Order', key: 'orderNumber', width: 24 },
      { header: 'Date', key: 'date', width: 16 },
      { header: 'Customer', key: 'customer', width: 28 },
      { header: 'Payment', key: 'payment', width: 16 },
      { header: 'Status', key: 'status', width: 20 },
      { header: 'Discount', key: 'discount', width: 14 },
      { header: 'Coupon deduction', key: 'couponDiscount', width: 18 },
      { header: 'Total', key: 'total', width: 14 }
    ];
    for (const order of report.orders) sheet.addRow({
      orderNumber: order.orderNumber,
      date: order.createdAt,
      customer: order.user?.email || 'Account unavailable',
      payment: order.paymentMethod,
      status: order.status,
      discount: order.discount || 0,
      couponDiscount: order.couponDiscount || 0,
      total: order.total
    });
    sheet.addRow({});
    sheet.addRow({ orderNumber: 'Totals', customer: `Orders: ${report.totals.orderCount}`, discount: report.totals.discount, couponDiscount: report.totals.couponDiscount, total: report.totals.orderAmount });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="orvella-sales.xlsx"');
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) { next(error); }
});
router.get('/reports/export.pdf', async (req, res, next) => {
  try {
    const range = getDateRange(req.query);
    const report = await getSalesReport(range);
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin: 42, size: 'A4', layout: 'landscape' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="orvella-sales.pdf"');
    doc.pipe(res);
    doc.fontSize(18).fillColor('#285640').text('Orvella Sales Report');
    doc.moveDown(.3).fontSize(9).fillColor('#667085').text(`${range.from.toLocaleDateString('en-IN')} — ${new Date(range.to.getTime() - 1).toLocaleDateString('en-IN')}`);
    doc.moveDown().fillColor('#20332d').fontSize(10)
      .text(`Orders: ${report.totals.orderCount}     Sales: INR ${report.totals.orderAmount.toFixed(2)}     Discounts: INR ${report.totals.discount.toFixed(2)}     Coupons: INR ${report.totals.couponDiscount.toFixed(2)}`);
    doc.moveDown().fontSize(8).text('Order number                 Date             Customer                 Payment          Status               Discount       Coupon          Total');
    doc.moveDown(.4);
    for (const order of report.orders) {
      if (doc.y > 520) doc.addPage();
      doc.text(`${order.orderNumber}  ${new Date(order.createdAt).toLocaleDateString('en-IN')}  ${(order.user?.email || 'Unavailable').slice(0, 24)}  ${order.paymentMethod}  ${order.status}  INR ${(order.discount || 0).toFixed(2)}  INR ${(order.couponDiscount || 0).toFixed(2)}  INR ${order.total.toFixed(2)}`);
    }
    doc.end();
  } catch (error) { next(error); }
});

// CATEGORY MANAGEMENT
router.get('/categories', async (req, res, next) => {
  try {
    const categories = await Category.find({ isDeleted: false }).sort({ name: 1 }).lean();
    res.render('admin-panel/categories', { categories, error: null });
  } catch (e) { next(e); }
});
router.get('/categories/new', (req, res) => res.render('admin-panel/category-form', {
  category: { name: '', description: '', offerPercent: 0 }, action: '/admin/categories', title: 'Add category', error: null
}));
router.post('/categories', async (req, res) => {
  const name = String(req.body.name || '').trim();
  const description = String(req.body.description || '').trim();
  const offerPercent = Number(req.body.offerPercent || 0);
  const offerStartsAt = req.body.offerStartsAt ? new Date(req.body.offerStartsAt) : null;
  const offerEndsAt = req.body.offerEndsAt ? new Date(req.body.offerEndsAt) : null;
  if (!name) return res.status(400).render('admin-panel/category-form', {
    category: { name, description }, action: '/admin/categories', title: 'Add category', error: 'Category name is required.'
  });
  if (!Number.isFinite(offerPercent) || offerPercent < 0 || offerPercent > 90 ||
      (offerStartsAt && !Number.isFinite(offerStartsAt.getTime())) ||
      (offerEndsAt && !Number.isFinite(offerEndsAt.getTime())) ||
      (offerStartsAt && offerEndsAt && offerStartsAt >= offerEndsAt)) {
    return res.status(400).render('admin-panel/category-form', {
      category: { name, description, offerPercent, offerStartsAt, offerEndsAt }, action: '/admin/categories', title: 'Add category', error: 'Enter a valid category offer and date range.'
    });
  }
  try {
    await Category.create({ name, description, offerPercent, offerStartsAt, offerEndsAt });
    res.redirect('/admin/categories');
  } catch (e) {
    res.status(400).render('admin-panel/category-form', {
      category: { name, description }, action: '/admin/categories', title: 'Add category',
      error: e.code === 11000 ? 'A category with this name already exists.' : 'Could not save category.'
    });
  }
});
router.get('/categories/:id/edit', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).send('Invalid category id');
    const category = await Category.findOne({ _id: req.params.id, isDeleted: false }).lean();
    if (!category) return res.status(404).send('Category not found');
    res.render('admin-panel/category-form', {
      category, action: `/admin/categories/${category._id}/edit`, title: 'Edit category', error: null
    });
  } catch (e) { next(e); }
});
router.post('/categories/:id/edit', async (req, res) => {
  const name = String(req.body.name || '').trim();
  const description = String(req.body.description || '').trim();
  const offerPercent = Number(req.body.offerPercent || 0);
  const offerStartsAt = req.body.offerStartsAt ? new Date(req.body.offerStartsAt) : null;
  const offerEndsAt = req.body.offerEndsAt ? new Date(req.body.offerEndsAt) : null;
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).send('Invalid category id');
    if (!name) return res.status(400).render('admin-panel/category-form', {
      category: { _id: req.params.id, name, description }, action: `/admin/categories/${req.params.id}/edit`,
      title: 'Edit category', error: 'Category name is required.'
    });
    if (!Number.isFinite(offerPercent) || offerPercent < 0 || offerPercent > 90 ||
        (offerStartsAt && !Number.isFinite(offerStartsAt.getTime())) ||
        (offerEndsAt && !Number.isFinite(offerEndsAt.getTime())) ||
        (offerStartsAt && offerEndsAt && offerStartsAt >= offerEndsAt)) {
      return res.status(400).render('admin-panel/category-form', {
        category: { _id: req.params.id, name, description, offerPercent, offerStartsAt, offerEndsAt },
        action: `/admin/categories/${req.params.id}/edit`, title: 'Edit category', error: 'Enter a valid category offer and date range.'
      });
    }
    await Category.findOneAndUpdate({ _id: req.params.id, isDeleted: false }, { name, description, offerPercent, offerStartsAt, offerEndsAt }, { runValidators: true });
    res.redirect('/admin/categories');
  } catch (e) {
    res.status(400).render('admin-panel/category-form', {
      category: { _id: req.params.id, name, description }, action: `/admin/categories/${req.params.id}/edit`,
      title: 'Edit category', error: e.code === 11000 ? 'A category with this name already exists.' : 'Could not update category.'
    });
  }
});
router.post('/categories/:id/delete', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).send('Invalid category id');
    await Category.updateOne({ _id: req.params.id }, { $set: { isDeleted: true } });
    res.redirect('/admin/categories');
  } catch (e) { next(e); }
});

// PRODUCT MANAGEMENT
router.get('/products', async (req, res, next) => {
  try {
    const products = await Product.find({ isDeleted: false }).populate('category', 'name').sort({ createdAt: -1 }).lean();
    res.render('admin-panel/products', { products });
  } catch (e) { next(e); }
});
router.get('/products/new', async (req, res, next) => {
  try {
    const categories = await Category.find({ isDeleted: false }).sort({ name: 1 }).lean();
    res.render('admin-panel/product-form', {
      product: { name: '', brand: '', category: '', price: '', discountPercent: 0, couponCode: '', couponPercent: 0, stock: '', description: '', highlights: [], specifications: [], images: [] },
      categories, action: '/admin/products', title: 'Add product', error: null
    });
  } catch (e) { next(e); }
});
router.post('/products', upload.array('images', MAX_PRODUCT_IMAGES), async (req, res) => {
  const values = {
    name: String(req.body.name || '').trim(),
    brand: String(req.body.brand || '').trim(),
    category: String(req.body.category || ''),
    price: Number(req.body.price),
    stock: Number(req.body.stock),
    description: String(req.body.description || '').trim(),
    discountPercent: Number(req.body.discountPercent || 0),
    couponCode: String(req.body.couponCode || '').trim().toUpperCase(),
    couponPercent: Number(req.body.couponPercent || 0),
    featured: req.body.featured === 'on',
    highlights: String(req.body.highlights || '').split('\n').map(x => x.trim()).filter(Boolean).slice(0, 20),
    specifications: String(req.body.specifications || '').split('\n').map(line => { const i = line.indexOf(':'); return i > 0 ? { name: line.slice(0, i).trim(), value: line.slice(i + 1).trim() } : null; }).filter(x => x && x.name && x.value).slice(0, 30)
  };
  const categories = await Category.find({ isDeleted: false }).sort({ name: 1 }).lean();
  const showFormError = (message, status = 400) => res.status(status).render('admin-panel/product-form', {
    product: { ...values, images: [] }, categories, action: '/admin/products', title: 'Add product', error: message
  });
  if (!values.name || values.brand.length > 100 || !mongoose.isValidObjectId(values.category) || !Number.isFinite(values.price) || values.price < 0 ||
      !Number.isInteger(values.stock) || values.stock < 0 || !Number.isFinite(values.discountPercent) || values.discountPercent < 0 || values.discountPercent > 90 || !Number.isFinite(values.couponPercent) || values.couponPercent < 0 || values.couponPercent > 80) {
    return showFormError('Enter a product name, valid category, non-negative price and whole-number stock.');
  }
  if (!req.files || req.files.length < MIN_PRODUCT_IMAGES) return showFormError(`Please upload at least ${MIN_PRODUCT_IMAGES} product images.`);
  try {
    const category = await Category.findOne({ _id: values.category, isDeleted: false });
    if (!category) return showFormError('Select an active category.');
    await fs.promises.mkdir(uploadDir, { recursive: true });
    const imageNames = [];
    for (const file of req.files) {
      const filename = `${Date.now()}-${require('crypto').randomBytes(8).toString('hex')}.webp`;
      // Sharp rotates, center-crops to a consistent 800x800 square, and resizes/compresses.
      await sharp(file.buffer).rotate().resize(800, 800, { fit: 'cover', position: 'centre' })
        .webp({ quality: 82 }).toFile(path.join(uploadDir, filename));
      imageNames.push(`/uploads/products/${filename}`);
    }
    await Product.create({ ...values, images: imageNames });
    res.redirect('/admin/products');
  } catch (e) {
    console.error(e);
    return showFormError('Could not save product. Check category and image files.', 500);
  }
});
router.get('/products/:id/edit', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).send('Invalid product id');
    const [product, categories] = await Promise.all([
      Product.findOne({ _id: req.params.id, isDeleted: false }).lean(),
      Category.find({ isDeleted: false }).sort({ name: 1 }).lean()
    ]);
    if (!product) return res.status(404).send('Product not found');
    res.render('admin-panel/product-form', {
      product, categories, action: `/admin/products/${product._id}/edit`, title: 'Edit product', error: null
    });
  } catch (e) { next(e); }
});
router.post('/products/:id/edit', upload.array('images', MAX_PRODUCT_IMAGES), async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).send('Invalid product id');
    const product = await Product.findOne({ _id: req.params.id, isDeleted: false });
    if (!product) return res.status(404).send('Product not found');
    const name = String(req.body.name || '').trim();
    const category = String(req.body.category || '');
    const price = Number(req.body.price);
    const stock = Number(req.body.stock);
    const description = String(req.body.description || '').trim();
    const brand = String(req.body.brand || '').trim();
    const discountPercent = Number(req.body.discountPercent || 0);
    const couponCode = String(req.body.couponCode || '').trim().toUpperCase();
    const couponPercent = Number(req.body.couponPercent || 0);
    const highlights = String(req.body.highlights || '').split('\n').map(x => x.trim()).filter(Boolean).slice(0, 20);
    const specifications = String(req.body.specifications || '').split('\n').map(line => { const i = line.indexOf(':'); return i > 0 ? { name: line.slice(0, i).trim(), value: line.slice(i + 1).trim() } : null; }).filter(x => x && x.name && x.value).slice(0, 30);
    const categories = await Category.find({ isDeleted: false }).sort({ name: 1 }).lean();
    const values = { ...product.toObject(), name, brand, category, price, stock, description, discountPercent, couponCode, couponPercent, featured: req.body.featured === 'on', highlights, specifications };
    const showFormError = message => res.status(400).render('admin-panel/product-form', {
      product: values, categories, action: `/admin/products/${product._id}/edit`, title: 'Edit product', error: message
    });
    if (!name || brand.length > 100 || !mongoose.isValidObjectId(category) || !Number.isFinite(price) || price < 0 ||
        !Number.isInteger(stock) || stock < 0 || !Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 90 || !Number.isFinite(couponPercent) || couponPercent < 0 || couponPercent > 80) return showFormError('Enter valid product details and discount percentages.');
    if (product.images.length + (req.files?.length || 0) < MIN_PRODUCT_IMAGES) {
      return showFormError(`Product must have at least ${MIN_PRODUCT_IMAGES} images. Upload ${MIN_PRODUCT_IMAGES - product.images.length} more.`);
    }
    const activeCategory = await Category.findOne({ _id: category, isDeleted: false });
    if (!activeCategory) return showFormError('Select an active category.');
    const newImages = [];
    if (req.files?.length) {
      await fs.promises.mkdir(uploadDir, { recursive: true });
      for (const file of req.files) {
        const filename = `${Date.now()}-${require('crypto').randomBytes(8).toString('hex')}.webp`;
        await sharp(file.buffer).rotate().resize(800, 800, { fit: 'cover', position: 'centre' })
          .webp({ quality: 82 }).toFile(path.join(uploadDir, filename));
        newImages.push(`/uploads/products/${filename}`);
      }
    }
    await Product.updateOne({ _id: product._id }, {
      $set: { name, brand, category, price, stock, description, discountPercent, couponCode, couponPercent, featured: req.body.featured === 'on', highlights, specifications, images: [...product.images, ...newImages] }
    });
    res.redirect('/admin/products');
  } catch (e) { next(e); }
});
router.post('/products/:id/delete', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).send('Invalid product id');
    await Product.updateOne({ _id: req.params.id }, { $set: { isDeleted: true } });
    res.redirect('/admin/products');
  } catch (e) { next(e); }
});

router.use((req, res) => res.redirect('/admin'));

router.use((err, req, res, next) => {
  console.error(err);
  if (err instanceof multer.MulterError) return res.status(400).send(`Upload error: ${err.message}`);
  if (err.message === 'Only JPG, PNG, and WEBP images are allowed.') return res.status(400).send(err.message);
  res.status(500).send('Something went wrong in the admin panel.');
});

module.exports = router;
