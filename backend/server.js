require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes = require('./src/routes/auth');
const userRoutes = require('./src/routes/users');
const calendarRoutes = require('./src/routes/calendar');
const menuRoutes = require('./src/routes/menu');
const shoppingRoutes = require('./src/routes/shopping');
const financeRoutes = require('./src/routes/finances');
const subscriptionRoutes = require('./src/routes/subscriptions');
const creditRoutes = require('./src/routes/credits');

const app = express();

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3001',
  credentials: true
}));
app.use(express.json());

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok', app: 'Domus API' }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/menu', menuRoutes);
app.use('/api/shopping', shoppingRoutes);
app.use('/api/finances', financeRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/credits', creditRoutes);

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Error interno del servidor' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Domus API corriendo en puerto ${PORT}`);
});
