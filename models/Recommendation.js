const mongoose = require('mongoose');
const recommendationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  playlistId: {
    type: String,
    required: true,
  },
  playlistName: {
    type: String,
    required: true,
  },
  playlistImage: {
    type: String,
  },
  speed: {
    type: String, // 'slow', 'moderate', 'fast', 'very_fast'
    required: false,
  },
  weather: {
    type: String, // 'sunny', 'rainy', 'cloudy', 'snowy'
    required: false,
  },
  timeOfDay: {
    type: String, // 'morning', 'afternoon', 'evening', 'night'
    required: false,
  },
  spotifyUri: {
    type: String,
  },
  tracksCount: {
    type: Number,
  },
  tracks: [{
    spotifyId: String,
    name: String,
    artist: String,
    album: String,
    uri: String,
    imageUrl: String,
  }],
  createdAt: {
    type: Date,
    default: Date.now,
  },
  lastPlayedAt: {
    type: Date,
  },
});
module.exports = mongoose.model('Recommendation', recommendationSchema);
