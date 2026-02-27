process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});

process.on("unhandledRejection", (err) => {
  console.error("Unhandled Rejection:", err);
});

const express = require("express");
const vision = require("@google-cloud/vision");
const { google } = require("googleapis");

const app = express();
app.use(express.json({ limit: "10mb" }));

// =============================
// 🔐 PARSEO SEGURO DE CREDENCIALES
// =============================

let credentials;

try {
  if (!process.env.GOOGLE_CREDENTIALS) {
    throw new Error("GOOGLE_CREDENTIALS no está definida");
  }

  credentials = JSON.parse(
    process.env.GOOGLE_CREDENTIALS
      .replace(/\\n/g, "\n")
      .trim()
  );

  console.log("Credenciales cargadas correctamente");

} catch (error) {
  console.error("Error cargando credenciales:", error.message);
}

// =============================
// 🔍 CLIENTES GOOGLE
// =============================

let visionClient;
let auth;

try {
  visionClient = new vision.ImageAnnotatorClient({
    credentials
  });

  auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });

  console.log("Clientes Google inicializados");

} catch (error) {
  console.error("Error inicializando clientes:", error.message);
}

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

// =============================
// 🧠 PARSEO EXTRACTO
// =============================

function parseExtracto(text) {
  const lines = text.split("\n");
  const movimientos = [];

  const regex = /^(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+(-?[\d.,]+)/;

  for (const line of lines) {
    const match = line.match(regex);

    if (match) {
      const fecha = match[1].trim();
      const descripcion = match[2].trim();
      let valorRaw = match[3];

      valorRaw = valorRaw
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
// 📌 ENDPOINT TEST
// =============================

app.get("/", (req, res) => {
  res.json({ status: "Bot financiero activo" });
});

// =============================
// 📌 ENDPOINT PRINCIPAL
// =============================

app.post("/", async (req, res) => {
  try {
    const { image } = req.body;

    if (!image) {
      return res.status(400).json({ error: "No se recibió imagen" });
    }

    const [result] = await visionClient.textDetection({
      image: { content: image }
    });

    const detections = result.textAnnotations;

    if (!detections || detections.length === 0) {
      return res.status(400).json({ error: "No se detectó texto" });
    }

    const text = detections[0].description;
    const movimientos = parseExtracto(text);

    if (movimientos.length === 0) {
      return res.status(400).json({ error: "No se encontraron movimientos válidos" });
    }

    const sheets = google.sheets({ version: "v4", auth });

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: "Hoja1!A:C",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: movimientos
      }
    });

    res.json({
      status: "ok",
      movimientos_guardados: movimientos.length
    });

  } catch (error) {
    console.error("Error general:", error);

    res.status(500).json({
      error: "Error interno",
      detalle: error.message
    });
  }
});

// =============================
// 🚀 CLOUD RUN
// =============================

const PORT = process.env.PORT || 8080;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});