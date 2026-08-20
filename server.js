require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const db = new Database(path.join(__dirname, 'cha-casa-nova.db'));
const PORT = process.env.PORT || 3000;

db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    is_admin INTEGER NOT NULL DEFAULT 0,
    password_hash TEXT
  );
  CREATE TABLE IF NOT EXISTS gifts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    price REAL,
    image_url TEXT,
    reserved_by INTEGER UNIQUE,
    reserved_at TEXT,
    FOREIGN KEY (reserved_by) REFERENCES users(id)
  );
`);

const adminPasswordHash = bcrypt.hashSync('admin', 12);
const adminUser = db.prepare('SELECT id FROM users WHERE name = ? COLLATE NOCASE').get('admin');
if (adminUser) {
  db.prepare('UPDATE users SET name = ?, is_admin = 1, password_hash = ? WHERE id = ?')
    .run('admin', adminPasswordHash, adminUser.id);
} else {
  db.prepare('INSERT INTO users (name, is_admin, password_hash) VALUES (?, 1, ?)')
    .run('admin', adminPasswordHash);
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'troque-este-segredo-em-producao',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax' }
}));

const admin = (req, res, next) => req.session.isAdmin ? next() : res.redirect('/admin/login');

app.get('/', (req, res) => res.redirect(req.session.userId ? (req.session.isAdmin ? '/admin' : '/gifts') : '/login'));
app.get('/login', (req, res) => res.render('login', { error: null }));
app.post('/login', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.render('login', { error: 'Informe seu nome.' });
  let user = db.prepare('SELECT * FROM users WHERE name = ?').get(name);
  if (!user) {
    const result = db.prepare('INSERT INTO users (name) VALUES (?)').run(name);
    user = { id: result.lastInsertRowid, name, is_admin: 0 };
  }
  req.session.userId = Number(user.id);
  req.session.userName = user.name;
  req.session.isAdmin = Boolean(user.is_admin);
  return res.redirect(user.is_admin ? '/admin' : '/gifts');
});

app.get('/admin/login', (req, res) => res.render('admin-login', { error: null }));
app.post('/admin/login', (req, res) => {
  const name = (req.body.name || '').trim();
  const password = req.body.password || '';
  const user = db.prepare('SELECT * FROM users WHERE name = ? COLLATE NOCASE AND is_admin = 1').get(name);
  if (!user || !user.password_hash || !bcrypt.compareSync(password, user.password_hash)) {
    return res.render('admin-login', { error: 'Credenciais inválidas.' });
  }
  req.session.userId = user.id;
  req.session.userName = user.name;
  req.session.isAdmin = true;
  return res.redirect('/admin');
});

app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/login')));
app.get('/admin/gifts', (req, res) => res.redirect('/admin'));

app.get('/gifts', (req, res, next) => {
  if (!req.session.userId) return res.redirect('/login');
  if (req.session.isAdmin) return res.redirect('/admin');
  return next();
}, (req, res) => {
  const gifts = db.prepare('SELECT id, name, description, reserved_by FROM gifts ORDER BY id DESC').all();
  res.render('gifts', { gifts, userName: req.session.userName });
});

app.post('/gifts/:id/reserve', (req, res, next) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Faça login antes de escolher um presente.' });
  if (req.session.isAdmin) return res.status(403).json({ error: 'Acesso negado.' });
  return next();
}, (req, res) => {
  const result = db.prepare('UPDATE gifts SET reserved_by = ?, reserved_at = CURRENT_TIMESTAMP WHERE id = ? AND reserved_by IS NULL').run(req.session.userId, req.params.id);
  if (!result.changes) return res.status(409).json({ error: 'Este presente já foi reservado por outra pessoa.' });
  return res.json({ ok: true });
});

app.get('/admin', admin, (req, res) => {
  const gifts = db.prepare('SELECT g.id, g.name, g.description, g.reserved_by, g.reserved_at, u.name AS reserved_by_name FROM gifts g LEFT JOIN users u ON u.id = g.reserved_by ORDER BY g.id DESC').all();
  res.render('admin', { gifts });
});
app.post('/admin/gifts', admin, (req, res) => {
  const name = (req.body.name || '').trim();
  const description = (req.body.description || '').trim();
  if (name) db.prepare('INSERT INTO gifts (name, description) VALUES (?, ?)').run(name, description || null);
  res.redirect('/admin');
});
app.post('/admin/gifts/:id/delete', admin, (req, res) => {
  db.prepare('DELETE FROM gifts WHERE id = ?').run(req.params.id);
  res.redirect('/admin');
});
app.post('/admin/gifts/:id/reset', admin, (req, res) => {
  db.prepare('UPDATE gifts SET reserved_by = NULL, reserved_at = NULL WHERE id = ?').run(req.params.id);
  res.redirect('/admin');
});

app.listen(PORT, () => console.log(`Servidor rodando em http://localhost:${PORT}`));
