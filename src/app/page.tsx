"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import clsx from "clsx";
import {
  AlertCircle,
  Check,
  Download,
  FileUp,
  Loader2,
  Play,
  Ruler,
  Sparkles,
  SquarePen,
} from "lucide-react";
import Image from "next/image";
import {
  baseRoomTypes,
  ConstructionType,
  getRoomColor,
  PagePreview,
  RoomDetection,
  RoomTypeDefinition,
} from "@/lib/analysis";
import {
  GlobalWorkerOptions,
  getDocument,
} from "pdfjs-dist/legacy/build/pdf";

GlobalWorkerOptions.workerSrc = "/pdf.worker.min.js";

const scalePresets = [
  `1/8" = 1'-0"`,
  `1/4" = 1'-0"`,
  `1/16" = 1'-0"`,
  `1:100`,
  `1:200`,
];

const emptyPageState: PagePreview[] = [];

const maxLogEntries = 5;

export default function Home() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [pages, setPages] = useState<PagePreview[]>(emptyPageState);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [loadingPages, setLoadingPages] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [classification, setClassification] =
    useState<ConstructionType>("residential");
  const [scalePreset, setScalePreset] = useState(scalePresets[0]);
  const [customScale, setCustomScale] = useState("");
  const [customRoomTypes, setCustomRoomTypes] = useState<RoomTypeDefinition[]>(
    [],
  );
  const [newRoomType, setNewRoomType] = useState({
    label: "",
    color: "#6366F1",
  });
  const [showOverlay, setShowOverlay] = useState<"before" | "after">("after");
  const [logEntries, setLogEntries] = useState<string[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const currentPage = useMemo(
    () => pages.find((page) => page.id === selectedPageId),
    [pages, selectedPageId],
  );

  const selectedCount = useMemo(
    () => pages.filter((page) => page.selected).length,
    [pages],
  );

  const processedCount = useMemo(
    () => pages.filter((page) => page.status === "processed").length,
    [pages],
  );

  const pushLog = useCallback((message: string) => {
    setLogEntries((prev) => {
      const next = [message, ...prev];
      return next.slice(0, maxLogEntries);
    });
  }, []);

  const resetProject = () => {
    setPages(emptyPageState);
    setSelectedPageId(null);
    setFileName(null);
    setLogEntries([]);
    setUploadError(null);
    setProcessing(false);
  };

  const handleFileChange = async (file?: File | null) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setUploadError("Only multi-page PDF files are supported in this demo.");
      return;
    }

    setUploadError(null);
    setLoadingPages(true);
    setFileName(file.name);
    setPages(emptyPageState);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await getDocument({ data: arrayBuffer }).promise;

      const nextPages: PagePreview[] = [];

      for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex += 1) {
        const page = await pdf.getPage(pageIndex);
        const viewport = page.getViewport({ scale: 0.35 });
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        await page.render({ canvasContext: context!, viewport }).promise;

        nextPages.push({
          id: `page-${pageIndex}`,
          index: pageIndex,
          thumbnail: canvas.toDataURL("image/png"),
          width: canvas.width,
          height: canvas.height,
          status: "idle",
          selected: pageIndex === 1,
          rooms: [],
        });
      }

      setPages(nextPages);
      setSelectedPageId(nextPages[0]?.id ?? null);
      pushLog(`Loaded ${pdf.numPages} page(s) from ${file.name}`);
    } catch (error) {
      console.error(error);
      setUploadError("We could not read that PDF. Please try another file.");
    } finally {
      setLoadingPages(false);
    }
  };

  const handleProcess = async () => {
    if (!selectedCount || processing) return;
    const pagesToProcess = pages.filter((page) => page.selected);
    if (!pagesToProcess.length) return;
    setProcessing(true);
    setAnalysisError(null);
    pushLog("Preparing analysis pipeline…");

    setPages((prev) =>
      prev.map((page) =>
        page.selected ? { ...page, status: "processing" } : page,
      ),
    );

    await new Promise((resolve) => setTimeout(resolve, 700));
    pushLog("Removing clutter and cleaning geometry…");

    await new Promise((resolve) => setTimeout(resolve, 800));
    pushLog("Classifying rooms and generating overlays…");

    await new Promise((resolve) => setTimeout(resolve, 600));

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          pages: pagesToProcess.map((page) => ({
            id: page.id,
            index: page.index,
            thumbnail: page.thumbnail,
          })),
          classification,
          customRoomTypes,
        }),
      });

      if (!response.ok) {
        throw new Error(
          `Analysis request failed: ${response.status} ${response.statusText}`,
        );
      }

      const data = (await response.json()) as {
        rooms: Record<string, RoomDetection[]>;
      };

      setPages((prev) =>
        prev.map((page) => {
          if (!page.selected) return page;
          const detectedRooms = data.rooms?.[page.id] ?? [];
          return {
            ...page,
            status: "processed",
            rooms: detectedRooms,
          };
        }),
      );

      pushLog("Analysis complete via CV endpoint.");
    } catch (error) {
      console.error(error);
      const message =
        error instanceof Error
          ? error.message
          : "Analysis service failed. Please retry.";
      setAnalysisError(message);
      pushLog("Analysis failed. Falling back to local mock results.");

      setPages((prev) =>
        prev.map((page) => {
          if (!page.selected) return page;
          const rooms = mockAnalyzeRooms(
            page.index,
            classification,
            customRoomTypes,
          );
          return {
            ...page,
            status: "processed",
            rooms,
          };
        }),
      );
    } finally {
      setProcessing(false);
    }
  };

  const togglePageSelection = (pageId: string) => {
    setPages((prev) =>
      prev.map((page) =>
        page.id === pageId ? { ...page, selected: !page.selected } : page,
      ),
    );
    setSelectedPageId(pageId);
  };

  const updateRoom = (roomId: string, data: Partial<RoomDetection>) => {
    setPages((prev) =>
      prev.map((page) => {
        if (page.id !== selectedPageId) return page;
        return {
          ...page,
          rooms: page.rooms.map((room) =>
            room.id === roomId ? { ...room, ...data, manual: true } : room,
          ),
        };
      }),
    );
  };

  const addCustomRoomType = () => {
    if (!newRoomType.label.trim()) return;
    setCustomRoomTypes((prev) => [
      ...prev,
      {
        label: newRoomType.label.trim(),
        color: newRoomType.color,
      },
    ]);
    setNewRoomType({ label: "", color: newRoomType.color });
    pushLog(`Added custom room type: ${newRoomType.label.trim()}`);
  };

  const handleExport = () => {
    if (!canvasRef.current) return;
    const dataUrl = canvasRef.current.toDataURL("image/png");
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = `${fileName ?? "takeoff"}-analysis.png`;
    link.click();
    pushLog("Exported processed overlay as PNG.");
  };

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-12">
      <div className="mx-auto flex max-w-6xl flex-col gap-8">
        <header className="flex flex-col gap-4 rounded-3xl bg-white/90 p-8 shadow-sm ring-1 ring-slate-100">
          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500">
            <span className="rounded-full bg-slate-100 px-3 py-1">
              Computer Vision Pilot
            </span>
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-700">
              Guest Workspace
            </span>
          </div>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                Takeoff MVP
              </p>
              <h1 className="mt-2 text-4xl font-semibold text-slate-900">
                Floorplan analysis sandbox
              </h1>
              <p className="mt-3 max-w-2xl text-base text-slate-500">
                Upload a multi-page PDF, preview thumbnails, and simulate the
                automated cleaning, room identification, and export workflow
                described in the Takeoff master plan.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={resetProject}
                className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-800"
              >
                Reset sandbox
              </button>
              <button
                onClick={handleExport}
                disabled={!currentPage || currentPage.rooms.length === 0}
                className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition enabled:hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-200"
              >
                <Download className="h-4 w-4" />
                Export overlay
              </button>
            </div>
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[320px,1fr]">
          <div className="flex flex-col gap-6">
            <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-100">
              <h2 className="text-lg font-semibold text-slate-900">
                Upload + page management
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Drag in a multi-page PDF to generate thumbnails for each sheet.
                Select the pages you want to process.
              </p>
              <label
                htmlFor="floorplan-upload"
                className={clsx(
                  "mt-4 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-4 py-10 text-center transition",
                  loadingPages
                    ? "border-slate-200 bg-slate-50 text-slate-400"
                    : "border-slate-300 text-slate-500 hover:border-slate-400 hover:bg-slate-50",
                )}
              >
                <input
                  id="floorplan-upload"
                  type="file"
                  accept="application/pdf"
                  className="sr-only"
                  onChange={(event) =>
                    handleFileChange(event.target.files?.[0])
                  }
                />
                {loadingPages ? (
                  <>
                    <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                    <p className="mt-2 text-sm font-medium">
                      Generating thumbnails…
                    </p>
                  </>
                ) : (
                  <>
                    <FileUp className="h-6 w-6 text-slate-400" />
                    <p className="mt-2 text-sm font-medium text-slate-700">
                      Drop PDF or click to upload
                    </p>
                    <p className="text-xs text-slate-400">
                      Support for DWG arrives after CV backend ships
                    </p>
                  </>
                )}
              </label>
              {fileName && (
                <div className="mt-3 rounded-2xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  <p className="font-medium text-slate-800">{fileName}</p>
                  <p>{selectedCount} page(s) selected · {processedCount} ready</p>
                </div>
              )}
              {uploadError && (
                <div className="mt-3 flex items-start gap-2 rounded-2xl bg-rose-50 px-3 py-2 text-sm text-rose-600">
                  <AlertCircle className="mt-0.5 h-4 w-4" />
                  <p>{uploadError}</p>
                </div>
              )}
            </div>

            <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-100">
              <h2 className="text-lg font-semibold text-slate-900">Settings</h2>
              <div className="mt-4 space-y-4">
                <div>
                  <p className="text-sm font-medium text-slate-700">
                    Construction type
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {(["residential", "commercial"] as ConstructionType[]).map(
                      (option) => (
                        <button
                          key={option}
                          onClick={() => setClassification(option)}
                          className={clsx(
                            "rounded-2xl border px-3 py-2 text-sm font-medium capitalize transition",
                            classification === option
                              ? "border-slate-900 bg-slate-900 text-white"
                              : "border-slate-200 text-slate-600 hover:border-slate-300 hover:text-slate-900",
                          )}
                        >
                          {option}
                        </button>
                      ),
                    )}
                  </div>
                </div>

                <div>
                  <p className="text-sm font-medium text-slate-700">
                    Scale + measurement
                  </p>
                  <div className="mt-2 space-y-2 text-sm text-slate-600">
                    <select
                      value={scalePreset}
                      onChange={(event) => setScalePreset(event.target.value)}
                      className="w-full rounded-2xl border border-slate-200 px-3 py-2 focus:border-slate-400 focus:outline-none"
                    >
                      {scalePresets.map((preset) => (
                        <option key={preset} value={preset}>
                          {preset}
                        </option>
                      ))}
                    </select>
                    <input
                      value={customScale}
                      onChange={(event) => setCustomScale(event.target.value)}
                      placeholder={'Custom scale (e.g. 1" = 4\')'}
                      className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <p className="text-sm font-medium text-slate-700">
                    Custom room types
                  </p>
                  <div className="mt-2 space-y-2">
                    <div className="flex items-center gap-2">
                      <input
                        value={newRoomType.label}
                        onChange={(event) =>
                          setNewRoomType((prev) => ({
                            ...prev,
                            label: event.target.value,
                          }))
                        }
                        placeholder="Roof terrace, lab, etc."
                        className="flex-1 rounded-2xl border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
                      />
                      <input
                        type="color"
                        value={newRoomType.color}
                        onChange={(event) =>
                          setNewRoomType((prev) => ({
                            ...prev,
                            color: event.target.value,
                          }))
                        }
                        className="h-11 w-16 cursor-pointer rounded-2xl border border-slate-200 bg-white p-1"
                      />
                    </div>
                    <button
                      onClick={addCustomRoomType}
                      className="flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300"
                    >
                      <SquarePen className="h-4 w-4" />
                      Save custom type
                    </button>
                    <div className="flex flex-wrap gap-2 text-xs">
                      {[...baseRoomTypes, ...customRoomTypes].map((type) => (
                        <span
                          key={type.label}
                          className="inline-flex items-center gap-1 rounded-full px-2 py-1 font-medium text-slate-600"
                          style={{ backgroundColor: `${type.color}22` }}
                        >
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: type.color }}
                          />
                          {type.label}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-100">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-900">
                  Processing
                </h2>
                <button
                  onClick={handleProcess}
                  disabled={!selectedCount || processing}
                  className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition enabled:hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-200"
                >
                  {processing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                  Run analysis
                </button>
              </div>
              <p className="mt-1 text-sm text-slate-500">
                Each step mirrors the MVP flow: upload, clean, classify, export.
              </p>
              {analysisError && (
                <div className="mt-3 flex items-start gap-2 rounded-2xl bg-rose-50 px-3 py-2 text-sm text-rose-600">
                  <AlertCircle className="mt-0.5 h-4 w-4" />
                  <p>{analysisError}</p>
                </div>
              )}
              <ul className="mt-4 space-y-3 text-sm">
                {[
                  { label: "Upload", done: !!fileName },
                  { label: "Clean geometry", done: processing || processedCount },
                  { label: "Room identification", done: processedCount > 0 },
                  { label: "Export", done: processedCount > 0 },
                ].map((step) => (
                  <li
                    key={step.label}
                    className="flex items-center gap-2 rounded-2xl border border-slate-200 px-3 py-2"
                  >
                    <span
                      className={clsx(
                        "flex h-6 w-6 items-center justify-center rounded-full border text-xs",
                        step.done
                          ? "border-emerald-200 bg-emerald-50 text-emerald-600"
                          : "border-slate-200 bg-white text-slate-400",
                      )}
                    >
                      {step.done ? <Check className="h-3 w-3" /> : "•"}
                    </span>
                    <span
                      className={clsx(
                        "font-medium",
                        step.done ? "text-slate-900" : "text-slate-400",
                      )}
                    >
                      {step.label}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="flex flex-col gap-6">
            <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-100">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-slate-500">
                    Page gallery
                  </p>
                  <h2 className="text-xl font-semibold text-slate-900">
                    Select sheets for analysis
                  </h2>
                </div>
                <div className="text-right text-sm text-slate-500">
                  {selectedCount} selected / {pages.length} total
                </div>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {pages.map((page) => (
                  <button
                    key={page.id}
                    onClick={() => togglePageSelection(page.id)}
                    className={clsx(
                      "group flex flex-col rounded-2xl border p-3 text-left transition",
                      page.selected
                        ? "border-slate-900 shadow-md"
                        : "border-slate-200 hover:border-slate-300",
                    )}
                  >
                    <div className="relative aspect-[3/4] overflow-hidden rounded-xl bg-slate-50">
        <Image
                        src={page.thumbnail}
                        alt={`Page ${page.index}`}
                        width={Math.max(1, page.width)}
                        height={Math.max(1, page.height)}
                        className="h-full w-full object-cover"
                        sizes="(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 200px"
                      />
                      {page.status !== "idle" && (
                        <span
                          className={clsx(
                            "absolute right-2 top-2 inline-flex items-center rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide",
                            page.status === "processing"
                              ? "bg-amber-100 text-amber-700"
                              : "bg-emerald-100 text-emerald-700",
                          )}
                        >
                          {page.status}
                        </span>
                      )}
                    </div>
                    <div className="mt-2 flex items-center justify-between text-sm text-slate-600">
                      <span className="font-medium text-slate-900">
                        Page {page.index}
                      </span>
                      <span>
                        {page.rooms.length
                          ? `${page.rooms.length} rooms`
                          : "Not processed"}
                      </span>
                    </div>
                  </button>
                ))}
                {!pages.length && !loadingPages && (
                  <div className="col-span-full rounded-2xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">
                    Upload a floorplan PDF to see page previews.
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-100">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-slate-500">
                    Analysis canvas
                  </p>
                  <h2 className="text-xl font-semibold text-slate-900">
                    Review + fine-tune boundaries
                  </h2>
                </div>
                <div className="flex gap-2 rounded-2xl bg-slate-100 p-1">
                  {(["before", "after"] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setShowOverlay(mode)}
                      className={clsx(
                        "rounded-2xl px-4 py-1.5 text-sm font-medium capitalize transition",
                        showOverlay === mode
                          ? "bg-white text-slate-900 shadow-sm"
                          : "text-slate-500",
                      )}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
                {currentPage ? (
                  <AnalysisCanvas
                    page={currentPage}
                    showOverlay={showOverlay === "after"}
                    canvasRef={canvasRef}
                  />
                ) : (
                  <div className="flex h-72 items-center justify-center text-sm text-slate-400">
                    Select a page to preview the overlay.
                  </div>
                )}
              </div>

              {currentPage && (
                <div className="mt-6 flex flex-col gap-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-slate-900">
                      Rooms on page {currentPage.index}
                    </h3>
                    <div className="text-sm text-slate-500">
                      {currentPage.rooms.length
                        ? "Adjust room type, confidence, and boundaries"
                        : "Run analysis to populate rooms"}
                    </div>
                  </div>
                  <div className="space-y-4">
                    {currentPage.rooms.map((room) => (
                      <div
                        key={room.id}
                        className="rounded-2xl border border-slate-200 p-4"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <span
                              className="h-8 w-8 rounded-full"
                              style={{ backgroundColor: `${room.color}33` }}
                            >
                              <span
                                className="sr-only">{room.type}</span>
                            </span>
                            <div>
                              <p className="text-sm font-semibold text-slate-900">
                                {room.label}
                              </p>
                              <p className="text-xs text-slate-500">
                                {room.manual ? "Manual override" : "AI detected"}
          </p>
        </div>
                          </div>
                          <div className="flex items-center gap-2 text-sm text-slate-500">
                            <Sparkles className="h-4 w-4 text-amber-500" />
                            {Math.round(room.confidence * 100)}% confidence
                          </div>
                        </div>
                        <div className="mt-4 grid gap-3 md:grid-cols-2">
                          <div className="text-sm">
                            <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                              Room type
                            </label>
                            <select
                              value={room.type}
                              onChange={(event) =>
                                updateRoom(room.id, {
                                  type: event.target.value,
                                  color: getRoomColor(
                                    event.target.value,
                                    customRoomTypes,
                                  ),
                                })
                              }
                              className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
                            >
                              {[...baseRoomTypes, ...customRoomTypes].map(
                                (type) => (
                                  <option key={type.label} value={type.label}>
                                    {type.label}
                                  </option>
                                ),
                              )}
                            </select>
                          </div>
                          <div className="text-sm">
                            <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                              Confidence
                            </label>
                            <input
                              type="range"
                              min={0.5}
                              max={1}
                              step={0.01}
                              value={room.confidence}
                              onChange={(event) =>
                                updateRoom(room.id, {
                                  confidence: Number(event.target.value),
                                })
                              }
                              className="mt-2 w-full"
                            />
                          </div>
                        </div>
                        <div className="mt-3 grid gap-3 md:grid-cols-4">
                          {(["x", "y", "width", "height"] as const).map(
                            (key) => (
                              <div key={key} className="text-sm">
                                <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                                  {key}
                                </label>
                                <input
                                  type="range"
                                  min={0}
                                  max={1}
                                  step={0.01}
                                  value={room.boundary[key]}
                                  onChange={(event) =>
                                    updateRoom(room.id, {
                                      boundary: {
                                        ...room.boundary,
                                        [key]: Number(event.target.value),
                                      },
                                    })
                                  }
                                  className="mt-2 w-full"
                                />
                              </div>
                            ),
                          )}
                        </div>
                      </div>
                    ))}
                    {!currentPage.rooms.length && (
                      <div className="rounded-2xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">
                        Run the analysis to populate detected rooms.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-100">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-slate-500">
                    Activity log
                  </p>
                  <h2 className="text-xl font-semibold text-slate-900">
                    Pipeline events
                  </h2>
                </div>
                <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <Ruler className="h-3.5 w-3.5" />
                  {scalePreset}
                </div>
              </div>
              <ul className="mt-4 space-y-2 text-sm text-slate-600">
                {logEntries.length ? (
                  logEntries.map((entry, index) => (
                    <li
                      key={`${entry}-${index}`}
                      className="rounded-2xl border border-slate-100 bg-slate-50/60 px-4 py-3"
                    >
                      {entry}
                    </li>
                  ))
                ) : (
                  <li className="rounded-2xl border border-dashed border-slate-200 px-4 py-3 text-center text-slate-400">
                    Upload a file to see live processing notes.
                  </li>
                )}
              </ul>
            </div>
          </div>
        </section>
        </div>
      </main>
  );
}

type AnalysisCanvasProps = {
  page: PagePreview | undefined;
  showOverlay: boolean;
  canvasRef: MutableRefObject<HTMLCanvasElement | null>;
};

const AnalysisCanvas = ({
  page,
  showOverlay,
  canvasRef,
}: AnalysisCanvasProps) => {
  const localRef = useRef<HTMLCanvasElement | null>(null);

  const draw = useCallback(() => {
    if (!page || !localRef.current) return;
    const canvas = localRef.current;
    const context = canvas.getContext("2d");
    if (!context) return;

    canvas.width = page.width;
    canvas.height = page.height;
    const image = new window.Image();
    image.src = page.thumbnail;

    image.onload = () => {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);

      if (!showOverlay || !page.rooms.length) {
        canvasRef.current = canvas;
        return;
      }

      page.rooms.forEach((room) => {
        const x = room.boundary.x * canvas.width;
        const y = room.boundary.y * canvas.height;
        const width = room.boundary.width * canvas.width;
        const height = room.boundary.height * canvas.height;

        context.fillStyle = `${room.color}33`;
        context.strokeStyle = room.color;
        context.lineWidth = 3;

        context.fillRect(x, y, width, height);
        context.strokeRect(x, y, width, height);

        context.font = "14px sans-serif";
        context.fillStyle = "#0f172a";
        context.fillText(room.type, x + 8, y + 20);
      });

      canvasRef.current = canvas;
    };
  }, [canvasRef, page, showOverlay]);

  useEffect(() => {
    draw();
  }, [draw]);

  return (
    <canvas
      ref={(node) => {
        localRef.current = node;
        canvasRef.current = node;
        draw();
      }}
      className="h-full w-full rounded-2xl bg-white shadow-sm"
    />
  );
};
