export type FrontViewExportStyle =
  | "download"
  | "monet"
  | "watercolor"
  | "vangogh"
  | "architectural"
  | "botanical"
  | "pastel"
  | "gouache"
  | "inkwash"
  | "storybook"
  | "coloredpencil";

export async function stylizeFrontViewImage(
  imageDataUrl: string,
  style: Exclude<FrontViewExportStyle, "download">
): Promise<{ imageDataUrl: string }> {
  const apiBase = (import.meta.env.VITE_STYLIZE_API_BASE as string | undefined)?.trim() || "http://localhost:8787";
  const res = await fetch(`${apiBase}/api/stylize`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      imageDataUrl,
      style,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Stylize request failed (${res.status})`);
  }

  return (await res.json()) as { imageDataUrl: string };
}
