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
  ukiyoe:
    "Transform this garden front-view design into a refined ukiyo-e inspired print. Preserve the exact garden composition, plant positions, relative sizes, and front-view perspective. Do not add or remove plants. Keep the same planting layout and structure. Use elegant flattened shapes, crisp contour lines, restrained but beautiful color blocks, decorative rhythm, and a traditional woodblock print feeling while keeping the garden layout clear and readable.",
  animebg:
    "Transform this garden front-view design into a warm hand-painted animated background illustration. Preserve the exact garden composition, plant positions, relative sizes, and front-view perspective. Do not add or remove plants. Keep the same planting layout and structure. Use luminous natural color, soft atmospheric light, painterly foliage, clear readable plant masses, and a polished hand-painted animation-background feeling with warmth, calm, and charm. Keep the garden layout recognizable and avoid exaggerated cartoon distortion.",
  architectural:
    "Transform this garden front-view design into a refined professional landscape architectural rendering for an American residential foundation planting. Preserve the exact garden composition, plant positions, relative sizes, and front-view perspective. Do not add or remove plants. Keep the same planting layout and spatial structure. Use clean atmospheric rendering, soft realistic lighting, controlled textures, elegant presentation, and a polished landscape design visualization style. Add a subtle American home frontage background behind the planting, such as house siding or brick facade, porch edge, foundation wall, front windows, entry walk, or front steps, so the scene reads clearly as a suburban front-yard foundation planting. Do not place the planting bed directly in front of a main entrance, front door, or primary circulation path; keep entrances and exits visually clear and believable. Keep the architecture understated and secondary to the planting, while keeping the plants readable and the layout highly recognizable.",
  botanical:
    "Transform this garden front-view design into a botanical illustration. Preserve the exact garden composition, plant positions, relative sizes, and front-view perspective. Do not add or remove plants. Keep the same planting layout and structure. Use refined botanical painting detail, elegant hand-rendered texture, crisp readable plant forms, richer natural color, clearer color separation, luminous but realistic floral hues, and a polished scientific-illustration quality. Increase tonal contrast, deepen shadows slightly, keep highlights clean, and make the flower and foliage colors more distinct while remaining natural. Avoid washed-out colors, low contrast, flat lighting, and overly pale rendering while keeping the layout clearly readable.",
  pastel:
    "Transform this garden front-view design into a soft pastel painting. Preserve the exact garden composition, plant positions, relative sizes, and front-view perspective. Do not add or remove plants. Keep the same layout and structure. Use gentle pastel color transitions, powdery texture, soft edges, atmospheric light, and a dreamy hand-painted quality. Keep plant masses readable.",
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

function now() {
  return new Date().toISOString();
}

function logInfo(message, extra) {
  if (extra !== undefined) {
    console.log(`[${now()}] ${message}`, extra);
    return;
  }
  console.log(`[${now()}] ${message}`);
}

function logError(message, extra) {
  if (extra !== undefined) {
    console.error(`[${now()}] ${message}`, extra);
    return;
  }
  console.error(`[${now()}] ${message}`);
}

function normalizeStyle(style) {
  return ["monet", "watercolor", "vangogh", "ukiyoe", "animebg", "architectural", "botanical", "pastel"].includes(style) ? style : null;
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
  logInfo("Generating stylized image", {
    style,
    model: ARK_MODEL,
    mimeType,
    inputBytesApprox: Math.round((base64.length * 3) / 4),
  });

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
    logError("Volcengine generation request failed", { status: generationRes.status, style, body: text });
    throw new Error(`Volcengine request failed (${generationRes.status}): ${text}`);
  }

  const generationJson = await generationRes.json();
  const remoteUrl = generationJson?.data?.[0]?.url;
  const imageBase64 = generationJson?.data?.[0]?.b64_json;
  logInfo("Volcengine generation request succeeded", {
    style,
    returnedUrl: !!remoteUrl,
    returnedBase64: !!imageBase64,
  });

  if (imageBase64) {
    return { imageDataUrl: `data:image/jpeg;base64,${imageBase64}` };
  }

  if (!remoteUrl) {
    throw new Error("No image URL returned from Volcengine");
  }

  const imageRes = await fetch(remoteUrl);
  if (!imageRes.ok) {
    logError("Generated image download failed", { status: imageRes.status, style, remoteUrl });
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

    logInfo("Incoming request", { method: req.method, url: req.url });

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      });
      res.end();
      return;
    }

    if (req.method === "GET" && req.url === "/api/styles") {
      sendJson(res, 200, {
        version: "2026-03-22-style-set-2",
        styles: Object.keys(PROMPTS),
      });
      return;
    }

    if (req.method === "POST" && req.url === "/api/stylize") {
      const body = await readJsonBody(req);
      const style = normalizeStyle(body.style);
      logInfo("Stylize request body parsed", {
        style: body.style,
        validStyle: !!style,
        hasImageDataUrl: typeof body.imageDataUrl === "string",
      });
      if (!style) {
        sendJson(res, 400, { error: "Invalid style" });
        return;
      }
      if (typeof body.imageDataUrl !== "string" || !body.imageDataUrl.startsWith("data:image/")) {
        sendJson(res, 400, { error: "Invalid imageDataUrl" });
        return;
      }
      const result = await generateStylizedImage(body.imageDataUrl, style);
      logInfo("Stylize request completed", { style });
      sendJson(res, 200, result);
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError("Unhandled request error", { message });
    sendJson(res, 500, { error: message });
  }
});

server.listen(PORT, () => {
  logInfo(`Stylize server listening on http://localhost:${PORT}`);
  logInfo("Supported styles", Object.keys(PROMPTS));
  logInfo("Runtime configuration", {
    port: PORT,
    model: ARK_MODEL,
    baseUrl: ARK_BASE_URL,
  });
});
