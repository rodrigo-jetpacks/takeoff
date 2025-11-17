export type ConstructionType = "residential" | "commercial";

export type RoomTypeDefinition = {
  label: string;
  color: string;
};

export type RoomBoundary = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type RoomDetection = {
  id: string;
  label: string;
  type: string;
  confidence: number;
  boundary: RoomBoundary;
  color: string;
  manual?: boolean;
};

export type PagePreview = {
  id: string;
  index: number;
  thumbnail: string;
  width: number;
  height: number;
  status: "idle" | "processing" | "processed";
  selected: boolean;
  rooms: RoomDetection[];
};

export const baseRoomTypes: RoomTypeDefinition[] = [
  { label: "Living Room", color: "#F97316" },
  { label: "Kitchen", color: "#0EA5E9" },
  { label: "Bedroom", color: "#A855F7" },
  { label: "Bathroom", color: "#10B981" },
  { label: "Circulation", color: "#F59E0B" },
  { label: "Storage", color: "#6B7280" },
  { label: "Mechanical", color: "#14B8A6" },
  { label: "Workspace", color: "#EF4444" },
];

const residentialBias: Record<string, number> = {
  "Living Room": 1.1,
  Kitchen: 1.05,
  Bedroom: 1.2,
  Bathroom: 1.15,
};

const commercialBias: Record<string, number> = {
  Workspace: 1.3,
  Mechanical: 1.1,
  Storage: 1.05,
  Circulation: 1.08,
};

const randomRoomNames = [
  "Suite",
  "Studio",
  "Flex Space",
  "Utility",
  "Lobby",
  "Conference",
  "Breakroom",
  "Core",
];

const seededRandom = (seed: number) => {
  let value = seed % 2147483647;
  if (value <= 0) value += 2147483646;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
};

export const getRoomColor = (
  type: string,
  customTypes: RoomTypeDefinition[] = [],
) => {
  const match =
    baseRoomTypes.find((def) => def.label === type) ??
    customTypes.find((def) => def.label === type);
  return match?.color ?? "#94A3B8";
};

export function mockAnalyzeRooms(
  pageIndex: number,
  classification: ConstructionType,
  customTypes: RoomTypeDefinition[] = [],
): RoomDetection[] {
  const rand = seededRandom(pageIndex + 1);
  const roomCount = Math.max(3, Math.floor(rand() * 6));
  const definitions = [...baseRoomTypes, ...customTypes];

  return Array.from({ length: roomCount }).map((_, idx) => {
    const typeIndex = Math.floor(rand() * definitions.length);
    const selectedType = definitions[typeIndex] ?? definitions[0];
    const biasMap =
      classification === "residential" ? residentialBias : commercialBias;
    const confidenceBase = 0.65 + rand() * 0.3;
    const bias = biasMap[selectedType.label] ?? 1;
    const confidence = Math.min(0.99, confidenceBase * bias);

    const width = 0.25 + rand() * 0.45;
    const height = 0.2 + rand() * 0.4;
    const x = rand() * (1 - width);
    const y = rand() * (1 - height);

    return {
      id: `room-${pageIndex}-${idx}`,
      label: randomRoomNames[idx % randomRoomNames.length] ?? selectedType.label,
      type: selectedType.label,
      confidence: Number(confidence.toFixed(2)),
      boundary: { x, y, width, height },
      color: getRoomColor(selectedType.label, customTypes),
    };
  });
}

