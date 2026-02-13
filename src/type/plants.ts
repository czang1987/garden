export type Footprint = [number, number]; // [h, w]

export type PlantVariant = {
  id: string;
  name: string;
  icon: string;
  baseHeight: number;
  footprint?: Footprint;
  tags?: string[];
};

export type PlantCategory = {
  id: string;
  name: string;
  icon?: string;
  variants: PlantVariant[];
};

export type PlantCatalogData = {
  categories: PlantCategory[];
};
