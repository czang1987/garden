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
    edgePreferences: Record<string, number>;
    centerPreferences: Record<string, number>;
    cornerPreferences: Record<string, number>;
    frontPreferences: Record<string, number>;
    middlePreferences: Record<string, number>;
    backPreferences: Record<string, number>;
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
    edgePreferences?: Record<string, number>;
    centerPreferences?: Record<string, number>;
    cornerPreferences?: Record<string, number>;
    frontPreferences?: Record<string, number>;
    middlePreferences?: Record<string, number>;
    backPreferences?: Record<string, number>;
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
      edgePreferences: {
        ...current.plant.edgePreferences,
        ...(patch.plant?.edgePreferences ?? {}),
      },
      centerPreferences: {
        ...current.plant.centerPreferences,
        ...(patch.plant?.centerPreferences ?? {}),
      },
      cornerPreferences: {
        ...current.plant.cornerPreferences,
        ...(patch.plant?.cornerPreferences ?? {}),
      },
      frontPreferences: {
        ...current.plant.frontPreferences,
        ...(patch.plant?.frontPreferences ?? {}),
      },
      middlePreferences: {
        ...current.plant.middlePreferences,
        ...(patch.plant?.middlePreferences ?? {}),
      },
      backPreferences: {
        ...current.plant.backPreferences,
        ...(patch.plant?.backPreferences ?? {}),
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

  const sanitizedEdgePlantPreferences: Record<string, number> = {};
  for (const [key, value] of Object.entries(next.plant.edgePreferences)) {
    if (!Number.isFinite(value)) continue;
    sanitizedEdgePlantPreferences[key] = clamp(value, -1, 1);
  }
  next.plant.edgePreferences = sanitizedEdgePlantPreferences;

  const sanitizedCenterPlantPreferences: Record<string, number> = {};
  for (const [key, value] of Object.entries(next.plant.centerPreferences)) {
    if (!Number.isFinite(value)) continue;
    sanitizedCenterPlantPreferences[key] = clamp(value, -1, 1);
  }
  next.plant.centerPreferences = sanitizedCenterPlantPreferences;

  const sanitizedCornerPlantPreferences: Record<string, number> = {};
  for (const [key, value] of Object.entries(next.plant.cornerPreferences)) {
    if (!Number.isFinite(value)) continue;
    sanitizedCornerPlantPreferences[key] = clamp(value, -1, 1);
  }
  next.plant.cornerPreferences = sanitizedCornerPlantPreferences;

  const sanitizedFrontPlantPreferences: Record<string, number> = {};
  for (const [key, value] of Object.entries(next.plant.frontPreferences)) {
    if (!Number.isFinite(value)) continue;
    sanitizedFrontPlantPreferences[key] = clamp(value, -1, 1);
  }
  next.plant.frontPreferences = sanitizedFrontPlantPreferences;

  const sanitizedMiddlePlantPreferences: Record<string, number> = {};
  for (const [key, value] of Object.entries(next.plant.middlePreferences)) {
    if (!Number.isFinite(value)) continue;
    sanitizedMiddlePlantPreferences[key] = clamp(value, -1, 1);
  }
  next.plant.middlePreferences = sanitizedMiddlePlantPreferences;

  const sanitizedBackPlantPreferences: Record<string, number> = {};
  for (const [key, value] of Object.entries(next.plant.backPreferences)) {
    if (!Number.isFinite(value)) continue;
    sanitizedBackPlantPreferences[key] = clamp(value, -1, 1);
  }
  next.plant.backPreferences = sanitizedBackPlantPreferences;

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
    edgePreferences: {},
    centerPreferences: {},
    cornerPreferences: {},
    frontPreferences: {},
    middlePreferences: {},
    backPreferences: {},
  },
};
