require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const db = new Database(path.join(__dirname, 'cha-casa-nova.db'));
const PORT = process.env.PORT || 3000;

// Habilita foreign keys
db.pragma('foreign_keys = ON');

// Cria tabelas
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
    FOREIGN KEY(reserved_by) REFERENCES users(id)
  );
`);

// Configuraç»µes
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Sess」o
app.use(session({
  secret: process.env.SESSION_SECRET || 'troque-este-segredo-em-producao',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax'
  }
}));

// Middlewares
const auth = (req, res, next) => {
  if (req.session.userId) next();
  else res.redirect('/login');
};

const admin = (req, res, next) => {
  if (req.session.isAdmin) next();
  else res.status(403).send('Acesso negado.');
};

// Rotas
app.get('/', (req, res) => {
  if (req.session.userId) {
    res.redirect(req.session.isAdmin ? '/admin' : '/gifts');
  } else {
    res.redirect('/login');
  }
});

app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.render('login', { error: 'Informe seu nome.' });
  
  let user = db.prepare('SELECT * FROM users WHERE name = ?').get(name);
  if (!user) {
    const result = db.prepare('INSERT INTO users(name) VALUES(?)').run(name);
    user = { id: result.lastInsertRowid, name, is_admin: 0 };
  }
  
  req.session.userId = Number(user.id);
  req.session.userName = user.name;
  req.session.isAdmin = !!user.is_admin;
  
  res.redirect(user.is_admin ? '/admin' : '/gifts');
});

app.get('/admin/login', (req, res) => {
  res.render('admin-login', { error: null });
});

app.post('/admin/login', (req, res) => {
  const name = (req.body.name || '').trim();
  const password = req.body.password || '';
  
  const user = db.prepare('SELECT * FROM users WHERE name = ? AND is_admin = 1').get(name);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.render('admin-login', { error: 'Credenciais invá¡¡lidas.' });
  }
  
  req.session.userId = user.id;
  req.session.userName = user.name;
  req.session.isAdmin = true;
  res.redirect('/admin');
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

app.get('/setup-admin', (req, res) => {
  const exists = db.prepare('SELECT 1 FROM users WHERE is_admin = 1').get();
  if (exists) return res.status(404).send('Administrador já configurado.');
  res.render('setup-admin', { error: null });
});

app.post('/setup-admin', (req, res) => {
  const exists = db.prepare('SELECT 1 FROM users WHERE is_admin = 1').get();
  if (exists) return res.status(404).send('Administrador já configurado.');
  
  const name = (req.body.name || '').trim();
  const password = req.body.password || '';
  
  if (!name || password.length < 6) {
    return res.render('setup-admin', { error: 'Informe nome e senha com pelo menos 6 caracteres.' });
  }
  
  db.prepare('INSERT INTO users(name, is_admin, password_hash) VALUES(?, 1, ?)')
    .run(name, bcrypt.hashSync(password, 12));
  
  res.redirect('/admin/login');
});

app.get('/gifts', auth, (req, res) => {
  if (req.session.isAdmin) return res.redirect('/admin');
  
  const gifts = db.prepare(`
    SELECT id, name, description, price, image_url, reserved_by 
    FROM gifts 
    ORDER BY id DESC
  `).all();
  
  res.render('gifts', { gifts, userName: req.session.userName });
});

app.post('/gifts/:id/reserve', auth, (req, res) => {
  if (req.session.isAdmin) return res.status(403).json({ error: 'Acesso negado.' });
  
  const result = db.prepare(`
    UPDATE gifts 
    SET reserved_by = ?, reserved_at = CURRENT_TIMESTAMP 
    WHERE id = ? AND reserved_by IS NULL
  `).run(req.session.userId, req.params.id);
  
  if (!result.changes) {
    return res.status(409).json({ error: 'Este presente acabou de ser reservado por outra pessoa.' });
  }
  
  res.json({ ok: true });
});

app.get('/admin', auth, admin, (req, res) => {
  const gifts = db.prepare(`
    SELECT g.*, u.name as reserved_by_name 
    FROM gifts g 
    LEFT JOIN users u ON u.id = g.reserved_by 
    ORDER BY g.id DESC
  `).all();
  
  res.render('admin', { gifts });
});

app.post('/admin/gifts', auth, admin, (req, res) => {
  const { name, description, price, image_url } = req.body;
  if (!(name || '').trim()) return res.redirect('/admin');
  
  db.prepare(`
    INSERT INTO gifts(name, description, price, image_url) 
    VALUES(?, ?, ?, ?)
  `).run(
    name.trim(),
    description?.trim() || null,
    price ? Number(price) : null,
    image_url?.trim() || null
  );
  
  res.redirect('/admin');
});

app.post('/admin/gifts/:id/delete', auth, admin, (req, res) => {
  db.prepare('DELETE FROM gifts WHERE id = ?').run(req.params.id);
  res.redirect('/admin');
});

app.post('/admin/gifts/:id/reset', auth, admin, (req, res) => {
  db.prepare('UPDATE gifts SET reserved_by = NULL, reserved_at = NULL WHERE id = ?')
    .run(req.params.id);
  res.redirect('/admin');
});

app.listen(PORT, () => {
  console.log(`\n✅ Servidor rodando em http://localhost:${PORT}\n`);
  console.log('🔐 Primeiro acesso: http://localhost:' + PORT + '/setup-admin\n');
});
