import { vi } from "vitest";

import type { IAssetAccess, IAssetEntry } from "../vs/base/common/assets/iAssetAccess.ts";
import type { IExtension } from "../vs/platform/extensions/common/iExtension.ts";
import type { IThemeContribution } from "../vs/platform/extensions/common/iThemeContribution.ts";
import type { ILogger } from "../vs/platform/log/common/iLogger.ts";

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

/** `themes` типизирован широко: тесты подсовывают битую запись, как сторонний манифест. */
export function extensionWithThemes(id: string, themes: readonly unknown[], isBuiltin = false): IExtension {
    const dot = id.indexOf(".");
    const publisher = dot === -1 ? id : id.slice(0, dot);
    const name = dot === -1 ? id : id.slice(dot + 1);
    return {
        id,
        location: `${isBuiltin ? "Extensions/builtin" : "UserExtensions"}/${id}-1.0.0/`,
        isBuiltin,
        manifest: {
            name,
            publisher,
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
