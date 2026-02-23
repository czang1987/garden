export type Footprint = [number, number]; // [h, w]

export type PlantVariant = {
  id: string;
  name: string;
  icon: string;
  baseHeight: number;
  footprint?: [number, number];
  tags?: string[];
  sun?: "full" | "partial" | "shade";
  water?: "low" | "medium" | "high";
  bloomSeasons?: ("spring" | "summer" | "autumn" | "winter")[];
  maintenance?: number; // 1~5
};

/*export type PlantVariant = {
  id: string;
  name: string;
  icon: string;
  baseHeight: number;
  footprint?: Footprint;
  tags?: string[];
};*/

export type PlantCategory = {
  id: string;
  name: string;
  icon?: string;
  variants: PlantVariant[];
};

export type PlantCatalogData = {
  categories: PlantCategory[];
};
