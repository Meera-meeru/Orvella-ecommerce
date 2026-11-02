const Product = require('../models/Product');

const restoreOrderItems = async (items) => {
  for (const item of items) {
    await Product.updateOne({ _id: item.product }, { $inc: { stock: item.quantity } });
    await Product.updateOne(
      { _id: item.product, purchaseCount: { $gte: item.quantity } },
      { $inc: { purchaseCount: -item.quantity } }
    );
  }
};

module.exports = { restoreOrderItems };
