export type DesignIntent = {
  height: {
    frontMin: number;
    backMin: number;
    frontMax: number;
    backMax: number;
    gradientStrength: number;
  };
  density: {
    front: number;
    middle: number;
    back: number;
  };
  layout: {
    symmetry: number;
    clusteriness: number;
  };
  color: {
    preferences: Record<string, number>;
  };
  plant: {
    preferences: Record<string, number>;
  };
};

export type DesignIntentPatch = {
  height?: Partial<DesignIntent["height"]>;
  density?: Partial<DesignIntent["density"]>;
  layout?: Partial<DesignIntent["layout"]>;
  color?: {
    preferences?: Record<string, number>;
  };
  plant?: {
    preferences?: Record<string, number>;
  };
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function applyDesignIntentPatch(current: DesignIntent, patch: DesignIntentPatch): DesignIntent {
  const next: DesignIntent = {
    height: { ...current.height, ...(patch.height ?? {}) },
    density: { ...current.density, ...(patch.density ?? {}) },
    layout: { ...current.layout, ...(patch.layout ?? {}) },
    color: {
      preferences: {
        ...current.color.preferences,
        ...(patch.color?.preferences ?? {}),
      },
    },
    plant: {
      preferences: {
        ...current.plant.preferences,
        ...(patch.plant?.preferences ?? {}),
      },
    },
  };

  next.height.frontMin = clamp(next.height.frontMin, 0, 120);
  next.height.backMin = clamp(next.height.backMin, 0, 120);
  next.height.frontMax = clamp(next.height.frontMax, next.height.frontMin, 160);
  next.height.backMax = clamp(next.height.backMax, next.height.backMin, 160);
  next.height.gradientStrength = clamp(next.height.gradientStrength, 0, 1);

  next.density.front = clamp(next.density.front, 0, 1);
  next.density.middle = clamp(next.density.middle, 0, 1);
  next.density.back = clamp(next.density.back, 0, 1);

  next.layout.symmetry = clamp(next.layout.symmetry, 0, 1);
  next.layout.clusteriness = clamp(next.layout.clusteriness, 0, 1);

  const sanitizedColorPreferences: Record<string, number> = {};
  for (const [key, value] of Object.entries(next.color.preferences)) {
    if (!Number.isFinite(value)) continue;
    sanitizedColorPreferences[key] = clamp(value, -1, 1);
  }
  next.color.preferences = sanitizedColorPreferences;

  const sanitizedPlantPreferences: Record<string, number> = {};
  for (const [key, value] of Object.entries(next.plant.preferences)) {
    if (!Number.isFinite(value)) continue;
    sanitizedPlantPreferences[key] = clamp(value, -1, 1);
  }
  next.plant.preferences = sanitizedPlantPreferences;

  return next;
}

export const DEFAULT_DESIGN_INTENT: DesignIntent = {
  height: {
    frontMin: 12,
    backMin: 36,
    frontMax: 36,
    backMax: 96,
    gradientStrength: 0.5,
  },
  density: {
    front: 0.62,
    middle: 0.62,
    back: 0.62,
  },
  layout: {
    symmetry: 0,
    clusteriness: 0.35,
  },
  color: {
    preferences: {},
  },
  plant: {
    preferences: {},
  },
};
