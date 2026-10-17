require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const db = new Database(path.join(__dirname, 'cha-casa-nova.db'));
const PORT = process.env.PORT || 3000;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024 } });
const UPLOAD_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const IMAGE_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
const imageUpload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${IMAGE_TYPES[file.mimetype]}`)
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, !!IMAGE_TYPES[file.mimetype])
});
const handleImage = (req, res, next) => imageUpload.single('image')(req, res, err => {
  if (err) { req.session.importResult = { type: 'error', text: err.code === 'LIMIT_FILE_SIZE' ? 'A imagem deve ter no máximo 5 MB.' : 'Não foi possível enviar a imagem.' }; return res.redirect('/admin'); }
  next();
});
const removeImage = url => { if (url && url.startsWith('/uploads/')) fs.unlink(path.join(UPLOAD_DIR, path.basename(url)), () => {}); };
const CATEGORIES = ['Cozinha', 'Sala', 'Quarto', 'Banheiro', 'Escritório', 'Lavanderia', 'Outros'];

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
    reserved_by INTEGER,
    reserved_at TEXT,
    FOREIGN KEY (reserved_by) REFERENCES users(id)
  );
`);
const giftColumns = db.prepare('PRAGMA table_info(gifts)').all();
if (!giftColumns.some(column => column.name === 'category')) db.exec("ALTER TABLE gifts ADD COLUMN category TEXT NOT NULL DEFAULT 'Outros'");
if (!giftColumns.some(column => column.name === 'color')) db.exec("ALTER TABLE gifts ADD COLUMN color TEXT");
db.prepare("UPDATE gifts SET category = 'Outros' WHERE category IS NULL OR TRIM(category) = ''").run();

// Auto-migration: Remove UNIQUE constraint on reserved_by if present from previous version
const giftsTableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='gifts'").get()?.sql || '';
if (giftsTableSql.includes('reserved_by INTEGER UNIQUE') || giftsTableSql.includes('reserved_by INT UNIQUE')) {
  db.exec(`
    PRAGMA foreign_keys = OFF;
    CREATE TABLE gifts_temp (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      price REAL,
      image_url TEXT,
      reserved_by INTEGER,
      reserved_at TEXT,
      category TEXT NOT NULL DEFAULT 'Outros',
      FOREIGN KEY (reserved_by) REFERENCES users(id)
    );
    INSERT INTO gifts_temp (id, name, description, price, image_url, reserved_by, reserved_at, category)
      SELECT id, name, description, price, image_url, reserved_by, reserved_at, category FROM gifts;
    DROP TABLE gifts;
    ALTER TABLE gifts_temp RENAME TO gifts;
    PRAGMA foreign_keys = ON;
  `);
}

// Initialize or update admin credentials
const envAdminName = (process.env.ADMIN_USERNAME || 'admin').trim();
const envAdminPassword = process.env.ADMIN_PASSWORD;

// Procura se já existe um usuário com o nome de ADMIN_USERNAME (ex: admin)
let adminUser = db.prepare('SELECT id, name, is_admin, password_hash FROM users WHERE name = ? COLLATE NOCASE').get(envAdminName);

if (!adminUser) {
  // Se não existir o usuário 'admin', cria um novo
  const defaultPass = envAdminPassword || 'admin';
  const initialHash = bcrypt.hashSync(defaultPass, 12);
  const info = db.prepare('INSERT INTO users (name, is_admin, password_hash) VALUES (?, 1, ?)').run(envAdminName, initialHash);
  adminUser = { id: info.lastInsertRowid };
} else {
  // Se já existir, garante que ele seja admin
  db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(adminUser.id);
  if (envAdminPassword) {
    const hash = bcrypt.hashSync(envAdminPassword, 12);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, adminUser.id);
  }
}

// Garante que qualquer outro usuário que não seja o adminUser atual seja apenas convidado normal (is_admin = 0)
db.prepare('UPDATE users SET is_admin = 0 WHERE id != ?').run(adminUser.id);

app.set('trust proxy', 1);
app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true })); app.use(express.json()); app.use(express.static(path.join(__dirname, 'public'))); app.use('/uploads', express.static(UPLOAD_DIR));
app.use(session({
  secret: process.env.SESSION_SECRET || 'troque-este-segredo-em-producao',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: 'auto'
  }
}));

