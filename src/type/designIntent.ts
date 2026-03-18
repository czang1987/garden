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
};

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
};
