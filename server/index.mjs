import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const PORT = Number(process.env.STYLIZE_PORT || 8787);
const ARK_BASE_URL = process.env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3";
const ARK_MODEL = process.env.ARK_MODEL || "doubao-seedream-4-0-250828";
const ARK_TEXT_MODEL = process.env.ARK_TEXT_MODEL || "";
const AI_CHAT_LOG_PATH = path.resolve(process.cwd(), "server", "logs", "design-intent-chat.log");

const PROMPTS = {
  monet:
    "Transform this garden front-view design into a Monet-inspired impressionist oil painting. Preserve the exact garden composition, plant positions, relative sizes, and front-view perspective. Do not add or remove plants. Keep the same layout and structure, only change the visual style to soft brushwork, painterly edges, atmospheric light, and Monet-like color harmony.",
  impressionist:
    "Transform this garden front-view design into a classic impressionist painting. Preserve the exact garden composition, plant positions, relative sizes, and front-view perspective. Do not add or remove plants. Keep the same planting layout and structure. Use lively broken brushstrokes, luminous natural color, soft atmospheric depth, painterly edges, and a balanced plein-air impressionist feeling. Keep the garden layout recognizable and the plant masses readable.",
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
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

function appendAiChatLog(entry) {
  try {
    fs.mkdirSync(path.dirname(AI_CHAT_LOG_PATH), { recursive: true });
    fs.appendFileSync(AI_CHAT_LOG_PATH, `${JSON.stringify({ timestamp: now(), ...entry })}\n`, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError("Failed to append AI chat log", { message });
  }
}

function maskSecret(secret) {
  if (!secret) return "(missing)";
  const value = String(secret);
  if (value.length <= 8) return `${value.slice(0, 2)}***${value.slice(-1)}`;
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

function normalizeStyle(style) {
  return ["monet", "impressionist", "watercolor", "vangogh", "ukiyoe", "animebg", "architectural", "botanical", "pastel"].includes(style) ? style : null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sanitizeDesignIntentPatch(patch, availableColors = []) {
  const safe = {};
  if (patch && typeof patch === "object") {
    if (patch.height && typeof patch.height === "object") {
      safe.height = {};
      for (const key of ["frontMin", "backMin"]) {
        if (Number.isFinite(patch.height[key])) safe.height[key] = clamp(Number(patch.height[key]), 0, 120);
      }
      for (const key of ["frontMax", "backMax"]) {
        if (Number.isFinite(patch.height[key])) safe.height[key] = clamp(Number(patch.height[key]), 0, 160);
      }
      if (Number.isFinite(patch.height.gradientStrength)) {
        safe.height.gradientStrength = clamp(Number(patch.height.gradientStrength), 0, 1);
      }
    }
    if (patch.density && typeof patch.density === "object") {
      safe.density = {};
      for (const key of ["front", "middle", "back"]) {
        if (Number.isFinite(patch.density[key])) safe.density[key] = clamp(Number(patch.density[key]), 0, 1);
      }
    }
    if (patch.layout && typeof patch.layout === "object") {
      safe.layout = {};
      for (const key of ["symmetry", "clusteriness"]) {
        if (Number.isFinite(patch.layout[key])) safe.layout[key] = clamp(Number(patch.layout[key]), 0, 1);
      }
    }
    if (patch.color?.preferences && typeof patch.color.preferences === "object") {
      const pref = {};
      for (const [key, value] of Object.entries(patch.color.preferences)) {
        if (!availableColors.includes(key)) continue;
        if (!Number.isFinite(value)) continue;
        pref[key] = clamp(Number(value), -1, 1);
      }
      safe.color = { preferences: pref };
    }
  }
  return safe;
}

function summarizeDesignIntentDelta(current, patch) {
  const next = {
    height: { ...(current?.height || {}), ...(patch?.height || {}) },
    density: { ...(current?.density || {}), ...(patch?.density || {}) },
    layout: { ...(current?.layout || {}), ...(patch?.layout || {}) },
    color: {
      preferences: {
        ...(current?.color?.preferences || {}),
        ...(patch?.color?.preferences || {}),
      },
    },
  };

  return {
    height: {
      before: current?.height || {},
      patch: patch?.height || {},
      after: next.height,
    },
    density: {
      before: current?.density || {},
      patch: patch?.density || {},
      after: next.density,
    },
    layout: {
      before: current?.layout || {},
      patch: patch?.layout || {},
      after: next.layout,
    },
    colorPreferencesPatch: patch?.color?.preferences || {},
  };
}

function extractJsonObject(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) throw new Error("Empty AI response");
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("AI response did not contain JSON");
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

function heuristicPatchFromMessage(message, availableColors = []) {
  const patch = {};
  const summary = [];

  if (/(?:\u5bf9\u79f0|\u6574\u9f50|formal|symmetric)/i.test(message)) {
    patch.layout = { ...(patch.layout || {}), symmetry: 0.8 };
    summary.push("Increase symmetry");
  }
  if (/(?:\u81ea\u7136|\u968f\u610f|\u677e\u5f1b|natural)/i.test(message)) {
    patch.layout = { ...(patch.layout || {}), symmetry: 0.2 };
    summary.push("Reduce symmetry");
  }
  if (/(?:\u6210\u7247|\u6210\u56e2|\u56e2\u5757|cluster)/i.test(message)) {
    patch.layout = { ...(patch.layout || {}), clusteriness: 0.75 };
    summary.push("Increase clusteriness");
  }
  if (/(?:\u540e\u6392.*(?:\u9ad8|\u9ad8\u4e00\u4e9b|\u66f4\u9ad8))/i.test(message)) {
    patch.height = {
      ...(patch.height || {}),
      backMin: 48,
      backMax: 108,
      gradientStrength: 0.65,
    };
    summary.push("Raise back-row target height");
  }
  if (/(?:\u524d\u6392.*(?:\u4f4e|\u4f4e\u4e00\u4e9b|\u66f4\u4f4e))/i.test(message)) {
    patch.height = {
      ...(patch.height || {}),
      frontMin: 8,
      frontMax: 30,
      gradientStrength: 0.65,
    };
    summary.push("Lower front-row target height");
  }
  if (/(?:\u524d\u4f4e\u540e\u9ad8|\u5c42\u6b21)/i.test(message)) {
    patch.height = { ...(patch.height || {}), frontMin: 10, backMin: 36, gradientStrength: 0.7 };
    summary.push("Strengthen front-low back-high layering");
  }
  if (/(?:\u524d\u6392.*(?:\u758f|\u7a00|\u7a00\u4e00\u70b9|\u66f4\u758f)|\u524d\u9762.*(?:\u758f|\u7a00))/i.test(message)) {
    patch.density = { ...(patch.density || {}), front: 0.35 };
    summary.push("Reduce front density");
  }
  if (/(?:\u540e\u6392.*(?:\u5bc6|\u5bc6\u4e00\u70b9|\u66f4\u5bc6)|\u540e\u9762.*\u5bc6)/i.test(message)) {
    patch.density = { ...(patch.density || {}), back: 0.78 };
    summary.push("Increase back density");
  }

  const colorMap = {
    white: /(?:\u767d|white)/i,
    pink: /(?:\u7c89|pink)/i,
    purple: /(?:\u7d2b|purple)/i,
    red: /(?:\u7ea2|red)/i,
    blue: /(?:\u84dd|blue)/i,
    yellow: /(?:\u9ec4|yellow)/i,
    green: /(?:\u7eff|green)/i,
  };
  for (const [color, regex] of Object.entries(colorMap)) {
    if (!availableColors.includes(color) || !regex.test(message)) continue;
    const negative = /(?:\u5c11|\u51cf\u5c11|\u4e0d\u8981|\u522b|\u53bb\u6389|less|remove|avoid)/i.test(message);
    const positive = /(?:\u591a|\u589e\u52a0|\u66f4\u591a|\u559c\u6b22|\u504f\u597d|\u60f3\u8981|more|prefer|add)/i.test(message);
    if (!patch.color) patch.color = { preferences: {} };
    patch.color.preferences[color] = negative ? -0.6 : positive ? 0.7 : 0.4;
    summary.push((negative ? "Reduce" : "Increase") + " " + color + " preference");
  }

  return {
    patch: sanitizeDesignIntentPatch(patch, availableColors),
    summary: summary.join(", ") || "Generated a small intent patch from the request.",
    source: "heuristic",
  };
}

async function generateDesignIntentPatchWithArk({ message, designIntent, zone, availableColors }) {
  const apiKey = process.env.ARK_API_KEY;
  if (!apiKey || !ARK_TEXT_MODEL) {
    return heuristicPatchFromMessage(message, availableColors);
  }

  const systemPrompt = [
    "You convert a gardening request into a JSON patch.",
    "Return JSON only. No markdown. No extra explanation.",
    'Output schema: {"patch":{"height"?:{"frontMin"?:number,"backMin"?:number,"frontMax"?:number,"backMax"?:number,"gradientStrength"?:number},"density"?:{"front"?:number,"middle"?:number,"back"?:number},"layout"?:{"symmetry"?:number,"clusteriness"?:number},"color"?:{"preferences"?:Record<string,number>}},"summary":string}.',
    "Only include fields that should change.",
    "Allowed ranges: frontMin/backMin 0-120; frontMax/backMax 0-160; gradientStrength 0-1; density 0-1; symmetry 0-1; clusteriness 0-1; color preference -1 to 1.",
    "Only use color keys from availableColors.",
    "Prefer small conservative edits rather than large jumps.",
    "If the request is vague, return a small helpful patch.",
  ].join(" ");

  const userPrompt = JSON.stringify({
    message,
    zone,
    availableColors,
    currentDesignIntent: designIntent,
  });

  logInfo("Generating design intent patch", {
    model: ARK_TEXT_MODEL,
    zone,
    availableColors,
    message,
  });

  const res = await fetch(`${ARK_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: ARK_TEXT_MODEL,
      temperature: 0.2,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    logError("Volcengine design-intent request failed", { status: res.status, body: text });
    throw new Error(`Volcengine text request failed (${res.status}): ${text}`);
  }

  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content || "";
  const parsed = extractJsonObject(content);
  return {
    patch: sanitizeDesignIntentPatch(parsed.patch, availableColors),
    summary: typeof parsed.summary === "string" && parsed.summary.trim() ? parsed.summary.trim() : "Updated the design intent from your request.",
    source: "ark",
  };
}

function splitDataUrl(dataUrl) {
  const match = /^data:(.+);base64,(.+)$/i.exec(dataUrl);
  if (!match) throw new Error("Invalid imageDataUrl");
  return { mimeType: match[1], base64: match[2] };
}

function readPngDimensions(buffer) {
  if (buffer.length < 24) return null;
  const pngSignature = "89504e470d0a1a0a";
  if (buffer.subarray(0, 8).toString("hex") !== pngSignature) return null;
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function readJpegDimensions(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    const blockLength = buffer.readUInt16BE(offset + 2);
    const isSof =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isSof && offset + 8 < buffer.length) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }
    if (!blockLength || offset + 2 + blockLength > buffer.length) break;
    offset += 2 + blockLength;
  }
  return null;
}

function readImageDimensionsFromBase64(mimeType, base64) {
  try {
    const buffer = Buffer.from(base64, "base64");
    if (/png/i.test(mimeType)) return readPngDimensions(buffer);
    if (/jpe?g/i.test(mimeType)) return readJpegDimensions(buffer);
    return null;
  } catch {
    return null;
  }
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
  const dimensions = readImageDimensionsFromBase64(mimeType, base64);
  logInfo("Generating stylized image", {
    style,
    model: ARK_MODEL,
    mimeType,
    inputBytesApprox: Math.round((base64.length * 3) / 4),
    dimensions,
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
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

    if (req.method === "POST" && req.url === "/api/design-intent/chat") {
      const body = await readJsonBody(req);
      const message = typeof body.message === "string" ? body.message.trim() : "";
      if (!message) {
        sendJson(res, 400, { error: "Invalid message" });
        return;
      }
      const designIntent = body.designIntent && typeof body.designIntent === "object" ? body.designIntent : {};
      const zone = Number.isFinite(body.zone) ? Number(body.zone) : null;
      const availableColors = Array.isArray(body.availableColors)
        ? body.availableColors.filter((item) => typeof item === "string")
        : [];
      logInfo("Design intent user command", {
        message,
        zone,
        availableColors,
      });
      const result = await generateDesignIntentPatchWithArk({
        message,
        designIntent,
        zone,
        availableColors,
      });
      logInfo("Design intent assistant feedback", {
        source: result.source,
        summary: result.summary,
        patch: result.patch,
      });
      const deltaPreview = summarizeDesignIntentDelta(designIntent, result.patch);
      logInfo("Design intent delta preview", deltaPreview);
      appendAiChatLog({
        message,
        zone,
        availableColors,
        source: result.source,
        summary: result.summary,
        patch: result.patch,
        deltaPreview,
      });
      sendJson(res, 200, result);
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const errorDetails =
      error instanceof Error
        ? {
            name: error.name,
            message: error.message,
            stack: error.stack,
            cause:
              error.cause && typeof error.cause === "object"
                ? {
                    ...(typeof error.cause.name === "string" ? { name: error.cause.name } : {}),
                    ...(typeof error.cause.message === "string" ? { message: error.cause.message } : {}),
                    ...(typeof error.cause.code === "string" ? { code: error.cause.code } : {}),
                    ...(typeof error.cause.errno === "number" ? { errno: error.cause.errno } : {}),
                    ...(typeof error.cause.syscall === "string" ? { syscall: error.cause.syscall } : {}),
                    ...(typeof error.cause.address === "string" ? { address: error.cause.address } : {}),
                    ...(typeof error.cause.port === "number" ? { port: error.cause.port } : {}),
                  }
                : error.cause,
          }
        : { message };
    logError("Unhandled request error", errorDetails);
    sendJson(res, 500, { error: message });
  }
});

server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
server.requestTimeout = 10 * 60 * 1000;

server.listen(PORT, () => {
  logInfo(`Stylize server listening on http://localhost:${PORT}`);
  logInfo("Supported styles", Object.keys(PROMPTS));
  logInfo("Runtime configuration", {
    port: PORT,
    model: ARK_MODEL,
    textModel: ARK_TEXT_MODEL || "(heuristic fallback)",
    baseUrl: ARK_BASE_URL,
    apiKeyPresent: !!process.env.ARK_API_KEY,
    apiKeyPreview: maskSecret(process.env.ARK_API_KEY),
  });
});
