import { describe, expect, it, vi } from "vitest";

import type { IAssetAccess } from "../../../base/common/assets/iAssetAccess.ts";
import type { ILogger } from "../../log/common/iLogger.ts";

import { loadNlsBundle, localizeExtensionManifest } from "./extensionNls.ts";

const PREFIX = "UserExtensions/redhat.java-1.57.0/";

/**
 * `IAssetAccess` над словарём «виртуальный путь → содержимое». Отсутствующий
 * путь — `exists() === false` и reject у `readText()`, как у настоящего.
 */
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
    it("читает базовый бандл для локали интерфейса `en`", async () => {
        const assets = createAssets({ [`${PREFIX}package.nls.json`]: '{"java.clean":"Clean Workspace"}' });

        await expect(loadNlsBundle(assets, PREFIX, "en")).resolves.toEqual({ "java.clean": "Clean Workspace" });
    });

    it("файл локали перебивает базовый", async () => {
        const assets = createAssets({
            [`${PREFIX}package.nls.json`]: '{"java.clean":"Clean Workspace"}',
            [`${PREFIX}package.nls.ko.json`]: '{"java.clean":"작업 영역 정리"}',
        });

        await expect(loadNlsBundle(assets, PREFIX, "ko")).resolves.toEqual({ "java.clean": "작업 영역 정리" });
    });

    it("нет файла локали — фолбэк на базовый", async () => {
        const assets = createAssets({ [`${PREFIX}package.nls.json`]: '{"java.clean":"Clean Workspace"}' });

        await expect(loadNlsBundle(assets, PREFIX, "ko")).resolves.toEqual({ "java.clean": "Clean Workspace" });
    });

    it("нет ни одного бандла — undefined, без ошибок в лог", async () => {
        const logger = createLoggerSpy();

        await expect(loadNlsBundle(createAssets({}), PREFIX, "en", logger)).resolves.toBeUndefined();
        expect(logger.error).not.toHaveBeenCalled();
    });

    it("битый бандл локали не отменяет локализацию — берётся базовый, ошибка в лог", async () => {
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

    it("битый базовый бандл — undefined, ошибка в лог", async () => {
        const logger = createLoggerSpy();
        const assets = createAssets({ [`${PREFIX}package.nls.json`]: '["not","an","object"]' });

        await expect(loadNlsBundle(assets, PREFIX, "en", logger)).resolves.toBeUndefined();
        expect(logger.error).toHaveBeenCalledTimes(1);
    });
});

describe("localizeExtensionManifest", () => {
    it("резолвит манифест по бандлу расширения", async () => {
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

    it("ненайденные ключи — одной строкой в лог, строки остаются ключами", async () => {
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

    it("всё резолвнуто — в лог ничего не пишется", async () => {
        const logger = createLoggerSpy();
        const assets = createAssets({ [`${PREFIX}package.nls.json`]: '{"a":"A"}' });

        await localizeExtensionManifest({ ok: "%a%" }, assets, PREFIX, "en", logger);

        expect(logger.warn).not.toHaveBeenCalled();
        expect(logger.error).not.toHaveBeenCalled();
    });
});
