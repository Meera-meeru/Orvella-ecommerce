const mongoose = require('mongoose');
const appConfig = require('./appConfig');

const connectDB = async () => {
  await mongoose.connect(appConfig.mongoUri);
  console.log('MongoDB connected successfully');
};

module.exports = connectDB;
