import { type Mock, vi } from "vitest";

import type { IDisposable } from "../vs/base/common/lifecycle.ts";
import { ConfigurationRegistry } from "../vs/platform/configuration/common/configurationRegistry.ts";
import type { IFileWatcher } from "../vs/platform/files/common/iFileWatcher.ts";
import type { ILogger } from "../vs/platform/log/common/iLogger.ts";
import { NULL_LOGGER } from "../vs/platform/log/common/nullLogService.ts";

export class FakeFileWatcher implements IFileWatcher {
    private readonly handlers = new Map<string, () => void>();

    public watchFile(filePath: string, onChange: () => void): IDisposable {
        this.handlers.set(filePath, onChange);
        return { dispose: () => this.handlers.delete(filePath) };
    }

    public fire(filePath: string): void {
        this.handlers.get(filePath)?.();
    }

    public watched(): string[] {
        return [...this.handlers.keys()];
    }
}

/** One key per scope; `java.home` is allowed in the workspace, `java.secret` is not. */
export function testRegistry(): ConfigurationRegistry {
    const registry = new ConfigurationRegistry([
        {
            id: "test",
            properties: {
                "editor.tabSize": { scope: "language-overridable", type: "number", default: 4 },
                "files.exclude": { scope: "resource", type: "object", default: {} },
                "workbench.colorTheme": { scope: "window", type: "string", default: "Dark" },
                "terminal.tier": { scope: "machine", type: "string", default: "auto" },
                "update.mode": { scope: "application", type: "string", default: "default" },
            },
        },
    ]);
    registry.registerExtensionConfiguration("acme.java", {
        "java.home": { scope: "machine-overridable" },
        "java.secret": { scope: "machine" },
    });
    return registry;
}

/** The null logger with `info`, `warn` and `error` observable. */
export function makeLogger(): ILogger & {
    info: Mock<ILogger["info"]>;
    warn: Mock<ILogger["warn"]>;
    error: Mock<ILogger["error"]>;
} {
    return {
        ...NULL_LOGGER,
        info: vi.fn<ILogger["info"]>(),
        warn: vi.fn<ILogger["warn"]>(),
        error: vi.fn<ILogger["error"]>(),
    };
}
