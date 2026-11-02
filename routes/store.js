const express = require('express');
const mongoose = require('mongoose');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const sharp = require('sharp');
const Product = require('../models/Product');
const Category = require('../models/Category');
const User = require('../models/user');
const Order = require('../models/Order');
const Coupon = require('../models/Coupon');
const { restoreOrderItems } = require('../services/inventory');
const { applyOffers } = require('../services/pricing');
const { getCouponDiscount, reserveCouponForOrder, releaseCouponForOrder } = require('../services/coupons');
const { isRazorpayConfigured, createRazorpayOrder, verifyRazorpayPayment } = require('../services/payments');
const { creditWallet, debitWallet } = require('../services/wallet');
const { rewardReferralForOrder } = require('../services/referrals');

const router = express.Router();
const SHIPPING_FEE = 0;
const profileUploadDir = path.join(__dirname, '..', 'public', 'uploads', 'profiles');
const profileImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp)$/.test(file.mimetype)) return cb(null, true);
    cb(new Error('Only JPG, PNG, and WEBP profile pictures are allowed.'));
  }
});

const requireCustomer = (req, res, next) => {
  if (req.session.userId && !req.session.isAdmin) return next();
  return res.redirect('/login?message=' + encodeURIComponent('Please sign in to continue.'));
};

const getCart = async (user) => {
  const cartEntries = user.cart || [];
  const [products, activeCategories] = await Promise.all([
    Product.find({ _id: { $in: cartEntries.map((item) => item.product) } }).populate('category', 'name').lean(),
    Category.find({ isDeleted: { $ne: true } }).select('_id').lean()
  ]);
  const activeCategoryIds = new Set(activeCategories.map((category) => String(category._id)));
  const pricedProducts = await applyOffers(products);
  const byId = new Map(pricedProducts.map((product) => [String(product._id), product]));
  const items = cartEntries.flatMap((entry) => {
    const product = byId.get(String(entry.product));
    if (!product) return [];
    const couponCode = entry.couponCode === product.couponCode ? product.couponCode : '';
    const discountPrice = product.price * (1 - (product.discountPercent || 0) / 100);
    const couponFactor = couponCode && product.couponPercent ? 1 - product.couponPercent / 100 : 1;
    const unitPrice = Number((discountPrice * couponFactor).toFixed(2));
    const available = !product.isDeleted && activeCategoryIds.has(String(product.category?._id || product.category)) && product.stock >= entry.quantity;
    return [{ product, quantity: entry.quantity, couponCode, unitPrice, available, lineTotal: Number((unitPrice * entry.quantity).toFixed(2)) }];
  });
  const subtotal = Number(items.filter((item) => item.available).reduce((sum, item) => sum + item.lineTotal, 0).toFixed(2));
  const couponResult = await getCouponDiscount({
    code: user.cartCouponCode,
    userId: user._id,
    items: items.filter((item) => item.available),
    subtotal
  });
  const discount = couponResult.discount;
  const shipping = items.length ? SHIPPING_FEE : 0;
  return {
    items, subtotal, discount, coupon: couponResult.coupon,
    couponError: couponResult.error,
    shipping, total: Math.max(0, Number((subtotal - discount + shipping).toFixed(2)))
  };
};

router.get('/', async (req, res, next) => {
  try {
    const categories = await Category.find({ isDeleted: { $ne: true } }).sort({ name: 1 }).lean();
    const products = await Product.find({ isDeleted: false, category: { $in: categories.map((category) => category._id) } })
      .populate('category', 'name').sort({ featured: -1, createdAt: -1 }).limit(24).lean();
    const priced = await applyOffers(products);
    const prepared = priced.map((p) => ({
      ...p,
      averageRating: p.reviews?.length ? p.reviews.reduce((sum, r) => sum + r.rating, 0) / p.reviews.length : 0,
    }));
    res.render('home', { products: prepared, categories, query: String(req.query.q || ''), categoryId: String(req.query.category || ''), stockFilter: '', sortBy: 'newest', showBrandIntro: true });
  } catch (error) { next(error); }
});

router.get('/categories', async (req, res, next) => {
  try {
    const categories = await Category.find({ isDeleted: { $ne: true } }).sort({ name: 1 }).lean();
    const products = await Product.find({
      isDeleted: false,
      category: { $in: categories.map((category) => category._id) }
    }).select('category name price discountPercent images stock reviews').sort({ featured: -1, createdAt: -1 }).lean();
    const pricedProducts = await applyOffers(products);
    const categoryProducts = new Map();
    for (const product of pricedProducts) {
      const id = String(product.category);
      const items = categoryProducts.get(id) || [];
      items.push(product);
      categoryProducts.set(id, items);
    }
    const preparedCategories = categories.map((category) => ({
      ...category,
      products: categoryProducts.get(String(category._id)) || []
    }));
    res.render('categories', { categories: preparedCategories });
  } catch (error) { next(error); }
});

