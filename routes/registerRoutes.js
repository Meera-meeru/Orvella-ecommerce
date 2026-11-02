const express = require('express');
const { renderRegister, register, verifyOTP, resendOTP } = require('../controllers/registerController');
const router = express.Router();

router.get('/register', renderRegister);
router.post('/register', register);
router.post('/verify-otp', verifyOTP);
router.post('/resend-otp', resendOTP);

module.exports = router;
