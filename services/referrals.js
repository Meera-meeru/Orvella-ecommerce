const crypto = require('crypto');
const User = require('../models/user');
const Order = require('../models/Order');
const Offer = require('../models/Offer');
const { creditWallet } = require('./wallet');

const makeReferralCode = () => `ORV${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

const rewardReferralForOrder = async (order) => {
  const referredUser = await User.findById(order.user).select('referredBy referralRewardedAt').lean();
  if (!referredUser?.referredBy || referredUser.referralRewardedAt) return;
  const priorPaidOrder = await Order.exists({
    user: order.user,
    _id: { $ne: order._id },
    paymentStatus: 'Paid',
    status: { $nin: ['Cancelled', 'Returned'] }
  });
  if (priorPaidOrder) return;
  const now = new Date();
  const referralOffer = await Offer.findOne({
    type: 'Referral',
    isActive: true,
    $and: [
      { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
      { $or: [{ endsAt: null }, { endsAt: { $gte: now } }] }
    ]
  }).sort({ rewardAmount: -1 }).lean();
  const rewardAmount = referralOffer?.rewardAmount || 100;

  await creditWallet({
    userId: order.user,
    amount: rewardAmount,
    key: `referral-new-${order.user}`,
    description: 'Referral welcome reward'
  });
  await creditWallet({
    userId: referredUser.referredBy,
    amount: rewardAmount,
    key: `referral-referrer-${order.user}`,
    description: 'Successful referral reward'
  });
  await User.updateOne(
    { _id: order.user, referredBy: referredUser.referredBy, referralRewardedAt: null },
    { $set: { referralRewardedAt: new Date() } }
  );
};

module.exports = { makeReferralCode, rewardReferralForOrder };