router.get('/categories/:id', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).render('not-found', { message: 'Category not found.' });
    }
    const category = await Category.findOne({
      _id: req.params.id,
      isDeleted: { $ne: true }
    }).lean();
    if (!category) return res.status(404).render('not-found', { message: 'Category not found.' });

    const products = await Product.find({ category: category._id, isDeleted: false })
      .sort({ featured: -1, createdAt: -1 })
      .lean();
    const pricedProducts = await applyOffers(products);
    const preparedProducts = pricedProducts.map((product) => ({
      ...product,
      averageRating: product.reviews?.length
        ? product.reviews.reduce((sum, review) => sum + review.rating, 0) / product.reviews.length
        : 0
    }));
    res.render('category-details', { category, products: preparedProducts });
  } catch (error) { next(error); }
});

router.get('/products', async (req, res, next) => {
  try {
    const categories = await Category.find({ isDeleted: { $ne: true } }).sort({ name: 1 }).lean();
    const activeCategoryIds = categories.map((category) => category._id);
    const filter = { isDeleted: false, category: { $in: activeCategoryIds } };
    const query = String(req.query.q || '').trim();
    const categoryId = String(req.query.category || '').trim();
    const stockFilter = String(req.query.stock || '');
    const sortBy = String(req.query.sort || 'newest');
    if (query) filter.$or = [{ name: { $regex: query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }, { description: { $regex: query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }];
    if (categoryId && mongoose.isValidObjectId(categoryId)) {
      filter.category = activeCategoryIds.some((id) => String(id) === categoryId) ? categoryId : { $in: [] };
    }
    if (stockFilter === 'available') filter.stock = { $gt: 0 };
    if (stockFilter === 'unavailable') filter.stock = 0;
    const items = await Product.find(filter).populate('category', 'name').lean();
    const priced = await applyOffers(items);
    const products = priced.map((p) => ({ ...p, averageRating: p.reviews?.length ? p.reviews.reduce((sum, r) => sum + r.rating, 0) / p.reviews.length : 0, popularity: p.purchaseCount || 0 }));
    const sorters = {
      newest: (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
      popularity: (a, b) => b.popularity - a.popularity,
      'price-low': (a, b) => a.salePrice - b.salePrice,
      'price-high': (a, b) => b.salePrice - a.salePrice,
      rating: (a, b) => b.averageRating - a.averageRating,
      featured: (a, b) => Number(b.featured) - Number(a.featured) || new Date(b.createdAt) - new Date(a.createdAt),
      'name-asc': (a, b) => a.name.localeCompare(b.name),
      'name-desc': (a, b) => b.name.localeCompare(a.name)
    };
    products.sort(sorters[sortBy] || sorters.newest);
    res.render('home', { products, categories, query, categoryId, stockFilter, sortBy });
  } catch (error) { next(error); }
});

router.get('/products/:id', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).render('not-found', { message: 'Product not found.' });
    const product = await Product.findOne({ _id: req.params.id, isDeleted: false }).populate('category', 'name isDeleted').populate('reviews.user', 'name').lean();
    if (!product || !product.category || product.category.isDeleted) return res.status(404).render('not-found', { message: 'Product not found.' });
    const reviews = (product.reviews || []).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const averageRating = reviews.length ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length : 0;
    const [pricedProduct] = await applyOffers([product]);
    const salePrice = pricedProduct.salePrice;
    product.discountPercent = pricedProduct.discountPercent;
    const relatedRaw = await Product.find({ isDeleted: false, category: product.category?._id, _id: { $ne: product._id } }).limit(4).lean();
    const relatedPriced = await applyOffers(relatedRaw);
    const relatedProducts = relatedPriced.map((p) => ({ ...p, averageRating: p.reviews?.length ? p.reviews.reduce((sum, r) => sum + r.rating, 0) / p.reviews.length : 0 }));
    res.render('product-details', { product, reviews, averageRating, salePrice, relatedProducts, error: null, reviewError: req.query.reviewError || null, userId: req.session.userId || null });
  } catch (error) { next(error); }
});

router.post('/products/:id/reviews', async (req, res, next) => {
  if (!req.session.userId) return res.redirect('/login?message=' + encodeURIComponent('Please log in to write a review.'));
  try {
    const rating = Number(req.body.rating);
    const comment = String(req.body.comment || '').trim();
    if (!Number.isInteger(rating) || rating < 1 || rating > 5 || !comment || comment.length > 1000) {
      return res.redirect(`/products/${req.params.id}?reviewError=invalid#reviews`);
    }
    const user = await User.findById(req.session.userId);
    if (!user || user.isBlocked) return res.redirect('/login');
    const product = await Product.findOne({ _id: req.params.id, isDeleted: false }).populate('category', 'isDeleted');
    if (!product || !product.category || product.category.isDeleted) return res.status(404).render('not-found', { message: 'Product not found.' });
    const existing = product.reviews.find((review) => String(review.user) === String(user._id));
    if (existing) {
      existing.rating = rating;
      existing.comment = comment;
      existing.name = user.name;
      existing.createdAt = new Date();
    } else {
      product.reviews.push({ user: user._id, name: user.name, rating, comment });
    }
    await product.save();
    res.redirect(`/products/${product._id}#reviews`);
  } catch (error) { next(error); }
});

