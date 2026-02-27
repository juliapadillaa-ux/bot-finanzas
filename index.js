process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});

process.on("unhandledRejection", (err) => {
  console.error("Unhandled Rejection:", err);
});

const express = require("express");
const fetch = require("node-fetch");
const vision = require("@google-cloud/vision");
const speech = require("@google-cloud/speech");
const { google } = require("googleapis");

const app = express();
app.use(express.json({ limit: "20mb" }));

// =============================
// 🔐 CREDENCIALES DESDE SECRET
// =============================

if (!process.env.GOOGLE_CREDENTIALS) {
  console.error("GOOGLE_CREDENTIALS no definida");
  process.exit(1);
}

const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;

if (!SPREADSHEET_ID || !TELEGRAM_TOKEN) {
  console.error("Faltan variables de entorno");
  process.exit(1);
}

// =============================
// 🔍 CLIENTES GOOGLE
// =============================

const visionClient = new vision.ImageAnnotatorClient({ credentials });

const speechClient = new speech.SpeechClient({ credentials });

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});

// =============================
// 🧠 PARSER EXTRACTOS
// =============================

function parseExtracto(text) {
  const lines = text.split("\n");
  const movimientos = [];
  const regex = /^(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+(-?\$?[\d.,]+)/;

  for (const line of lines) {
    const match = line.match(regex);
    if (match) {
      const fecha = match[1];
      const descripcion = match[2];
      let valorRaw = match[3]
        .replace(/\$/g, "")
        .replace(/\./g, "")
        .replace(",", ".");

      const valor = parseFloat(valorRaw);
      if (!isNaN(valor)) {
        movimientos.push([fecha, descripcion, valor]);
      }
    }
  }

  return movimientos;
}

// =============================
// 📊 GUARDAR EN SHEETS
// =============================

async function guardarEnSheets(filas) {
  const sheets = google.sheets({ version: "v4", auth });

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: "Hoja1!A:C",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: filas }
  });
}

// =============================
// 🤖 TELEGRAM ENDPOINT
// =============================

app.post("/", async (req, res) => {
  try {
    const message = req.body.message;
    if (!message) return res.sendStatus(200);

    const chatId = message.chat.id;

    // =============================
    // 📷 FOTO (OCR)
    // =============================

    if (message.photo) {
      const photo = message.photo.pop();
      const fileInfo = await fetch(
        `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${photo.file_id}`
      ).then(r => r.json());

      const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${fileInfo.result.file_path}`;
      const buffer = await fetch(fileUrl).then(r => r.buffer());
      const base64 = buffer.toString("base64");

      const [result] = await visionClient.textDetection({
        image: { content: base64 }
      });

      const text = result.textAnnotations[0]?.description || "";
      const movimientos = parseExtracto(text);

      if (movimientos.length > 0) {
        await guardarEnSheets(movimientos);
        await enviarMensaje(chatId, `Se guardaron ${movimientos.length} movimientos ✅`);
      } else {
        await enviarMensaje(chatId, "No se detectaron movimientos válidos.");
      }
    }

    // =============================
    // 🎤 VOZ (Speech to Text)
    // =============================

    else if (message.voice) {
      const fileInfo = await fetch(
        `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${message.voice.file_id}`
      ).then(r => r.json());

      const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${fileInfo.result.file_path}`;
      const audioBuffer = await fetch(fileUrl).then(r => r.buffer());

      const audioBytes = audioBuffer.toString("base64");

      const [response] = await speechClient.recognize({
        audio: { content: audioBytes },
        config: {
          encoding: "OGG_OPUS",
          sampleRateHertz: 48000,
          languageCode: "es-CO"
        }
      });

      const transcription =
        response.results.map(r => r.alternatives[0].transcript).join("\n");

      await guardarEnSheets([[new Date().toLocaleDateString(), "Registro por voz", transcription]]);
      await enviarMensaje(chatId, "Mensaje de voz registrado ✅");
    }

    // =============================
    // 📄 TEXTO NORMAL
    // =============================

    else if (message.text) {

      if (message.text === "/reporte") {
        await enviarMensaje(chatId, "Reporte generado en Google Sheets 📊");
      } else {
        await guardarEnSheets([[new Date().toLocaleDateString(), "Texto", message.text]]);
        await enviarMensaje(chatId, "Texto registrado ✅");
      }
    }

    res.sendStatus(200);

  } catch (error) {
    console.error("Error general:", error);
    res.sendStatus(500);
  }
});

// =============================
// 📩 ENVIAR MENSAJE TELEGRAM
// =============================

async function enviarMensaje(chatId, text) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text
    })
  });
}

// =============================
// 🚀 CLOUD RUN SERVER
// =============================

const PORT = process.env.PORT || 8080;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});