function notifyReservation(giftId, guestName) {
  const topic = (process.env.NTFY_TOPIC || '').trim();
  if (!topic) return;
  const gift = db.prepare('SELECT name FROM gifts WHERE id = ?').get(giftId);
  if (!gift) return;
  const base = (process.env.NTFY_SERVER || 'https://ntfy.sh').replace(/\/+$/, '');
  // Cabeçalhos HTTP não aceitam acentos; título vai em UTF-8 pelo corpo da mensagem.
  fetch(`${base}/${encodeURIComponent(topic)}`, {
    method: 'POST',
    headers: { Tags: 'gift' },
    body: `${guestName} escolheu: ${gift.name}`,
    signal: AbortSignal.timeout(5000)
  }).catch(err => console.error('Falha ao enviar notificação ntfy:', err.message));
}
const admin = (req, res, next) => req.session.isAdmin ? next() : res.redirect('/admin/login');
const validCategory = value => CATEGORIES.includes(value) ? value : 'Outros';
const getGifts = () => db.prepare('SELECT g.id,g.name,g.category,g.color,g.image_url,g.reserved_by,g.reserved_at,u.name reserved_by_name FROM gifts g LEFT JOIN users u ON u.id=g.reserved_by ORDER BY g.category,g.name').all();
function csvGifts(content) { const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/); const results = []; for (let i = 0; i < lines.length; i += 1) { const line = lines[i].trim(); if (!line) continue; const columns = line.split(/[;,]/).map(value => value.trim().replace(/^"|"$/g, '')); if (i === 0 && columns[0].toLowerCase() === 'nome') continue; if (columns[0]) results.push({ name: columns[0], category: validCategory(columns[1] || 'Outros'), color: (columns[2] || '').trim() || null }); } const unique = new Map(); for (const gift of results) unique.set(`${gift.name.toLocaleLowerCase('pt-BR')}|${gift.category}`, gift); return [...unique.values()]; }

app.get('/', (req, res) => res.redirect(req.session.userId ? (req.session.isAdmin ? '/admin' : '/gifts') : '/login'));
app.get('/login', (req, res) => res.render('login', { error: null }));
app.post('/login', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.render('login', { error: 'Informe seu nome.' });

  let user = db.prepare('SELECT * FROM users WHERE name = ? COLLATE NOCASE').get(name);

  // Se o nome pertence ao administrador, não permite entrar sem senha
  if (user && user.is_admin) {
    return res.render('login', {
      error: 'Este nome pertence ao administrador. Para acessar a administração, use a Área Administrativa com sua senha.'
    });
  }

  // Se o usuário não existir, cria; se já existir, aproveita o mesmo
  if (!user) {
    const result = db.prepare('INSERT INTO users(name, is_admin) VALUES(?, 0)').run(name);
    user = { id: result.lastInsertRowid, name, is_admin: 0 };
  }

  req.session.userId = Number(user.id);
  req.session.userName = user.name;
  req.session.isAdmin = false;
  res.redirect('/gifts');
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
  res.redirect('/admin');
});
app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/login'))); app.get('/admin/gifts', (req, res) => res.redirect('/admin'));

app.get('/gifts', (req, res, next) => { if (!req.session.userId) return res.redirect('/login'); if (req.session.isAdmin) return res.redirect('/admin'); next(); }, (req, res) => {
  const gifts = db.prepare('SELECT id,name,category,color,image_url,reserved_by FROM gifts ORDER BY category,name').all();
  const myGifts = gifts.filter(gift => gift.reserved_by === req.session.userId);
  const groups = CATEGORIES.map(category => ({ category, gifts: gifts.filter(gift => gift.category === category) })).filter(group => group.gifts.length);
  res.render('gifts', { groups, myGifts, userId: req.session.userId, userName: req.session.userName });
});
app.post('/gifts/:id/reserve', (req, res, next) => { if (!req.session.userId) return res.status(401).json({ error: 'Faça login antes de escolher um presente.' }); if (req.session.isAdmin) return res.status(403).json({ error: 'O administrador não pode reservar presentes. Saia e entre usando um nome de convidado.' }); next(); }, (req, res) => { const result = db.prepare('UPDATE gifts SET reserved_by = ?, reserved_at = CURRENT_TIMESTAMP WHERE id = ? AND reserved_by IS NULL').run(req.session.userId, req.params.id); if (!result.changes) return res.status(409).json({ error: 'Este presente já foi reservado por outra pessoa.' }); notifyReservation(req.params.id, req.session.userName); res.json({ ok: true }); });
app.post('/gifts/:id/unreserve', (req, res) => res.status(403).json({ error: 'Não é permitido desistir de um presente já escolhido.' }));

