const express = require('express');
const axios = require('axios');
const qs = require('qs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const SpotifyToken = require('../models/SpotifyToken');
const Recommendation = require('../models/Recommendation');
const router = express.Router();
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const SPOTIFY_REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI || 'http://127.0.0.1:5000/api/spotify/callback';

router.get('/login', (req, res) => {
  const scopes = [
    'playlist-read-private',
    'playlist-read-collaborative',
    'playlist-modify-public',
    'playlist-modify-private',
    'user-read-private',
    'user-read-email',
    'user-read-playback-state',
    'user-modify-playback-state',
    'user-top-read',
    'user-read-recently-played'
  ];
  const authUrl = `https://accounts.spotify.com/authorize?${qs.stringify({
    client_id: SPOTIFY_CLIENT_ID,
    response_type: 'code',
    redirect_uri: SPOTIFY_REDIRECT_URI,
    scope: scopes.join(' '),
    state: Math.random().toString(36).substring(7)
  })}`;
  res.redirect(authUrl);
});

router.get('/callback', async (req, res) => {
  const { code, error } = req.query;
  console.log('Callback received with code:', code ? '✓ Present' : '✗ Missing');
  console.log('Query params:', req.query);
  
  if (error) {
    console.error('Spotify error:', error);
    return res.status(400).json({ message: 'Spotify auth error', error });
  }
  
  if (!code) {
    console.error('No authorization code received');
    return res.status(400).json({ message: 'No authorization code received' });
  }
  
  try {
    const tokenResponse = await axios.post(
      'https://accounts.spotify.com/api/token',
      qs.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri: SPOTIFY_REDIRECT_URI,
        client_id: SPOTIFY_CLIENT_ID,
        client_secret: SPOTIFY_CLIENT_SECRET
      }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }
    );
    
    const { access_token, refresh_token, expires_in } = tokenResponse.data;
    const spotifyUserResponse = await axios.get('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${access_token}` }
    });
    
    const spotifyUser = spotifyUserResponse.data;
    
    let user = await User.findOne({ spotifyId: spotifyUser.id });
    if (!user) {
      user = new User({
        name: spotifyUser.display_name,
        email: spotifyUser.email || `spotify-${spotifyUser.id}@spotify.com`,
        spotifyId: spotifyUser.id,
        password: 'spotify-oauth'
      });
      await user.save();
    }
    
    let spotifyToken = await SpotifyToken.findOne({ userId: user._id });
    if (!spotifyToken) {
      spotifyToken = new SpotifyToken({
        userId: user._id,
        accessToken: access_token,
        refreshToken: refresh_token,
        expiresAt: new Date(Date.now() + expires_in * 1000)
      });
    } else {
      spotifyToken.accessToken = access_token;
      spotifyToken.refreshToken = refresh_token;
      spotifyToken.expiresAt = new Date(Date.now() + expires_in * 1000);
    }
    
    await spotifyToken.save();
    
    const appToken = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET || 'your_jwt_secret_key_here',
      { expiresIn: '7d' }
    );
    
    const userAgent = req.headers['user-agent'] || '';
    if (userAgent.includes('Android')) {
      res.redirect(`mongodb-android://callback?token=${appToken}&user_id=${user._id}`);
    } else {
      res.redirect(`/analysis.html?token=${appToken}&user_id=${user._id}`);
    }
  } catch (error) {
    console.error('Spotify auth error:', error);
    res.status(500).json({ message: 'Authentication failed', error: error.message });
  }
});

router.post('/refresh-token', async (req, res) => {
  try {
    const userId = req.userId;
    const spotifyToken = await SpotifyToken.findOne({ userId });
    
    if (!spotifyToken) {
      return res.status(404).json({ message: 'Spotify token not found' });
    }
    
    if (new Date() > spotifyToken.expiresAt) {
      const tokenResponse = await axios.post(
        'https://accounts.spotify.com/api/token',
        qs.stringify({
          grant_type: 'refresh_token',
          refresh_token: spotifyToken.refreshToken,
          client_id: SPOTIFY_CLIENT_ID,
          client_secret: SPOTIFY_CLIENT_SECRET
        }),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        }
      );
      
      spotifyToken.accessToken = tokenResponse.data.access_token;
      spotifyToken.expiresAt = new Date(Date.now() + tokenResponse.data.expires_in * 1000);
      await spotifyToken.save();
    }
    
    res.json({ accessToken: spotifyToken.accessToken });
  } catch (error) {
    res.status(500).json({ message: 'Token refresh failed', error: error.message });
  }
});

