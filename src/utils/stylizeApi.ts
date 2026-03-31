export type FrontViewExportStyle =
  | "download"
  | "monet"
  | "impressionist"
  | "watercolor"
  | "vangogh"
  | "ukiyoe"
  | "animebg"
  | "architectural"
  | "botanical"
  | "pastel";

async function getImageDataUrlDimensions(imageDataUrl: string): Promise<{ width: number; height: number }> {
  return await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
    img.onerror = () => reject(new Error("Failed to inspect image dimensions"));
    img.src = imageDataUrl;
  });
}

export async function stylizeFrontViewImage(
  imageDataUrl: string,
  style: Exclude<FrontViewExportStyle, "download">,
  options?: { backgroundImageDataUrl?: string | null }
): Promise<{ imageDataUrl: string }> {
  const apiBase = ((import.meta.env.VITE_STYLIZE_API_BASE as string | undefined)?.trim() || "").replace(/\/+$/, "");
  const apiBaseRemote = (import.meta.env.VITE_STYLIZE_API_BASE_REMOTE as string | undefined)?.trim() || "";
  const backgroundImageDataUrl = options?.backgroundImageDataUrl?.trim() || "";
  let dimensions: { width: number; height: number } | null = null;
  try {
    dimensions = await getImageDataUrlDimensions(imageDataUrl);
  } catch (error) {
    console.warn("[stylize] failed to inspect image dimensions", error);
  }
  console.log(
    "[stylize] apiBase =",
    apiBase,
    "apiBaseRemote =",
    apiBaseRemote,
    "style =",
    style,
    "length =",
    imageDataUrl.length,
    "dimensions =",
    dimensions,
    "hasBackground =",
    !!backgroundImageDataUrl
  );
  const res = await fetch(`${apiBase}/api/stylize`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      imageDataUrl,
      backgroundImageDataUrl: backgroundImageDataUrl || undefined,
      style,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Stylize request failed (${res.status})`);
  }

  return (await res.json()) as { imageDataUrl: string };
}
