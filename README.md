# 🏠 Chá»« de Casa Nova

Sistema completo para gerenciar presentes de chá de casa nova.

## ✨ Funcionalidades

- **Convidados**: Login apenas com nome, visualiza lista, reserva presentes
- **Admin**: Vê»ª quem reservou o quê, gerencia lista de presentes
- **Privacidade**: Convidados não veem quem reservou, apenas o admin

## 🚀 Instalaç»£o

```bash
git clone https://github.com/guivascs/cha-casa-nova.git
cd cha-casa-nova
npm install
cp .env.example .env
npm run dev
```

## 🔐 Primeiro acesso

1. Acesse `http://localhost:3000/setup-admin`
2. Crie sua conta de administrador
3. Acesse `http://localhost:3000/admin/login`

## 📁 Estrutura

```
cha-casa-nova/
├── package.json
├── server.js
├── .env.example
├── .gitignore
├── README.md
├── public/
│   └── style.css
└── views/
    ├── login.ejs
    ├── gifts.ejs
    ├── admin-login.ejs
    ├── admin.ejs
    └── setup-admin.ejs
```

## 🛠️ Tecnologias

- Node.js + Express
- EJS (templates)
- SQLite (better-sqlite3)
- bcryptjs (criptografia)

## 📝 Notas

- Presentes reservados ficam em vermelho
- Uma vez reservado, só admin pode resetar
- Convidados podem cancelar sua própria reserva

## 🌐 Deploy

Funciona em Vercel, Railway, Render, etc.

**Importante para produção**:
- Mude `SESSION_SECRET` no `.env`
- Use HTTPS
- Configure `cookie: { secure: true }`

## 📞 Autor

Guilherme - Desenvolvido com ❤️

MIT License