router.get('/profile', async (req, res) => {
  try {
    const userId = req.query.userId || req.userId;
    const spotifyToken = await SpotifyToken.findOne({ userId });
    
    if (!spotifyToken) {
      return res.status(404).json({ message: 'Spotify token not found' });
    }
    
    if (new Date() > spotifyToken.expiresAt) {
      const tokenResponse = await axios.post(
        'https://accounts.spotify.com/api/token',
        qs.stringify({
          grant_type: 'refresh_token',
          refresh_token: spotifyToken.refreshToken,
          client_id: SPOTIFY_CLIENT_ID,
          client_secret: SPOTIFY_CLIENT_SECRET
        }),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        }
      );
      
      spotifyToken.accessToken = tokenResponse.data.access_token;
      spotifyToken.expiresAt = new Date(Date.now() + tokenResponse.data.expires_in * 1000);
      await spotifyToken.save();
    }
    
    const profileResponse = await axios.get('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${spotifyToken.accessToken}` }
    });
    
    res.json({
      profile: {
        name: profileResponse.data.display_name,
        email: profileResponse.data.email,
        country: profileResponse.data.country,
        followers: profileResponse.data.followers.total,
        imageUrl: profileResponse.data.images[0]?.url,
        product: profileResponse.data.product
      }
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ message: 'Failed to get profile', error: error.message });
  }
});

router.get('/top-tracks', async (req, res) => {
  try {
    const userId = req.query.userId || req.userId;
    const spotifyToken = await SpotifyToken.findOne({ userId });
    
    if (!spotifyToken) {
      return res.status(404).json({ message: 'Spotify token not found' });
    }
    
    if (new Date() > spotifyToken.expiresAt) {
      const tokenResponse = await axios.post(
        'https://accounts.spotify.com/api/token',
        qs.stringify({
          grant_type: 'refresh_token',
          refresh_token: spotifyToken.refreshToken,
          client_id: SPOTIFY_CLIENT_ID,
          client_secret: SPOTIFY_CLIENT_SECRET
        }),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        }
      );
      
      spotifyToken.accessToken = tokenResponse.data.access_token;
      spotifyToken.expiresAt = new Date(Date.now() + tokenResponse.data.expires_in * 1000);
      await spotifyToken.save();
    }
    
    const tracksResponse = await axios.get('https://api.spotify.com/v1/me/top/tracks?limit=20&time_range=short_term', {
      headers: { Authorization: `Bearer ${spotifyToken.accessToken}` }
    });
    
    const tracks = tracksResponse.data.items.map(track => ({
      id: track.id,
      name: track.name,
      artist: track.artists[0].name,
      album: track.album.name,
      imageUrl: track.album.images[0]?.url,
      previewUrl: track.preview_url,
      spotifyUrl: track.external_urls.spotify,
      uri: track.uri
    }));
    
    res.json({ tracks });
  } catch (error) {
    console.error('Get top tracks error:', error);
    res.status(500).json({ message: 'Failed to get top tracks', error: error.message });
  }
});

