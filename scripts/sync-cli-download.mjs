import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const source = resolve(projectRoot, "scripts/cli.mjs");
const destination = resolve(projectRoot, "public/downloads/webforge-cli.mjs");
mkdirSync(dirname(destination), { recursive: true });
copyFileSync(source, destination);
console.log(`Updated ${destination}`);
