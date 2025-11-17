import { NextResponse } from "next/server";
import {
  ConstructionType,
  mockAnalyzeRooms,
  RoomTypeDefinition,
} from "@/lib/analysis";

type AnalysisRequest = {
  pageIndex: number;
  classification: ConstructionType;
  customRoomTypes?: RoomTypeDefinition[];
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as AnalysisRequest;

    if (
      typeof body.pageIndex !== "number" ||
      !Number.isFinite(body.pageIndex) ||
      body.pageIndex < 0
    ) {
      return NextResponse.json(
        { message: "pageIndex must be a positive number" },
        { status: 400 },
      );
    }

    if (
      body.classification !== "residential" &&
      body.classification !== "commercial"
    ) {
      return NextResponse.json(
        { message: "classification must be residential or commercial" },
        { status: 400 },
      );
    }

    const customRoomTypes =
      body.customRoomTypes?.filter(
        (type): type is RoomTypeDefinition =>
          typeof type?.label === "string" &&
          type.label.trim().length > 0 &&
          typeof type.color === "string",
      ) ?? [];

    const rooms = mockAnalyzeRooms(
      body.pageIndex,
      body.classification,
      customRoomTypes,
    );

    return NextResponse.json({ rooms });
  } catch (error) {
    console.error("Analysis service error:", error);
    return NextResponse.json(
      { message: "Unable to process analysis request" },
      { status: 500 },
    );
  }
}

