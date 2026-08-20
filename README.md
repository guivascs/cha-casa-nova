# 🏠 Chá de Casa Nova

Sistema completo para gerenciar presentes de chá de casa nova.

## ✨ Funcionalidades

- **Convidados**: Login apenas com nome, visualiza lista, reserva presentes
- **Admin**: Vê quem reservou o quê, adiciona/exclui presentes, importa lista via CSV e altera senha
- **Privacidade**: Convidados não veem quem reservou, apenas o admin

## 🚀 Instalação

```bash
git clone https://github.com/guivascs/cha-casa-nova.git
cd cha-casa-nova
npm install
cp .env.example .env
npm run dev
```

## 🔐 Acesso Administrativo

- Acesse `http://localhost:3000/admin/login`
- Você pode definir o usuário e senha do admin no arquivo `.env`:
  ```env
  ADMIN_USERNAME=seu_usuario
  ADMIN_PASSWORD=sua_senha_segura
  ```
- Ou alterar a senha diretamente no painel administrativo em `http://localhost:3000/admin`.

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
    └── admin.ejs
```

## 🛠️ Tecnologias

- Node.js + Express
- EJS (templates)
- SQLite (better-sqlite3)
- bcryptjs (criptografia)

## 🌐 Deploy

Funciona em Vercel, Railway, Render, etc.

**Importante para produção**:
- Mude `SESSION_SECRET` no `.env`
- Use HTTPS
- Configure `cookie: { secure: true }`

## 📞 Autor

Guilherme - Desenvolvido com ❤️

MIT License
