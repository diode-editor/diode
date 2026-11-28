import { Event } from "../../../../../base/common/event.ts";
import { DisposableStore, type IDisposable } from "../../../../../base/common/lifecycle.ts";
import type { HostRpc } from "../../../../api/common/extHostProtocol.ts";
import type { IHostService } from "../../../host/browser/hostService.ts";
import type { IUserActivityService } from "../../../userActivity/common/userActivityService.ts";
import type { IExtensionHostContext, IExtensionHostCustomer } from "../../common/extensionHostCustomer.ts";

/** What `window.state` is made of: the terminal's focus and the user's input activity. */
export interface IExtensionHostWindowState {
    readonly host: Pick<IHostService, "hasFocus" | "onDidChangeFocus">;
    readonly userActivity: Pick<IUserActivityService, "isActive" | "onDidChangeIsActive">;
}

/** Null object: a host built without the window services (tests) — the subprocess keeps its own `true/true`. */
export const ALWAYS_FOCUSED_AND_ACTIVE: IExtensionHostWindowState = {
    host: { hasFocus: true, onDidChangeFocus: Event.None },
    userActivity: { isActive: true, onDidChangeIsActive: Event.None },
};

/**
 * Upstream `MainThreadWindow`: `window.focusChanged` on a focus change, `window.activeChanged` on an activity change,
 * and the seed of both (upstream `$getInitialState`) before the first activation — `activate()` already reads
 * `window.state`. The subprocess drops a value it already holds.
 */
export class WindowStateCustomer implements IExtensionHostCustomer {
    private rpc: HostRpc | null = null;

    public constructor(private readonly state: IExtensionHostWindowState) {}

    public pushInitialState(): void {
        this.rpc?.notify("window.focusChanged", { focused: this.state.host.hasFocus });
        this.rpc?.notify("window.activeChanged", { active: this.state.userActivity.isActive });
    }

    public attach({ rpc }: IExtensionHostContext): IDisposable {
        this.rpc = rpc;
        const store = new DisposableStore();
        store.add(
            this.state.host.onDidChangeFocus((focused) => {
                rpc.notify("window.focusChanged", { focused });
            }),
        );
        store.add(
            this.state.userActivity.onDidChangeIsActive((active) => {
                rpc.notify("window.activeChanged", { active });
            }),
        );
        return store;
    }
}
