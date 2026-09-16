import { describe, expect, it, vi } from "vitest";

import type { IAssetAccess, IAssetEntry } from "../../../../base/common/assets/iAssetAccess.ts";
import { EMPTY_LANGUAGE_CONFIGURATION } from "../../../../editor/common/languages/languageConfiguration.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";

import { LanguageConfigurationService } from "./languageConfigurationService.ts";

class MemoryAssets implements IAssetAccess {
    public readCount = 0;

    public constructor(private readonly files: Record<string, string>) {}

    public read(): Promise<Uint8Array> {
        return Promise.reject(new Error("not used"));
    }

    public readText(virtualPath: string): Promise<string> {
        this.readCount++;
        const content = this.files[virtualPath];
        if (content === undefined) return Promise.reject(new Error(`no asset: ${virtualPath}`));
        return Promise.resolve(content);
    }

    public exists(): Promise<boolean> {
        return Promise.resolve(true);
    }

    public listEntries(): Promise<IAssetEntry[]> {
        return Promise.resolve([]);
    }
}

function createLogger(): ILogger {
    return {
        trace: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        isEnabled: () => false,
    };
}

const TS_CONFIG_PATH = "Extensions/builtin/typescript/language-configuration.json";

function createService(
    files: Record<string, string>,
    configurationPaths: Record<string, string | undefined> = { typescript: TS_CONFIG_PATH },
    logger: ILogger = createLogger(),
): { service: LanguageConfigurationService; assets: MemoryAssets } {
    const assets = new MemoryAssets(files);
    const service = new LanguageConfigurationService(
        assets,
        {
            getLanguage: (languageId) =>
                languageId in configurationPaths
                    ? { configurationPath: configurationPaths[languageId] }
                    : undefined,
        },
        logger,
    );
    return { service, assets };
}

describe("LanguageConfigurationService", () => {
    it("loads and resolves a JSONC configuration (comments + trailing commas)", async () => {
        const logger = createLogger();
        const { service } = createService(
            {
                [TS_CONFIG_PATH]: `{
                // как в реальных файлах стоковых расширений
                "comments": { "lineComment": "//", "blockComment": ["/*", "*/"], },
                "brackets": [["{", "}"],],
                "autoClosingPairs": [{ "open": "'", "close": "'", "notIn": ["string"] },],
            }`,
            },
            { typescript: TS_CONFIG_PATH },
            logger,
        );

        const config = await service.ensureLoaded("typescript");
        expect(config.comments).toEqual({ lineComment: "//", blockComment: ["/*", "*/"] });
        expect(config.brackets).toEqual([["{", "}"]]);
        expect(config.autoClosingPairs).toEqual([{ open: "'", close: "'", notIn: ["string"] }]);
        // Комментарии и висячие запятые — валидный JSONC: ни одной жалобы в лог.
        expect(logger.warn).not.toHaveBeenCalled();
    });

    it("get() is undefined before loading and returns the cached value after", async () => {
        const { service } = createService({ [TS_CONFIG_PATH]: `{ "comments": { "lineComment": "//" } }` });

        expect(service.get("typescript")).toBeUndefined();
        const loaded = await service.ensureLoaded("typescript");
        expect(service.get("typescript")).toBe(loaded);
    });

    it("reads the asset once per language (repeat and concurrent calls share the flight)", async () => {
        const { service, assets } = createService({ [TS_CONFIG_PATH]: `{}` });

        const [first, second] = await Promise.all([
            service.ensureLoaded("typescript"),
            service.ensureLoaded("typescript"),
        ]);
        const third = await service.ensureLoaded("typescript");

        expect(assets.readCount).toBe(1);
        expect(second).toBe(first);
        expect(third).toBe(first);
    });

    it("gives the empty configuration to unknown languages and languages without a file", async () => {
        const { service, assets } = createService({}, { plaintext: undefined });

        expect(await service.ensureLoaded("no-such-language")).toBe(EMPTY_LANGUAGE_CONFIGURATION);
        expect(await service.ensureLoaded("plaintext")).toBe(EMPTY_LANGUAGE_CONFIGURATION);
        expect(assets.readCount).toBe(0);
    });

    it("caches an unreadable asset as the empty configuration and warns once", async () => {
        const logger = createLogger();
        const { service, assets } = createService({}, { typescript: TS_CONFIG_PATH }, logger);

        expect(await service.ensureLoaded("typescript")).toBe(EMPTY_LANGUAGE_CONFIGURATION);
        expect(await service.ensureLoaded("typescript")).toBe(EMPTY_LANGUAGE_CONFIGURATION);
        expect(assets.readCount).toBe(1);
        expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    it("logs a non-Error rejection reason as-is", async () => {
        // FS-провайдеры и бандл могут реджектить чем угодно — не только Error.
        const logger = createLogger();
        const assets = new MemoryAssets({});
        assets.readText = () => Promise.reject("EACCES");
        const service = new LanguageConfigurationService(
            assets,
            { getLanguage: () => ({ configurationPath: TS_CONFIG_PATH }) },
            logger,
        );

        expect(await service.ensureLoaded("typescript")).toBe(EMPTY_LANGUAGE_CONFIGURATION);
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("unreadable"), "EACCES");
    });

    it("warns on parse errors but keeps the salvageable part", async () => {
        const logger = createLogger();
        const { service } = createService(
            { [TS_CONFIG_PATH]: `{ "comments": { "lineComment": "//" } !!!garbage` },
            { typescript: TS_CONFIG_PATH },
            logger,
        );

        const config = await service.ensureLoaded("typescript");
        expect(config.comments).toEqual({ lineComment: "//", blockComment: undefined });
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("JSONC parse error"));
    });

    it("treats a non-object document as the empty configuration", async () => {
        // Массив, скаляр и `null` — всё это не конфигурация языка.
        for (const content of [`["not", "an", "object"]`, `42`, `null`]) {
            const { service } = createService({ [TS_CONFIG_PATH]: content });
            expect(await service.ensureLoaded("typescript")).toBe(EMPTY_LANGUAGE_CONFIGURATION);
        }
    });
});
