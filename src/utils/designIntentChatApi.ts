import type { DesignIntent, DesignIntentPatch } from "../type/designIntent";

export async function requestDesignIntentPatch(input: {
  message: string;
  designIntent: DesignIntent;
  zone: number;
  availableColors: string[];
  availablePlantTargets: Array<{ key: string; label: string }>;
}): Promise<{ patch: DesignIntentPatch; summary: string; source?: string }> {
  const apiBase = ((import.meta.env.VITE_STYLIZE_API_BASE as string | undefined)?.trim() || "").replace(/\/+$/, "");
  const apiBaseRemote = (import.meta.env.VITE_STYLIZE_API_BASE_REMOTE as string | undefined)?.trim() || "";
  console.log("[design-intent] apiBase =", apiBase, "apiBaseRemote =", apiBaseRemote, "message =", input.message);
  const res = await fetch(`${apiBase}/api/design-intent/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Design intent request failed (${res.status})`);
  }

  return (await res.json()) as { patch: DesignIntentPatch; summary: string; source?: string };
}
