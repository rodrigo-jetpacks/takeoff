## Takeoff – Floorplan Analysis Sandbox

This project is a lightweight implementation of the **Takeoff** product vision as described in `Takeoff - Master Plan.md`. It focuses on demonstrating the end-to-end workflow for multi-page PDF floorplans:

- Drag-and-drop upload with thumbnail generation for each page
- Page selection and simulated processing pipeline (cleaning → room detection → export)
- Interactive analysis canvas with before/after toggle, editable room metadata, and manual boundary adjustments
- Material-inspired control panels for construction type, scale presets, and custom room legends
- Export of the processed overlay as a PNG preview

The CV endpoint now invokes the open-source model `ozturkoktay/floor-plan-room-segmentation` on Hugging Face. When a token isn’t configured the system gracefully falls back to deterministic mock detections so the workflow remains testable offline.

## Getting Started

```bash
cd /Users/rodrigofranco/Documents/takeoff/web
npm install
cp env.example .env.local   # add your Hugging Face token
npm run dev
```

The app runs at [http://localhost:3000](http://localhost:3000). Upload any multi-page PDF to explore the workflow. (DWG processing is staged for a future milestone.)

## Project Structure

- `src/app/page.tsx` – Client-side experience that orchestrates uploads, processing, canvas overlays, and editing tools.
- `src/app/api/analyze/route.ts` – Talks to `ozturkoktay/floor-plan-room-segmentation` on Hugging Face (and falls back to mock detections if the token is missing).
- `src/lib/analysis.ts` – Shared mock computer-vision helpers, type definitions, and color mappings for room categories.
- `src/app/globals.css` – Tailwind-powered Material 3 inspired theme tokens.

## Environment

Create `.env.local` with:

```
HUGGING_FACE_TOKEN=hf_xxx                # Required for real CV analysis
HF_FLOORPLAN_MODEL=ozturkoktay/floor-plan-room-segmentation # optional override
```

Without the token, API calls log a warning and the fallback mock detections keep the UI functional.

## Next Steps

- Swap the fallback pathway for actual per-room metadata storage (confidence thresholds, manual overrides) once the Hugging Face integration is hardened.
- Persist projects, thumbnails, and room edits to Supabase as outlined in the plan.
- Expand export formats (SVG/DXF) and add square-footage calculations via the scale inputs.
