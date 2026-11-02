# Orvella E-Commerce

## Project Description
Orvella is a full-stack e-commerce web application designed for a smooth online shopping experience. It features customer authentication with OTP and Google sign-in, product browsing with search and filters, cart and wishlist management, multi-gateway payments (COD, Razorpay, Wallet), and an admin panel to manage products, categories, orders, and sales reports.

## Features
- **User Authentication:** Email registration with OTP verification, Google SSO login, and password reset.
- **Product Browsing:** Search, category filtering, sorting, and product image zoom.
- **Cart & Wishlist:** Add to cart, quantity control, wishlist management, and coupon discounts.
- **Checkout & Payments:** Cash on Delivery (COD), Razorpay online payment, and In-App Wallet.
- **Order Management:** Real-time order tracking, order cancellation, returns, and downloadable PDF invoices.
- **Admin Panel:** Dashboard with analytics, product & category CRUD, coupon management, order status updates, and sales reports (Excel/PDF).

## Technologies Used
- **Backend:** Node.js, Express.js
- **Database:** MongoDB, Mongoose
- **Frontend:** EJS, CSS, JavaScript
- **Authentication:** bcryptjs, express-session, Google OAuth 2.0
- **Services & Tools:** Nodemailer (Email OTP), Razorpay (Payments), Sharp (Image processing), PDFKit, ExcelJS

## Installation Steps

1. **Clone the repository:**
   ```bash
   git clone https://github.com/your-username/orvella-ecommerce.git
   cd orvella-ecommerce
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure environment variables:**
   Create a `.env` file in the root folder using `.env.example`:
   

4. **Seed sample data (Optional):**
   ```bash
   npm run seed:categories
   npm run seed:catalog
   ```

5. **Create an admin account:**
   ```bash
   npm run create:admin
   ```

## How to Run the Project

1. **Start the server:**
   ```bash
   npm start
   ```

2. **Open in browser:**
   - **Store:** http://localhost:3000
