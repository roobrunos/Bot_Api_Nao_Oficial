const { google } = require('googleapis');
const fs = require('fs');

const auth = new google.auth.GoogleAuth({
  keyFile: 'credentials.json',
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const SHEET_ID = '1XWCuOolxqubYngVF0JLNieY3JS-7YCRP7ZvE9CJDYTw'; // só o ID, não a URL completa

async function carregarContatos() {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  const resposta = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'Contatos!A2:F', // A1 contém os cabeçalhos
  });

  const linhas = resposta.data.values || [];

  return linhas.map((linha, i) => ({
    index: i + 2, // número da linha na planilha
    nome: linha[0],
    razao_social: linha[1],
    cnpj: linha[2],
    celular_destino: linha[3],
    remetente: linha[4],
    status: linha[5] || '',
  }));
}

async function atualizarStatus(index, status) {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `Contatos!F${index}`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [[status]],
    },
  });
}

module.exports = { carregarContatos, atualizarStatus };
