const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Category = require('../models/Category');
const Product = require('../models/Product');
const categories = require('../config/defaultCategories');

const products = [
  {
    name: 'Studio Wireless Headphones',
    category: 'Audio',
    price: 5499,
    discountPercent: 8,
    stock: 14,
    featured: false,
    image: 'orvella-studio-headphones.webp',
    description: 'Comfortable over-ear headphones with detailed sound for work, travel, and downtime.',
    highlights: ['Soft cushioned ear cups', 'Foldable travel-friendly design', 'Wireless listening'],
    specifications: [{ name: 'Style', value: 'Over-ear' }, { name: 'Colour', value: 'Black' }]
  },
  {
    name: 'Metro Canvas Backpack',
    category: 'Bags & Travel',
    price: 2499,
    discountPercent: 0,
    stock: 18,
    featured: false,
    image: 'orvella-metro-backpack.webp',
    description: 'A clean, roomy backpack that keeps everyday essentials close at hand.',
    highlights: ['Spacious main compartment', 'Front zip pocket', 'Padded adjustable straps'],
    specifications: [{ name: 'Style', value: 'Everyday backpack' }, { name: 'Colour', value: 'Midnight navy' }]
  },
  {
    name: 'Arc Adjustable Desk Lamp',
    category: 'Home & Office',
    price: 3299,
    discountPercent: 10,
    stock: 9,
    featured: true,
    image: 'orvella-arc-desk-lamp.webp',
    description: 'A sculptural task lamp that brings focused light to a desk or reading corner.',
    highlights: ['Adjustable shade', 'Minimal matte finish', 'Made for desks and bedside tables'],
    specifications: [{ name: 'Style', value: 'Task lamp' }, { name: 'Colour', value: 'Charcoal' }]
  },
  {
    name: 'Pace Knit Running Shoes',
    category: 'Footwear',
    price: 4599,
    discountPercent: 0,
    stock: 16,
    featured: false,
    image: 'orvella-pace-sneakers.webp',
    description: 'Lightweight knit trainers with a cushioned sole for everyday walks and runs.',
    highlights: ['Breathable knit upper', 'Cushioned sole', 'Everyday active fit'],
    specifications: [{ name: 'Style', value: 'Running shoes' }, { name: 'Colour', value: 'Red' }]
  },
  {
    name: 'Tempo Smart Watch',
    category: 'Accessories',
    price: 3999,
    discountPercent: 12,
    stock: 20,
    featured: false,
    image: 'orvella-tempo-watch.webp',
    description: 'A clean, modern smartwatch style that pairs easily with everyday outfits.',
    highlights: ['Lightweight profile', 'Soft silicone-style band', 'Simple modern design'],
    specifications: [{ name: 'Style', value: 'Smart watch' }, { name: 'Colour', value: 'White' }]
  },
  {
    name: 'Noir Stoneware Coffee Cup',
    category: 'Drinkware',
    price: 649,
    discountPercent: 0,
    stock: 32,
    featured: false,
    image: 'orvella-stoneware-cup.webp',
    description: 'A generous stoneware cup for slow mornings and your favourite coffee.',
    highlights: ['Comfortable handle', 'Rich glazed finish', 'Made for daily coffee moments'],
    specifications: [{ name: 'Style', value: 'Stoneware cup' }, { name: 'Colour', value: 'Black' }]
  },
  {
    name: 'Rose Restore Facial Serum',
    category: 'Beauty & Wellness',
    price: 1299,
    discountPercent: 5,
    stock: 21,
    featured: false,
    image: 'orvella-studio-skincare.webp',
    description: 'A lightweight botanical-inspired serum for a simple, refreshing self-care routine.',
    highlights: ['Easy dropper application', 'Lightweight daily-care formula', 'A thoughtful addition to a skincare routine'],
    specifications: [{ name: 'Style', value: 'Facial serum' }, { name: 'Size', value: '30 ml' }]
  },
  {
    name: 'Indoor Plant Collection',
    category: 'Home & Office',
    price: 1799,
    discountPercent: 0,
    stock: 12,
    featured: false,
    image: 'orvella-olive-planter.webp',
    description: 'A leafy mix of indoor plants to bring a fresh, natural touch to a room.',
    highlights: ['A mix of leafy indoor plants', 'Easy to style at home or work', 'Natural green colour'],
    specifications: [{ name: 'Style', value: 'Indoor plants' }, { name: 'Use', value: 'Home or office' }]
  },
  {
    name: 'Cove Leather Sofa',
    category: 'Home & Office',
    price: 28999,
    discountPercent: 0,
    stock: 4,
    featured: false,
    image: 'orvella-cove-sofa.webp',
    description: 'A generous, low-profile sectional sofa that makes a warm centrepiece for the living room.',
    highlights: ['Roomy sectional shape', 'Low-profile modern silhouette', 'Designed for relaxed living spaces'],
    specifications: [{ name: 'Style', value: 'Sectional sofa' }, { name: 'Colour', value: 'Charcoal' }]
  },
  {
    name: 'Classic 35 Film Camera',
    category: 'Cameras & Tech',
    price: 8999,
    discountPercent: 0,
    stock: 7,
    featured: false,
    image: 'orvella-camera.webp',
    description: 'A timeless film-camera look for collectors and anyone who loves analogue photography.',
    highlights: ['Classic film-camera design', 'Compact everyday form', 'A distinctive gift for photography lovers'],
    specifications: [{ name: 'Style', value: '35 mm film camera' }, { name: 'Finish', value: 'Black and silver' }]
  },
  {
    name: 'Sunset Aviator Sunglasses',
    category: 'Accessories',
    price: 1499,
    discountPercent: 0,
    stock: 18,
    featured: false,
    image: 'orvella-classic-sunglasses.webp',
    description: 'A classic aviator silhouette with warm lenses for bright days out.',
    highlights: ['Timeless aviator shape', 'Warm tinted lenses', 'Lightweight everyday accessory'],
    specifications: [{ name: 'Style', value: 'Aviator' }, { name: 'Lens', value: 'Warm tint' }]
  }
];

const main = async () => {
  for (const product of products) {
    const imagePath = path.join(__dirname, '..', 'public', 'uploads', 'products', product.image);
    await fs.promises.access(imagePath, fs.constants.R_OK);
  }

  await connectDB();

  const categoryIds = new Map();
  for (const [name, description] of Object.entries(categories)) {
    const category = await Category.findOneAndUpdate(
      { name },
      { $setOnInsert: { name, description, isDeleted: false } },
      { upsert: true, returnDocument: 'after', runValidators: true }
    );
    if (category.isDeleted) throw new Error(`Restore the deleted "${name}" category before seeding products.`);
    categoryIds.set(name, category._id);
  }

  let added = 0;
  for (const product of products) {
    const { image, category, ...values } = product;
    const result = await Product.updateOne(
      { name: values.name },
      {
        $setOnInsert: {
          ...values,
          category: categoryIds.get(category),
          images: [`/uploads/products/${image}`]
        }
      },
      { upsert: true, runValidators: true }
    );
    if (result.upsertedCount) added += 1;
  }

  console.log(`Catalog seed complete: added ${added} products (${products.length} available in the demo catalog).`);
};

main()
  .catch((error) => {
    console.error('Could not seed the demo catalog.', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
