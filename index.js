const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage } = require('@whiskeysockets/baileys');
const express = require('express');
const qrcode = require('qrcode-terminal');
const { Boom } = require('@hapi/boom');
const fs = require('fs');
const path = require('path');
const inquirer = require('inquirer');

const app = express();
const PORT = 3000;

app.use(express.json());

let globalSessions = {}; // Guarda conexões ativas por número

async function iniciarSessao(numero) {
  const pastaAuth = path.join('auth', numero);
  const { state, saveCreds } = await useMultiFileAuthState(pastaAuth);
  const sock = makeWASocket({ auth: state });

  globalSessions[numero] = sock;

  return new Promise((resolve) => {
    let conectado = false;
    let qrExibido = false;

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr && !conectado && !qrExibido) {
        console.clear();
        console.log(`\u{1F4F2} Escaneie o QR Code abaixo para o número ${numero}:`);
        qrcode.generate(qr, { small: true });
        qrExibido = true;
      }

      if (connection === 'close') {
        const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
        console.log(`\u{1F50C} Conexão encerrada para ${numero}. Reconnect: ${shouldReconnect}`);

        if (shouldReconnect) {
          console.log(`\u{1F501} Recarregando sessão para ${numero}...`);
          setTimeout(() => iniciarSessao(numero), 3000);
        } else {
          console.log(`\u{1F512} Sessão finalizada manualmente para ${numero}.`);
        }
      }

      if (connection === 'open' && !conectado) {
        conectado = true;
        console.log(`\u{2705} Número ${numero} conectado com sucesso!`);
        resolve();
      }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type === 'notify' && messages[0]?.message) {
        const msg = messages[0];
        const sender = msg.key.remoteJid;
        if (msg.key.fromMe) return;

        const body = msg.message.conversation || msg.message.extendedTextMessage?.text;
        if (body) {
          console.log(`\u{1F4E5} Texto recebido de ${sender}: ${body}`);
          await sock.sendMessage(sender, { text: 'Olá! Recebemos sua mensagem!' });
          return;
        }

        const tipo = Object.keys(msg.message)[0];
        if (["imageMessage", "audioMessage", "videoMessage"].includes(tipo)) {
          const buffer = await downloadMediaMessage(
            msg,
            'buffer',
            {},
            { logger: console, reuploadRequest: sock.updateMediaMessage }
          );

          const ext = tipo === 'imageMessage' ? 'jpg' : tipo === 'audioMessage' ? 'mp3' : 'mp4';
          const nomeArquivo = `${Date.now()}.${ext}`;
          const caminho = path.join(__dirname, 'midias', nomeArquivo);

          fs.writeFileSync(caminho, buffer);
          console.log(`\u{1F4CE} Mídia recebida de ${sender} salva como: ${nomeArquivo}`);
          await sock.sendMessage(sender, { text: 'Recebemos sua mídia. Obrigado!' });
        }
      }
    });
  });
}

async function iniciar() {
  if (!fs.existsSync('./midias')) {
    fs.mkdirSync('./midias');
  }

  let continuar = true;

  while (continuar) {
    const { numero } = await inquirer.prompt([
      {
        type: 'input',
        name: 'numero',
        message: 'Digite o número de WhatsApp (com DDI, ex: 5511999999999):',
        validate: input => /^\d{11,13}$/.test(input) ? true : 'Número inválido. Use apenas números (ex: 5511999999999)',
      }
    ]);

    await iniciarSessao(numero);

    const { adicionarOutro } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'adicionarOutro',
        message: 'Deseja adicionar outro número?',
        default: false
      }
    ]);

    continuar = adicionarOutro;
  }

  console.log('\u{1F501} Finalizado. Todos os números foram conectados.');
}

iniciar();

app.post('/send', async (req, res) => {
  const { number, message, remetente } = req.body;

  if (!number || !message || !remetente) {
    return res.status(400).send('Parâmetros "number", "message" e "remetente" são obrigatórios.');
  }

  const sock = globalSessions[remetente];
  if (!sock) {
    return res.status(500).send('Sessão não iniciada para o remetente informado.');
  }

  const formattedNumber = number.includes('@s.whatsapp.net') ? number : number + '@s.whatsapp.net';

  try {
    await sock.sendMessage(formattedNumber, { text: message });
    console.log(`\u{1F4E4} Mensagem enviada para ${formattedNumber}: ${message}`);
    res.send('Mensagem enviada com sucesso.');
  } catch (err) {
    console.error('\u{2757} Erro ao enviar mensagem:', err);
    res.status(500).send('Erro ao enviar mensagem.');
  }
});

app.listen(PORT, () => {
  console.log(`\u{1F680} API rodando em http://localhost:${PORT}`);
});

