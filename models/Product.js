const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true, trim: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
  comment: { type: String, required: true, trim: true, maxlength: 1000 },
  createdAt: { type: Date, default: Date.now }
}, { _id: true });

const specificationSchema = new mongoose.Schema({
  name: { type: String, trim: true, required: true },
  value: { type: String, trim: true, required: true }
}, { _id: false });

const productSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 160 },
  category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
  brand: { type: String, trim: true, maxlength: 100, default: '' },
  price: { type: Number, required: true, min: 0 },
  discountPercent: { type: Number, default: 0, min: 0, max: 90 },
  couponCode: { type: String, trim: true, uppercase: true, default: '' },
  couponPercent: { type: Number, default: 0, min: 0, max: 80 },
  stock: { type: Number, required: true, min: 0 },
  description: { type: String, trim: true, default: '' },
  highlights: [{ type: String, trim: true }],
  specifications: [specificationSchema],
  images: [{ type: String, required: true }],
  featured: { type: Boolean, default: false },
  purchaseCount: { type: Number, default: 0, min: 0 },
  reviews: [reviewSchema],
  isDeleted: { type: Boolean, default: false }
}, { timestamps: true });

productSchema.virtual('averageRating').get(function () {
  if (!this.reviews || !this.reviews.length) return 0;
  return this.reviews.reduce((sum, review) => sum + review.rating, 0) / this.reviews.length;
});
productSchema.set('toJSON', { virtuals: true });
productSchema.set('toObject', { virtuals: true });

module.exports = mongoose.models.Product || mongoose.model('Product', productSchema);
