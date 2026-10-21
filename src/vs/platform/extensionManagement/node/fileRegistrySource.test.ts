import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../TestUtils/TempWorkspace.ts";
import { type IRegistryVersion, REGISTRY_SCHEMA_VERSION } from "../common/registryFormat.ts";

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

    it("getIndex reads and parses index.json", async () => {
        ws = createTempWorkspace({ files: { "index.json": indexJson() } });
        const source = new FileExtensionRegistrySource(ws.dir);
        const index = await source.getIndex();
        expect(index.extensions.map((e) => e.id)).toEqual([ID]);
    });

    it("getIndex without index.json fails with the path", async () => {
        ws = createTempWorkspace();
        const source = new FileExtensionRegistrySource(ws.dir);
        await expect(source.getIndex()).rejects.toThrow(/index\.json/);
    });

    it("getIndex on malformed JSON fails with the file path", async () => {
        ws = createTempWorkspace({ files: { "index.json": "{oops" } });
        const source = new FileExtensionRegistrySource(ws.dir);
        await expect(source.getIndex()).rejects.toThrow(/index\.json.*malformed JSON/);
    });

    it("diagnostics for broken entries go to onProblem", async () => {
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

    it("getMeta reads meta/<id>.json and checks the id", async () => {
        ws = createTempWorkspace({ files: { [`meta/${ID}.json`]: metaJson() } });
        const source = new FileExtensionRegistrySource(ws.dir);
        const meta = await source.getMeta(ID);
        expect(meta?.id).toBe(ID);
        expect(meta?.versions).toHaveLength(1);
    });

    it("getMeta for an unknown id returns undefined", async () => {
        ws = createTempWorkspace();
        const source = new FileExtensionRegistrySource(ws.dir);
        await expect(source.getMeta("acme.unknown")).resolves.toBeUndefined();
    });

    it("getMeta on meta with a different id inside fails", async () => {
        ws = createTempWorkspace({
            files: {
                [`meta/${ID}.json`]: metaJson({ id: "other.markdown-tools", publisher: "other" }),
            },
        });
        const source = new FileExtensionRegistrySource(ws.dir);
        await expect(source.getMeta(ID)).rejects.toThrow(/does not match expected/);
    });

    it.each([
        "../evil",
        "a/b",
        "a\\b",
        "..",
        ".hidden",
        "noDotSeparator",
        // A valid id as the string's tail: the id must match whole, not be found inside.
        "evil/../acme.hello",
        // A valid id as the string's head: same requirement from the other end.
        "acme.hello/../../etc/passwd",
    ])("getMeta rejects unsafe id %j", async (id) => {
        ws = createTempWorkspace();
        const source = new FileExtensionRegistrySource(ws.dir);
        await expect(source.getMeta(id)).rejects.toThrow(/Invalid extension id/);
    });

    it("broken entries do not crash a source without onProblem", async () => {
        const badEntry = JSON.stringify({ schemaVersion: REGISTRY_SCHEMA_VERSION, extensions: [{ id: "broken" }] });
        ws = createTempWorkspace({ files: { "index.json": badEntry } });
        const source = new FileExtensionRegistrySource(ws.dir);
        const index = await source.getIndex();
        expect(index.extensions).toEqual([]);
    });

    it("fetchArtifact returns the absolute path of an existing file without copying", async () => {
        ws = createTempWorkspace({ files: { "artifacts/mt-1.2.0.vsix": "fake-vsix-bytes" } });
        const source = new FileExtensionRegistrySource(ws.dir);
        const result = await source.fetchArtifact(pathVersion("artifacts/mt-1.2.0.vsix"), ws.path("tmp"));
        expect(result).toBe(path.join(ws.dir, "artifacts", "mt-1.2.0.vsix"));
    });

    it("fetchArtifact on a url artifact fails with a clear error", async () => {
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

    it("fetchArtifact rejects a path escaping the root (built programmatically, bypassing the parser)", async () => {
        ws = createTempWorkspace();
        const source = new FileExtensionRegistrySource(ws.dir);
        await expect(source.fetchArtifact(pathVersion("../outside.vsix"), ws.path("tmp"))).rejects.toThrow(
            /outside the registry root/,
        );
    });

    it("fetchArtifact on a missing file fails with the path", async () => {
        ws = createTempWorkspace();
        const source = new FileExtensionRegistrySource(ws.dir);
        await expect(source.fetchArtifact(pathVersion("artifacts/missing.vsix"), ws.path("tmp"))).rejects.toThrow(
            /Artifact file not found in registry/,
        );
    });

    it('fetchArtifact with path === "." points at the root itself and is not an escape', async () => {
        ws = createTempWorkspace();
        const source = new FileExtensionRegistrySource(ws.dir);
        await expect(source.fetchArtifact(pathVersion("."), ws.path("tmp"))).resolves.toBe(ws.dir);
    });
});