// Legacy page URLs retained so existing links do not break.
router.get('/product-details', (req, res) => res.redirect('/products'));

router.get('/cart', requireCustomer, async (req, res, next) => {
  try {
    const user = await User.findById(req.session.userId);
    if (!user) return res.redirect('/login');
    const cart = await getCart(user);
    res.render('cart', { ...cart, error: req.query.error || null });
  } catch (error) { next(error); }
});

router.post('/cart', requireCustomer, async (req, res, next) => {
  try {
    const productId = String(req.body.productId || '');
    const quantity = Number(req.body.quantity);
    const couponCode = String(req.body.couponCode || '').trim().toUpperCase();
    if (!mongoose.isValidObjectId(productId) || !Number.isInteger(quantity) || quantity < 1) {
      return res.redirect('/cart?error=' + encodeURIComponent('Choose a valid product quantity.'));
    }
    const [user, product] = await Promise.all([
      User.findById(req.session.userId),
      Product.findOne({ _id: productId, isDeleted: false })
    ]);
    if (!user) return res.redirect('/login');
    if (!product) return res.redirect('/cart?error=' + encodeURIComponent('This product is no longer available.'));
    if (!await Category.exists({ _id: product.category, isDeleted: { $ne: true } })) {
      return res.redirect('/cart?error=' + encodeURIComponent('This product is no longer available.'));
    }
    if (product.stock < 1) return res.redirect('/cart?error=' + encodeURIComponent('This product is out of stock.'));
    if (couponCode && (!product.couponCode || couponCode !== product.couponCode || !product.couponPercent)) {
      return res.redirect('/cart?error=' + encodeURIComponent('That coupon is not valid for this product.'));
    }
    const item = user.cart.find((entry) => String(entry.product) === productId);
    const nextQuantity = quantity + (item ? item.quantity : 0);
    if (nextQuantity > product.stock) {
      return res.redirect('/cart?error=' + encodeURIComponent(`Only ${product.stock} item(s) are currently available.`));
    }
    if (item) {
      item.quantity = nextQuantity;
      if (couponCode) item.couponCode = couponCode;
    } else user.cart.push({ product: product._id, quantity, couponCode });
    await user.save();
    res.redirect('/cart');
  } catch (error) { next(error); }
});

router.post('/cart/:id/update', requireCustomer, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.redirect('/cart');
    const quantity = Number(req.body.quantity);
    const user = await User.findById(req.session.userId);
    const item = user?.cart.find((entry) => String(entry.product) === req.params.id);
    if (!user || !item) return res.redirect('/cart');
    const product = await Product.findOne({ _id: req.params.id, isDeleted: false });
    const activeCategory = product && await Category.exists({ _id: product.category, isDeleted: { $ne: true } });
    if (!product || !activeCategory) return res.redirect('/cart?error=' + encodeURIComponent('This product is no longer available.'));
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > product.stock) {
      return res.redirect('/cart?error=' + encodeURIComponent(`Quantity must be between 1 and ${product.stock}.`));
    }
    item.quantity = quantity;
    await user.save();
    res.redirect('/cart');
  } catch (error) { next(error); }
});

router.post('/cart/:id/remove', requireCustomer, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.redirect('/cart');
    await User.updateOne({ _id: req.session.userId }, { $pull: { cart: { product: req.params.id } } });
    res.redirect('/cart');
  } catch (error) { next(error); }
});
router.post('/cart/coupon/apply', requireCustomer, async (req, res, next) => {
  try {
    const code = String(req.body.code || '').trim().toUpperCase();
    if (!code) return res.redirect('/cart?error=' + encodeURIComponent('Enter a coupon code.'));
    const user = await User.findById(req.session.userId);
    if (!user) return res.redirect('/login');
    const cart = await getCart({ ...user.toObject(), cartCouponCode: '' });
    const result = await getCouponDiscount({ code, userId: user._id, items: cart.items, subtotal: cart.subtotal });
    if (result.error) return res.redirect('/cart?error=' + encodeURIComponent(result.error));
    user.cartCouponCode = code;
    await user.save();
    res.redirect('/cart');
  } catch (error) { next(error); }
});
router.post('/cart/coupon/remove', requireCustomer, async (req, res, next) => {
  try {
    await User.updateOne({ _id: req.session.userId }, { $set: { cartCouponCode: '' } });
    res.redirect('/cart');
  } catch (error) { next(error); }
});
router.get('/cart/remove/:id', requireCustomer, async (req, res, next) => {
  try {
    if (mongoose.isValidObjectId(req.params.id)) {
      await User.updateOne({ _id: req.session.userId }, { $pull: { cart: { product: req.params.id } } });
    }
    res.redirect('/cart');
  } catch (error) { next(error); }
});

