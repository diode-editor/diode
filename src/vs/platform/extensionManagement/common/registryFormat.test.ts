import * as semver from "semver";
import { describe, expect, it } from "vitest";

import {
    parseRegistryIndex,
    parseRegistryMeta,
    REGISTRY_SCHEMA_VERSION,
    searchRegistryIndex,
} from "./registryFormat.ts";

function indexEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: "acme.markdown-tools",
        publisher: "acme",
        name: "markdown-tools",
        displayName: "Markdown Tools",
        description: "Tools for markdown",
        kind: "native",
        latest: { version: "1.2.0", engines: { vscode: "^1.90.0" } },
        ...overrides,
    };
}

function indexText(entries: unknown[], envelope: Record<string, unknown> = {}): string {
    return JSON.stringify({ schemaVersion: REGISTRY_SCHEMA_VERSION, extensions: entries, ...envelope });
}

function versionRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        version: "1.2.0",
        engines: { vscode: "^1.90.0" },
        artifact: { type: "path", path: "artifacts/acme.markdown-tools-1.2.0.vsix" },
        sha256: "a".repeat(64),
        ...overrides,
    };
}

function metaText(versions: unknown[], envelope: Record<string, unknown> = {}): string {
    return JSON.stringify({
        schemaVersion: REGISTRY_SCHEMA_VERSION,
        id: "acme.markdown-tools",
        publisher: "acme",
        name: "markdown-tools",
        displayName: "Markdown Tools",
        description: "Tools for markdown",
        kind: "proxy-openvsx",
        versions,
        ...envelope,
    });
}

