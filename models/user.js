const mongoose = require('mongoose');

const addressSchema = new mongoose.Schema({
  label: { type: String, trim: true, maxlength: 40, default: 'Home' },
  name: { type: String, required: true, trim: true, maxlength: 100 },
  phone: { type: String, required: true, trim: true, maxlength: 20 },
  addressLine1: { type: String, required: true, trim: true, maxlength: 160 },
  addressLine2: { type: String, trim: true, maxlength: 160, default: '' },
  city: { type: String, required: true, trim: true, maxlength: 80 },
  state: { type: String, required: true, trim: true, maxlength: 80 },
  postalCode: { type: String, required: true, trim: true, maxlength: 20 },
  country: { type: String, required: true, trim: true, maxlength: 80, default: 'India' },
  isDefault: { type: Boolean, default: false }
});

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
  phone: { type: String, trim: true, maxlength: 20, default: '' },
  profileImage: { type: String, default: '' },
  // Google users do not have a local password; local signups store a bcrypt hash.
  password: { type: String, default: null, select: false },
  googleId: { type: String, default: null, sparse: true },
  referralCode: { type: String, trim: true, uppercase: true, unique: true, sparse: true },
  referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  referralRewardedAt: { type: Date, default: null },
  isAdmin: { type: Boolean, default: false },
  isBlocked: { type: Boolean, default: false },
  emailVerified: { type: Boolean, default: false },
  addresses: { type: [addressSchema], default: [] },
  cart: {
    type: [{
      product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
      quantity: { type: Number, required: true, min: 1 },
      couponCode: { type: String, trim: true, uppercase: true, default: '' }
    }],
    default: []
  },
  wishlist: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
  walletBalance: { type: Number, min: 0, default: 0 },
  walletTransactions: [{
    key: { type: String, required: true },
    type: { type: String, enum: ['Credit', 'Debit'], required: true },
    amount: { type: Number, required: true, min: 0 },
    description: { type: String, required: true },
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
    createdAt: { type: Date, default: Date.now }
  }],
  cartCouponCode: { type: String, trim: true, uppercase: true, default: '' }
}, { timestamps: true });

module.exports = mongoose.models.User || mongoose.model('User', userSchema);