router.get('/checkout', requireCustomer, async (req, res, next) => {
  try {
    const user = await User.findById(req.session.userId);
    if (!user) return res.redirect('/login');
    const cart = await getCart(user);
    if (!cart.items.length || cart.items.some((item) => !item.available)) {
      return res.redirect('/cart?error=' + encodeURIComponent('Remove unavailable items or update quantities before checkout.'));
    }
    res.render('checkout', {
      ...cart,
      addresses: user.addresses,
      walletBalance: user.walletBalance || 0,
      razorpayKeyId: isRazorpayConfigured() ? process.env.RAZORPAY_KEY_ID : '',
      error: req.query.error || cart.couponError || null
    });
  } catch (error) { next(error); }
});

router.post('/checkout', requireCustomer, async (req, res, next) => {
  const decremented = [];
  let order;
  let couponReserved = false;
  let walletDebited = false;
  try {
    const user = await User.findById(req.session.userId);
    if (!user || !user.cart.length) return res.redirect('/cart');
    const address = user.addresses.id(req.body.addressId);
    if (!address) return res.redirect('/checkout?error=' + encodeURIComponent('Choose a saved delivery address.'));
    const paymentMethod = String(req.body.paymentMethod || 'COD');
    if (!['COD', 'Razorpay', 'Wallet'].includes(paymentMethod)) {
      return res.redirect('/checkout?error=' + encodeURIComponent('Choose a valid payment method.'));
    }
    if (paymentMethod === 'Razorpay' && !isRazorpayConfigured()) {
      return res.redirect('/checkout?error=' + encodeURIComponent('Online payment is not configured yet. Add Razorpay test keys to the server environment.'));
    }
    const cart = await getCart(user);
    if (!cart.items.length || cart.items.some((item) => !item.available) || cart.couponError) {
      return res.redirect('/checkout?error=' + encodeURIComponent(cart.couponError || 'Remove unavailable items or update quantities before checkout.'));
    }
    if (paymentMethod === 'COD' && cart.total > 1000) {
      return res.redirect('/checkout?error=' + encodeURIComponent('Cash on Delivery is available only for orders up to ₹1,000. Choose Razorpay or wallet payment.'));
    }
    if (paymentMethod === 'Wallet' && Number(user.walletBalance || 0) < cart.total) {
      return res.redirect('/checkout?error=' + encodeURIComponent('Your wallet balance is not enough to pay for this order.'));
    }
    const productIds = user.cart.map((item) => item.product);
    const activeCategories = await Category.find({ isDeleted: { $ne: true } }).select('_id').lean();
    const products = await Product.find({
      _id: { $in: productIds },
      isDeleted: false,
      category: { $in: activeCategories.map((category) => category._id) }
    });
    if (products.length !== user.cart.length) {
      return res.redirect('/checkout?error=' + encodeURIComponent('One or more cart products are unavailable. Remove them from your cart.'));
    }
    const items = [];
    const pricedCartItems = new Map(cart.items.map((item) => [String(item.product._id), item]));
    for (const entry of user.cart) {
      const product = products.find((candidate) => String(candidate._id) === String(entry.product));
      if (!product || entry.quantity > product.stock) {
        return res.redirect('/checkout?error=' + encodeURIComponent(`${product?.name || 'A cart product'} has only ${product?.stock || 0} item(s) left.`));
      }
    }
    for (const entry of user.cart) {
      const product = products.find((candidate) => String(candidate._id) === String(entry.product));
      const result = await Product.updateOne(
        { _id: product._id, isDeleted: false, stock: { $gte: entry.quantity } },
        { $inc: { stock: -entry.quantity, purchaseCount: entry.quantity } }
      );
      if (!result.modifiedCount) {
        throw new Error(`Stock changed while placing the order for ${product.name}. Please review your cart.`);
      }
      decremented.push({ product: product._id, quantity: entry.quantity });
      const cartItem = pricedCartItems.get(String(product._id));
      const unitPrice = cartItem.unitPrice;
      const couponCode = cartItem.couponCode;
      items.push({ product: product._id, name: product.name, image: product.images[0] || '', quantity: entry.quantity, unitPrice, couponCode });
    }
    const subtotal = cart.subtotal;
    const productDiscount = Number(items.reduce((sum, item) => {
      const product = pricedCartItems.get(String(item.product)).product;
      return sum + Math.max(0, product.price - item.unitPrice) * item.quantity;
    }, 0).toFixed(2));
    const discount = Number((productDiscount + cart.discount).toFixed(2));
    order = await Order.create({
      orderNumber: `SHP-${Date.now()}-${crypto.randomInt(1000, 10000)}`,
      user: user._id,
      items,
      address: address.toObject(),
      subtotal,
      discount,
      productDiscount,
      couponDiscount: cart.discount,
      couponCode: cart.coupon?.code || '',
      shipping: cart.shipping,
      total: cart.total,
      paymentMethod,
      paymentStatus: paymentMethod === 'Wallet' ? 'Paid' : 'Pending',
      status: paymentMethod === 'Razorpay' ? 'Payment Pending' : 'Placed',
      walletDebited: paymentMethod === 'Wallet' ? cart.total : 0
    });
    if (paymentMethod === 'Razorpay') {
      const razorpayOrder = await createRazorpayOrder(order);
      order.razorpayOrderId = razorpayOrder.id;
      await order.save();
    }
    if (cart.coupon) {
      couponReserved = await reserveCouponForOrder({ couponId: cart.coupon._id, userId: user._id, orderId: order._id });
      if (!couponReserved) throw new Error('That coupon was just used or has reached its usage limit. Please try again.');
    }
    if (paymentMethod === 'Wallet') {
      walletDebited = await debitWallet({
        userId: user._id, amount: cart.total, key: `order-payment-${order._id}`,
        description: `Payment for order ${order.orderNumber}`, orderId: order._id
      });
      if (!walletDebited) throw new Error('Your wallet balance changed. Please retry checkout.');
    }
    user.cart = [];
    user.cartCouponCode = '';
    await user.save();
    if (paymentMethod === 'Wallet') {
      try {
        await rewardReferralForOrder(order);
      } catch (referralError) {
        console.error(`Referral reward could not be processed for order ${order.orderNumber}:`, referralError);
      }
    }
    return res.redirect(`/orders/${order._id}?${paymentMethod === 'Razorpay' ? 'pay=1' : 'placed=1'}`);
  } catch (error) {
    if (order && couponReserved) await releaseCouponForOrder({ couponId: order.couponCode ? (await Coupon.findOne({ code: order.couponCode }).select('_id').lean())?._id : null, orderId: order._id });
    if (walletDebited && order) await creditWallet({ userId: order.user, amount: order.total, key: `order-payment-rollback-${order._id}`, description: `Reversal for order ${order.orderNumber}`, orderId: order._id });
    if (order) await Order.deleteOne({ _id: order._id });
    await restoreOrderItems(decremented);
    const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred while placing your order. Please try again.';
    if (errorMessage.startsWith('Stock changed')) {
      return res.redirect('/checkout?error=' + encodeURIComponent(errorMessage));
    }
    if (errorMessage.includes('coupon') || errorMessage.includes('wallet balance')) {
      return res.redirect('/checkout?error=' + encodeURIComponent(errorMessage));
    }
    return next(error instanceof Error ? error : new Error(errorMessage));
  }
});

