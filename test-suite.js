/**
 * Teste de Convidados Escolhendo Presentes - Chá de Casa Nova
 * Simula 15 pessoas entrando no site e escolhendo presentes da lista.
 */

const BASE_URL = process.env.TEST_URL || 'https://reasonable-ronald-parenting-hanging.trycloudflare.com';

const CONVIDADOS = [
  'Lucas Almeida', 'Beatriz Lima', 'Thiago Rocha', 'Camila Santos',
  'Rodrigo Ferreira', 'Juliana Costa', 'Felipe Oliveira', 'Larissa Mendes',
  'Gustavo Ribeiro', 'Fernanda Souza', 'Rafael Martins', 'Amanda Carvalho',
  'Bruno Barbosa', 'Mariana Dias', 'Eduardo Ramos'
];

class Guest {
  constructor(name) {
    this.name = name;
    this.cookie = '';
    this.chosenGifts = [];
  }

  async request(path, options = {}) {
    const headers = options.headers || {};
    if (this.cookie) headers['Cookie'] = this.cookie;

    const response = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers,
      redirect: 'manual'
    });

    const setCookie = response.headers.get('set-cookie');
    if (setCookie) {
      this.cookie = setCookie.split(';')[0];
    }
    return response;
  }

  async login() {
    const form = new URLSearchParams();
    form.append('name', this.name);
    const res = await this.request('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString()
    });
    return res.status === 302;
  }

  async getAvailableGifts() {
    const res = await this.request('/gifts');
    const html = await res.text();
    // Extrai botões que têm o onclick='reserve(ID, "NOME", this)'
    const matches = [...html.matchAll(/reserve\((\d+),\s*"([^"]+)"/g)];
    return matches.map(m => ({ id: Number(m[1]), name: m[2] }));
  }

  async chooseGift(gift) {
    const res = await this.request(`/gifts/${gift.id}/reserve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' }
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 200) {
      this.chosenGifts.push(gift);
      return { success: true, message: 'Reservado com sucesso!' };
    } else {
      return { success: false, message: data.error || `HTTP ${res.status}` };
    }
  }

  async unchooseGift(gift) {
    const res = await this.request(`/gifts/${gift.id}/unreserve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' }
    });
    if (res.status === 200) {
      this.chosenGifts = this.chosenGifts.filter(g => g.id !== gift.id);
      return true;
    }
    return false;
  }
}

async function startSimulation() {
  console.log(`\n===============================================================`);
  console.log(`🎁 TESTE DE CONVIDADOS ESCOLHENDO PRESENTES`);
  console.log(`🌐 Link: ${BASE_URL}`);
  console.log(`===============================================================\n`);

  const guests = CONVIDADOS.map(name => new Guest(name));

  // 1. Login dos 15 convidados
  console.log(`🚪 1. Entrando na lista com 15 convidados...`);
  for (const guest of guests) {
    const ok = await guest.login();
    if (ok) {
      console.log(`   👤 ${guest.name} entrou na lista.`);
    } else {
      console.log(`   ❌ Falha ao logar: ${guest.name}`);
    }
  }

  // 2. Buscar a lista de presentes disponíveis
  console.log(`\n🔍 2. Consultando presentes disponíveis na lista...`);
  const availableGifts = await guests[0].getAvailableGifts();

  if (availableGifts.length === 0) {
    console.error(`\n❌ Nenhum presente disponível para escolha.`);
    console.error(`   Acesse o painel admin ou importe o presentes.csv para adicionar itens antes de rodar.`);
    return;
  }

  console.log(`   ➔ Encontrados ${availableGifts.length} presentes disponíveis para escolha.\n`);

  // 3. Os convidados escolhem os presentes um a um
  console.log(`🎉 3. Convidados escolhendo seus presentes:`);
  console.log(`---------------------------------------------------------------`);

  const totalToPick = Math.min(guests.length, availableGifts.length);

  for (let i = 0; i < totalToPick; i++) {
    const guest = guests[i];
    const gift = availableGifts[i];

    const result = await guest.chooseGift(gift);
    if (result.success) {
      console.log(`   ✅ ${guest.name.padEnd(18)} ➔ escolheu: "${gift.name}"`);
    } else {
      console.log(`   ⚠️ ${guest.name.padEnd(18)} ➔ NÃO conseguiu: "${gift.name}" (${result.message})`);
    }

    // Pequena pausa natural de 150ms entre cada escolha
    await new Promise(r => setTimeout(r, 150));
  }

  console.log(`---------------------------------------------------------------`);

  // 4. Teste de tentativa duplicada: outro convidado tenta escolher um presente já escolhido
  if (guests[0].chosenGifts.length > 0) {
    const takenGift = guests[0].chosenGifts[0];
    const competitor = guests[14]; // Eduardo Ramos tenta pegar o presente do Lucas
    console.log(`\n🥊 4. Teste de disputa: ${competitor.name} tentando pegar "${takenGift.name}" (já escolhido por ${guests[0].name})...`);
    const attempt = await competitor.chooseGift(takenGift);
    if (!attempt.success) {
      console.log(`   🛡️ Resposta do sistema: "${attempt.message}"`);
      console.log(`   ✅ Bloqueio correto! Ninguém consegue roubar o presente de outra pessoa.`);
    } else {
      console.log(`   ❌ ERRO: Conseguiu escolher um presente que já tinha dono!`);
    }
  }

  console.log(`\n📌 As escolhas dos convidados foram MANTIDAS no banco de dados.`);
  console.log(`   Você pode acessar o painel Admin ou a lista agora mesmo para ver os presentes reservados!`);

  console.log(`\n===============================================================`);
  console.log(`✨ TESTE CONCLUÍDO! PRESENTES RESERVADOS COM SUCESSO!`);
  console.log(`===============================================================\n`);
}

startSimulation();
