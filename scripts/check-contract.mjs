#!/usr/bin/env node
/** Zero-extra-dependency API inventory guard. Compares route registrations,
 * Postman request methods/paths, and OpenAPI method/path skeleton. This is a
 * drift check, NOT a full OpenAPI validator nor a replacement for HTTP tests.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");
const canonical = (raw) => {
  const route = raw.replace(/^\{\{baseUrl\}\}/, "/api").split("?")[0]
    .replace(/\/\{\{[^}]+\}\}/g, "/:param")
    .replace(/\/\{[^}]+\}/g, "/:param")
    .replace(/\/:\w+/g, "/:param")
    .replace(/\/[0-9]+(?=\/|$)/g, "/:param") // Postman negative-case literal IDs
    .replace(/\/+$/, "") || "/";
  return route;
};
const key = (method, p) => `${method.toUpperCase()} ${canonical(p)}`;

function fromRoutes() {
  const index = read("src/routes/index.ts");
  const imports = new Map();
  for (const [, symbol, file] of index.matchAll(/import\s+(\w+)\s+from\s+["']\.\/([\w-]+\.routes)\.js["'];/g)) {
    imports.set(symbol, file);
  }
  const result = new Set();
  for (const [, prefix, symbol] of index.matchAll(/router\.use\(["']([^"']+)["'],\s*(\w+)\)/g)) {
    const filename = imports.get(symbol);
    if (!filename) throw Error(`Router mount missing import: ${symbol}`);
    const body = read(`src/routes/${filename}.ts`);
    let n = 0;
    for (const [, method, local] of body.matchAll(/router\.(get|post|patch|delete|put)\(\s*["']([^"']+)["']/g)) {
      result.add(key(method, `${prefix}${local === "/" ? "" : local}`));
      n++;
    }
    if (!n) throw Error(`No statically registered methods in ${filename}.ts; review inventory parser`);
  }
  return result;
}
function fromPostman() {
  const doc = JSON.parse(read("postman/SARA_Backend.postman_collection.json"));
  const result = new Set();
  function walk(items) {
    for (const item of items ?? []) {
      if (item.item) { walk(item.item); continue; }
      const request = item.request;
      if (!request?.method) continue;
      const raw = typeof request.url === "string" ? request.url : request.url?.raw;
      if (!raw || !raw.startsWith("{{baseUrl}}/")) {
        throw Error(`Unsupported Postman URL in '${item.name}': ${raw}`);
      }
      result.add(key(request.method, raw));
    }
  }
  walk(doc.item);
  return result;
}
function fromOpenApi() {
  const yaml = read("docs/api/SARA_OpenAPI_v1.yaml");
  if (!yaml.includes("openapi: 3.0.3")) throw Error("Expected OpenAPI 3.0.3 document");
  const result = new Set();
  let current = null;
  for (const line of yaml.split(/\r?\n/)) {
    const pathname = /^  (\/api\/[^:\s]+):\s*$/.exec(line);
    if (pathname) { current = pathname[1]; continue; }
    if (/^[^\s#]/.test(line)) current = null;
    const method = /^    (get|post|patch|delete|put):\s*$/.exec(line);
    if (current && method) result.add(key(method[1], current));
  }
  return result;
}
const routes = fromRoutes();
const postman = fromPostman();
const openapi = fromOpenApi();
if (!routes.size) throw Error("No routes found");
let mismatch = false;
for (const [label, values] of [["Postman", postman], ["OpenAPI", openapi]]) {
  const missing = [...routes].filter((value) => !values.has(value));
  const extra = [...values].filter((value) => !routes.has(value));
  if (missing.length || extra.length) {
    mismatch = true;
    console.error(`\n${label} differs from src/routes/`);
    for (const value of missing) console.error(`  MISSING ${value}`);
    for (const value of extra) console.error(`  EXTRA   ${value}`);
  }
}
if (mismatch) process.exit(1);
console.log(`PASS: ${routes.size} HTTP methods aligned across routes, Postman and OpenAPI.`);
console.log("Note: structural inventory only; request/response schemas still require manual review.");