describe("parseRegistryIndex", () => {
    it("parses a valid index", () => {
        const { index, problems } = parseRegistryIndex(
            indexText([indexEntry({ categories: ["Programming Languages"] })], { generatedAt: "2026-08-27T00:00:00Z" }),
            semver,
        );
        expect(problems).toEqual([]);
        expect(index.schemaVersion).toBe(REGISTRY_SCHEMA_VERSION);
        expect(index.generatedAt).toBe("2026-08-27T00:00:00Z");
        expect(index.extensions).toHaveLength(1);
        expect(index.extensions[0]).toMatchObject({
            id: "acme.markdown-tools",
            kind: "native",
            categories: ["Programming Languages"],
            latest: { version: "1.2.0", engines: { vscode: "^1.90.0" } },
        });
    });

    it.each(["proxy-openvsx", "proxy-hosted", "native"] as const)("kind %s is accepted", (kind) => {
        const { index, problems } = parseRegistryIndex(indexText([indexEntry({ kind })]), semver);
        expect(problems).toEqual([]);
        expect(index.extensions).toHaveLength(1);
        expect(index.extensions[0].kind).toBe(kind);
    });

    it.each([
        ["non-string", 42],
        ["empty string", ""],
    ])("generatedAt %s is dropped without breaking the contract", (_label, generatedAt) => {
        const { index } = parseRegistryIndex(indexText([], { generatedAt }), semver);
        expect(index.generatedAt).toBeUndefined();
    });

    it.each([
        ["not JSON", "{oops", /Invalid registry index: malformed JSON/],
        ["not an object", "[1,2]", /Invalid registry index: expected a JSON object/],
        ["JSON null", "null", /Invalid registry index: expected a JSON object/],
        ["JSON number", "42", /Invalid registry index: expected a JSON object/],
        ["JSON string", '"registry"', /Invalid registry index: expected a JSON object/],
        ["no schemaVersion", "{}", /Invalid registry index: missing "schemaVersion"/],
        ["schemaVersion as a string", '{"schemaVersion":"1"}', /Invalid registry index: missing "schemaVersion"/],
        [
            "schemaVersion newer than the client",
            JSON.stringify({ schemaVersion: REGISTRY_SCHEMA_VERSION + 1, extensions: [] }),
            /Registry index has schemaVersion 2, but this client supports up to 1 — update Diode/,
        ],
        ["no extensions", JSON.stringify({ schemaVersion: 1 }), /Invalid registry index: missing "extensions" array/],
        [
            "extensions not an array",
            JSON.stringify({ schemaVersion: 1, extensions: {} }),
            /Invalid registry index: missing "extensions" array/,
        ],
    ])("broken file (%s) fails", (_label, text, error) => {
        expect(() => parseRegistryIndex(text, semver)).toThrow(error);
    });

    it.each([
        ["not an object", "just a string"],
        ["no id", indexEntry({ id: undefined })],
        ["id empty string", indexEntry({ id: "" })],
        ["no publisher", indexEntry({ publisher: undefined })],
        ["publisher empty string", indexEntry({ publisher: "", id: ".markdown-tools" })],
        ["no name", indexEntry({ name: undefined })],
        ["name empty string", indexEntry({ name: "", id: "acme." })],
        ["no displayName", indexEntry({ displayName: undefined })],
        ["displayName empty string", indexEntry({ displayName: "" })],
        ["description not a string", indexEntry({ description: 42 })],
        ["kind outside the vocabulary", indexEntry({ kind: "curated" })],
        ["id ≠ publisher.name", indexEntry({ id: "other.markdown-tools" })],
        ["categories not an array", indexEntry({ categories: "Linters" })],
        ["categories with a non-string", indexEntry({ categories: ["ok", 5] })],
        ["categories with an empty string", indexEntry({ categories: [""] })],
        ["no latest", indexEntry({ latest: undefined })],
        ["latest.version not a string", indexEntry({ latest: { version: 42, engines: { vscode: "*" } } })],
        ["latest.version not semver", indexEntry({ latest: { version: "latest", engines: { vscode: "*" } } })],
        ["latest without engines", indexEntry({ latest: { version: "1.0.0" } })],
        ["latest.engines empty", indexEntry({ latest: { version: "1.0.0", engines: {} } })],
    ])("broken entry (%s) is skipped with a diagnostic", (_label, entry) => {
        const { index, problems } = parseRegistryIndex(indexText([entry, indexEntry()]), semver);
        expect(index.extensions).toHaveLength(1);
        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatch(/skipping invalid entry #0/);
    });

    it("the diagnostic includes the broken entry id when present", () => {
        const { problems } = parseRegistryIndex(indexText([indexEntry({ kind: "bad" })]), semver);
        expect(problems[0]).toContain("(acme.markdown-tools)");
    });

    it("the diagnostic for an entry without id is exactly the skip text, without a suffix", () => {
        const { problems } = parseRegistryIndex(indexText(["just a string"]), semver);
        expect(problems).toEqual(["registry index: skipping invalid entry #0"]);
    });
});

describe("parseRegistryMeta", () => {
    it("parses valid meta with all optional fields", () => {
        const { meta, problems } = parseRegistryMeta(
            metaText(
                [
                    versionRecord({
                        artifact: { type: "url", url: "https://open-vsx.org/x.vsix", origin: "openvsx" },
                        size: 124000,
                        publishedAt: "2026-08-01T00:00:00Z",
                    }),
                ],
                {
                    repository: "https://github.com/acme/mt",
                    license: "MIT",
                    homepage: "https://acme.dev",
                    readme: "# MT",
                },
            ),
            semver,
            "acme.markdown-tools",
        );
        expect(problems).toEqual([]);
        expect(meta).toMatchObject({
            id: "acme.markdown-tools",
            kind: "proxy-openvsx",
            repository: "https://github.com/acme/mt",
            license: "MIT",
            homepage: "https://acme.dev",
            readme: "# MT",
        });
        expect(meta.versions[0]).toMatchObject({
            artifact: { type: "url", url: "https://open-vsx.org/x.vsix", origin: "openvsx" },
            size: 124000,
            publishedAt: "2026-08-01T00:00:00Z",
        });
    });

    it("missing optional fields are undefined", () => {
        const { meta } = parseRegistryMeta(metaText([versionRecord()]), semver);
        expect(meta.schemaVersion).toBe(REGISTRY_SCHEMA_VERSION);
        expect(meta.repository).toBeUndefined();
        expect(meta.license).toBeUndefined();
        expect(meta.homepage).toBeUndefined();
        expect(meta.readme).toBeUndefined();
        expect(meta.versions[0]?.artifact).toEqual({ type: "path", path: "artifacts/acme.markdown-tools-1.2.0.vsix" });
        expect(meta.versions[0]?.targetPlatform).toBeUndefined();
        expect(meta.versions[0]?.size).toBeUndefined();
        expect(meta.versions[0]?.publishedAt).toBeUndefined();
    });

    it("targetPlatform is kept; one version as several platform entries is valid", () => {
        const { meta, problems } = parseRegistryMeta(
            metaText([
                versionRecord({ targetPlatform: "linux-x64" }),
                versionRecord({ targetPlatform: "somearch-someos" }),
            ]),
            semver,
        );
        expect(problems).toEqual([]);
        expect(meta.versions.map((v) => v.targetPlatform)).toEqual(["linux-x64", "somearch-someos"]);
    });

    it("optional fields with an empty string are undefined", () => {
        const { meta } = parseRegistryMeta(
            metaText([versionRecord()], { repository: "", license: "", homepage: "", readme: "" }),
            semver,
        );
        expect(meta.repository).toBeUndefined();
        expect(meta.license).toBeUndefined();
        expect(meta.homepage).toBeUndefined();
        expect(meta.readme).toBeUndefined();
    });

    it.each([
        ["not JSON", "{oops", /Invalid registry meta: malformed JSON/],
        ["not an object", "null", /Invalid registry meta: expected a JSON object/],
        ["no schemaVersion", "{}", /Invalid registry meta: missing "schemaVersion"/],
        [
            "schemaVersion newer than the client",
            JSON.stringify({ schemaVersion: REGISTRY_SCHEMA_VERSION + 1 }),
            /Registry meta has schemaVersion 2, but this client supports up to 1 — update Diode/,
        ],
        ["broken identity", metaText([], { kind: "bad" }), /Invalid registry meta: bad identity fields/],
        [
            "versions not an array",
            metaText([], { versions: "none" }),
            /Invalid registry meta: missing "versions" array/,
        ],
    ])("broken file (%s) fails", (_label, text, error) => {
        expect(() => parseRegistryMeta(text, semver)).toThrow(error);
    });

    it("an id different from the expected one fails", () => {
        expect(() => parseRegistryMeta(metaText([]), semver, "other.ext")).toThrow(
            /does not match expected "other.ext"/,
        );
    });

    it.each([
        ["not an object", 42],
        ["no version", versionRecord({ version: undefined })],
        ["version not semver", versionRecord({ version: "latest" })],
        ["no engines", versionRecord({ engines: undefined })],
        ["engines without diode/vscode", versionRecord({ engines: { node: ">=20" } })],
        ["engines.diode not a string", versionRecord({ engines: { diode: 1 } })],
        ["engines.diode empty string", versionRecord({ engines: { diode: "" } })],
        ["engines.vscode not a string", versionRecord({ engines: { vscode: 1 } })],
        ["engines.vscode empty string", versionRecord({ engines: { vscode: "" } })],
        ["no artifact", versionRecord({ artifact: undefined })],
        ["artifact without type", versionRecord({ artifact: {} })],
        ["artifact of unknown type", versionRecord({ artifact: { type: "ftp", url: "x" } })],
        ["artifact of a foreign type with a valid path", versionRecord({ artifact: { type: "ftp", path: "a.vsix" } })],
        ["url artifact without url", versionRecord({ artifact: { type: "url" } })],
        ["url artifact with empty url", versionRecord({ artifact: { type: "url", url: "" } })],
        [
            "url artifact with a foreign origin",
            versionRecord({ artifact: { type: "url", url: "https://x", origin: "npm" } }),
        ],
        ["path artifact without path", versionRecord({ artifact: { type: "path" } })],
        ["path empty string", versionRecord({ artifact: { type: "path", path: "" } })],
        ["path with backslash", versionRecord({ artifact: { type: "path", path: "a\\b.vsix" } })],
        ["path absolute", versionRecord({ artifact: { type: "path", path: "/etc/x.vsix" } })],
        ["path with ..", versionRecord({ artifact: { type: "path", path: "../outside.vsix" } })],
        ["path with an empty segment", versionRecord({ artifact: { type: "path", path: "a//b.vsix" } })],
        ["no sha256", versionRecord({ sha256: undefined })],
        // RegExp.test coerces an array holding a hex string into valid hex, so the type needs its own check.
        ["sha256 not a string", versionRecord({ sha256: ["a".repeat(64)] })],
        ["sha256 not hex-64", versionRecord({ sha256: "abc" })],
        ["sha256 longer than 64", versionRecord({ sha256: "a".repeat(65) })],
        ["sha256 uppercase", versionRecord({ sha256: "A".repeat(64) })],
        ["targetPlatform not a string", versionRecord({ targetPlatform: 7 })],
        ["targetPlatform empty string", versionRecord({ targetPlatform: "" })],
        ["size not a number", versionRecord({ size: "big" })],
        ["publishedAt not a string", versionRecord({ publishedAt: 5 })],
        ["publishedAt empty string", versionRecord({ publishedAt: "" })],
    ])("broken version (%s) is skipped with a diagnostic", (_label, version) => {
        const { meta, problems } = parseRegistryMeta(metaText([version, versionRecord({ version: "1.1.0" })]), semver);
        expect(meta.versions).toHaveLength(1);
        expect(meta.versions[0]?.version).toBe("1.1.0");
        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatch(/acme\.markdown-tools: skipping invalid version #0/);
    });

    it("the diagnostic includes the broken entry version when present", () => {
        const { problems } = parseRegistryMeta(metaText([versionRecord({ sha256: "zzz" })]), semver);
        expect(problems[0]).toContain("(1.2.0)");
    });

    it("the diagnostic for an entry without version is exactly the skip text, without a suffix", () => {
        const { problems } = parseRegistryMeta(metaText([42]), semver);
        expect(problems).toEqual(["registry meta acme.markdown-tools: skipping invalid version #0"]);
    });

    it("engines with only diode is valid", () => {
        const { meta, problems } = parseRegistryMeta(
            metaText([versionRecord({ engines: { diode: "^0.3.0" } })]),
            semver,
        );
        expect(problems).toEqual([]);
        expect(meta.versions[0]?.engines).toEqual({ diode: "^0.3.0", vscode: undefined });
    });

    it("url artifact without origin is valid", () => {
        const { meta } = parseRegistryMeta(
            metaText([versionRecord({ artifact: { type: "url", url: "https://x/y.vsix" } })]),
            semver,
        );
        expect(meta.versions[0]?.artifact).toEqual({ type: "url", url: "https://x/y.vsix", origin: undefined });
    });

    it("url artifact with origin github-release is valid", () => {
        const { meta, problems } = parseRegistryMeta(
            metaText([versionRecord({ artifact: { type: "url", url: "https://x/y.vsix", origin: "github-release" } })]),
            semver,
        );
        expect(problems).toEqual([]);
        expect(meta.versions[0]?.artifact).toEqual({ type: "url", url: "https://x/y.vsix", origin: "github-release" });
    });
});

describe("searchRegistryIndex", () => {
    // Not at describe level: Stryker marks such code as static mutants and runs the whole suite.
    const searchableIndex = () =>
        parseRegistryIndex(
            indexText([
                indexEntry(),
                indexEntry({
                    id: "maptz.regionfolder",
                    publisher: "maptz",
                    name: "regionfolder",
                    displayName: "Region Folder",
                    description: "Fold custom regions",
                    kind: "proxy-openvsx",
                }),
            ]),
            semver,
        ).index;

    it("an empty or whitespace query returns the whole list", () => {
        const index = searchableIndex();
        expect(searchRegistryIndex(index, "")).toHaveLength(2);
        expect(searchRegistryIndex(index, "   ")).toHaveLength(2);
    });

    it.each([
        ["by id", "maptz", ["maptz.regionfolder"]],
        ["by displayName, case-insensitive", "MARKDOWN tools", ["acme.markdown-tools"]],
        ["by description", "fold custom", ["maptz.regionfolder"]],
        ["no matches", "python", []],
    ])("searches %s", (_label, query, expected) => {
        expect(searchRegistryIndex(searchableIndex(), query).map((e) => e.id)).toEqual(expected);
    });
});

describe("support note", () => {
    const partial = { level: "partial", works: ["Inline completions"], limits: ["Chat panel needs a webview"] };

    it("travels in the index entry", () => {
        const { index, problems } = parseRegistryIndex(indexText([indexEntry({ support: partial })]), semver);
        expect(problems).toEqual([]);
        expect(index.extensions[0]?.support).toEqual(partial);
    });

    it("travels in the meta", () => {
        const { meta } = parseRegistryMeta(metaText([versionRecord()], { support: partial }), semver);
        expect(meta.support).toEqual(partial);
    });

    it("level full requires no lists", () => {
        const { meta } = parseRegistryMeta(metaText([versionRecord()], { support: { level: "full" } }), semver);
        expect(meta.support).toEqual({ level: "full", works: undefined, limits: undefined });
    });

    it.each([
        ["unknown level", { level: "sort-of", limits: ["x"] }],
        ["no level at all", { limits: ["x"] }],
        ["partial without limits", { level: "partial", works: ["y"] }],
        ["partial with an empty limits list", { level: "partial", limits: [] }],
        ["limits not an array", { level: "partial", limits: "webview" }],
        ["empty list item", { level: "partial", limits: [""] }],
        ["list item not a string", { level: "partial", limits: [42] }],
        // `every` rejects it, `some` would let it through (mutant).
        ["some items broken", { level: "partial", limits: ["Chat panel", 42] }],
        ["works not an array", { level: "full", works: "everything" }],
        ["not an object", "partial"],
    ])("broken support note (%s) is dropped but the entry stays", (_label, support) => {
        const { meta, problems } = parseRegistryMeta(metaText([versionRecord()], { support }), semver);
        expect(meta.support).toBeUndefined();
        expect(meta.id).toBe("acme.markdown-tools");
        expect(problems).toEqual([]);
    });
});
