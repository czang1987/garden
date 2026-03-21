import http from "node:http";

const PORT = Number(process.env.STYLIZE_PORT || 8787);
const ARK_BASE_URL = process.env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3";
const ARK_MODEL = process.env.ARK_MODEL || "doubao-seedream-4-0-250828";

const PROMPTS = {
  monet:
    "Transform this garden front-view design into a Monet-inspired impressionist oil painting. Preserve the exact garden composition, plant positions, relative sizes, and front-view perspective. Do not add or remove plants. Keep the same layout and structure, only change the visual style to soft brushwork, painterly edges, atmospheric light, and Monet-like color harmony.",
  watercolor:
    "Transform this garden front-view design into a refined landscape watercolor rendering. Preserve the exact garden composition, plant positions, relative sizes, and front-view perspective. Do not add or remove plants. Keep the same planting layout and spatial structure. Use transparent watercolor washes, soft edges, subtle pigment blooms, gentle color bleeding, light paper texture, and a natural hand-painted landscape illustration style. Keep the planting layout clearly readable. Avoid cartoon style, anime style, and heavy digital painting effects.",
  vangogh:
    "Transform this garden front-view design into a Van Gogh-inspired post-impressionist oil painting. Preserve the exact garden composition, plant positions, relative sizes, and front-view perspective. Do not add or remove plants. Keep the same layout and structure, only change the visual style to expressive brushstrokes, bold painterly texture, and Van Gogh-like color energy.",
};

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  });
  res.end(JSON.stringify(data));
}

function normalizeStyle(style) {
  return ["monet", "watercolor", "vangogh"].includes(style) ? style : null;
}

function splitDataUrl(dataUrl) {
  const match = /^data:(.+);base64,(.+)$/i.exec(dataUrl);
  if (!match) throw new Error("Invalid imageDataUrl");
  return { mimeType: match[1], base64: match[2] };
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
    const total = chunks.reduce((sum, item) => sum + item.length, 0);
    if (total > 20 * 1024 * 1024) {
      throw new Error("Request body too large");
    }
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(raw || "{}");
}

async function generateStylizedImage(imageDataUrl, style) {
  const apiKey = process.env.ARK_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ARK_API_KEY on local stylize server");
  }

  const { mimeType, base64 } = splitDataUrl(imageDataUrl);
  const inputDataUrl = `data:${mimeType};base64,${base64}`;

  const generationRes = await fetch(`${ARK_BASE_URL}/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: ARK_MODEL,
      prompt: PROMPTS[style],
      image: [inputDataUrl],
      seed: 123,
      guidance_scale: 5.5,
      size: "2k",
      watermark: true,
    }),
  });

  if (!generationRes.ok) {
    const text = await generationRes.text();
    throw new Error(`Volcengine request failed (${generationRes.status}): ${text}`);
  }

  const generationJson = await generationRes.json();
  const remoteUrl = generationJson?.data?.[0]?.url;
  const imageBase64 = generationJson?.data?.[0]?.b64_json;

  if (imageBase64) {
    return { imageDataUrl: `data:image/jpeg;base64,${imageBase64}` };
  }

  if (!remoteUrl) {
    throw new Error("No image URL returned from Volcengine");
  }

  const imageRes = await fetch(remoteUrl);
  if (!imageRes.ok) {
    throw new Error(`Failed to download generated image (${imageRes.status})`);
  }
  const arrayBuffer = await imageRes.arrayBuffer();
  const contentType = imageRes.headers.get("content-type") || "image/jpeg";
  const downloadedBase64 = Buffer.from(arrayBuffer).toString("base64");
  return { imageDataUrl: `data:${contentType};base64,${downloadedBase64}` };
}

const server = http.createServer(async (req, res) => {
  try {
    if (!req.url) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      });
      res.end();
      return;
    }

    if (req.method === "POST" && req.url === "/api/stylize") {
      const body = await readJsonBody(req);
      const style = normalizeStyle(body.style);
      if (!style) {
        sendJson(res, 400, { error: "Invalid style" });
        return;
      }
      if (typeof body.imageDataUrl !== "string" || !body.imageDataUrl.startsWith("data:image/")) {
        sendJson(res, 400, { error: "Invalid imageDataUrl" });
        return;
      }
      const result = await generateStylizedImage(body.imageDataUrl, style);
      sendJson(res, 200, result);
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, 500, { error: message });
  }
});

server.listen(PORT, () => {
  console.log(`Stylize server listening on http://localhost:${PORT}`);
});
