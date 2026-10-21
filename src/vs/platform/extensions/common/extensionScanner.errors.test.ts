import { describe, expect, it, vi } from "vitest";

import type { IAssetAccess, IAssetEntry } from "../../../base/common/assets/iAssetAccess.ts";
import type { ILogger } from "../../log/common/iLogger.ts";

import { scanExtensions } from "./extensionScanner.ts";

const ROOT_PREFIX = "Extensions/builtin/";

function createLoggerSpy(): ILogger & { error: ReturnType<typeof vi.fn> } {
    return {
        trace: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        isEnabled: () => true,
    } as unknown as ILogger & { error: ReturnType<typeof vi.fn> };
}

describe("scanExtensions — error handling", () => {
    it("logs and returns [] when listEntries() throws", async () => {
        const logger = createLoggerSpy();
        const boom = new Error("listEntries failed");
        const assets: IAssetAccess = {
            read: vi.fn(),
            readText: vi.fn(),
            exists: vi.fn(),
            listEntries: vi.fn().mockRejectedValue(boom),
        };

        const result = await scanExtensions(assets, ROOT_PREFIX, {}, logger);

        expect(result).toEqual([]);
        expect(logger.error).toHaveBeenCalledTimes(1);
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("Failed to scan extensions"), boom);
    });

    it("logs and skips an extension when readText() throws, continuing with valid ones", async () => {
        const logger = createLoggerSpy();
        const boom = new Error("readText failed");

        const entries: IAssetEntry[] = [
            { name: "broken", isDirectory: true },
            { name: "good", isDirectory: true },
        ];
        const goodManifest = JSON.stringify({ name: "good", publisher: "vscode", version: "1.0.0" });

        const assets: IAssetAccess = {
            read: vi.fn(),
            exists: vi.fn().mockResolvedValue(true),
            listEntries: vi.fn().mockResolvedValue(entries),
            readText: vi.fn((p: string) => {
                if (p.includes("broken")) return Promise.reject(boom);
                return Promise.resolve(goodManifest);
            }),
        };

        const result = await scanExtensions(assets, ROOT_PREFIX, {}, logger);

        expect(result).toHaveLength(1);
        expect(result[0].id).toBe("vscode.good");
        expect(logger.error).toHaveBeenCalledWith(
            expect.stringContaining(`Failed to read ${ROOT_PREFIX}broken/package.json`),
            boom,
        );
    });
});
