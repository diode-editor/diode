import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../TestUtils/TempWorkspace.ts";
import { REGISTRY_SCHEMA_VERSION, type IRegistryVersion } from "../common/registryFormat.ts";
import { FileExtensionRegistrySource } from "./fileRegistrySource.ts";

const ID = "acme.markdown-tools";

function indexJson(): string {
    return JSON.stringify({
        schemaVersion: REGISTRY_SCHEMA_VERSION,
        extensions: [
            {
                id: ID,
                publisher: "acme",
                name: "markdown-tools",
                displayName: "Markdown Tools",
                description: "Tools",
                kind: "native",
                latest: { version: "1.2.0", engines: { vscode: "^1.90.0" } },
            },
        ],
    });
}

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
                artifact: { type: "path", path: "artifacts/mt-1.2.0.vsix" },
                sha256: "a".repeat(64),
            },
        ],
        ...overrides,
    });
}

function pathVersion(relPath: string): IRegistryVersion {
    return {
        version: "1.2.0",
        engines: { vscode: "*" },
        artifact: { type: "path", path: relPath },
        sha256: "a".repeat(64),
    };
}

describe("FileExtensionRegistrySource", () => {
    let ws: ITempWorkspace | undefined;

    afterEach(() => {
        ws?.dispose();
        ws = undefined;
    });

    it("getIndex читает и парсит index.json", async () => {
        ws = createTempWorkspace({ files: { "index.json": indexJson() } });
        const source = new FileExtensionRegistrySource(ws.dir);
        const index = await source.getIndex();
        expect(index.extensions.map((e) => e.id)).toEqual([ID]);
    });

    it("getIndex без index.json — ошибка с путём", async () => {
        ws = createTempWorkspace();
        const source = new FileExtensionRegistrySource(ws.dir);
        await expect(source.getIndex()).rejects.toThrow(/index\.json/);
    });

    it("getIndex на битом JSON — ошибка с путём файла", async () => {
        ws = createTempWorkspace({ files: { "index.json": "{oops" } });
        const source = new FileExtensionRegistrySource(ws.dir);
        await expect(source.getIndex()).rejects.toThrow(/index\.json.*malformed JSON/);
    });

    it("диагностики битых записей уходят в onProblem", async () => {
        const badEntry = JSON.stringify({
            schemaVersion: REGISTRY_SCHEMA_VERSION,
            extensions: [{ id: "broken" }],
        });
        ws = createTempWorkspace({ files: { "index.json": badEntry } });
        const problems: string[] = [];
        const source = new FileExtensionRegistrySource(ws.dir, (p) => problems.push(p));
        const index = await source.getIndex();
        expect(index.extensions).toEqual([]);
        expect(problems).toHaveLength(1);
    });

    it("getMeta читает meta/<id>.json и сверяет id", async () => {
        ws = createTempWorkspace({ files: { [`meta/${ID}.json`]: metaJson() } });
        const source = new FileExtensionRegistrySource(ws.dir);
        const meta = await source.getMeta(ID);
        expect(meta?.id).toBe(ID);
        expect(meta?.versions).toHaveLength(1);
    });

    it("getMeta для неизвестного id — undefined", async () => {
        ws = createTempWorkspace();
        const source = new FileExtensionRegistrySource(ws.dir);
        await expect(source.getMeta("acme.unknown")).resolves.toBeUndefined();
    });

    it("getMeta на мете с чужим id внутри — ошибка", async () => {
        ws = createTempWorkspace({
            files: {
                [`meta/${ID}.json`]: metaJson({ id: "other.markdown-tools", publisher: "other" }),
            },
        });
        const source = new FileExtensionRegistrySource(ws.dir);
        await expect(source.getMeta(ID)).rejects.toThrow(/does not match expected/);
    });

    it.each(["../evil", "a/b", "a\\b", "..", ".hidden", "noDotSeparator"])(
        "getMeta отвергает небезопасный id %j",
        async (id) => {
            ws = createTempWorkspace();
            const source = new FileExtensionRegistrySource(ws.dir);
            await expect(source.getMeta(id)).rejects.toThrow(/Invalid extension id/);
        },
    );

    it("fetchArtifact возвращает абсолютный путь существующего файла без копирования", async () => {
        ws = createTempWorkspace({ files: { "artifacts/mt-1.2.0.vsix": "fake-vsix-bytes" } });
        const source = new FileExtensionRegistrySource(ws.dir);
        const result = await source.fetchArtifact(pathVersion("artifacts/mt-1.2.0.vsix"), ws.path("tmp"));
        expect(result).toBe(path.join(ws.dir, "artifacts", "mt-1.2.0.vsix"));
    });

    it("fetchArtifact на url-артефакте — понятная ошибка", async () => {
        ws = createTempWorkspace();
        const source = new FileExtensionRegistrySource(ws.dir);
        const version: IRegistryVersion = {
            version: "1.0.0",
            engines: { vscode: "*" },
            artifact: { type: "url", url: "https://open-vsx.org/x.vsix" },
            sha256: "a".repeat(64),
        };
        await expect(source.fetchArtifact(version, ws.path("tmp"))).rejects.toThrow(
            /"url" is not supported by the file registry source/,
        );
    });

    it("fetchArtifact с путём, выходящим за корень (собран программно, мимо парсера) — отказ", async () => {
        ws = createTempWorkspace();
        const source = new FileExtensionRegistrySource(ws.dir);
        await expect(source.fetchArtifact(pathVersion("../outside.vsix"), ws.path("tmp"))).rejects.toThrow(
            /outside the registry root/,
        );
    });

    it("fetchArtifact на отсутствующем файле — ошибка с путём", async () => {
        ws = createTempWorkspace();
        const source = new FileExtensionRegistrySource(ws.dir);
        await expect(source.fetchArtifact(pathVersion("artifacts/missing.vsix"), ws.path("tmp"))).rejects.toThrow(
            /Artifact file not found in registry/,
        );
    });

    it("fetchArtifact с path === «.» указывает на сам корень и не считается выходом", async () => {
        ws = createTempWorkspace();
        const source = new FileExtensionRegistrySource(ws.dir);
        await expect(source.fetchArtifact(pathVersion("."), ws.path("tmp"))).resolves.toBe(ws.dir);
    });
});