router.get('/top-artists', async (req, res) => {
  try {
    const userId = req.query.userId || req.userId;
    const spotifyToken = await SpotifyToken.findOne({ userId });
    
    if (!spotifyToken) {
      return res.status(404).json({ message: 'Spotify token not found' });
    }
    
    if (new Date() > spotifyToken.expiresAt) {
      const tokenResponse = await axios.post(
        'https://accounts.spotify.com/api/token',
        qs.stringify({
          grant_type: 'refresh_token',
          refresh_token: spotifyToken.refreshToken,
          client_id: SPOTIFY_CLIENT_ID,
          client_secret: SPOTIFY_CLIENT_SECRET
        }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );
      
      spotifyToken.accessToken = tokenResponse.data.access_token;
      spotifyToken.expiresAt = new Date(Date.now() + tokenResponse.data.expires_in * 1000);
      await spotifyToken.save();
    }
    
    const artistsResponse = await axios.get('https://api.spotify.com/v1/me/top/artists?limit=10', {
      headers: { Authorization: `Bearer ${spotifyToken.accessToken}` }
    });
    
    const artists = artistsResponse.data.items.map(artist => ({
      id: artist.id,
      name: artist.name,
      genres: artist.genres,
      imageUrl: artist.images[0]?.url,
      popularity: artist.popularity,
      followers: artist.followers.total,
      spotifyUrl: artist.external_urls.spotify
    }));
    
    res.json({ artists });
  } catch (error) {
    console.error('Get top artists error:', error);
    res.status(500).json({ message: 'Failed to get top artists', error: error.message });
  }
});

router.get('/recently-played', async (req, res) => {
  try {
    const userId = req.query.userId || req.userId;
    const spotifyToken = await SpotifyToken.findOne({ userId });
    
    if (!spotifyToken) {
      return res.status(404).json({ message: 'Spotify token not found' });
    }
    
    if (new Date() > spotifyToken.expiresAt) {
      const tokenResponse = await axios.post(
        'https://accounts.spotify.com/api/token',
        qs.stringify({
          grant_type: 'refresh_token',
          refresh_token: spotifyToken.refreshToken,
          client_id: SPOTIFY_CLIENT_ID,
          client_secret: SPOTIFY_CLIENT_SECRET
        }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );
      
      spotifyToken.accessToken = tokenResponse.data.access_token;
      spotifyToken.expiresAt = new Date(Date.now() + tokenResponse.data.expires_in * 1000);
      await spotifyToken.save();
    }
    
    const recentResponse = await axios.get('https://api.spotify.com/v1/me/player/recently-played?limit=20', {
      headers: { Authorization: `Bearer ${spotifyToken.accessToken}` }
    });
    
    const tracks = recentResponse.data.items.map(item => ({
      id: item.track.id,
      name: item.track.name,
      artist: item.track.artists[0].name,
      album: item.track.album.name,
      imageUrl: item.track.album.images[0]?.url,
      playedAt: item.played_at
    }));
    
    res.json({ tracks });
  } catch (error) {
    console.error('Get recently played error:', error);
    res.status(500).json({ message: 'Failed to get recently played', error: error.message });
  }
});

router.get('/generate-playlist', async (req, res) => {
  try {
    const userId = req.query.userId || req.userId;
    const spotifyToken = await SpotifyToken.findOne({ userId });
    
    if (!spotifyToken) {
      return res.status(404).json({ message: 'Spotify token not found' });
    }
    
    if (new Date() > spotifyToken.expiresAt) {
      const tokenResponse = await axios.post(
        'https://accounts.spotify.com/api/token',
        qs.stringify({
          grant_type: 'refresh_token',
          refresh_token: spotifyToken.refreshToken,
          client_id: SPOTIFY_CLIENT_ID,
          client_secret: SPOTIFY_CLIENT_SECRET
        }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );
      
      spotifyToken.accessToken = tokenResponse.data.access_token;
      spotifyToken.expiresAt = new Date(Date.now() + tokenResponse.data.expires_in * 1000);
      await spotifyToken.save();
    }
    
    const shortTermResponse = await axios.get('https://api.spotify.com/v1/me/top/tracks?limit=50&time_range=short_term', {
      headers: { Authorization: `Bearer ${spotifyToken.accessToken}` }
    });
    
    const mediumTermResponse = await axios.get('https://api.spotify.com/v1/me/top/tracks?limit=50&time_range=medium_term', {
      headers: { Authorization: `Bearer ${spotifyToken.accessToken}` }
    });
    
    const allTracks = [
      ...shortTermResponse.data.items,
      ...mediumTermResponse.data.items
    ];
    
    const uniqueTracks = [];
    const seenIds = new Set();
    
    for (const track of allTracks) {
      if (!seenIds.has(track.id)) {
        seenIds.add(track.id);
        uniqueTracks.push(track);
      }
    }
    
    const shuffled = uniqueTracks.sort(() => Math.random() - 0.5);
    const tracks = shuffled.slice(0, 20).map(track => ({
      id: track.id,
      name: track.name,
      artist: track.artists[0].name,
      album: track.album.name,
      imageUrl: track.album.images[0]?.url,
      previewUrl: track.preview_url,
      spotifyUrl: track.external_urls.spotify,
      uri: track.uri
    }));
    
    const currentDate = new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    res.json({
      name: `Mes Top Morceaux - ${currentDate}`,
      description: `Votre playlist personnalisée avec vos 20 morceaux préférés de ce mois`,
      tracks
    });
  } catch (error) {
    console.error('Generate playlist error:', error);
    res.status(500).json({ message: 'Failed to generate playlist', error: error.message });
  }
});

router.post('/save-playlist', async (req, res) => {
  try {
    const userId = req.query.userId || req.userId;
    const { name, description, trackUris, tracks } = req.body;
    
    if (!trackUris || trackUris.length === 0) {
      return res.status(400).json({ message: 'No tracks provided' });
    }
    
    const spotifyToken = await SpotifyToken.findOne({ userId });
    
    if (!spotifyToken) {
      return res.status(404).json({ message: 'Spotify token not found' });
    }
    
    if (new Date() > spotifyToken.expiresAt) {
      const tokenResponse = await axios.post(
        'https://accounts.spotify.com/api/token',
        qs.stringify({
          grant_type: 'refresh_token',
          refresh_token: spotifyToken.refreshToken,
          client_id: SPOTIFY_CLIENT_ID,
          client_secret: SPOTIFY_CLIENT_SECRET
        }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );
      
      spotifyToken.accessToken = tokenResponse.data.access_token;
      spotifyToken.expiresAt = new Date(Date.now() + tokenResponse.data.expires_in * 1000);
      await spotifyToken.save();
    }
    
    const profileResponse = await axios.get('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${spotifyToken.accessToken}` }
    });
    
    const spotifyUserId = profileResponse.data.id;
    
    const createPlaylistResponse = await axios.post(
      `https://api.spotify.com/v1/users/${spotifyUserId}/playlists`,
      {
        name: name || 'Ma Playlist Personnalisée',
        description: description || 'Créée depuis MongoAndroidApp',
        public: false
      },
      { headers: { 
        Authorization: `Bearer ${spotifyToken.accessToken}`,
        'Content-Type': 'application/json'
      }}
    );
    
    const playlistId = createPlaylistResponse.data.id;
    
    await axios.post(
      `https://api.spotify.com/v1/playlists/${playlistId}/tracks`,
      { uris: trackUris },
      { headers: { 
        Authorization: `Bearer ${spotifyToken.accessToken}`,
        'Content-Type': 'application/json'
      }}
    );
    
    const playlistData = new Recommendation({
      userId,
      playlistId,
      playlistName: name || 'Ma Playlist Personnalisée',
      playlistImage: createPlaylistResponse.data.images?.[0]?.url,
      tracksCount: trackUris.length,
      spotifyUri: createPlaylistResponse.data.uri,
      tracks: tracks || [], 
    });
    
    await playlistData.save();
    
    res.json({
      success: true,
      playlistId,
      playlistUrl: createPlaylistResponse.data.external_urls.spotify,
      message: 'Playlist créée et sauvegardée avec succès !'
    });
  } catch (error) {
    console.error('Save playlist error:', error.response?.data || error.message);
    res.status(500).json({ 
      message: 'Failed to save playlist', 
      error: error.response?.data || error.message 
    });
  }
});

router.post('/generate-smart-playlist', async (req, res) => {
  try {
    const userId = req.query.userId || req.userId;
    const { weather, temperature, time, speed } = req.body;
    
    const spotifyToken = await SpotifyToken.findOne({ userId });
    
    if (!spotifyToken) {
      return res.status(404).json({ message: 'Spotify token not found' });
    }
    
    if (new Date() > spotifyToken.expiresAt) {
      const tokenResponse = await axios.post(
        'https://accounts.spotify.com/api/token',
        qs.stringify({
          grant_type: 'refresh_token',
          refresh_token: spotifyToken.refreshToken,
          client_id: SPOTIFY_CLIENT_ID,
          client_secret: SPOTIFY_CLIENT_SECRET
        }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );
      
      spotifyToken.accessToken = tokenResponse.data.access_token;
      spotifyToken.expiresAt = new Date(Date.now() + tokenResponse.data.expires_in * 1000);
      await spotifyToken.save();
    }
    
    let energy = 0.5; 
    let valence = 0.5; 
    let tempo = 120; 
    let playlistName = '';
    let playlistDescription = '';
    
    if (speed < 50) {
      energy = 0.3;
      tempo = 90;
      playlistName = 'Conduite Relaxée';
    } else if (speed < 90) {
      energy = 0.5;
      tempo = 120;
      playlistName = 'Route Tranquille';
    } else if (speed < 130) {
      energy = 0.7;
      tempo = 140;
      playlistName = 'Autoroute Dynamique';
    } else {
      energy = 0.9;
      tempo = 160;
      playlistName = 'Mode Sport';
    }
    
    if (weather === 'rain' || weather === 'rainy' || weather === 'drizzle') {
      valence = 0.3;
      energy = Math.max(0.3, energy - 0.2);
      playlistName = 'Pluie - ' + playlistName;
      playlistDescription = 'Mélodie pour la pluie';
    } else if (weather === 'clear' || weather === 'sunny') {
      valence = 0.8;
      playlistName = 'Soleil - ' + playlistName;
      playlistDescription = 'Vibes ensoleillées';
    } else if (weather === 'clouds' || weather === 'cloudy') {
      valence = 0.5;
      playlistName = 'Nuageux - ' + playlistName;
      playlistDescription = 'Ambiance douce';
    } else if (weather === 'snow') {
      valence = 0.6;
      energy = Math.max(0.3, energy - 0.1);
      playlistName = 'Neige - ' + playlistName;
      playlistDescription = 'Paysages hivernaux';
    } else if (weather === 'thunderstorm' || weather === 'storm') {
      valence = 0.4;
      energy = 0.8;
      playlistName = 'Orage - ' + playlistName;
      playlistDescription = 'Énergie électrique';
    }
    
    const hour = parseInt(time.split(':')[0]);
    if (hour >= 5 && hour < 9) {
      valence = Math.min(1, valence + 0.2);
      playlistDescription += ' - Réveil en douceur';
    } else if (hour >= 9 && hour < 12) {
      energy = Math.min(1, energy + 0.1);
      playlistDescription += ' - Matinée productive';
    } else if (hour >= 12 && hour < 14) {
      valence = Math.min(1, valence + 0.1);
      playlistDescription += ' - Pause déjeuner';
    } else if (hour >= 14 && hour < 18) {
      energy = Math.min(1, energy + 0.15);
      playlistDescription += ' - Après-midi dynamique';
    } else if (hour >= 18 && hour < 22) {
      valence = 0.6;
      playlistDescription += ' - Soirée détente';
    } else {
      energy = Math.max(0.2, energy - 0.3);
      valence = 0.4;
      playlistDescription += ' - Nuit calme';
    }
    
    if (temperature > 25) {
      valence = Math.min(1, valence + 0.1);
    } else if (temperature < 5) {
      energy = Math.max(0.2, energy - 0.1);
    }
    
    let timeRanges = [];
    if (energy < 0.4) {
      timeRanges = ['long_term', 'medium_term']; 
    } else if (energy > 0.7) {
      timeRanges = ['short_term', 'medium_term']; 
    } else {
      timeRanges = ['short_term', 'medium_term', 'long_term']; 
    }
    
    const trackPromises = timeRanges.map(range =>
      axios.get(`https://api.spotify.com/v1/me/top/tracks?time_range=${range}&limit=50`, {
        headers: { Authorization: `Bearer ${spotifyToken.accessToken}` }
      })
    );
    
    const trackResponses = await Promise.all(trackPromises);
    let allTracks = [];
    
    trackResponses.forEach(response => {
      allTracks = [...allTracks, ...response.data.items];
    });
    
    const uniqueTracks = [];
    const seenIds = new Set();
    
    for (const track of allTracks) {
      if (!seenIds.has(track.id)) {
        seenIds.add(track.id);
        uniqueTracks.push(track);
      }
    }
    
    let tracks = uniqueTracks;
    
    if (energy > 0.7) {
      tracks = tracks.sort((a, b) => b.popularity - a.popularity);
    } else if (energy < 0.4) {
      tracks = tracks.sort((a, b) => a.popularity - b.popularity);
    } else {
      tracks = tracks.sort(() => Math.random() - 0.5);
    }
    
    if (valence < 0.4) {
      tracks = [...tracks.slice(0, 25), ...tracks.slice(25).sort(() => Math.random() - 0.5)];
    } else if (valence > 0.7) {
      tracks = [...tracks.slice(25), ...tracks.slice(0, 25).sort(() => Math.random() - 0.5)];
    }
    
    const selectedTracks = tracks.slice(0, 20).map(track => ({
      id: track.id,
      name: track.name,
      artist: track.artists[0].name,
      album: track.album.name,
      imageUrl: track.album.images[0]?.url,
      previewUrl: track.preview_url,
      spotifyUrl: track.external_urls.spotify,
      uri: track.uri
    }));
    
    res.json({
      name: playlistName,
      description: playlistDescription,
      tracks: selectedTracks,
      parameters: {
        weather,
        temperature,
        time,
        speed,
        energy: energy.toFixed(2),
        valence: valence.toFixed(2),
        tempo
      }
    });
  } catch (error) {
    console.error('Generate smart playlist error:', error.response?.data || error.message);
    const statusCode = error.response?.status || 500;
    res.status(statusCode).json({ 
      message: 'Failed to generate smart playlist', 
      error: error.response?.data || error.message 
    });
  }
});

module.exports = router;
