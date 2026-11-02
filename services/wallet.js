const User = require('../models/user');

const creditWallet = async ({ userId, amount, key, description, orderId = null }) => {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Wallet credit must be a positive amount.');
  const result = await User.updateOne(
    { _id: userId, 'walletTransactions.key': { $ne: key } },
    {
      $inc: { walletBalance: amount },
      $push: { walletTransactions: { key, type: 'Credit', amount, description, order: orderId, createdAt: new Date() } }
    }
  );
  return result.modifiedCount === 1;
};

const debitWallet = async ({ userId, amount, key, description, orderId = null }) => {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Wallet debit must be a positive amount.');
  const result = await User.updateOne(
    {
      _id: userId,
      'walletTransactions.key': { $ne: key },
      walletBalance: { $gte: amount }
    },
    {
      $inc: { walletBalance: -amount },
      $push: { walletTransactions: { key, type: 'Debit', amount, description, order: orderId, createdAt: new Date() } }
    }
  );
  return result.modifiedCount === 1;
};

module.exports = { creditWallet, debitWallet };
