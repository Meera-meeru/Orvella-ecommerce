const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Category = require('../models/Category');
const categories = require('../config/defaultCategories');

const main = async () => {
  await connectDB();
  for (const [name, description] of Object.entries(categories)) {
    const category = await Category.findOneAndUpdate(
      { name },
      { $setOnInsert: { name, description, isDeleted: false } },
      { upsert: true, returnDocument: 'after', runValidators: true }
    );
    if (category.isDeleted) {
      throw new Error(`Restore the deleted "${name}" category before seeding categories.`);
    }
  }
  console.log(`Category seed complete: ${Object.keys(categories).length} default categories are available.`);
};

main()
  .catch((error) => {
    console.error('Could not seed the default categories.', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
