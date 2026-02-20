process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught Exception:", err);
});

process.on("unhandledRejection", (err) => {
  console.error("❌ Unhandled Rejection:", err);
});

const express = require("express");
const vision = require("@google-cloud/vision");
const { google } = require("googleapis");
const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);

const app = express();
app.use(express.json());

// =============================
// 🔐 PARSEO SEGURO DE CREDENCIALES
// =============================

let credentials;

try {
  const raw = process.env.GOOGLE_CREDENTIALS;

  if (!raw) {
    throw new Error("GOOGLE_CREDENTIALS no está definida");
  }

  credentials = JSON.parse(
    raw
      .replace(/\\n/g, "\n")
      .trim()
  );

  console.log("✅ Credenciales parseadas correctamente");

} catch (error) {
  console.error("❌ Error parseando credenciales:", error.message);
  process.exit(1);
}

// =============================
// 🔍 CLIENTES GOOGLE
// =============================

const visionClient = new vision.ImageAnnotatorClient({
  credentials
});

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

let visionClient;

try {
  if (process.env.GOOGLE_CREDENTIALS) {
    visionClient = new vision.ImageAnnotatorClient({
      credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS)
    });
    console.log("✅ Vision inicializado");
  } else {
    console.log("⚠️ GOOGLE_CREDENTIALS no definido");
  }
} catch (error) {
  console.error("❌ Error inicializando Vision:", error);
}

// =============================
// 🧠 FUNCIÓN PARA PARSEAR EXTRACTO
// Estructura: fecha | descripción | referencia | valor
// =============================

function parseExtracto(text) {
  const lines = text.split("\n");
  const movimientos = [];

  const regex = /^(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+(-?\$?[\d.,]+)/;

  for (const line of lines) {
    const match = line.match(regex);

    if (match) {
      const fecha = match[1].trim();
      const descripcion = match[2].trim();
      let valorRaw = match[3];

      valorRaw = valorRaw.replace(/\$/g, "").replace(/\./g, "").replace(",", ".");
      const valor = parseFloat(valorRaw);

      if (!isNaN(valor)) {
        movimientos.push([fecha, descripcion, valor]);
      }
    }
  }

  return movimientos;
}

// =============================
// 📌 ENDPOINT PRINCIPAL
// =============================

app.post("/", async (req, res) => {
  try {
    const { image } = req.body;

    if (!image) {
      return res.status(400).json({ error: "No se recibió imagen" });
    }

    console.log("📷 Procesando imagen...");

    const [result] = await visionClient.textDetection({
      image: { content: image }
    });

    const detections = result.textAnnotations;

    if (!detections || detections.length === 0) {
      return res.status(400).json({ error: "No se detectó texto" });
    }

    const text = detections[0].description;

    console.log("🧾 Texto detectado correctamente");

    const movimientos = parseExtracto(text);

    if (movimientos.length === 0) {
      return res.status(400).json({ error: "No se encontraron movimientos válidos" });
    }

    console.log(`💰 Movimientos encontrados: ${movimientos.length}`);

    // =============================
    // 📊 GUARDAR EN GOOGLE SHEETS
    // =============================

    const sheets = google.sheets({ version: "v4", auth });

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: "Hoja1!A:C",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: movimientos
      }
    });

    console.log("✅ Datos guardados en Sheets");

    res.json({
      status: "ok",
      movimientos_guardados: movimientos.length
    });

  } catch (error) {
    console.error("❌ Error general:", error.message);

    res.status(500).json({
      error: "Error interno del servidor",
      detalle: error.message
    });
  }
});

// =============================
// 🚀 SERVIDOR CLOUD RUN
// =============================

const PORT = process.env.PORT || 8080;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});