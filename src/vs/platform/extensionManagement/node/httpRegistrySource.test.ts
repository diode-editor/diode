import * as fs from "node:fs";
import * as http from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../TestUtils/TempWorkspace.ts";
import { REGISTRY_SCHEMA_VERSION, type IRegistryVersion } from "../common/registryFormat.ts";
import { HttpExtensionRegistrySource } from "./httpRegistrySource.ts";

/**
 * Тесты гоняются против настоящего `node:http`-сервера на 127.0.0.1: HTTP-источник
 * целиком про поведение транспорта (статусы, лимиты, обрывы), а мок fetch'а
 * проверял бы наши же представления о нём. Внешняя сеть при этом не нужна —
 * сквозняк по опубликованному реестру живёт в e2e.
 */

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
    /** Пути, по которым реально сходили — проверка резолва относительно базы. */
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
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    beforeEach(() => {
        routes.clear();
        requested.length = 0;
    });

    afterEach(() => {
        ws?.dispose();
        ws = undefined;
    });

    // ── База и адресация ─────────────────────────────────────────────────────

    it("getIndex читает <base>/index.json", async () => {
        routes.set(`${BASE_PATH}index.json`, json(indexJson()));
        const index = await new HttpExtensionRegistrySource(base).getIndex();
        expect(index.extensions.map((e) => e.id)).toEqual([ID]);
        expect(requested).toEqual([`${BASE_PATH}index.json`]);
    });

    it("база без слеша на конце указывает на тот же index.json", async () => {
        routes.set(`${BASE_PATH}index.json`, json(indexJson()));
        const source = new HttpExtensionRegistrySource(base.slice(0, -1));
        await expect(source.getIndex()).resolves.toBeDefined();
        expect(requested).toEqual([`${BASE_PATH}index.json`]);
    });

    it("запрос представляется User-Agent'ом diode", async () => {
        routes.set(`${BASE_PATH}index.json`, json(indexJson()));
        await new HttpExtensionRegistrySource(base).getIndex();
        expect(headers["user-agent"]).toMatch(/^diode\//);
    });

    it.each(["not a url", "ftp://example.test/registry/"])("некорректная база %j — ошибка сразу", (bad) => {
        expect(() => new HttpExtensionRegistrySource(bad)).toThrow(/Invalid registry URL|must be http/);
    });

    it("https-база принимается (публичный реестр раздаётся именно так)", () => {
        expect(() => new HttpExtensionRegistrySource("https://diode-editor.github.io/registry/v1/")).not.toThrow();
    });

    // ── index.json ───────────────────────────────────────────────────────────

    it("диагностики битых записей уходят в onProblem", async () => {
        routes.set(`${BASE_PATH}index.json`, json(indexJson([{ id: "broken" }])));
        const problems: string[] = [];
        const source = new HttpExtensionRegistrySource(base, (p) => problems.push(p));
        const index = await source.getIndex();
        expect(index.extensions).toEqual([]);
        expect(problems).toHaveLength(1);
    });

    it("битые записи не роняют источник без onProblem", async () => {
        routes.set(`${BASE_PATH}index.json`, json(indexJson([{ id: "broken" }])));
        const index = await new HttpExtensionRegistrySource(base).getIndex();
        expect(index.extensions).toEqual([]);
    });

    it("getIndex на битом JSON — ошибка с адресом", async () => {
        routes.set(`${BASE_PATH}index.json`, json("{oops"));
        await expect(new HttpExtensionRegistrySource(base).getIndex()).rejects.toThrow(
            /index\.json: Invalid registry index: malformed JSON/,
        );
    });

    it("getIndex на ответе без тела — ошибка разбора, а не пустой индекс", async () => {
        routes.set(`${BASE_PATH}index.json`, status(204));
        await expect(new HttpExtensionRegistrySource(base).getIndex()).rejects.toThrow(/malformed JSON/);
    });

    it.each([404, 500])("getIndex на HTTP %i — ошибка со статусом", async (code) => {
        routes.set(`${BASE_PATH}index.json`, status(code));
        await expect(new HttpExtensionRegistrySource(base).getIndex()).rejects.toThrow(
            new RegExp(`index\\.json: HTTP ${String(code)}`),
        );
    });

    it("getIndex сверх лимита размера — отказ до разбора", async () => {
        routes.set(`${BASE_PATH}index.json`, json(indexJson()));
        const source = new HttpExtensionRegistrySource(base, undefined, { maxJsonBytes: 8 });
        await expect(source.getIndex()).rejects.toThrow(/exceeds the 8-byte limit/);
    });

    it("ответ ровно в лимит проходит — лимит про «больше», а не «столько же»", async () => {
        const body = indexJson();
        routes.set(`${BASE_PATH}index.json`, json(body));
        const source = new HttpExtensionRegistrySource(base, undefined, { maxJsonBytes: Buffer.byteLength(body) });
        await expect(source.getIndex()).resolves.toBeDefined();
    });

    it("недоступный реестр — ошибка с адресом, а не голый сетевой стектрейс", async () => {
        routes.set(`${BASE_PATH}index.json`, (_req, res) => {
            // Ответ не приходит вовсе — единственный способ увидеть таймаут честно.
            void res;
        });
        const source = new HttpExtensionRegistrySource(base, undefined, { timeoutMs: 60 });
        await expect(source.getIndex()).rejects.toThrow(/index\.json: .*(timeout|aborted)/i);
    });

    it("недостижимый хост — сообщение несёт причину из cause, а не голое «fetch failed»", async () => {
        // Порт занят сервером, соединение на соседний — отказ; undici прячет
        // ECONNREFUSED в cause, и без него текст ошибки ничего не объясняет.
        const port = (server.address() as AddressInfo).port;
        const source = new HttpExtensionRegistrySource(`http://127.0.0.1:${String(port === 65535 ? port - 1 : port + 1)}/r/`);
        await expect(source.getIndex()).rejects.toThrow(/index\.json: fetch failed \(.+\)/);
    });

    // ── meta/<id>.json ───────────────────────────────────────────────────────

    it("getMeta читает meta/<id>.json и сверяет id", async () => {
        routes.set(`${BASE_PATH}meta/${ID}.json`, json(metaJson()));
        const meta = await new HttpExtensionRegistrySource(base).getMeta(ID);
        expect(meta?.id).toBe(ID);
        expect(meta?.versions).toHaveLength(1);
    });

    it("getMeta на 404 — undefined (реестр не знает такого id)", async () => {
        await expect(new HttpExtensionRegistrySource(base).getMeta("acme.unknown")).resolves.toBeUndefined();
    });

    it("getMeta на 500 — ошибка, а не «нет такого расширения»", async () => {
        routes.set(`${BASE_PATH}meta/${ID}.json`, status(500));
        await expect(new HttpExtensionRegistrySource(base).getMeta(ID)).rejects.toThrow(/HTTP 500/);
    });

    it("getMeta на мете с чужим id внутри — ошибка", async () => {
        routes.set(`${BASE_PATH}meta/${ID}.json`, json(metaJson({ id: "other.markdown-tools", publisher: "other" })));
        await expect(new HttpExtensionRegistrySource(base).getMeta(ID)).rejects.toThrow(/does not match expected/);
    });

    it("диагностики битых версий уходят в onProblem", async () => {
        routes.set(`${BASE_PATH}meta/${ID}.json`, json(metaJson({ versions: [{ version: "broken" }] })));
        const problems: string[] = [];
        const meta = await new HttpExtensionRegistrySource(base, (p) => problems.push(p)).getMeta(ID);
        expect(meta?.versions).toEqual([]);
        expect(problems).toHaveLength(1);
    });

    it.each(["../evil", "a/b", "..", "noDotSeparator", "acme.hello/../../etc/passwd"])(
        "getMeta отвергает небезопасный id %j до запроса",
        async (id) => {
            await expect(new HttpExtensionRegistrySource(base).getMeta(id)).rejects.toThrow(/Invalid extension id/);
            expect(requested).toEqual([]);
        },
    );

    // ── fetchArtifact ────────────────────────────────────────────────────────

    it("fetchArtifact качает .vsix в tempDir и отдаёт путь", async () => {
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

    it("https-артефакт проходит проверку схемы и падает уже на сети", async () => {
        // Порт 1 закрыт: до сети дело доходит, значит схему не отвергли. Мутант,
        // выкинувший https из проверки, дал бы «must be http(s)» вместо отказа сети.
        ws = createTempWorkspace();
        await expect(
            new HttpExtensionRegistrySource(base).fetchArtifact(urlVersion("https://127.0.0.1:1/x.vsix"), ws.dir),
        ).rejects.toThrow(/x\.vsix: fetch failed/);
    });

    it("fetchArtifact на path-артефакте — понятная ошибка", async () => {
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
    ])("fetchArtifact отвергает артефакт по адресу %j", async (url, expected) => {
        ws = createTempWorkspace();
        await expect(
            new HttpExtensionRegistrySource(base).fetchArtifact(urlVersion(url), ws.dir),
        ).rejects.toThrow(expected);
    });

    it("fetchArtifact на HTTP 404 — ошибка со статусом", async () => {
        ws = createTempWorkspace();
        await expect(
            new HttpExtensionRegistrySource(base).fetchArtifact(urlVersion(`${origin}/missing.vsix`), ws.dir),
        ).rejects.toThrow(/missing\.vsix: HTTP 404/);
    });

    it("fetchArtifact сверх лимита размера — отказ, файл не появляется", async () => {
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

    it("артефакт ровно в лимит скачивается", async () => {
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

    it("обрыв соединения на середине тела — ошибка загрузки, файл не появляется", async () => {
        routes.set("/truncated.vsix", (_req, res) => {
            // Обещаем килобайт, отдаём кусок и рвём соединение.
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
});
