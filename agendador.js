const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const { google } = require('googleapis');
const { useMultiFileAuthState, makeWASocket } = require('@whiskeysockets/baileys');
const { carregarContatos, atualizarStatus } = require('./helpers/sheets');

const auth = new google.auth.GoogleAuth({
  keyFile: 'credentials.json',
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const SHEET_ID = '1XWCuOolxqubYngVF0JLNieY3JS-7YCRP7ZvE9CJDYTw';

const lerCampanhas = async () => {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  const resposta = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'Campanhas!A2:F',
  });

  const linhas = resposta.data.values || [];
  return linhas.map((linha, i) => ({
    index: i + 2,
    nome_campanha: linha[0],
    data_disparo: linha[1],
    hora_disparo: linha[2],
    remetentes: linha[3]?.split(',').map(r => r.trim()) || [],
    id_template: linha[4],
    status: linha[5] || '',
  }));
};

const atualizarStatusCampanha = async (index, novoStatus) => {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `Campanhas!F${index}`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [[novoStatus]],
    },
  });
};

const carregarTemplates = () => {
  const raw = fs.readFileSync(path.join(__dirname, 'templates.json'), 'utf-8');
  const templates = JSON.parse(raw);
  const mapeado = {};
  for (const t of templates) {
    mapeado[t.id] = t.mensagem;
  }
  return mapeado;
};

const aplicarTemplate = (template, dados) => {
  return template.replace(/{{\s*(\w+)\s*}}/g, (_, chave) => dados[chave] ?? '');
};

const conectarRemetentes = async (remetentes) => {
  const conexoes = {};
  for (const numero of remetentes) {
    const authPath = path.join(__dirname, 'auth', numero);
    const { state, saveCreds } = await useMultiFileAuthState(authPath);
    const sock = makeWASocket({ auth: state });
    sock.ev.on('creds.update', saveCreds);
    conexoes[numero] = sock;
  }
  return conexoes;
};

const executarCampanha = async (campanha, templates, conexoes) => {
  const contatos = await carregarContatos();
  const template = templates[campanha.id_template];

  if (!template) {
    console.error(`❌ Template com ID ${campanha.id_template} não encontrado.`);
    await atualizarStatusCampanha(campanha.index, 'Erro');
    return;
  }

  const contatosFiltrados = contatos.filter(
    c => campanha.remetentes.includes(c.remetente) && c.status.toLowerCase() !== 'enviado'
  );

  for (const contato of contatosFiltrados) {
    const mensagem = aplicarTemplate(template, {
      nome: contato.nome,
      razao_social: contato.razao_social,
      cnpj: contato.cnpj,
    });

    const numeroDestino = contato.celular_destino.replace(/\D/g, '') + '@s.whatsapp.net';
    const remetenteSock = conexoes[contato.remetente];

    try {
      await remetenteSock.sendMessage(numeroDestino, { text: mensagem });
      console.log(`✅ Enviado para ${contato.nome} (${numeroDestino})`);
      await atualizarStatus(contato.index, 'Enviado');
    } catch (err) {
      console.error(`❌ Falha ao enviar para ${numeroDestino}:`, err);
      await atualizarStatus(contato.index, 'Erro');
    }

    await new Promise(r => setTimeout(r, 2000));
  }

  await atualizarStatusCampanha(campanha.index, 'Finalizado');
};

const verificarCampanhas = async () => {
  console.log('🕒 Verificando campanhas agendadas...');
  const campanhas = await lerCampanhas();
  const now = new Date();
  const templates = carregarTemplates();

  const campanhasPendentes = campanhas.filter(c => {
    if (c.status.toLowerCase() !== 'pendente') return false;
    if (!c.data_disparo || !c.hora_disparo) return false;

    const [dia, mes, ano] = c.data_disparo.split('/');
    const [hora, minuto] = c.hora_disparo.split(':');
    const dataHora = new Date(ano, mes - 1, dia, hora, minuto);

    return dataHora <= now;
  });

  for (const campanha of campanhasPendentes) {
    console.log(`🚀 Iniciando campanha: ${campanha.nome_campanha}`);
    await atualizarStatusCampanha(campanha.index, 'Em andamento');
    const conexoes = await conectarRemetentes(campanha.remetentes);
    await executarCampanha(campanha, templates, conexoes);
  }

  console.log('✅ Verificação finalizada.\n');
};

// Agenda a verificação a cada minuto
cron.schedule('* * * * *', () => {
  verificarCampanhas();
});
