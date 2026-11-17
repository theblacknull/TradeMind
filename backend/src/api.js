const express = require('express');
const connectDB = require('./database/db');
const cors = require('cors');

const app = express();
const port = 8000;

connectDB();

app.use(cors());
app.use(express.json({ limit: '8mb' }));

const authRoutes = require('./routes/authenticationRoute');
const report = require('./routes/reportRoute');
const user = require('./routes/userRoutes');

app.use('/auth', authRoutes);
app.use('/report', report);
app.use('/user', user);
app.use('/assistant', require('./routes/assistantRoute'));

app.get('/', (req, res) => {
  res.status(200).send('Server is running!');
});

// Warm the BTC/ETH/SOL outlook in the background so reports do not wait for it.
require('./services/assistant/forecast').prewarm();

app.listen(port, () => {
  console.log(`Server is listening on port ${port}`);
});