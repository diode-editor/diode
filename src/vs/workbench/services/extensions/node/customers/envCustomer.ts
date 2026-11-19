import { Event } from "../../../../../base/common/event.ts";
import { DisposableStore, type IDisposable } from "../../../../../base/common/lifecycle.ts";
import { getMachineId } from "../../../../../base/node/id.ts";
import { getSystemShell } from "../../../../../base/node/shell.ts";
import type { IClipboard } from "../../../../../platform/clipboard/common/iClipboard.ts";
import { DEFAULT_WINDOW_LOG_LEVEL, LogLevel } from "../../../../../platform/log/common/logLevel.ts";
import type { HostRpc } from "../../../../api/common/extHostProtocol.ts";
import { LogLevel as ApiLogLevel } from "../../../../api/common/vscodeTypes.ts";
import type { IWireClipboardText } from "../../../../api/common/wireTypes.ts";
import type { IExternalOpener } from "../../../externalOpener/common/iExternalOpener.ts";
import { loadRipgrepAppRoot } from "../../../search/node/loadRipgrep.ts";
import type { IExtensionHostContext, IExtensionHostCustomer } from "../../common/extensionHostCustomer.ts";

/** Upstream `initData`. */
export interface IExtensionHostEnvironment {
    /** Stable across runs (cached in application state). */
    readonly machineId: () => string;
    /** The shell a terminal without `shellPath` would start with. */
    readonly defaultShell: () => string;
    /** `env.appRoot`: an existing directory with VS Code's layout (rg), or `""`. */
    readonly appRoot: () => string;
    /** `env.logLevel`: the window's level, `ILogService.getWindowLevel`. */
    readonly logLevel: () => LogLevel;
    readonly onDidChangeLogLevel: Event<LogLevel>;
}

/** The machine id doesn't survive across runs, the shell is the system one, the log level is upstream's default Info. */
export function fallbackExtensionHostEnvironment(): IExtensionHostEnvironment {
    let machineId: string | undefined;
    return {
        machineId: () => (machineId ??= getMachineId()),
        defaultShell: () => getSystemShell(),
        appRoot: loadRipgrepAppRoot,
        logLevel: () => DEFAULT_WINDOW_LOG_LEVEL,
        onDidChangeLogLevel: Event.None,
    };
}

/** The core numbers levels Off 0, Trace 10 … Error 50; the API — Off 0, Trace 1 … Error 5. */
const API_LOG_LEVELS: Record<LogLevel, ApiLogLevel> = {
    [LogLevel.Off]: ApiLogLevel.Off,
    [LogLevel.Trace]: ApiLogLevel.Trace,
    [LogLevel.Debug]: ApiLogLevel.Debug,
    [LogLevel.Info]: ApiLogLevel.Info,
    [LogLevel.Warn]: ApiLogLevel.Warning,
    [LogLevel.Error]: ApiLogLevel.Error,
};

export class EnvCustomer implements IExtensionHostCustomer {
    private rpc: HostRpc | null = null;

    public constructor(
        private readonly clipboard: IClipboard | undefined,
        private readonly externalOpener: IExternalOpener | undefined,
        private readonly environment: IExtensionHostEnvironment,
    ) {}

    /**
     * `env.machineId`/`env.shell`/`env.appRoot`/`env.logLevel` are synchronous — seeded before the first activation. The
     * shell never changes (we have no terminal profiles); a log level change goes as `env.didChangeLogLevel`.
     */
    public pushInitialState(): void {
        this.rpc?.notify("env.initialize", {
            machineId: this.environment.machineId(),
            shell: this.environment.defaultShell(),
            appRoot: this.environment.appRoot(),
            logLevel: API_LOG_LEVELS[this.environment.logLevel()],
        });
    }

    public attach({ rpc }: IExtensionHostContext): IDisposable {
        this.rpc = rpc;
        const store = new DisposableStore();
        // Upstream `$setLogLevel` without a resource: every spawn alive at the change hears it.
        store.add(
            this.environment.onDidChangeLogLevel((level) => {
                rpc.notify("env.didChangeLogLevel", { logLevel: API_LOG_LEVELS[level] });
            }),
        );
        store.add(
            rpc.handleRequest("env.clipboard.readText", async (): Promise<IWireClipboardText> => {
                return { text: (await this.clipboard?.readText()) ?? "" };
            }),
        );
        store.add(
            rpc.handleRequest("env.clipboard.writeText", async (params): Promise<null> => {
                const { text }: { text?: unknown } = params;
                // A non-string must not overwrite the real clipboard contents.
                if (typeof text === "string") await this.clipboard?.writeText(text);
                return null;
            }),
        );
        store.add(
            rpc.handleRequest("env.openExternal", async (params): Promise<{ opened: boolean }> => {
                const { uri }: { uri?: unknown } = params;
                if (typeof uri !== "string" || uri === "") return { opened: false };
                return { opened: (await this.externalOpener?.open(uri)) ?? false };
            }),
        );
        return store;
    }
}
