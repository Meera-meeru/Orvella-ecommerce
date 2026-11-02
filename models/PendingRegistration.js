const mongoose = require('mongoose');

const pendingRegistrationSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  password: { type: String, required: true },
  otpHash: { type: String, required: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  resendAvailableAt: { type: Date, required: true },
  attempts: { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.models.PendingRegistration || mongoose.model('PendingRegistration', pendingRegistrationSchema);
