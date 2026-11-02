const mongoose = require('mongoose');

const couponSchema = new mongoose.Schema({
  code: { type: String, required: true, trim: true, uppercase: true, unique: true },
  discountType: { type: String, enum: ['Percent', 'Fixed'], required: true, default: 'Percent' },
  value: { type: Number, required: true, min: 0 },
  maxDiscount: { type: Number, min: 0, default: 0 },
  minimumOrder: { type: Number, min: 0, default: 0 },
  scope: { type: String, enum: ['All', 'Product', 'Category'], default: 'All' },
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
  category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
  startsAt: { type: Date, default: null },
  endsAt: { type: Date, default: null },
  usageLimit: { type: Number, min: 0, default: 0 },
  usedCount: { type: Number, min: 0, default: 0 },
  redemptions: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true }
  }],
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.models.Coupon || mongoose.model('Coupon', couponSchema);
