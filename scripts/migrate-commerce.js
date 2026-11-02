const mongoose = require('mongoose');
const appConfig = require('../config/appConfig');
const User = require('../models/user');
const Order = require('../models/Order');
const { makeReferralCode } = require('../services/referrals');

const migrate = async () => {
  await mongoose.connect(appConfig.mongoUri);
  let usersUpdated = 0;
  const users = await User.find({
    $or: [
      { referralCode: { $exists: false } },
      { referralCode: null },
      { walletBalance: { $exists: false } },
      { walletTransactions: { $exists: false } }
    ]
  }).select('_id referralCode walletBalance walletTransactions').lean();

  for (const user of users) {
    const updates = {};
    if (!user.referralCode) {
      let referralCode;
      do {
        referralCode = makeReferralCode();
      } while (await User.exists({ referralCode }));
      updates.referralCode = referralCode;
    }
    if (user.walletBalance == null) updates.walletBalance = 0;
    if (!Array.isArray(user.walletTransactions)) updates.walletTransactions = [];
    await User.updateOne({ _id: user._id }, { $set: updates });
    usersUpdated += 1;
  }

  let ordersUpdated = 0;
  const orders = await Order.collection.find({
    $or: [
      { paymentMethod: { $exists: false } },
      { paymentStatus: { $exists: false } },
      { discount: { $exists: false } },
      { productDiscount: { $exists: false } },
      { couponDiscount: { $exists: false } },
      { couponCode: { $exists: false } },
      { shipping: { $exists: false } },
      { walletDebited: { $exists: false } },
      { status: { $in: ['Delivered', 'Return Requested', 'Returned'] }, deliveredAt: { $exists: false } }
    ]
  }).toArray();
  for (const order of orders) {
    const updates = {};
    if (!order.paymentMethod) updates.paymentMethod = 'COD';
    if (!order.paymentStatus) updates.paymentStatus = order.status === 'Delivered' ? 'Paid' : 'Pending';
    if (order.discount == null) updates.discount = 0;
    if (order.productDiscount == null) updates.productDiscount = order.discount || 0;
    if (order.couponDiscount == null) updates.couponDiscount = 0;
    if (order.couponCode == null) updates.couponCode = '';
    if (order.shipping == null) updates.shipping = 0;
    if (order.walletDebited == null) updates.walletDebited = 0;
    if (!order.deliveredAt && ['Delivered', 'Return Requested', 'Returned'].includes(order.status)) updates.deliveredAt = order.updatedAt || order.createdAt;
    await Order.collection.updateOne({ _id: order._id }, { $set: updates });
    ordersUpdated += 1;
  }
  console.log(`Commerce migration complete. Updated ${usersUpdated} users and ${ordersUpdated} orders.`);
};

migrate()
  .catch((error) => {
    console.error('Commerce migration failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
