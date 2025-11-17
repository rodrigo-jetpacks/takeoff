import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
const source = join(
  projectRoot,
  "node_modules",
  "pdfjs-dist",
  "build",
  "pdf.worker.min.mjs",
);
const destinationDir = join(projectRoot, "public");
const destination = join(destinationDir, "pdf.worker.min.js");

try {
  await mkdir(destinationDir, { recursive: true });
  await copyFile(source, destination);
  console.log(`Copied pdf.js worker to ${destination}`);
} catch (error) {
  console.error("Failed to copy pdf.js worker", error);
  process.exitCode = 1;
}

