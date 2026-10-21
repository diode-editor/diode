import * as fs from "node:fs";
import * as http from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../TestUtils/TempWorkspace.ts";
import { type IRegistryVersion, REGISTRY_SCHEMA_VERSION } from "../common/registryFormat.ts";

import { DEFAULT_MAX_ARTIFACT_BYTES, HttpExtensionRegistrySource } from "./httpRegistrySource.ts";

/** Real `node:http` on 127.0.0.1, not a fetch mock: a mock would only test our own assumptions about the transport. */

const ID = "acme.markdown-tools";
const BASE_PATH = "/registry/v1/";

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

function metaJson(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
        schemaVersion: REGISTRY_SCHEMA_VERSION,
        id: ID,
        publisher: "acme",
        name: "markdown-tools",
        displayName: "Markdown Tools",
        description: "Tools",
        kind: "native",
        versions: [
            {
                version: "1.2.0",
                engines: { vscode: "^1.90.0" },
                artifact: { type: "url", url: "https://example.test/mt-1.2.0.vsix" },
                sha256: "a".repeat(64),
            },
        ],
        ...overrides,
    });
}

function indexJson(extensions: unknown[] = [defaultEntry()]): string {
    return JSON.stringify({ schemaVersion: REGISTRY_SCHEMA_VERSION, extensions });
}

function defaultEntry(): Record<string, unknown> {
    return {
        id: ID,
        publisher: "acme",
        name: "markdown-tools",
        displayName: "Markdown Tools",
        description: "Tools",
        kind: "native",
        latest: { version: "1.2.0", engines: { vscode: "^1.90.0" } },
    };
}

function urlVersion(url: string): IRegistryVersion {
    return {
        version: "1.2.0",
        engines: { vscode: "*" },
        artifact: { type: "url", url },
        sha256: "a".repeat(64),
    };
}

function json(body: string): Handler {
    return (_req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(body);
    };
}

function status(code: number): Handler {
    return (_req, res) => {
        res.writeHead(code);
        res.end();
    };
}

