import { beforeEach, describe, expect, it, vi } from "vitest";

const assets = vi.hoisted(() => ({
    cacheDir: null as string | null,
    bundle: null as Uint8Array | null,
    reads: [] as string[],
    extracted: [] as { bundle: Uint8Array; cacheDir: string }[],
}));

vi.mock("../../../../base/node/assets/packagedAsset.ts", () => ({
    packagedAssetCacheDirByName: () => assets.cacheDir,
    readPackagedAssetView: (name: string) => {
        assets.reads.push(name);
        return assets.bundle;
    },
}));

vi.mock("../../../../base/node/assets/extractBundleToCache.ts", () => ({
    extractBundleToCache: (bundle: Uint8Array, cacheDir: string) => {
        assets.extracted.push({ bundle, cacheDir });
        return Promise.resolve();
    },
}));

// The module memoizes the source and the extraction promise, so every test gets a fresh copy.
async function loadEnsureTsServer() {
    vi.resetModules();
    return (await import("./loadTsServer.ts")).ensureTsServer;
}

describe("ensureTsServer", () => {
    beforeEach(() => {
        assets.cacheDir = null;
        assets.bundle = null;
        assets.reads = [];
        assets.extracted = [];
    });

    it("without a packaged bundle (dev) reads and extracts nothing", async () => {
        assets.bundle = new Uint8Array([1]);
        const onError = vi.fn();
        const ensureTsServer = await loadEnsureTsServer();

        await ensureTsServer(onError);

        expect(assets.reads).toEqual([]);
        expect(assets.extracted).toEqual([]);
        expect(onError).not.toHaveBeenCalled();
    });

    it("with a packaged bundle extracts it into its cache directory", async () => {
        const bundle = new Uint8Array([1, 2, 3]);
        assets.cacheDir = "/cache/ts-server/abc";
        assets.bundle = bundle;
        const ensureTsServer = await loadEnsureTsServer();

        await ensureTsServer();

        expect(assets.extracted).toEqual([{ bundle, cacheDir: "/cache/ts-server/abc" }]);
    });
});