router.get('/order-success', requireCustomer, (req, res) => res.redirect('/orders'));
router.get('/wallet', requireCustomer, async (req, res, next) => {
  try {
    const user = await User.findById(req.session.userId).select('walletBalance walletTransactions referralCode').lean();
    if (!user) return res.redirect('/login');
    res.render('wallet', {
      balance: user.walletBalance || 0,
      transactions: [...(user.walletTransactions || [])].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
      referralCode: user.referralCode || ''
    });
  } catch (error) { next(error); }
});
router.get('/wishlist', requireCustomer, async (req, res, next) => {
  try {
    const user = await User.findById(req.session.userId);
    if (!user) return res.redirect('/login');
    const activeCategories = await Category.find({ isDeleted: { $ne: true } }).select('_id').lean();
    const products = await Product.find({
      _id: { $in: user.wishlist },
      isDeleted: false,
      category: { $in: activeCategories.map((category) => category._id) }
    }).populate('category', 'name').lean();
    res.render('wishlist', { wishlist: products.map((product) => ({
      ...product,
      salePrice: Number((product.price * (1 - (product.discountPercent || 0) / 100)).toFixed(2))
    })) });
  } catch (error) { next(error); }
});
router.post('/wishlist/add/:id', requireCustomer, async (req, res, next) => {
  try {
    const product = mongoose.isValidObjectId(req.params.id) && await Product.findOne({ _id: req.params.id, isDeleted: false });
    if (!product || !await Category.exists({ _id: product.category, isDeleted: { $ne: true } })) return res.redirect('/products');
    await User.updateOne({ _id: req.session.userId }, { $addToSet: { wishlist: product._id } });
    res.redirect('/wishlist');
  } catch (error) { next(error); }
});
router.get('/wishlist/add/:id', requireCustomer, async (req, res, next) => {
  try {
    if (mongoose.isValidObjectId(req.params.id)) {
      const product = await Product.findOne({ _id: req.params.id, isDeleted: false });
      if (product && await Category.exists({ _id: product.category, isDeleted: { $ne: true } })) {
        await User.updateOne({ _id: req.session.userId }, { $addToSet: { wishlist: product._id } });
      }
    }
    res.redirect('/wishlist');
  } catch (error) { next(error); }
});
router.post('/wishlist/:id/remove', requireCustomer, async (req, res, next) => {
  try {
    if (mongoose.isValidObjectId(req.params.id)) {
      await User.updateOne({ _id: req.session.userId }, { $pull: { wishlist: req.params.id } });
    }
    res.redirect('/wishlist');
  } catch (error) { next(error); }
});
router.get('/wishlist/remove/:id', requireCustomer, async (req, res, next) => {
  try {
    if (mongoose.isValidObjectId(req.params.id)) {
      await User.updateOne({ _id: req.session.userId }, { $pull: { wishlist: req.params.id } });
    }
    res.redirect('/wishlist');
  } catch (error) { next(error); }
});

