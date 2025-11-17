import { NextResponse } from "next/server";
import { Buffer } from "node:buffer";
import { HfInference } from "@huggingface/inference";
import { PNG } from "pngjs";
import {
  ConstructionType,
  getRoomColor,
  mockAnalyzeRooms,
  RoomDetection,
  RoomTypeDefinition,
} from "@/lib/analysis";

const HF_MODEL =
  process.env.HF_FLOORPLAN_MODEL ??
  "ozturkoktay/floor-plan-room-segmentation";
const HF_TOKEN =
  process.env.HF_ACCESS_TOKEN ?? process.env.HUGGING_FACE_TOKEN ?? null;

const inference = HF_TOKEN ? new HfInference(HF_TOKEN) : null;

type AnalyzeRequest = {
  pages: { id: string; index: number; thumbnail: string }[];
  classification?: ConstructionType;
  customRoomTypes?: RoomTypeDefinition[];
};

type AnalyzeResponse = {
  rooms: Record<string, RoomDetection[]>;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as AnalyzeRequest;
    const classification = body.classification ?? "residential";
    const customTypes = body.customRoomTypes ?? [];

    if (!body.pages?.length) {
      return NextResponse.json(
        { error: "At least one page is required" },
        { status: 400 },
      );
    }

    const rooms: AnalyzeResponse["rooms"] = {};

    if (!inference || !HF_TOKEN) {
      console.warn(
        "[analyze] Missing Hugging Face token. Falling back to mock results.",
      );
      body.pages.forEach((page) => {
        rooms[page.id] = mockAnalyzeRooms(
          page.index,
          classification,
          customTypes,
        );
      });
      return NextResponse.json(
        { rooms, fallback: true },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    for (const page of body.pages) {
      try {
        const detections = await analyzePageWithHf(
          page.thumbnail,
          page.index,
          customTypes,
        );
        rooms[page.id] = detections.length
          ? detections
          : mockAnalyzeRooms(page.index, classification, customTypes);
      } catch (error) {
        console.error(
          `[analyze] Hugging Face request failed for page ${page.index}`,
          error,
        );
        rooms[page.id] = mockAnalyzeRooms(
          page.index,
          classification,
          customTypes,
        );
      }
    }

    return NextResponse.json<AnalyzeResponse>(
      { rooms },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[analyze] request failed", error);
    return NextResponse.json(
      { error: "Unable to analyze floorplan pages" },
      { status: 500 },
    );
  }
}

const labelToRoomType = (label: string): string => {
  const normalized = label.toLowerCase();
  if (normalized.includes("living")) return "Living Room";
  if (normalized.includes("kitchen")) return "Kitchen";
  if (normalized.includes("bed")) return "Bedroom";
  if (normalized.includes("bath") || normalized.includes("rest"))
    return "Bathroom";
  if (normalized.includes("storage") || normalized.includes("closet"))
    return "Storage";
  if (normalized.includes("mechanical") || normalized.includes("utility"))
    return "Mechanical";
  if (normalized.includes("office") || normalized.includes("workspace"))
    return "Workspace";
  if (normalized.includes("corridor") || normalized.includes("hall"))
    return "Circulation";
  return label.replace(/(^|\s)\w/g, (match) => match.toUpperCase());
};

const analyzePageWithHf = async (
  thumbnailDataUrl: string,
  pageIndex: number,
  customTypes: RoomTypeDefinition[],
): Promise<RoomDetection[]> => {
  if (!inference) return [];
  const base64 = thumbnailDataUrl.split(",")[1];
  if (!base64) return [];
  const data = Buffer.from(base64, "base64");
  const segments = await inference.imageSegmentation({
    model: HF_MODEL,
    data,
  });

  if (!Array.isArray(segments)) return [];

  const detections: RoomDetection[] = [];

  for (let idx = 0; idx < segments.length; idx += 1) {
    const segment = segments[idx];
    if (!segment?.mask) continue;
    const maskBuffer = toPngBuffer(segment.mask);
    if (!maskBuffer?.length) continue;
    const detection = maskToBoundary(
      maskBuffer,
      segment.label ?? `Region ${idx + 1}`,
      segment.score ?? 0.5,
      pageIndex,
      idx,
      customTypes,
    );
    if (detection) {
      detections.push(detection);
    }
  }

  return detections;
};

const toPngBuffer = (mask: string) => {
  if (!mask) return null;
  if (mask.startsWith("data:image/png;base64,")) {
    return Buffer.from(mask.split(",")[1] ?? "", "base64");
  }
  return Buffer.from(mask, "base64");
};

const maskToBoundary = (
  maskBuffer: Buffer,
  label: string,
  score: number,
  pageIndex: number,
  idx: number,
  customTypes: RoomTypeDefinition[],
): RoomDetection | null => {
  try {
    const png = PNG.sync.read(maskBuffer);
    const { width, height, data } = png;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const pixelIndex = (y * width + x) * 4 + 3; // alpha channel
        if (data[pixelIndex] > 0) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (maxX === -1 || maxY === -1) return null;

    const roomType = labelToRoomType(label);

    return {
      id: `hf-room-${pageIndex}-${idx}`,
      label: roomType,
      type: roomType,
      confidence: Number(Math.min(Math.max(score, 0.1), 0.99).toFixed(2)),
      boundary: {
        x: minX / width,
        y: minY / height,
        width: Math.max((maxX - minX) / width, 0.05),
        height: Math.max((maxY - minY) / height, 0.05),
      },
      color: getRoomColor(roomType, customTypes),
    };
  } catch (error) {
    console.error("[analyze] Failed to decode mask", error);
    return null;
  }
};

