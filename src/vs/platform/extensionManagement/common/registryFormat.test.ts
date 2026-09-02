import { describe, expect, it } from "vitest";

import {
    REGISTRY_SCHEMA_VERSION,
    parseRegistryIndex,
    parseRegistryMeta,
    searchRegistryIndex,
} from "./registryFormat.ts";

/** Валидная запись index.json; поля переопределяются мутатором. */
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

/** Валидная запись версии в meta; поля переопределяются мутатором. */
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
    it("разбирает валидный индекс", () => {
        const { index, problems } = parseRegistryIndex(
            indexText([indexEntry({ categories: ["Programming Languages"] })], { generatedAt: "2026-08-27T00:00:00Z" }),
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

    it.each([
        ["не-строка", 42],
        ["пустая строка", ""],
    ])("generatedAt %s отбрасывается, contract не ломается", (_label, generatedAt) => {
        const { index } = parseRegistryIndex(indexText([], { generatedAt }));
        expect(index.generatedAt).toBeUndefined();
    });

    it.each([
        ["не JSON", "{oops", /Invalid registry index: malformed JSON/],
        ["не объект", "[1,2]", /Invalid registry index: expected a JSON object/],
        ["JSON null", "null", /Invalid registry index: expected a JSON object/],
        ["JSON число", "42", /Invalid registry index: expected a JSON object/],
        ["JSON строка", '"registry"', /Invalid registry index: expected a JSON object/],
        ["нет schemaVersion", "{}", /Invalid registry index: missing "schemaVersion"/],
        ["schemaVersion строкой", '{"schemaVersion":"1"}', /Invalid registry index: missing "schemaVersion"/],
        [
            "schemaVersion новее клиента",
            JSON.stringify({ schemaVersion: REGISTRY_SCHEMA_VERSION + 1, extensions: [] }),
            /Registry index has schemaVersion 2, but this client supports up to 1 — update Diode/,
        ],
        ["нет extensions", JSON.stringify({ schemaVersion: 1 }), /Invalid registry index: missing "extensions" array/],
        [
            "extensions не массив",
            JSON.stringify({ schemaVersion: 1, extensions: {} }),
            /Invalid registry index: missing "extensions" array/,
        ],
    ])("битый файл (%s) — ошибка", (_label, text, error) => {
        expect(() => parseRegistryIndex(text)).toThrow(error);
    });

    it.each([
        ["не объект", "just a string"],
        ["нет id", indexEntry({ id: undefined })],
        ["id пустая строка", indexEntry({ id: "" })],
        ["нет publisher", indexEntry({ publisher: undefined })],
        ["publisher пустая строка", indexEntry({ publisher: "", id: ".markdown-tools" })],
        ["нет name", indexEntry({ name: undefined })],
        ["name пустая строка", indexEntry({ name: "", id: "acme." })],
        ["нет displayName", indexEntry({ displayName: undefined })],
        ["displayName пустая строка", indexEntry({ displayName: "" })],
        ["description не строка", indexEntry({ description: 42 })],
        ["kind вне словаря", indexEntry({ kind: "curated" })],
        ["id ≠ publisher.name", indexEntry({ id: "other.markdown-tools" })],
        ["categories не массив", indexEntry({ categories: "Linters" })],
        ["categories с не-строкой", indexEntry({ categories: ["ok", 5] })],
        ["categories с пустой строкой", indexEntry({ categories: [""] })],
        ["нет latest", indexEntry({ latest: undefined })],
        ["latest.version не строка", indexEntry({ latest: { version: 42, engines: { vscode: "*" } } })],
        ["latest.version не semver", indexEntry({ latest: { version: "latest", engines: { vscode: "*" } } })],
        ["latest без engines", indexEntry({ latest: { version: "1.0.0" } })],
        ["latest.engines пустой", indexEntry({ latest: { version: "1.0.0", engines: {} } })],
    ])("битая запись (%s) пропускается с диагностикой", (_label, entry) => {
        const { index, problems } = parseRegistryIndex(indexText([entry, indexEntry()]));
        expect(index.extensions).toHaveLength(1);
        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatch(/skipping invalid entry #0/);
    });

    it("диагностика включает id битой записи, когда он есть", () => {
        const { problems } = parseRegistryIndex(indexText([indexEntry({ kind: "bad" })]));
        expect(problems[0]).toContain("(acme.markdown-tools)");
    });

    it("диагностика записи без id — ровно текст пропуска, без суффикса", () => {
        const { problems } = parseRegistryIndex(indexText(["just a string"]));
        expect(problems).toEqual(["registry index: skipping invalid entry #0"]);
    });
});

describe("parseRegistryMeta", () => {
    it("разбирает валидную мету со всеми опциональными полями", () => {
        const { meta, problems } = parseRegistryMeta(
            metaText(
                [
                    versionRecord({
                        artifact: { type: "url", url: "https://open-vsx.org/x.vsix", origin: "openvsx" },
                        size: 124000,
                        publishedAt: "2026-08-01T00:00:00Z",
                    }),
                ],
                { repository: "https://github.com/acme/mt", license: "MIT", homepage: "https://acme.dev", readme: "# MT" },
            ),
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

    it("опциональные поля отсутствуют — undefined", () => {
        const { meta } = parseRegistryMeta(metaText([versionRecord()]));
        expect(meta.schemaVersion).toBe(REGISTRY_SCHEMA_VERSION);
        expect(meta.repository).toBeUndefined();
        expect(meta.license).toBeUndefined();
        expect(meta.homepage).toBeUndefined();
        expect(meta.readme).toBeUndefined();
        expect(meta.versions[0]?.artifact).toEqual({ type: "path", path: "artifacts/acme.markdown-tools-1.2.0.vsix" });
        expect(meta.versions[0]?.size).toBeUndefined();
        expect(meta.versions[0]?.publishedAt).toBeUndefined();
    });

    it("опциональные поля с пустой строкой — undefined", () => {
        const { meta } = parseRegistryMeta(
            metaText([versionRecord()], { repository: "", license: "", homepage: "", readme: "" }),
        );
        expect(meta.repository).toBeUndefined();
        expect(meta.license).toBeUndefined();
        expect(meta.homepage).toBeUndefined();
        expect(meta.readme).toBeUndefined();
    });

    it.each([
        ["не JSON", "{oops", /Invalid registry meta: malformed JSON/],
        ["не объект", "null", /Invalid registry meta: expected a JSON object/],
        ["нет schemaVersion", "{}", /Invalid registry meta: missing "schemaVersion"/],
        [
            "schemaVersion новее клиента",
            JSON.stringify({ schemaVersion: REGISTRY_SCHEMA_VERSION + 1 }),
            /Registry meta has schemaVersion 2, but this client supports up to 1 — update Diode/,
        ],
        ["битая идентичность", metaText([], { kind: "bad" }), /Invalid registry meta: bad identity fields/],
        ["versions не массив", metaText([], { versions: "none" }), /Invalid registry meta: missing "versions" array/],
    ])("битый файл (%s) — ошибка", (_label, text, error) => {
        expect(() => parseRegistryMeta(text)).toThrow(error);
    });

    it("id не совпадает с ожидаемым — ошибка", () => {
        expect(() => parseRegistryMeta(metaText([]), "other.ext")).toThrow(/does not match expected "other.ext"/);
    });

    it.each([
        ["не объект", 42],
        ["нет version", versionRecord({ version: undefined })],
        ["version не semver", versionRecord({ version: "latest" })],
        ["нет engines", versionRecord({ engines: undefined })],
        ["engines без diode/vscode", versionRecord({ engines: { node: ">=20" } })],
        ["engines.diode не строка", versionRecord({ engines: { diode: 1 } })],
        ["engines.diode пустая строка", versionRecord({ engines: { diode: "" } })],
        ["engines.vscode не строка", versionRecord({ engines: { vscode: 1 } })],
        ["engines.vscode пустая строка", versionRecord({ engines: { vscode: "" } })],
        ["нет artifact", versionRecord({ artifact: undefined })],
        ["artifact без типа", versionRecord({ artifact: {} })],
        ["artifact неизвестного типа", versionRecord({ artifact: { type: "ftp", url: "x" } })],
        ["artifact чужого типа с валидным path", versionRecord({ artifact: { type: "ftp", path: "a.vsix" } })],
        ["url-артефакт без url", versionRecord({ artifact: { type: "url" } })],
        ["url-артефакт с пустым url", versionRecord({ artifact: { type: "url", url: "" } })],
        ["url-артефакт с чужим origin", versionRecord({ artifact: { type: "url", url: "https://x", origin: "npm" } })],
        ["path-артефакт без path", versionRecord({ artifact: { type: "path" } })],
        ["path пустая строка", versionRecord({ artifact: { type: "path", path: "" } })],
        ["path с backslash", versionRecord({ artifact: { type: "path", path: "a\\b.vsix" } })],
        ["path абсолютный", versionRecord({ artifact: { type: "path", path: "/etc/x.vsix" } })],
        ["path с ..", versionRecord({ artifact: { type: "path", path: "../outside.vsix" } })],
        ["path с пустым сегментом", versionRecord({ artifact: { type: "path", path: "a//b.vsix" } })],
        ["нет sha256", versionRecord({ sha256: undefined })],
        // Массив с hex-строкой коэрсится RegExp.test'ом в валидный hex — тип обязан проверяться отдельно.
        ["sha256 не строка", versionRecord({ sha256: ["a".repeat(64)] })],
        ["sha256 не hex-64", versionRecord({ sha256: "abc" })],
        ["sha256 длиннее 64", versionRecord({ sha256: "a".repeat(65) })],
        ["sha256 uppercase", versionRecord({ sha256: "A".repeat(64) })],
        ["size не число", versionRecord({ size: "big" })],
        ["publishedAt не строка", versionRecord({ publishedAt: 5 })],
        ["publishedAt пустая строка", versionRecord({ publishedAt: "" })],
    ])("битая версия (%s) пропускается с диагностикой", (_label, version) => {
        const { meta, problems } = parseRegistryMeta(metaText([version, versionRecord({ version: "1.1.0" })]));
        expect(meta.versions).toHaveLength(1);
        expect(meta.versions[0]?.version).toBe("1.1.0");
        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatch(/acme\.markdown-tools: skipping invalid version #0/);
    });

    it("диагностика включает номер версии битой записи, когда он есть", () => {
        const { problems } = parseRegistryMeta(metaText([versionRecord({ sha256: "zzz" })]));
        expect(problems[0]).toContain("(1.2.0)");
    });

    it("диагностика записи без version — ровно текст пропуска, без суффикса", () => {
        const { problems } = parseRegistryMeta(metaText([42]));
        expect(problems).toEqual(["registry meta acme.markdown-tools: skipping invalid version #0"]);
    });

    it("engines только с diode валиден", () => {
        const { meta, problems } = parseRegistryMeta(metaText([versionRecord({ engines: { diode: "^0.3.0" } })]));
        expect(problems).toEqual([]);
        expect(meta.versions[0]?.engines).toEqual({ diode: "^0.3.0", vscode: undefined });
    });

    it("url-артефакт без origin валиден", () => {
        const { meta } = parseRegistryMeta(metaText([versionRecord({ artifact: { type: "url", url: "https://x/y.vsix" } })]));
        expect(meta.versions[0]?.artifact).toEqual({ type: "url", url: "https://x/y.vsix", origin: undefined });
    });

    it("url-артефакт с origin github-release валиден", () => {
        const { meta, problems } = parseRegistryMeta(
            metaText([versionRecord({ artifact: { type: "url", url: "https://x/y.vsix", origin: "github-release" } })]),
        );
        expect(problems).toEqual([]);
        expect(meta.versions[0]?.artifact).toEqual({ type: "url", url: "https://x/y.vsix", origin: "github-release" });
    });
});

describe("searchRegistryIndex", () => {
    // Индекс собирается внутри тестов, а не при загрузке файла: код, исполненный на уровне
    // describe, Stryker помечает static-мутантами и гоняет для них весь сьют целиком.
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
        ).index;

    it("пустой и пробельный запрос — весь список", () => {
        const index = searchableIndex();
        expect(searchRegistryIndex(index, "")).toHaveLength(2);
        expect(searchRegistryIndex(index, "   ")).toHaveLength(2);
    });

    it.each([
        ["по id", "maptz", ["maptz.regionfolder"]],
        ["по displayName без учёта регистра", "MARKDOWN tools", ["acme.markdown-tools"]],
        ["по description", "fold custom", ["maptz.regionfolder"]],
        ["нет совпадений", "python", []],
    ])("ищет %s", (_label, query, expected) => {
        expect(searchRegistryIndex(searchableIndex(), query).map((e) => e.id)).toEqual(expected);
    });
});
