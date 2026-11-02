const Order = require('../models/Order');

const startOfDay = (date) => {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
};

const endExclusive = (date) => {
  const value = startOfDay(date);
  value.setDate(value.getDate() + 1);
  return value;
};

const formatLocalDate = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const parseLocalDate = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return new Date(NaN);
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return formatLocalDate(date) === value ? date : new Date(NaN);
};

const getDateRange = (query, now = new Date()) => {
  const preset = ['day', 'week', 'month', 'year', 'custom'].includes(query.range) ? query.range : 'month';
  let from;
  let to;
  if (preset === 'custom') {
    from = parseLocalDate(query.from);
    to = parseLocalDate(query.to);
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from > to) {
      throw new Error('Choose a valid custom date range.');
    }
  } else {
    to = startOfDay(now);
    from = new Date(to);
    if (preset === 'day') from.setDate(from.getDate() - 0);
    if (preset === 'week') from.setDate(from.getDate() - 6);
    if (preset === 'month') from.setDate(1);
    if (preset === 'year') { from.setMonth(0, 1); }
  }
  return {
    preset,
    from: startOfDay(from),
    to: endExclusive(to),
    fromInput: formatLocalDate(startOfDay(from)),
    toInput: formatLocalDate(to)
  };
};

const getSalesReport = async (range) => {
  const orders = await Order.find({
    paymentStatus: 'Paid',
    status: { $nin: ['Cancelled', 'Returned', 'Payment Pending'] },
    createdAt: { $gte: range.from, $lt: range.to }
  }).populate('user', 'name email').sort({ createdAt: -1 }).lean();
  return {
    orders,
    totals: orders.reduce((total, order) => ({
      orderCount: total.orderCount + 1,
      orderAmount: total.orderAmount + order.total,
      discount: total.discount + (order.discount || 0),
      couponDiscount: total.couponDiscount + (order.couponDiscount || 0)
    }), { orderCount: 0, orderAmount: 0, discount: 0, couponDiscount: 0 })
  };
};

const getDashboardAnalytics = async (year) => {
  const start = new Date(year, 0, 1);
  const end = new Date(year + 1, 0, 1);
  const paidOrdersMatch = { paymentStatus: 'Paid', status: { $nin: ['Cancelled', 'Returned'] } };
  const productSales = [
    { $match: paidOrdersMatch },
    { $unwind: '$items' },
    { $group: { _id: '$items.product', quantity: { $sum: '$items.quantity' }, revenue: { $sum: { $multiply: ['$items.quantity', '$items.unitPrice'] } } } },
    { $lookup: { from: 'products', localField: '_id', foreignField: '_id', as: 'product' } },
    { $unwind: '$product' }
  ];
  const [monthlySales, bestProducts, bestCategories, bestBrands] = await Promise.all([
    Order.aggregate([
      { $match: { ...paidOrdersMatch, createdAt: { $gte: start, $lt: end } } },
      { $group: { _id: { $month: '$createdAt' }, amount: { $sum: '$total' }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]),
    Order.aggregate([...productSales,
      { $sort: { quantity: -1, revenue: -1 } },
      { $limit: 10 },
      { $project: { name: '$product.name', quantity: 1, revenue: 1 } }
    ]),
    Order.aggregate([...productSales,
      { $group: { _id: '$product.category', quantity: { $sum: '$quantity' }, revenue: { $sum: '$revenue' } } },
      { $lookup: { from: 'categories', localField: '_id', foreignField: '_id', as: 'category' } },
      { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } },
      { $project: { name: { $ifNull: ['$category.name', 'Unknown'] }, quantity: 1, revenue: 1 } },
      { $sort: { quantity: -1, revenue: -1 } },
      { $limit: 10 }
    ]),
    Order.aggregate([...productSales,
      { $group: { _id: { $ifNull: ['$product.brand', 'Unbranded'] }, quantity: { $sum: '$quantity' }, revenue: { $sum: '$revenue' } } },
      { $sort: { quantity: -1, revenue: -1 } },
      { $limit: 10 },
      { $project: { name: '$_id', quantity: 1, revenue: 1 } }
    ])
  ]);
  const monthRows = Array.from({ length: 12 }, (_, index) => {
    const row = monthlySales.find((item) => item._id === index + 1);
    return { month: new Date(year, index, 1).toLocaleString('en', { month: 'short' }), amount: row?.amount || 0, count: row?.count || 0 };
  });
  return {
    year,
    monthRows,
    bestProducts,
    bestCategories,
    bestBrands
  };
};

module.exports = { getDateRange, getSalesReport, getDashboardAnalytics };
