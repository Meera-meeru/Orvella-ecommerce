const mongoose = require('mongoose');

const offerSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  type: { type: String, enum: ['Product', 'Category', 'Referral'], required: true },
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
  category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
  discountPercent: { type: Number, required: true, min: 1, max: 90 },
  rewardAmount: { type: Number, min: 0, default: 100 },
  startsAt: { type: Date, default: null },
  endsAt: { type: Date, default: null },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.models.Offer || mongoose.model('Offer', offerSchema);
