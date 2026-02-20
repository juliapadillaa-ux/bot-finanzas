const express = require("express");
const { ImageAnnotatorClient } = require("@google-cloud/vision");

const app = express();
app.use(express.json({ limit: "10mb" }));

// ============================
// CONFIGURACIÓN SEGURA DE CREDENCIALES
// ============================

if (!process.env.GOOGLE_CREDENTIALS) {
  console.error("❌ GOOGLE_CREDENTIALS no está definida");
}

let visionClient;

try {
  const credentials = JSON.parse(
    process.env.GOOGLE_CREDENTIALS.replace(/\\n/g, "\n")
  );

  visionClient = new ImageAnnotatorClient({
    credentials,
  });

  console.log("✅ Vision inicializado correctamente");
} catch (error) {
  console.error("❌ Error inicializando Vision:", error.message);
}

// ============================
// FUNCIÓN AVANZADA DE EXTRACCIÓN
// ============================

function extraerGastosAvanzado(textoOCR) {
  const lineas = textoOCR.split("\n");
  const gastos = [];

  const regexMovimiento =
    /^(\d{2}\/\d{2}(?:\/\d{2,4})?)\s+(.*?)\s+(-?\$?\s?[\d\.\,]+)/;

  for (let linea of lineas) {
    linea = linea.trim();

    if (!linea) continue;

    const lower = linea.toLowerCase();

    if (
      lower.includes("fecha") ||
      lower.includes("descripcion") ||
      lower.includes("saldo") ||
      lower.includes("total")
    ) {
      continue;
    }

    const match = linea.match(regexMovimiento);

    if (match) {
      const fecha = match[1];
      let descripcionRaw = match[2];
      let valorRaw = match[3];

      valorRaw = valorRaw
        .replace("$", "")
        .replace(/\s/g, "")
        .replace(/\./g, "")
        .replace(",", ".");

      const valor = parseFloat(valorRaw);

      if (!isNaN(valor) && valor < 0) {
        const descripcion = descripcionRaw
          .replace(/\d{6,}/g, "")
          .replace(/\s{2,}/g, " ")
          .trim();

        gastos.push({
          fecha,
          descripcion,
          valor: Math.abs(valor),
        });
      }
    }
  }

  return gastos;
}

// ============================
// ENDPOINT PRINCIPAL
// ============================

app.post("/analizar", async (req, res) => {
  try {
    if (!visionClient) {
      return res.status(500).json({
        error: "Vision no inicializado",
      });
    }

    const { image } = req.body;

    if (!image) {
      return res.status(400).json({
        error: "No se envió imagen",
      });
    }

    const base64Image = image.replace(/^data:image\/\w+;base64,/, "");

    const [result] = await visionClient.textDetection({
      image: { content: base64Image },
    });

    const detections = result.textAnnotations;

    if (!detections || detections.length === 0) {
      return res.json({
        mensaje: "⚠️ No se detectó texto en la imagen",
      });
    }

    const textoDetectado = detections[0].description;

    const gastos = extraerGastosAvanzado(textoDetectado);

    if (gastos.length === 0) {
      return res.json({
        mensaje: "⚠️ No se detectaron gastos válidos",
        debug_texto: textoDetectado.substring(0, 1000),
      });
    }

    return res.json({
      total_gastos_detectados: gastos.length,
      gastos,
    });
  } catch (error) {
    console.error("❌ Error en /analizar:", error);

    return res.status(500).json({
      error: "Error procesando imagen",
      detalle: error.message,
    });
  }
});

// ============================
// HEALTH CHECK
// ============================

app.get("/", (req, res) => {
  res.send("Bot Finanzas funcionando correctamente 🚀");
});

// ============================
// START SERVER
// ============================

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});