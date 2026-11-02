const crypto = require('crypto');
const Razorpay = require('razorpay');

const isRazorpayConfigured = () => Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);

const getRazorpayClient = () => {
  if (!isRazorpayConfigured()) throw new Error('Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.');
  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
  });
};

const createRazorpayOrder = async (order) => getRazorpayClient().orders.create({
  amount: Math.round(order.total * 100),
  currency: 'INR',
  receipt: order.orderNumber,
  notes: { storeOrderId: String(order._id) }
});

const verifyRazorpayPayment = ({ razorpayOrderId, razorpayPaymentId, signature }) => {
  if (!isRazorpayConfigured()) throw new Error('Razorpay is not configured.');
  const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest();
  let received;
  try { received = Buffer.from(signature, 'hex'); }
  catch { return false; }
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
};

module.exports = { isRazorpayConfigured, createRazorpayOrder, verifyRazorpayPayment };