router.get('/profile', requireCustomer, async (req, res, next) => {
  try {
    const user = await User.findById(req.session.userId).lean();
    if (!user) return res.redirect('/login');
    const profileUser = { ...user, addresses: user.addresses || [], wishlist: user.wishlist || [] };
    const [orderCount, reviewCount] = await Promise.all([
      Order.countDocuments({ user: user._id }),
      Product.countDocuments({ 'reviews.user': user._id })
    ]);
    res.render('profile', { profileUser, stats: { orders: orderCount, wishlist: profileUser.wishlist.length, reviews: reviewCount }, success: req.query.saved === '1' });
  } catch (error) { next(error); }
});

router.get('/profile/edit', requireCustomer, async (req, res, next) => {
  try {
    const user = await User.findById(req.session.userId).lean();
    if (!user) return res.redirect('/login');
    res.render('edit-profile', { user, error: req.query.error || null });
  } catch (error) { next(error); }
});
router.post('/profile/edit', requireCustomer, (req, res, next) => {
  profileImageUpload.single('profileImage')(req, res, (error) => {
    if (error) return next(error);
    next();
  });
}, async (req, res, next) => {
  const name = String(req.body.name || '').trim();
  const phone = String(req.body.phone || '').trim();
  let savedProfileImage = '';
  let user;
  try {
    user = await User.findById(req.session.userId);
    if (!user) return res.redirect('/login');
    if (!name || name.length > 100 || (phone && !/^[+\d()\-\s]{7,20}$/.test(phone))) {
      return res.status(400).render('edit-profile', { user: { ...user.toObject(), name, phone }, error: 'Enter a valid name and phone number.' });
    }
    const previousProfileImage = user.profileImage;
    if (req.file) {
      await fs.promises.mkdir(profileUploadDir, { recursive: true });
      const filename = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.webp`;
      savedProfileImage = `/uploads/profiles/${filename}`;
      try {
        await sharp(req.file.buffer).rotate().resize(480, 480, { fit: 'cover', position: 'centre' })
          .webp({ quality: 84 }).toFile(path.join(profileUploadDir, filename));
      } catch (error) {
        if (/unsupported image format|Input (file|buffer).*(corrupt|invalid)/i.test(error.message)) {
          return res.status(400).render('edit-profile', {
            user: { ...user.toObject(), name, phone },
            error: 'That picture could not be opened. Choose a JPG, PNG, or WEBP image.'
          });
        }
        throw error;
      }
      user.profileImage = savedProfileImage;
    } else if (req.body.removeProfileImage === 'on') {
      user.profileImage = '';
    }
    user.name = name;
    user.phone = phone;
    await user.save();
    if (previousProfileImage && previousProfileImage !== user.profileImage && previousProfileImage.startsWith('/uploads/profiles/')) {
      const oldFilename = path.basename(previousProfileImage);
      try { await fs.promises.unlink(path.join(profileUploadDir, oldFilename)); }
      catch (error) { if (error.code !== 'ENOENT') console.error('Could not remove the previous profile picture.', error); }
    }
    req.session.userName = user.name;
    res.redirect('/profile?saved=1');
  } catch (error) {
    if (savedProfileImage) {
      try { await fs.promises.unlink(path.join(profileUploadDir, path.basename(savedProfileImage))); }
      catch (cleanupError) { if (cleanupError.code !== 'ENOENT') console.error('Could not clean up the new profile picture.', cleanupError); }
    }
    next(error);
  }
}, async (error, req, res, next) => {
  if (!(error instanceof multer.MulterError) && error.message !== 'Only JPG, PNG, and WEBP profile pictures are allowed.') return next(error);
  try {
    const user = await User.findById(req.session.userId).lean();
    if (!user) return res.redirect('/login');
    const message = error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE'
      ? 'Choose a profile picture smaller than 5 MB.'
      : error instanceof multer.MulterError
        ? 'Choose one JPG, PNG, or WEBP profile picture.'
        : error.message;
    res.status(400).render('edit-profile', { user, error: message });
  } catch (lookupError) { next(lookupError); }
});

router.get('/profile/addresses', requireCustomer, async (req, res, next) => {
  try {
    const user = await User.findById(req.session.userId);
    if (!user) return res.redirect('/login');
    res.render('addresses', { addresses: user.addresses, address: null, error: req.query.error || null });
  } catch (error) { next(error); }
});
router.get('/profile/addresses/:id/edit', requireCustomer, async (req, res, next) => {
  try {
    const user = await User.findById(req.session.userId);
    const address = user?.addresses.id(req.params.id);
    if (!address) return res.redirect('/profile/addresses');
    res.render('addresses', { addresses: user.addresses, address, error: null });
  } catch (error) { next(error); }
});
const addressFields = (body) => ({
  label: String(body.label || 'Home').trim(),
  name: String(body.name || '').trim(),
  phone: String(body.phone || '').trim(),
  addressLine1: String(body.addressLine1 || '').trim(),
  addressLine2: String(body.addressLine2 || '').trim(),
  city: String(body.city || '').trim(),
  state: String(body.state || '').trim(),
  postalCode: String(body.postalCode || '').trim(),
  country: String(body.country || 'India').trim(),
  isDefault: body.isDefault === 'on'
});
const validateAddress = (address) => address.name && /^[+\d()\-\s]{7,20}$/.test(address.phone) &&
  address.addressLine1 && address.city && address.state && address.postalCode && address.country;
router.post('/profile/addresses', requireCustomer, async (req, res, next) => {
  const values = addressFields(req.body);
  try {
    const user = await User.findById(req.session.userId);
    if (!user) return res.redirect('/login');
    if (!validateAddress(values) || user.addresses.length >= 10) {
      return res.status(400).render('addresses', { addresses: user.addresses, address: values, error: user.addresses.length >= 10 ? 'You can save up to 10 addresses.' : 'Fill out the required address details using a valid phone number.' });
    }
    if (values.isDefault) user.addresses.forEach((saved) => { saved.isDefault = false; });
    if (!user.addresses.length) values.isDefault = true;
    user.addresses.push(values);
    await user.save();
    res.redirect('/profile/addresses');
  } catch (error) { next(error); }
});
router.post('/profile/addresses/:id/edit', requireCustomer, async (req, res, next) => {
  const values = addressFields(req.body);
  try {
    const user = await User.findById(req.session.userId);
    const address = user?.addresses.id(req.params.id);
    if (!user || !address) return res.redirect('/profile/addresses');
    if (!validateAddress(values)) {
      return res.status(400).render('addresses', { addresses: user.addresses, address: { ...values, _id: req.params.id }, error: 'Fill out the required address details using a valid phone number.' });
    }
    if (values.isDefault) user.addresses.forEach((saved) => { saved.isDefault = false; });
    address.set(values);
    await user.save();
    res.redirect('/profile/addresses');
  } catch (error) { next(error); }
});
router.post('/profile/addresses/:id/delete', requireCustomer, async (req, res, next) => {
  try {
    const user = await User.findById(req.session.userId);
    const address = user?.addresses.id(req.params.id);
    if (!user || !address) return res.redirect('/profile/addresses');
    const wasDefault = address.isDefault;
    address.deleteOne();
    if (wasDefault && user.addresses.length) user.addresses[0].isDefault = true;
    await user.save();
    res.redirect('/profile/addresses');
  } catch (error) { next(error); }
});
router.post('/profile/addresses/:id/default', requireCustomer, async (req, res, next) => {
  try {
    const user = await User.findById(req.session.userId);
    const address = user?.addresses.id(req.params.id);
    if (!user || !address) return res.redirect('/profile/addresses');
    user.addresses.forEach((saved) => { saved.isDefault = String(saved._id) === String(address._id); });
    await user.save();
    res.redirect('/profile/addresses');
  } catch (error) { next(error); }
});

router.get('/orders', requireCustomer, async (req, res, next) => {
  try {
    const orders = await Order.find({ user: req.session.userId }).sort({ createdAt: -1 }).lean();
    res.render('orders', { orders });
  } catch (error) { next(error); }
});
router.get('/orders/:id', requireCustomer, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).render('not-found', { message: 'Order not found.' });
    const order = await Order.findOne({ _id: req.params.id, user: req.session.userId }).lean();
    if (!order) return res.status(404).render('not-found', { message: 'Order not found.' });
    res.render('order-details', {
      order, placed: req.query.placed === '1',
      razorpayKeyId: isRazorpayConfigured() ? process.env.RAZORPAY_KEY_ID : '',
      paymentMessage: req.query.payment || ''
    });
  } catch (error) { next(error); }
});
router.post('/orders/:id/payment/retry', requireCustomer, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.redirect('/orders');
    const order = await Order.findOne({
      _id: req.params.id, user: req.session.userId,
      paymentMethod: 'Razorpay', paymentStatus: { $in: ['Pending', 'Failed'] },
      status: { $nin: ['Cancelled', 'Returned'] }
    });
    if (!order) return res.redirect(`/orders/${req.params.id}`);
    const razorpayOrder = await createRazorpayOrder(order);
    order.razorpayOrderId = razorpayOrder.id;
    order.paymentStatus = 'Pending';
    order.status = 'Payment Pending';
    order.paymentFailure = '';
    await order.save();
    res.redirect(`/orders/${order._id}?pay=1`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unable to restart payment. Please try again.';
    res.redirect(`/orders/${req.params.id}?payment=${encodeURIComponent(errorMessage)}`);
  }
});
router.post('/orders/:id/payment/verify', requireCustomer, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).send('Order not found.');
    const { razorpay_order_id: razorpayOrderId, razorpay_payment_id: razorpayPaymentId, razorpay_signature: signature } = req.body;
    const order = await Order.findOne({ _id: req.params.id, user: req.session.userId });
    if (!order) return res.status(404).send('Order not found.');
    if (order.paymentStatus === 'Paid') return res.redirect(`/orders/${order._id}?payment=success`);
    if (order.paymentMethod !== 'Razorpay' || order.status !== 'Payment Pending' || order.razorpayOrderId !== razorpayOrderId ||
        !verifyRazorpayPayment({ razorpayOrderId, razorpayPaymentId, signature })) {
      return res.status(400).send('Payment verification failed. Do not retry from this page; check your order status.');
    }
    const updated = await Order.findOneAndUpdate(
      { _id: order._id, user: req.session.userId, status: 'Payment Pending', paymentStatus: { $in: ['Pending', 'Failed'] }, razorpayOrderId },
      { $set: { status: 'Placed', paymentStatus: 'Paid', razorpayPaymentId, paymentFailure: '' } },
      { new: true }
    );
    if (!updated) return res.redirect(`/orders/${order._id}`);
    await rewardReferralForOrder(updated);
    res.redirect(`/orders/${updated._id}?payment=success`);
  } catch (error) { next(error); }
});
router.post('/orders/:id/payment/failed', requireCustomer, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).send('Order not found.');
    const message = String(req.body.message || 'Payment was not completed.').slice(0, 240);
    await Order.updateOne(
      { _id: req.params.id, user: req.session.userId, status: 'Payment Pending', paymentStatus: 'Pending' },
      { $set: { paymentStatus: 'Failed', paymentFailure: message } }
    );
    res.sendStatus(204);
  } catch (error) { next(error); }
});
router.post('/orders/:id/cancel', requireCustomer, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.redirect('/orders');
    const order = await Order.findOneAndUpdate(
      { _id: req.params.id, user: req.session.userId, status: { $in: ['Payment Pending', 'Placed', 'Processing'] } },
      { $set: { status: 'Cancelled', cancelledAt: new Date() } },
      { new: true }
    );
    if (!order) return res.redirect(`/orders/${req.params.id}`);
    await restoreOrderItems(order.items);
    if (order.couponCode) {
      const coupon = await Coupon.findOne({ code: order.couponCode }).select('_id').lean();
      if (coupon) await releaseCouponForOrder({ couponId: coupon._id, orderId: order._id });
    }
    if (order.paymentStatus === 'Paid') {
      await creditWallet({
        userId: order.user, amount: order.total, key: `order-refund-${order._id}`,
        description: `Refund for cancelled order ${order.orderNumber}`, orderId: order._id
      });
      order.paymentStatus = 'Refunded';
      await order.save();
    }
    res.redirect(`/orders/${order._id}`);
  } catch (error) { next(error); }
});
router.post('/orders/:id/return', requireCustomer, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.redirect('/orders');
    const order = await Order.findOne({ _id: req.params.id, user: req.session.userId, status: 'Delivered' });
    if (!order) return res.redirect(`/orders/${req.params.id}`);
    const deliveredAt = order.deliveredAt || order.updatedAt;
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    if (Date.now() - new Date(deliveredAt).getTime() > sevenDays) return res.redirect(`/orders/${order._id}?payment=return-expired`);
    order.status = 'Return Requested';
    order.returnStatus = 'Requested';
    order.returnRequestedAt = new Date();
    await order.save();
    res.redirect(`/orders/${order._id}`);
  } catch (error) { next(error); }
});
router.get('/orders/:id/invoice.pdf', requireCustomer, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).send('Invoice not found.');
    const order = await Order.findOne({ _id: req.params.id, user: req.session.userId }).lean();
    if (!order) return res.status(404).send('Invoice not found.');
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin: 48, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Orvella-${order.orderNumber}.pdf"`);
    doc.pipe(res);
    doc.fontSize(22).fillColor('#285640').text('Orvella', { continued: true }).fillColor('#20332d').fontSize(16).text('  INVOICE');
    doc.moveDown().fontSize(10).fillColor('#667085')
      .text(`Order: ${order.orderNumber}`)
      .text(`Date: ${new Date(order.createdAt).toLocaleDateString('en-IN')}`)
      .text(`Payment: ${order.paymentMethod} · ${order.paymentStatus}`);
    doc.moveDown().fillColor('#20332d').fontSize(12).text('Bill to');
    doc.fontSize(10).text(`${order.address.name} · ${order.address.phone}`)
      .text(`${order.address.addressLine1}${order.address.addressLine2 ? `, ${order.address.addressLine2}` : ''}`)
      .text(`${order.address.city}, ${order.address.state} ${order.address.postalCode}, ${order.address.country}`);
    doc.moveDown().fontSize(10).fillColor('#20332d');
    for (const item of order.items) {
      doc.text(`${item.name} × ${item.quantity}`, 48, doc.y, { continued: true })
        .text(`INR ${(item.unitPrice * item.quantity).toFixed(2)}`, { align: 'right' });
    }
    doc.moveDown().text(`Subtotal: INR ${order.subtotal.toFixed(2)}`, { align: 'right' })
      .text(`Discount: INR ${(order.discount || 0).toFixed(2)}`, { align: 'right' })
      .text(`Shipping: INR ${order.shipping.toFixed(2)}`, { align: 'right' })
      .fontSize(13).fillColor('#285640').text(`Total: INR ${order.total.toFixed(2)}`, { align: 'right' });
    doc.end();
  } catch (error) { next(error); }
});

module.exports = router;
