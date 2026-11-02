const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  name: { type: String, required: true, trim: true },
  image: { type: String, default: '' },
  quantity: { type: Number, required: true, min: 1 },
  unitPrice: { type: Number, required: true, min: 0 },
  couponCode: { type: String, default: '' }
}, { _id: false });

const orderSchema = new mongoose.Schema({
  orderNumber: { type: String, required: true, unique: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  items: { type: [orderItemSchema], required: true },
  address: {
    label: String,
    name: { type: String, required: true },
    phone: { type: String, required: true },
    addressLine1: { type: String, required: true },
    addressLine2: { type: String, default: '' },
    city: { type: String, required: true },
    state: { type: String, required: true },
    postalCode: { type: String, required: true },
    country: { type: String, required: true }
  },
  subtotal: { type: Number, required: true, min: 0 },
  discount: { type: Number, required: true, min: 0, default: 0 },
  productDiscount: { type: Number, required: true, min: 0, default: 0 },
  couponDiscount: { type: Number, required: true, min: 0, default: 0 },
  couponCode: { type: String, trim: true, uppercase: true, default: '' },
  shipping: { type: Number, required: true, min: 0, default: 0 },
  total: { type: Number, required: true, min: 0 },
  paymentMethod: { type: String, enum: ['COD', 'Razorpay', 'Wallet'], default: 'COD', required: true },
  paymentStatus: { type: String, enum: ['Pending', 'Paid', 'Failed', 'Refunded'], default: 'Pending', required: true },
  razorpayOrderId: { type: String, default: '' },
  razorpayPaymentId: { type: String, default: '' },
  paymentFailure: { type: String, default: '' },
  walletDebited: { type: Number, min: 0, default: 0 },
  returnRequestedAt: { type: Date, default: null },
  deliveredAt: { type: Date, default: null },
  returnStatus: { type: String, enum: ['', 'Requested', 'Approved', 'Rejected', 'Refunded'], default: '' },
  status: {
    type: String,
    enum: ['Payment Pending', 'Placed', 'Processing', 'Shipped', 'Delivered', 'Cancelled', 'Return Requested', 'Returned'],
    default: 'Placed',
    required: true
  },
  cancelledAt: { type: Date, default: null }
}, { timestamps: true });

module.exports = mongoose.models.Order || mongoose.model('Order', orderSchema);
