import { vi } from "vitest";

import type { IAssetAccess, IAssetEntry } from "../vs/base/common/assets/iAssetAccess.ts";
import type { IExtension } from "../vs/platform/extensions/common/iExtension.ts";
import type { IThemeContribution } from "../vs/platform/extensions/common/iThemeContribution.ts";
import type { ILogger } from "../vs/platform/log/common/iLogger.ts";

/**
 * Обвязка тестов `ExtensionThemeContributor`: синтетическое расширение-тема с
 * файлами тем в памяти — без диска и без упаковки vsix. Реестр-фикстура для
 * e2e (`e2e/fixtures/sample-theme`) — тот же формат, но настоящими файлами.
 */

/** Ассеты в памяти: виртуальный путь → текст файла. Ведёт журнал чтений. */
export class MemoryAssets implements IAssetAccess {
    public readonly reads: string[] = [];

    public constructor(private readonly files: Partial<Record<string, string>>) {}

    public async read(virtualPath: string): Promise<Uint8Array> {
        return new TextEncoder().encode(await this.readText(virtualPath));
    }

    public readText(virtualPath: string): Promise<string> {
        this.reads.push(virtualPath);
        const content = this.files[virtualPath];
        if (content === undefined) return Promise.reject(new Error(`ENOENT: no asset ${virtualPath}`));
        return Promise.resolve(content);
    }

    public exists(virtualPath: string): Promise<boolean> {
        return Promise.resolve(this.files[virtualPath] !== undefined);
    }

    public listEntries(): Promise<IAssetEntry[]> {
        return Promise.resolve([]);
    }
}

/**
 * Расширение с `contributes.themes`. `themes` типизирован широко, чтобы тесты
 * могли подсунуть битую запись (без `label`/`path`) — как это сделал бы
 * сторонний манифест.
 */
export function extensionWithThemes(id: string, themes: readonly unknown[], isBuiltin = false): IExtension {
    const parts = id.split(".");
    const publisher = parts.at(0);
    const name = parts.at(1);
    return {
        id,
        location: `${isBuiltin ? "Extensions/builtin" : "UserExtensions"}/${id}-1.0.0/`,
        isBuiltin,
        manifest: {
            name: name ?? id,
            publisher: publisher ?? "test",
            version: "1.0.0",
            engines: { vscode: "*" },
            contributes: { themes: themes as readonly IThemeContribution[] },
        },
    };
}

export type LoggerSpy = ILogger & { warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };

export function createLoggerSpy(): LoggerSpy {
    return {
        trace: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    } as unknown as LoggerSpy;
}
