// server/index.js
import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import cors from 'cors';
import { fileURLToPath } from 'url';

dotenv.config();
const app = express();
const PORT = process.env.PORT || 5000;
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const JWT_SECRET = process.env.JWT_SECRET || 'replace-this-secret';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const USERS_FILE = path.join(__dirname, 'users.json');

if (!TMDB_API_KEY) {
  console.error('Missing TMDB_API_KEY in .env');
  process.exit(1);
}

// ensure users.json exists
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, JSON.stringify([]));

app.use(express.json());
// app.use(cors()); // during development; 
app.use(cors({
  origin: ['https://moviehub-3sw3.onrender.com', 'http://localhost:5000'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
})); // tighten in production

// helper: read/write users
function readUsers() {
  return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8') || '[]');
}
function writeUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// auth middleware
function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'Missing auth token' });
  const token = auth.split(' ')[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// ----- TMDb proxy endpoints -----
app.get('/api/trending/:mediaType/:timeWindow', async (req, res) => {
  const { mediaType, timeWindow } = req.params;
  try {
    const r = await axios.get(`${TMDB_BASE}/trending/${mediaType}/${timeWindow}`, {
      params: { api_key: TMDB_API_KEY },
    });
    res.json(r.data);
  } catch (err) {
    res.status(500).json({ error: 'TMDb error', details: err.message });
  }
});

app.get('/api/movie/:id', async (req, res) => {
  try {
    const r = await axios.get(`${TMDB_BASE}/movie/${req.params.id}`, {
      params: { api_key: TMDB_API_KEY, append_to_response: 'videos,credits' },
    });
    res.json(r.data);
  } catch (err) {
    res.status(500).json({ error: 'TMDb error', details: err.message });
  }
});

app.get('/api/search/movie', async (req, res) => {
  try {
    const r = await axios.get(`${TMDB_BASE}/search/movie`, {
      params: { api_key: TMDB_API_KEY, ...req.query },
    });
    res.json(r.data);
  } catch (err) {
    res.status(500).json({ error: 'TMDb error', details: err.message });
  }
});

app.get('/api/configuration', async (req, res) => {
  try {
    const r = await axios.get(`${TMDB_BASE}/configuration`, {
      params: { api_key: TMDB_API_KEY },
    });
    res.json(r.data);
  } catch (err) {
    res.status(500).json({ error: 'TMDb error', details: err.message });
  }
});

// ----- Simple auth (signup/login) -----
// Signup: { name, email, password }
app.post('/auth/signup', async (req, res) => {
  const { name, email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Missing fields' });
  const users = readUsers();
  if (users.find(u => u.email === email)) return res.status(400).json({ error: 'Email exists' });
  const hash = await bcrypt.hash(password, 10);
  const newUser = { id: Date.now().toString(), name: name || '', email, passwordHash: hash, watchlist: [] };
  users.push(newUser);
  writeUsers(users);
  const token = jwt.sign({ id: newUser.id, email }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: newUser.id, name: newUser.name, email: newUser.email } });
});

// Login: { email, password }
app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const users = readUsers();
  const user = users.find(u => u.email === email);
  if (!user) return res.status(400).json({ error: 'Invalid credentials' });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(400).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
});

// Get current user
app.get('/auth/me', authMiddleware, (req, res) => {
  const users = readUsers();
  const u = users.find(x => x.id === req.user.id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  res.json({ id: u.id, name: u.name, email: u.email, watchlist: u.watchlist || [] });
});

// Watchlist (protected) - GET and POST
app.get('/api/watchlist', authMiddleware, (req, res) => {
  const users = readUsers();
  const u = users.find(x => x.id === req.user.id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  res.json({ watchlist: u.watchlist || [] });
});

app.post('/api/watchlist', authMiddleware, (req, res) => {
  // body: { movie }
  const users = readUsers();
  const uIndex = users.findIndex(x => x.id === req.user.id);
  if (uIndex === -1) return res.status(404).json({ error: 'User not found' });
  const movie = req.body.movie;
  if (!movie || !movie.id) return res.status(400).json({ error: 'Missing movie' });
  users[uIndex].watchlist = users[uIndex].watchlist || [];
  // toggle: remove if exists else add
  const exists = users[uIndex].watchlist.find(m => m.id === movie.id);
  if (exists) users[uIndex].watchlist = users[uIndex].watchlist.filter(m => m.id !== movie.id);
  else users[uIndex].watchlist.push(movie);
  writeUsers(users);
  res.json({ watchlist: users[uIndex].watchlist });
});

// Serve client static files (expects client folder sibling to server)
app.use(express.static(path.join(__dirname, '../client')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client', 'index.html'));
});

// app.use(express.static(path.join(process.cwd(), 'client')));
// app.get('*', (req, res) => {
//   res.sendFile(path.join(process.cwd(), 'client', 'index.html'));
// });

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
