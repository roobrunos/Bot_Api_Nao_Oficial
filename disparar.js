const fs = require('fs');
const path = require('path');
const inquirer = require('inquirer');
const { carregarContatos, atualizarStatus } = require('./helpers/sheets');
const { useMultiFileAuthState, makeWASocket } = require('@whiskeysockets/baileys');

// Lista as pastas da auth como números disponíveis
async function listarNumerosDisponiveis() {
  const authDir = path.join(__dirname, 'auth');
  return fs.readdirSync(authDir).filter(p => fs.statSync(path.join(authDir, p)).isDirectory());
}

// Permite selecionar múltiplos remetentes
async function escolherRemetentes() {
  const numeros = await listarNumerosDisponiveis();
  const resposta = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'remetentes',
      message: 'Selecione os números de WhatsApp remetentes para disparo:',
      choices: numeros,
      validate: (input) => input.length ? true : 'Selecione pelo menos um remetente.'
    }
  ]);
  return resposta.remetentes;
}

// Carrega e seleciona um template do JSON
async function escolherTemplate() {
  const caminho = path.join(__dirname, 'templates.json');
  const templates = JSON.parse(fs.readFileSync(caminho, 'utf-8'));

  const { escolhido } = await inquirer.prompt([
    {
      type: 'list',
      name: 'escolhido',
      message: 'Selecione o template de mensagem:',
      choices: templates.map((t, i) => ({ name: t.nome, value: i }))
    }
  ]);

  return templates[escolhido].mensagem;
}

// Conecta todos os remetentes selecionados
async function conectarRemetentes(remetentes) {
  const conexoes = {};
  for (const numero of remetentes) {
    const authPath = path.join(__dirname, 'auth', numero);
    const { state, saveCreds } = await useMultiFileAuthState(authPath);
    const sock = makeWASocket({ auth: state });
    sock.ev.on('creds.update', saveCreds);
    conexoes[numero] = sock;
  }
  return conexoes;
}

// Aplica as variáveis ao template
function aplicarTemplate(template, dados) {
  return template.replace(/{{\s*(\w+)\s*}}/g, (_, chave) => dados[chave] ?? '');
}

// Execução principal
async function main() {
  const remetentesSelecionados = await escolherRemetentes();
  const conexoes = await conectarRemetentes(remetentesSelecionados);
  const template = await escolherTemplate();
  const contatos = await carregarContatos();

  for (const contato of contatos) {
    if (contato.status.toLowerCase() === 'enviado') continue;
    if (!remetentesSelecionados.includes(contato.remetente)) continue;

    const mensagem = aplicarTemplate(template, {
      nome: contato.nome,
      razao_social: contato.razao_social,
      cnpj: contato.cnpj
    });

    const numeroDestino = contato.celular_destino.replace(/\D/g, '') + '@s.whatsapp.net';
    const remetenteSock = conexoes[contato.remetente];

    try {
      await remetenteSock.sendMessage(numeroDestino, { text: mensagem });
      console.log(`✅ Mensagem enviada para ${contato.nome} (${numeroDestino}) por ${contato.remetente}`);
      await atualizarStatus(contato.index, 'Enviado');
    } catch (erro) {
      console.error(`❌ Erro ao enviar para ${numeroDestino}:`, erro);
      await atualizarStatus(contato.index, 'Erro');
    }

    await new Promise(r => setTimeout(r, 2000)); // delay de 2s
  }

  console.log('🚀 Disparos concluídos com todos os remetentes selecionados!');
}

main();
