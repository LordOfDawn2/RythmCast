const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/mongo-android-app', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('MongoDB connected'))
.catch(err => console.log('MongoDB connection error:', err));
const userRoutes = require('./routes/userRoutes');
const spotifyRoutes = require('./routes/spotifyRoutes');
app.use('/api/users', userRoutes);
app.use('/api/spotify', spotifyRoutes);
app.get('/api/health', (req, res) => {
  res.json({ status: 'Server is running' });
});
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
