const fs = require('fs');
const path = require('path');
const inquirer = require('inquirer');
const { carregarContatos, atualizarStatus } = require('./helpers/sheets');
const { useMultiFileAuthState, makeWASocket } = require('@whiskeysockets/baileys');

async function listarNumerosDisponiveis() {
  const authDir = path.join(__dirname, 'auth');
  const pastas = fs.readdirSync(authDir).filter(p => fs.statSync(path.join(authDir, p)).isDirectory());
  return pastas;
}

async function escolherRemetente() {
  const numeros = await listarNumerosDisponiveis();
  const resposta = await inquirer.prompt([
    {
      type: 'list',
      name: 'numero',
      message: 'Escolha o número de WhatsApp remetente para disparo:',
      choices: numeros
    }
  ]);
  return resposta.numero;
}

function aplicarTemplate(template, dados) {
  return template.replace(/{{\s*(\w+)\s*}}/g, (_, chave) => dados[chave] ?? '');
}

async function main() {
  const pastaRemetente = await escolherRemetente();
  const authPath = path.join(__dirname, 'auth', pastaRemetente);
  const { state, saveCreds } = await useMultiFileAuthState(authPath);
  const sock = makeWASocket({ auth: state });
  sock.ev.on('creds.update', saveCreds);

  const template = fs.readFileSync(path.join(__dirname, 'template.txt'), 'utf-8');
  const contatos = await carregarContatos();

  for (const contato of contatos) {
    if (contato.status.toLowerCase() === 'enviado') continue;
    if (contato.remetente !== pastaRemetente) continue;

    const numeroFormatado = contato.celular_destino.replace(/\D/g, '') + '@s.whatsapp.net';

    const mensagem = aplicarTemplate(template, {
      nome: contato.nome,
      razao_social: contato.razao_social,
      cnpj: contato.cnpj
    });

    try {
      await sock.sendMessage(numeroFormatado, { text: mensagem });
      console.log(`✅ Mensagem enviada para ${contato.nome} (${numeroFormatado})`);
      await atualizarStatus(contato.index, 'Enviado');
    } catch (erro) {
      console.error(`❌ Erro ao enviar para ${numeroFormatado}:`, erro);
      await atualizarStatus(contato.index, 'Erro');
    }

    await new Promise(r => setTimeout(r, 2000)); // delay entre mensagens
  }

  console.log('🚀 Disparos concluídos!');
}

main();


