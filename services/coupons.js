const Coupon = require('../models/Coupon');

const getCouponDiscount = async ({ code, userId, items, subtotal }) => {
  if (!code) return { coupon: null, discount: 0, error: null };
  const coupon = await Coupon.findOne({ code: String(code).trim().toUpperCase(), isActive: true }).lean();
  if (!coupon) return { coupon: null, discount: 0, error: 'That coupon code is not active.' };
  const now = new Date();
  if ((coupon.startsAt && coupon.startsAt > now) || (coupon.endsAt && coupon.endsAt < now)) {
    return { coupon: null, discount: 0, error: 'That coupon is not currently available.' };
  }
  if (coupon.usageLimit > 0 && coupon.usedCount >= coupon.usageLimit) {
    return { coupon: null, discount: 0, error: 'That coupon has reached its usage limit.' };
  }
  if (coupon.redemptions?.some((redemption) => String(redemption.user) === String(userId))) {
    return { coupon: null, discount: 0, error: 'You have already used that coupon.' };
  }
  if (subtotal < coupon.minimumOrder) {
    return { coupon: null, discount: 0, error: `This coupon needs a minimum order of ₹${coupon.minimumOrder.toFixed(2)}.` };
  }

  const eligibleItems = items.filter(({ product }) =>
    coupon.scope === 'All' ||
    (coupon.scope === 'Product' && String(product._id) === String(coupon.product)) ||
    (coupon.scope === 'Category' && String(product.category?._id || product.category) === String(coupon.category))
  );
  const eligibleSubtotal = eligibleItems.reduce((sum, item) => sum + item.lineTotal, 0);
  if (!eligibleSubtotal) return { coupon: null, discount: 0, error: 'That coupon does not apply to items in your cart.' };

  const rawDiscount = coupon.discountType === 'Percent'
    ? eligibleSubtotal * coupon.value / 100
    : coupon.value;
  const discount = Number(Math.min(eligibleSubtotal, coupon.maxDiscount > 0 ? coupon.maxDiscount : rawDiscount, rawDiscount).toFixed(2));
  return { coupon, discount, error: null };
};

const reserveCouponForOrder = async ({ couponId, userId, orderId }) => {
  if (!couponId) return true;
  const now = new Date();
  const coupon = await Coupon.findOneAndUpdate(
    {
      _id: couponId,
      isActive: true,
      $and: [
        { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
        { $or: [{ endsAt: null }, { endsAt: { $gte: now } }] },
        { $or: [{ usageLimit: 0 }, { $expr: { $lt: ['$usedCount', '$usageLimit'] } }] },
        { redemptions: { $not: { $elemMatch: { user: userId } } } }
      ]
    },
    { $inc: { usedCount: 1 }, $push: { redemptions: { user: userId, order: orderId } } },
    { new: true }
  );
  return Boolean(coupon);
};

const releaseCouponForOrder = async ({ couponId, orderId }) => {
  if (!couponId) return;
  await Coupon.updateOne(
    { _id: couponId, 'redemptions.order': orderId },
    { $inc: { usedCount: -1 }, $pull: { redemptions: { order: orderId } } }
  );
};

module.exports = { getCouponDiscount, reserveCouponForOrder, releaseCouponForOrder };
