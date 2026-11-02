const Category = require('../models/Category');
const Offer = require('../models/Offer');

const isCurrent = (offer, now) =>
  offer.isActive !== false &&
  (!offer.startsAt || offer.startsAt <= now) &&
  (!offer.endsAt || offer.endsAt >= now);

const applyOffers = async (products) => {
  if (!products.length) return [];
  const now = new Date();
  const productIds = products.map((product) => product._id);
  const categoryIds = [...new Set(products.map((product) => String(product.category?._id || product.category)).filter(Boolean))];
  const [categories, offers] = await Promise.all([
    Category.find({
      _id: { $in: categoryIds },
      isDeleted: { $ne: true }
    }).select('offerPercent offerStartsAt offerEndsAt').lean(),
    Offer.find({
      isActive: true,
      $and: [
        { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
        { $or: [{ endsAt: null }, { endsAt: { $gte: now } }] },
        { $or: [
          { type: 'Product', product: { $in: productIds } },
          { type: 'Category', category: { $in: categoryIds } }
        ] }
      ]
    }).lean()
  ]);
  const categoryOffers = new Map(categories.map((category) => {
    const active = category.offerPercent > 0 &&
      (!category.offerStartsAt || category.offerStartsAt <= now) &&
      (!category.offerEndsAt || category.offerEndsAt >= now);
    return [String(category._id), active ? category.offerPercent : 0];
  }));
  const productOffers = new Map();
  for (const offer of offers) {
    const key = offer.type === 'Product' ? String(offer.product) : String(offer.category);
    const map = offer.type === 'Product' ? productOffers : categoryOffers;
    map.set(key, Math.max(map.get(key) || 0, offer.discountPercent));
  }

  return products.map((product) => {
    const categoryId = String(product.category?._id || product.category);
    const discountPercent = Math.max(
      product.discountPercent || 0,
      productOffers.get(String(product._id)) || 0,
      categoryOffers.get(categoryId) || 0
    );
    return {
      ...product,
      discountPercent,
      salePrice: Number((product.price * (1 - discountPercent / 100)).toFixed(2))
    };
  });
};

module.exports = { applyOffers };
