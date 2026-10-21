import { describe, expect, it, vi } from "vitest";

import type { IAssetAccess } from "../../../base/common/assets/iAssetAccess.ts";
import type { ILogger } from "../../log/common/iLogger.ts";

import { loadNlsBundle, localizeExtensionManifest } from "./extensionNls.ts";

const PREFIX = "UserExtensions/redhat.java-1.57.0/";

function createAssets(files: Readonly<Partial<Record<string, string>>>): IAssetAccess {
    return {
        read: vi.fn(),
        readText: (p: string) => {
            const content = files[p];
            return content === undefined ? Promise.reject(new Error(`ENOENT: ${p}`)) : Promise.resolve(content);
        },
        exists: (p: string) => Promise.resolve(p in files),
        listEntries: vi.fn(),
    } as unknown as IAssetAccess;
}

function createLoggerSpy(): ILogger {
    return {
        trace: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        isEnabled: () => true,
    } as unknown as ILogger;
}

describe("loadNlsBundle", () => {
    it("reads the base bundle for the `en` UI locale", async () => {
        const assets = createAssets({ [`${PREFIX}package.nls.json`]: '{"java.clean":"Clean Workspace"}' });

        await expect(loadNlsBundle(assets, PREFIX, "en")).resolves.toEqual({ "java.clean": "Clean Workspace" });
    });

    it("the locale file overrides the base one", async () => {
        const assets = createAssets({
            [`${PREFIX}package.nls.json`]: '{"java.clean":"Clean Workspace"}',
            [`${PREFIX}package.nls.ko.json`]: '{"java.clean":"작업 영역 정리"}',
        });

        await expect(loadNlsBundle(assets, PREFIX, "ko")).resolves.toEqual({ "java.clean": "작업 영역 정리" });
    });

    it("no locale file: falls back to the base one", async () => {
        const assets = createAssets({ [`${PREFIX}package.nls.json`]: '{"java.clean":"Clean Workspace"}' });

        await expect(loadNlsBundle(assets, PREFIX, "ko")).resolves.toEqual({ "java.clean": "Clean Workspace" });
    });

    it("no bundle at all: undefined, no errors logged", async () => {
        const logger = createLoggerSpy();

        await expect(loadNlsBundle(createAssets({}), PREFIX, "en", logger)).resolves.toBeUndefined();
        expect(logger.error).not.toHaveBeenCalled();
    });

    it("a broken locale bundle does not cancel localization: the base one is used, the error is logged", async () => {
        const logger = createLoggerSpy();
        const assets = createAssets({
            [`${PREFIX}package.nls.ko.json`]: "{not json",
            [`${PREFIX}package.nls.json`]: '{"java.clean":"Clean Workspace"}',
        });

        await expect(loadNlsBundle(assets, PREFIX, "ko", logger)).resolves.toEqual({
            "java.clean": "Clean Workspace",
        });
        expect(logger.error).toHaveBeenCalledWith(
            `Failed to read nls bundle ${PREFIX}package.nls.ko.json`,
            expect.anything(),
        );
    });

    it("broken base bundle: undefined, the error is logged", async () => {
        const logger = createLoggerSpy();
        const assets = createAssets({ [`${PREFIX}package.nls.json`]: '["not","an","object"]' });

        await expect(loadNlsBundle(assets, PREFIX, "en", logger)).resolves.toBeUndefined();
        expect(logger.error).toHaveBeenCalledTimes(1);
    });
});

describe("localizeExtensionManifest", () => {
    it("resolves the manifest from the extension bundle", async () => {
        const assets = createAssets({
            [`${PREFIX}package.nls.json`]: '{"displayName":"Java","java.clean":"Clean Workspace"}',
        });

        const result = await localizeExtensionManifest(
            { displayName: "%displayName%", contributes: { commands: [{ title: "%java.clean%" }] } },
            assets,
            PREFIX,
            "en",
        );

        expect(result.displayName).toBe("Java");
        expect(result.contributes.commands[0].title).toBe("Clean Workspace");
    });

    it("missing keys are logged in one line, the strings stay keys", async () => {
        const logger = createLoggerSpy();
        const assets = createAssets({ [`${PREFIX}package.nls.json`]: '{"a":"A"}' });

        const result = await localizeExtensionManifest(
            { one: "%missing.one%", two: "%missing.two%", ok: "%a%" },
            assets,
            PREFIX,
            "en",
            logger,
        );

        expect(result).toEqual({ one: "%missing.one%", two: "%missing.two%", ok: "A" });
        expect(logger.warn).toHaveBeenCalledTimes(1);
        expect(logger.warn).toHaveBeenCalledWith(`${PREFIX}: unresolved nls keys (2): missing.one, missing.two`);
    });

    it("everything resolved: nothing is logged", async () => {
        const logger = createLoggerSpy();
        const assets = createAssets({ [`${PREFIX}package.nls.json`]: '{"a":"A"}' });

        await localizeExtensionManifest({ ok: "%a%" }, assets, PREFIX, "en", logger);

        expect(logger.warn).not.toHaveBeenCalled();
        expect(logger.error).not.toHaveBeenCalled();
    });
});
