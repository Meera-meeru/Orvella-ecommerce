require('dotenv').config();

const path = require('path');
const express = require('express');
const connectDB = require('./config/db');
const appConfig = require('./config/appConfig');
const storeRoutes = require('./routes/store');
const adminPanelRoutes = require('./routes/adminPanel');
const registerRoutes = require('./routes/registerRoutes');
const authRoutes = require('./routes/authRoutes');
const userSession = require('./config/userSession');
const User = require('./models/user');

const app = express();
const port = appConfig.port;

if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(userSession);
app.use(express.static(path.join(__dirname, 'public')));

app.use(async (req, res, next) => {
  res.locals.currentUser = null;
  res.locals.isAdmin = req.session.isAdmin === true;
  res.locals.currentUserName = req.session.userName || null;
  res.locals.currentPath = req.path;
  if (!req.session.userId) return next();
  try {
    const user = await User.findById(req.session.userId).select('name email isBlocked').lean();
    if (!user || user.isBlocked) {
      delete req.session.userId;
      delete req.session.userName;
      return next();
    }
    res.locals.currentUser = user;
    res.locals.currentUserName = user.name;
    next();
  } catch (error) { next(error); }
});

app.use('/', storeRoutes);
app.use('/', authRoutes);
app.use('/', registerRoutes);
app.use('/admin', adminPanelRoutes);

app.use((req, res) => res.status(404).render('not-found', { message: 'We could not find that page.' }));
app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  res.status(500).send('Something went wrong. Check the terminal for details.');
});

connectDB()
  .then(() => app.listen(port, () => console.log(`Orvella server running at http://localhost:${port}`)))
  .catch((error) => {
    console.error('Could not connect to MongoDB. Make sure MongoDB is running.', error.message);
    process.exitCode = 1;
  });
