// Starts the public bot via tsx so hosts running "node index.js" work with zero build step.
import { tsImport } from "tsx/esm/api";

await tsImport("./src/index.ts", import.meta.url);