describe("HttpExtensionRegistrySource", () => {
    let server: http.Server;
    let origin: string;
    let base: string;
    let routes: Map<string, Handler>;
    let requested: string[];
    let headers: http.IncomingHttpHeaders;
    let ws: ITempWorkspace | undefined;

    beforeAll(async () => {
        routes = new Map();
        requested = [];
        headers = {};
        server = http.createServer((req, res) => {
            requested.push(req.url ?? "");
            headers = req.headers;
            const handler = routes.get(req.url ?? "");
            if (handler === undefined) {
                res.writeHead(404);
                res.end("not found");
                return;
            }
            handler(req, res);
        });
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
        base = `${origin}${BASE_PATH}`;
    });

    afterAll(async () => {
        server.closeAllConnections();
        await new Promise<void>((resolve) =>
            server.close(() => {
                resolve();
            }),
        );
    });

    beforeEach(() => {
        routes.clear();
        requested.length = 0;
    });

    afterEach(() => {
        ws?.dispose();
        ws = undefined;
    });

    it("getIndex reads <base>/index.json", async () => {
        routes.set(`${BASE_PATH}index.json`, json(indexJson()));
        const index = await new HttpExtensionRegistrySource(base).getIndex();
        expect(index.extensions.map((e) => e.id)).toEqual([ID]);
        expect(requested).toEqual([`${BASE_PATH}index.json`]);
    });

    it("a base without a trailing slash points at the same index.json", async () => {
        routes.set(`${BASE_PATH}index.json`, json(indexJson()));
        const source = new HttpExtensionRegistrySource(base.slice(0, -1));
        await expect(source.getIndex()).resolves.toBeDefined();
        expect(requested).toEqual([`${BASE_PATH}index.json`]);
    });

    it("the request identifies itself with the diode User-Agent", async () => {
        routes.set(`${BASE_PATH}index.json`, json(indexJson()));
        await new HttpExtensionRegistrySource(base).getIndex();
        expect(headers["user-agent"]).toMatch(/^diode\//);
    });

    it.each(["not a url", "ftp://example.test/registry/"])("invalid base %j fails immediately", (bad) => {
        expect(() => new HttpExtensionRegistrySource(bad)).toThrow(/Invalid registry URL|must be http/);
    });

    it("an https base is accepted (the public registry is served this way)", () => {
        expect(() => new HttpExtensionRegistrySource("https://diode-editor.github.io/registry/v1/")).not.toThrow();
    });

    it("diagnostics for broken entries go to onProblem", async () => {
        routes.set(`${BASE_PATH}index.json`, json(indexJson([{ id: "broken" }])));
        const problems: string[] = [];
        const source = new HttpExtensionRegistrySource(base, (p) => problems.push(p));
        const index = await source.getIndex();
        expect(index.extensions).toEqual([]);
        expect(problems).toHaveLength(1);
    });

    it("broken entries do not crash a source without onProblem", async () => {
        routes.set(`${BASE_PATH}index.json`, json(indexJson([{ id: "broken" }])));
        const index = await new HttpExtensionRegistrySource(base).getIndex();
        expect(index.extensions).toEqual([]);
    });

    it("getIndex on malformed JSON fails with the address", async () => {
        routes.set(`${BASE_PATH}index.json`, json("{oops"));
        await expect(new HttpExtensionRegistrySource(base).getIndex()).rejects.toThrow(
            /index\.json: Invalid registry index: malformed JSON/,
        );
    });

    it("getIndex on a response without a body fails to parse instead of returning an empty index", async () => {
        routes.set(`${BASE_PATH}index.json`, status(204));
        await expect(new HttpExtensionRegistrySource(base).getIndex()).rejects.toThrow(/malformed JSON/);
    });

    it.each([404, 500])("getIndex on HTTP %i fails with the status", async (code) => {
        routes.set(`${BASE_PATH}index.json`, status(code));
        await expect(new HttpExtensionRegistrySource(base).getIndex()).rejects.toThrow(
            new RegExp(`index\\.json: HTTP ${String(code)}`),
        );
    });

    it("getIndex over the size limit fails before parsing", async () => {
        routes.set(`${BASE_PATH}index.json`, json(indexJson()));
        const source = new HttpExtensionRegistrySource(base, undefined, { maxJsonBytes: 8 });
        await expect(source.getIndex()).rejects.toThrow(/exceeds the 8-byte limit/);
    });

    it('a response exactly at the limit passes: the limit means "more than", not "equal to"', async () => {
        const body = indexJson();
        routes.set(`${BASE_PATH}index.json`, json(body));
        const source = new HttpExtensionRegistrySource(base, undefined, { maxJsonBytes: Buffer.byteLength(body) });
        await expect(source.getIndex()).resolves.toBeDefined();
    });

    it("an unavailable registry fails with the address, not a bare network stack trace", async () => {
        routes.set(`${BASE_PATH}index.json`, (_req, res) => {
            void res;
        });
        const source = new HttpExtensionRegistrySource(base, undefined, { timeoutMs: 60 });
        await expect(source.getIndex()).rejects.toThrow(/index\.json: .*(timeout|aborted)/i);
    });

    it('an unreachable host: the message carries the reason from cause, not a bare "fetch failed"', async () => {
        const port = (server.address() as AddressInfo).port;
        const source = new HttpExtensionRegistrySource(
            `http://127.0.0.1:${String(port === 65535 ? port - 1 : port + 1)}/r/`,
        );
        await expect(source.getIndex()).rejects.toThrow(/index\.json: fetch failed \(.+\)/);
    });

    it("getMeta reads meta/<id>.json and checks the id", async () => {
        routes.set(`${BASE_PATH}meta/${ID}.json`, json(metaJson()));
        const meta = await new HttpExtensionRegistrySource(base).getMeta(ID);
        expect(meta?.id).toBe(ID);
        expect(meta?.versions).toHaveLength(1);
    });

    it("getMeta on 404 returns undefined (the registry does not know the id)", async () => {
        await expect(new HttpExtensionRegistrySource(base).getMeta("acme.unknown")).resolves.toBeUndefined();
    });

    it('getMeta on 500 fails instead of reporting "no such extension"', async () => {
        routes.set(`${BASE_PATH}meta/${ID}.json`, status(500));
        await expect(new HttpExtensionRegistrySource(base).getMeta(ID)).rejects.toThrow(/HTTP 500/);
    });

    it("getMeta on meta with a different id inside fails", async () => {
        routes.set(`${BASE_PATH}meta/${ID}.json`, json(metaJson({ id: "other.markdown-tools", publisher: "other" })));
        await expect(new HttpExtensionRegistrySource(base).getMeta(ID)).rejects.toThrow(/does not match expected/);
    });

    it("diagnostics for broken versions go to onProblem", async () => {
        routes.set(`${BASE_PATH}meta/${ID}.json`, json(metaJson({ versions: [{ version: "broken" }] })));
        const problems: string[] = [];
        const meta = await new HttpExtensionRegistrySource(base, (p) => problems.push(p)).getMeta(ID);
        expect(meta?.versions).toEqual([]);
        expect(problems).toHaveLength(1);
    });

    it.each(["../evil", "a/b", "..", "noDotSeparator", "acme.hello/../../etc/passwd"])(
        "getMeta rejects unsafe id %j before the request",
        async (id) => {
            await expect(new HttpExtensionRegistrySource(base).getMeta(id)).rejects.toThrow(/Invalid extension id/);
            expect(requested).toEqual([]);
        },
    );

    it("fetchArtifact downloads the .vsix into tempDir and returns the path", async () => {
        const bytes = Buffer.from("PKfake-vsix-bytes");
        routes.set("/mt-1.2.0.vsix", (_req, res) => {
            res.writeHead(200, { "content-type": "application/octet-stream" });
            res.end(bytes);
        });
        ws = createTempWorkspace();
        const source = new HttpExtensionRegistrySource(base);
        const file = await source.fetchArtifact(urlVersion(`${origin}/mt-1.2.0.vsix`), ws.dir);
        expect(file).toBe(ws.path("artifact.vsix"));
        expect(fs.readFileSync(file)).toEqual(bytes);
    });

    it("an https artifact passes the scheme check and fails only on the network", async () => {
        // Port 1 is closed: a mutant dropping https from the check would give "must be http(s)" instead of a network failure.
        ws = createTempWorkspace();
        await expect(
            new HttpExtensionRegistrySource(base).fetchArtifact(urlVersion("https://127.0.0.1:1/x.vsix"), ws.dir),
        ).rejects.toThrow(/x\.vsix: fetch failed/);
    });

    it("fetchArtifact on a path artifact fails with a clear error", async () => {
        ws = createTempWorkspace();
        const version: IRegistryVersion = {
            version: "1.0.0",
            engines: { vscode: "*" },
            artifact: { type: "path", path: "artifacts/x.vsix" },
            sha256: "a".repeat(64),
        };
        await expect(new HttpExtensionRegistrySource(base).fetchArtifact(version, ws.dir)).rejects.toThrow(
            /"path" is not supported by the HTTP registry source/,
        );
    });

    it.each([
        ["not a url", /Invalid artifact URL/],
        ["file:///etc/passwd", /must be http/],
    ])("fetchArtifact rejects an artifact at %j", async (url, expected) => {
        ws = createTempWorkspace();
        await expect(new HttpExtensionRegistrySource(base).fetchArtifact(urlVersion(url), ws.dir)).rejects.toThrow(
            expected,
        );
    });

    it("fetchArtifact on HTTP 404 fails with the status", async () => {
        ws = createTempWorkspace();
        await expect(
            new HttpExtensionRegistrySource(base).fetchArtifact(urlVersion(`${origin}/missing.vsix`), ws.dir),
        ).rejects.toThrow(/missing\.vsix: HTTP 404/);
    });

    it("fetchArtifact over the size limit fails and no file appears", async () => {
        routes.set("/big.vsix", (_req, res) => {
            res.writeHead(200);
            res.end(Buffer.alloc(4096));
        });
        ws = createTempWorkspace();
        const source = new HttpExtensionRegistrySource(base, undefined, { maxArtifactBytes: 16 });
        await expect(source.fetchArtifact(urlVersion(`${origin}/big.vsix`), ws.dir)).rejects.toThrow(
            /exceeds the 16-byte limit/,
        );
        expect(fs.existsSync(ws.path("artifact.vsix"))).toBe(false);
    });

    it("a slow but LIVE download is not aborted: the watchdog tracks silence, not duration", async () => {
        // ~280ms total: longer than the 100ms timeout, but no single pause exceeds it.
        const total = 7;
        routes.set("/slow.vsix", (_req, res) => {
            res.writeHead(200, { "content-type": "application/octet-stream" });
            let sent = 0;
            const tick = (): void => {
                if (sent === total) {
                    res.end();
                    return;
                }
                sent++;
                res.write(Buffer.alloc(8, sent));
                setTimeout(tick, 40);
            };
            tick();
        });
        ws = createTempWorkspace();
        const source = new HttpExtensionRegistrySource(base, undefined, { timeoutMs: 100 });
        const file = await source.fetchArtifact(urlVersion(`${origin}/slow.vsix`), ws.dir);
        expect(fs.statSync(file).size).toBe(total * 8);
    });

    it("a stalled download is aborted by the watchdog and the partial file is removed", async () => {
        routes.set("/stalled.vsix", (_req, res) => {
            res.writeHead(200, { "content-type": "application/octet-stream" });
            res.write(Buffer.alloc(8, 1));
            // The body is left open: closeAllConnections in afterAll cleans up the connection.
        });
        ws = createTempWorkspace();
        const source = new HttpExtensionRegistrySource(base, undefined, { timeoutMs: 100 });
        await expect(source.fetchArtifact(urlVersion(`${origin}/stalled.vsix`), ws.dir)).rejects.toThrow(
            /stalled\.vsix: download failed: no data for 100ms/,
        );
        expect(fs.existsSync(ws.path("artifact.vsix"))).toBe(false);
    });

    it("after a successful download the watchdog is cleared and no timers are left", async () => {
        // An uncleared `setTimeout` holds the event loop: `--install-extension` would hang for another `timeoutMs`.
        const bytes = Buffer.alloc(32, 3);
        routes.set("/tidy.vsix", (_req, res) => {
            res.writeHead(200);
            res.end(bytes);
        });
        ws = createTempWorkspace();
        const timers = (): number => process.getActiveResourcesInfo().filter((r) => r === "Timeout").length;
        const before = timers();
        const source = new HttpExtensionRegistrySource(base, undefined, { timeoutMs: 30_000 });
        await source.fetchArtifact(urlVersion(`${origin}/tidy.vsix`), ws.dir);
        expect(timers()).toBe(before);
    });

    it("an artifact exactly at the limit downloads", async () => {
        const bytes = Buffer.alloc(64, 7);
        routes.set("/exact.vsix", (_req, res) => {
            res.writeHead(200);
            res.end(bytes);
        });
        ws = createTempWorkspace();
        const source = new HttpExtensionRegistrySource(base, undefined, { maxArtifactBytes: bytes.byteLength });
        const file = await source.fetchArtifact(urlVersion(`${origin}/exact.vsix`), ws.dir);
        expect(fs.readFileSync(file)).toEqual(bytes);
    });

    it("a connection drop mid-body fails the download and no file appears", async () => {
        routes.set("/truncated.vsix", (_req, res) => {
            res.writeHead(200, { "content-length": "1024" });
            res.write(Buffer.alloc(64));
            setTimeout(() => res.socket?.destroy(), 10);
        });
        ws = createTempWorkspace();
        const source = new HttpExtensionRegistrySource(base);
        await expect(source.fetchArtifact(urlVersion(`${origin}/truncated.vsix`), ws.dir)).rejects.toThrow(
            /truncated\.vsix: download failed/,
        );
        expect(fs.existsSync(ws.path("artifact.vsix"))).toBe(false);
    });

    it("a multi-chunk body reaches the file whole and in order", async () => {
        // A single-`res.end` body wouldn't catch a write that puts every chunk at offset zero.
        const parts = [Buffer.alloc(64 * 1024, 1), Buffer.alloc(96 * 1024, 2), Buffer.alloc(48 * 1024, 3)];
        routes.set("/chunked.vsix", (_req, res) => {
            res.writeHead(200);
            for (const part of parts) {
                res.write(part);
            }
            res.end();
        });
        ws = createTempWorkspace();
        const file = await new HttpExtensionRegistrySource(base).fetchArtifact(
            urlVersion(`${origin}/chunked.vsix`),
            ws.dir,
        );
        expect(fs.readFileSync(file)).toEqual(Buffer.concat(parts));
    });

    it("exceeding the limit aborts the download instead of checking after the fact", async () => {
        // An after-the-fact check on the finished file would pass the previous cases, but not this one.
        const TOTAL = 64 * 1024 * 1024;
        const chunk = Buffer.alloc(64 * 1024, 7);
        let sent = 0;
        let finished!: () => void;
        const closed = new Promise<void>((resolve) => {
            finished = resolve;
        });
        routes.set("/endless.vsix", (_req, res) => {
            res.writeHead(200, { "content-length": String(TOTAL) });
            res.on("error", () => undefined);
            res.on("close", finished);
            const pump = (): void => {
                while (sent < TOTAL && !res.destroyed) {
                    sent += chunk.byteLength;
                    if (!res.write(chunk)) {
                        res.once("drain", pump);
                        return;
                    }
                }
                res.end();
            };
            pump();
        });
        ws = createTempWorkspace();
        const source = new HttpExtensionRegistrySource(base, undefined, { maxArtifactBytes: 1024 });
        await expect(source.fetchArtifact(urlVersion(`${origin}/endless.vsix`), ws.dir)).rejects.toThrow(
            /exceeds the 1024-byte limit/,
        );
        await closed;
        expect(sent).toBeLessThan(TOTAL);
        expect(fs.existsSync(ws.path("artifact.vsix"))).toBe(false);
    });

    it("the default limit admits a platform .vsix with a bundled runtime", () => {
        // redhat.java@1.57.2026092608 (linux-x64, with JRE 21) is the heaviest build.
        expect(DEFAULT_MAX_ARTIFACT_BYTES).toBeGreaterThanOrEqual(139_029_576);
    });
});
