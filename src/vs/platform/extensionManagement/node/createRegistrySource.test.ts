import { afterEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../TestUtils/TempWorkspace.ts";
import { REGISTRY_SCHEMA_VERSION } from "../common/registryFormat.ts";
import { createRegistrySource, DEFAULT_REGISTRY_URL } from "./createRegistrySource.ts";
import { FileExtensionRegistrySource } from "./fileRegistrySource.ts";
import { HttpExtensionRegistrySource } from "./httpRegistrySource.ts";

describe("createRegistrySource", () => {
    let ws: ITempWorkspace | undefined;

    afterEach(() => {
        ws?.dispose();
        ws = undefined;
    });

    it("без --registry берёт публичный реестр по HTTP", () => {
        expect(createRegistrySource(undefined)).toBeInstanceOf(HttpExtensionRegistrySource);
        expect(DEFAULT_REGISTRY_URL).toMatch(/^https:\/\//);
    });

    it.each([
        "https://diode-editor.github.io/registry/v1/",
        "http://127.0.0.1:8080/registry/",
        "HTTPS://EXAMPLE.TEST/r/",
    ])("адрес %j — HTTP-источник", (spec) => {
        expect(createRegistrySource(spec)).toBeInstanceOf(HttpExtensionRegistrySource);
    });

    it.each([
        "/var/lib/diode-registry",
        "./registry",
        "registry",
        // Виндовый путь разбирается `new URL` как протокол `c:` — потому различаем
        // строго по префиксу схемы, иначе он уехал бы в HTTP-ветку.
        "C:\\registry",
        // Схема, которую мы не поддерживаем, — это не адрес, а имя каталога.
        "ftp://example.test/registry/",
    ])("значение %j — файловый источник", (spec) => {
        expect(createRegistrySource(spec)).toBeInstanceOf(FileExtensionRegistrySource);
    });

    it("onProblem доходит до созданного источника", async () => {
        ws = createTempWorkspace({
            files: {
                "index.json": JSON.stringify({ schemaVersion: REGISTRY_SCHEMA_VERSION, extensions: [{ id: "broken" }] }),
            },
        });
        const problems: string[] = [];
        const index = await createRegistrySource(ws.dir, (p) => problems.push(p)).getIndex();
        expect(index.extensions).toEqual([]);
        expect(problems).toHaveLength(1);
    });
});
