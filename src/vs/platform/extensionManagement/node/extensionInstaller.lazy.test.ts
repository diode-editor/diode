import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it, vi } from "vitest";

import type * as LazyModule from "../../../base/node/lazyModule.ts";
import { lazyChunkAssetName } from "../../../base/node/lazyModule.ts";

import { readVsixManifest } from "./extensionInstaller.ts";

const lazy = vi.hoisted(() => ({ ids: [] as string[] }));

vi.mock("../../../base/node/lazyModule.ts", async (importOriginal) => {
    const original = await importOriginal<typeof LazyModule>();
    return {
        ...original,
        loadLazyModule: <T>(id: string, importer: () => Promise<T>) => {
            lazy.ids.push(id);
            return original.loadLazyModule(id, importer);
        },
    };
});

describe("extensionInstaller — yauzl из ленивого куска", () => {
    // В SEA кусок ищется по id: другой id — другой ассет, и установка падает (e2e/sea-install.test.ts).
    it("чтение .vsix грузит yauzl через loadLazyModule под id из LAZY_CHUNKS", async () => {
        await expect(readVsixManifest(path.join(os.tmpdir(), "diode-no-such.vsix"))).rejects.toThrow();

        expect(lazy.ids).toEqual(["yauzl"]);
        expect(lazyChunkAssetName(lazy.ids[0])).toBe("lazy/yauzl.cjs");
    });
});