app.get('/admin', admin, (req, res) => { res.render('admin', { gifts: getGifts(), categories: CATEGORIES, importResult: req.session.importResult || null, passwordResult: req.session.passwordResult || null }); delete req.session.importResult; delete req.session.passwordResult; });
app.post('/admin/change-password', admin, (req, res) => {
  const currentPassword = (req.body.currentPassword || '').trim();
  const newPassword = (req.body.newPassword || '').trim();
  const confirmPassword = (req.body.confirmPassword || '').trim();

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!user || !user.password_hash || !bcrypt.compareSync(currentPassword, user.password_hash)) {
    req.session.passwordResult = { type: 'error', text: 'Senha atual incorreta.' };
    return res.redirect('/admin');
  }

  if (!newPassword || newPassword.length < 6) {
    req.session.passwordResult = { type: 'error', text: 'A nova senha deve ter no mínimo 6 caracteres.' };
    return res.redirect('/admin');
  }

  if (newPassword !== confirmPassword) {
    req.session.passwordResult = { type: 'error', text: 'A confirmação de senha não confere.' };
    return res.redirect('/admin');
  }

  const newHash = bcrypt.hashSync(newPassword, 12);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, req.session.userId);
  req.session.passwordResult = { type: 'success', text: 'Senha alterada com sucesso!' };
  res.redirect('/admin');
});
app.post('/admin/gifts', admin, handleImage, (req, res) => {
  const name = (req.body.name || '').trim();
  const category = validCategory(req.body.category);
  const color = (req.body.color || '').trim() || null;
  const image = req.file ? `/uploads/${req.file.filename}` : null;
  if (name) db.prepare('INSERT INTO gifts(name,category,color,image_url) VALUES(?,?,?,?)').run(name, category, color, image);
  else if (req.file) removeImage(image);
  res.redirect('/admin');
});
app.post('/admin/gifts/import', admin, upload.single('csvFile'), (req, res) => {
  if (!req.file) {
    req.session.importResult = { type: 'error', text: 'Selecione um arquivo CSV para importar.' };
    return res.redirect('/admin');
  }
  if (!req.file.originalname.toLowerCase().endsWith('.csv')) {
    req.session.importResult = { type: 'error', text: 'O arquivo deve ter extensão .csv.' };
    return res.redirect('/admin');
  }
  const gifts = csvGifts(req.file.buffer.toString('utf8'));
  let added = 0;
  let updated = 0;
  const findGift = db.prepare('SELECT id, color, category FROM gifts WHERE name = ? COLLATE NOCASE');
  const insert = db.prepare('INSERT INTO gifts(name,category,color) VALUES(?,?,?)');
  const update = db.prepare('UPDATE gifts SET category = ?, color = COALESCE(?, color) WHERE id = ?');
  db.transaction(() => {
    for (const gift of gifts) {
      const existing = findGift.get(gift.name);
      if (existing) {
        update.run(gift.category, gift.color, existing.id);
        updated += 1;
      } else {
        insert.run(gift.name, gift.category, gift.color);
        added += 1;
      }
    }
  })();
  req.session.importResult = { type: 'success', text: `Importação concluída: ${added} presente(s) adicionado(s) e ${updated} atualizado(s).` };
  res.redirect('/admin');
});
app.post('/admin/gifts/:id/edit', admin, handleImage, (req, res) => {
  const name = (req.body.name || '').trim();
  const category = validCategory(req.body.category);
  const color = (req.body.color || '').trim() || null;
  const current = db.prepare('SELECT image_url FROM gifts WHERE id = ?').get(req.params.id);
  if (name && current) {
    let image = current.image_url;
    if (req.file) image = `/uploads/${req.file.filename}`;
    else if (req.body.removeImage) image = null;
    db.prepare('UPDATE gifts SET name = ?, category = ?, color = ?, image_url = ? WHERE id = ?').run(name, category, color, image, req.params.id);
    if (image !== current.image_url) removeImage(current.image_url);
  } else if (req.file) removeImage(`/uploads/${req.file.filename}`);
  res.redirect('/admin');
});
app.post('/admin/gifts/:id/delete', admin, (req, res) => { removeImage(db.prepare('SELECT image_url FROM gifts WHERE id = ?').get(req.params.id)?.image_url); db.prepare('DELETE FROM gifts WHERE id = ?').run(req.params.id); res.redirect('/admin'); });
app.post('/admin/gifts/:id/reset', admin, (req, res) => { db.prepare('UPDATE gifts SET reserved_by = NULL, reserved_at = NULL WHERE id = ?').run(req.params.id); res.redirect('/admin'); });
app.post('/admin/gifts/clear-all', admin, (req, res) => {
  db.prepare('SELECT image_url FROM gifts').all().forEach(g => removeImage(g.image_url));
  const result = db.prepare('DELETE FROM gifts').run();
  try { db.prepare("DELETE FROM sqlite_sequence WHERE name = 'gifts'").run(); } catch (e) { }
  req.session.importResult = { type: 'success', text: `Todos os presentes (${result.changes}) foram removidos com sucesso.` };
  res.redirect('/admin');
});
app.listen(PORT, () => console.log(`Servidor rodando em http://localhost:${PORT}`));
