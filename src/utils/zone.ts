import type { PlantVariant } from "../type/plants";

function parseZoneRange(zone?: string) {
  if (!zone) return null;
  const match = zone.trim().match(/^(\d+)\s*-\s*(\d+)$/);
  if (!match) return null;
  const min = Number(match[1]);
  const max = Number(match[2]);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return { min: Math.min(min, max), max: Math.max(min, max) };
}

export function plantSupportsZone(plant: PlantVariant, zone: number) {
  const range = parseZoneRange(plant.zone);
  if (!range) return true;
  return zone >= range.min && zone <= range.max;
}
