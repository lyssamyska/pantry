const express = require('express');
const path = require('path');
const productPagesRouter = require('./routes/product-pages');
const plannerRouter = require('./routes/planner');
const recipeImportRouter = require('./routes/recipe-import');
const bookmarksRouter = require('./routes/bookmarks');
const recipesRouter = require('./routes/recipes');
const myRecipesRouter = require('./routes/my-recipes');
const discoveryRouter = require('./routes/discovery');
const pricesRouter = require('./routes/prices');
const authRouter = require('./routes/auth');
const onboardingRouter = require('./routes/onboarding');
const profileRouter = require('./routes/profile');
const pantryRouter = require('./routes/pantry');
const { getUserIdFromCookie } = require('./lib/user-session');
const { getSessionSecret } = require('./lib/session');
const { migrate } = require('./migrate');
const { PRICE_ESTIMATE_NOTICE } = require('./lib/austin-retailers');

const app = express();
const port = process.env.PORT || 3000;

if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable is required');
  process.exit(1);
}

try {
  getSessionSecret();
} catch (err) {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
}

app.use(express.json());
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.locals.priceEstimateNotice = PRICE_ESTIMATE_NOTICE;

app.get('/health', (_req, res) => res.json({ status: 'healthy' }));

app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Landing page
app.get('/', (_req, res) => {
  res.render('layout');
});

// Planner routes
app.use('/api/planner', plannerRouter);

// Recipe import routes
app.use('/api/recipe-import', recipeImportRouter);

// Bookmark routes
app.use('/api/bookmarks', bookmarksRouter);

// Recipe routes
app.use('/api/recipes', recipesRouter);

// My Recipes pool
app.use('/api/my-recipes', myRecipesRouter);

// Discover Recipes panel
app.use('/api/discovery', discoveryRouter);

// Price comparison
app.use('/api/prices', pricesRouter);

// Auth (email + password, signed session cookie)
app.use('/auth', authRouter);

// Account profile
app.use('/profile', profileRouter);

// Onboarding API
app.use('/api/onboarding', onboardingRouter);

// Pantry API
app.use('/api/pantry', pantryRouter);

// Product pages
app.use(productPagesRouter);

// Onboarding UI
app.get('/onboarding', (req, res) => {
  if (!getUserIdFromCookie(req)) return res.redirect('/?account=1');
  res.render('onboarding', { title: 'Welcome to Pantry' });
});

// Catch-all error handler. The four-arg signature marks this as an error
// handler in Express. Per-route catches still win for known failures; this
// only fires for things that escape them.
app.use((err, req, res, next) => {
  console.error(`[unhandled ${req.method} ${req.path}]`, err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

migrate()
  .then(() => {
    app.listen(port, () => console.log(`Server running on port ${port}`));
  })
  .catch(err => {
    console.error('Startup migration failed:', err.message);
    process.exit(1);
  });
