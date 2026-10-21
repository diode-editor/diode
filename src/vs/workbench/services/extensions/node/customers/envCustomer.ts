import { DisposableStore, type IDisposable } from "../../../../../base/common/lifecycle.ts";
import { getMachineId } from "../../../../../base/node/id.ts";
import { getSystemShell } from "../../../../../base/node/shell.ts";
import type { IClipboard } from "../../../../../platform/clipboard/common/iClipboard.ts";
import type { HostRpc } from "../../../../api/common/extHostProtocol.ts";
import type { IWireClipboardText } from "../../../../api/common/wireTypes.ts";
import type { IExternalOpener } from "../../../externalOpener/common/iExternalOpener.ts";
import type { IExtensionHostContext, IExtensionHostCustomer } from "../../common/extensionHostCustomer.ts";

/** Upstream `initData`. */
export interface IExtensionHostEnvironment {
    /** Stable across runs (cached in application state). */
    readonly machineId: () => string;
    /** The shell a terminal without `shellPath` would start with. */
    readonly defaultShell: () => string;
}

/** The machine id doesn't survive across runs, the shell is the system one. */
export function fallbackExtensionHostEnvironment(): IExtensionHostEnvironment {
    let machineId: string | undefined;
    return {
        machineId: () => (machineId ??= getMachineId()),
        defaultShell: () => getSystemShell(),
    };
}

export class EnvCustomer implements IExtensionHostCustomer {
    private rpc: HostRpc | null = null;

    public constructor(
        private readonly clipboard: IClipboard | undefined,
        private readonly externalOpener: IExternalOpener | undefined,
        private readonly environment: IExtensionHostEnvironment,
    ) {}

    /**
     * `env.machineId`/`env.shell` are synchronous — seeded before the first activation. The shell never changes
     * (we have no terminal profiles), so there are no repeated seeds.
     */
    public pushInitialState(): void {
        this.rpc?.notify("env.initialize", {
            machineId: this.environment.machineId(),
            shell: this.environment.defaultShell(),
        });
    }

    public attach({ rpc }: IExtensionHostContext): IDisposable {
        this.rpc = rpc;
        const store = new DisposableStore();
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
