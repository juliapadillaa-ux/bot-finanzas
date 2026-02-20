import express from "express";
import vision from "@google-cloud/vision";

const app = express();
app.use(express.json({ limit: "10mb" }));

const PORT = process.env.PORT || 8080;

// ===============================
// Inicialización segura de Vision
// ===============================
let visionClient = null;

try {
  if (!process.env.GOOGLE_CREDENTIALS) {
    console.error("GOOGLE_CREDENTIALS no está definida");
  } else {
    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);

    visionClient = new vision.ImageAnnotatorClient({
      credentials: credentials,
    });

    console.log("Vision client inicializado correctamente");
  }
} catch (error) {
  console.error("Error inicializando Vision:", error.message);
}

// ===============================
// Ruta de prueba (health check)
// ===============================
app.get("/", (req, res) => {
  res.status(200).send("Servidor activo 🚀");
});

// ===============================
// Endpoint principal
// ===============================
app.post("/analizar", async (req, res) => {
  try {
    if (!visionClient) {
      return res.status(500).json({
        error: "Vision no está inicializado",
      });
    }

    const { image } = req.body;

    if (!image) {
      return res.status(400).json({
        error: "No se envió imagen",
      });
    }

    const [result] = await visionClient.textDetection({
      image: { content: image },
    });

    const detections = result.textAnnotations;

    if (!detections || detections.length === 0) {
      return res.json({ text: "No se detectó texto" });
    }

    res.json({
      text: detections[0].description,
    });
  } catch (error) {
    console.error("Error en /analizar:", error);
    res.status(500).json({
      error: "Error procesando imagen",
      details: error.message,
    });
  }
});

// ===============================
// Arranque del servidor
// ===============================
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});