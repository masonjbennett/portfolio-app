/// <reference types="node" />
// Vite: React, the dev server on 5174, and a dev-only bridge that serves /api/<name> from
// api/<name>.ts the way Vercel's Node runtime does, so the page and its handlers run together
// under `npm run dev`. The bridge is `apply: "serve"`: a production build never contains it.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig } from "vite";
import type { Plugin, ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";

// A handler file is api/<name>.ts; anything else in the name is refused before touching the disk.
const API_NAME = /^[A-Za-z0-9_-]+$/;
const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

function send(res: ServerResponse, status: number, text: string, headers: Record<string, string> = {}) {
  res.statusCode = status;
  res.setHeader("content-type", "text/plain; charset=utf-8");
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(text);
}

// Node's request, as the Web-standard Request a handler receives: method, full url with its query,
// headers (repeated ones appended, not joined), and the body for methods that carry one.
async function toRequest(req: IncomingMessage): Promise<Request> {
  const method = (req.method ?? "GET").toUpperCase();
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) for (const one of v) headers.append(k, one);
    else if (v !== undefined) headers.set(k, v);
  }
  let body: Uint8Array<ArrayBuffer> | undefined;
  if (method !== "GET" && method !== "HEAD") {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    if (chunks.length) body = new Uint8Array(Buffer.concat(chunks));
  }
  const url = `http://${req.headers.host ?? "localhost"}${req.url ?? "/"}`;
  return new Request(url, { method, headers, body });
}

// The handler's Response, back onto Node's: status, headers (every Set-Cookie kept), body. The body
// is read whole, and already decoded, so content-encoding and content-length are not forwarded.
async function fromResponse(r: Response, res: ServerResponse) {
  res.statusCode = r.status;
  if (r.statusText) res.statusMessage = r.statusText;
  for (const [k, v] of r.headers) {
    if (k === "set-cookie" || k === "content-encoding" || k === "content-length") continue;
    res.setHeader(k, v);
  }
  const cookies = r.headers.getSetCookie();
  if (cookies.length) res.setHeader("set-cookie", cookies);
  res.end(r.body ? Buffer.from(await r.arrayBuffer()) : undefined);
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function handle(server: ViteDevServer, dir: string, req: IncomingMessage, res: ServerResponse) {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  const name = path.slice("/api/".length);
  const file = resolve(dir, `${name}.ts`);
  if (!API_NAME.test(name) || !existsSync(file)) {
    return send(res, 404, API_NAME.test(name) ? `404: no handler at api/${name}.ts` : "404: not an API route");
  }
  let mod: Record<string, unknown>;
  try {
    mod = await server.ssrLoadModule(file);
  } catch (err) {
    server.config.logger.error(`api/${name}.ts failed to load: ${message(err)}`);
    return send(res, 500, `500: api/${name}.ts failed to load: ${message(err)}`);
  }
  const method = (req.method ?? "GET").toUpperCase();
  const fn = mod[method];
  if (typeof fn !== "function") {
    const allow = METHODS.filter((m) => typeof mod[m] === "function").join(", ");
    return send(res, 405, `405: api/${name}.ts exports no ${method} handler`, { allow });
  }
  let out: unknown;
  try {
    out = await fn(await toRequest(req));
  } catch (err) {
    server.config.logger.error(`api/${name}.ts ${method} threw: ${message(err)}`);
    return send(res, 500, `500: api/${name}.ts ${method} threw: ${message(err)}`);
  }
  if (!(out instanceof Response)) return send(res, 500, `500: api/${name}.ts ${method} did not return a Response`);
  await fromResponse(out, res);
}

// Exported so test/t-shell.mjs can mount it on a throwaway server over a directory of its own.
export function devApi(dir: string = fileURLToPath(new URL("./api", import.meta.url))): Plugin {
  return {
    name: "portfolio-dev-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!(req.url ?? "").startsWith("/api/")) return next();
        handle(server, dir, req, res).catch(next);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), devApi()],
  server: { port: 5174 },
});
