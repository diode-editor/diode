import { Disposable } from "../../../../base/common/lifecycle.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import {
    type StatusBarComponent,
    StatusBarComponentDIToken,
} from "../../../browser/parts/statusbar/statusBarComponent.ts";
import { type DebugStubModel, DebugStubModelDIToken } from "../common/debugStubModel.ts";

export const StatusBarColorProviderDIToken = token<StatusBarColorProvider>("StatusBarColorProvider");

/**
 * SPIKE: upstream `StatusBarColorProvider` (`statusbarColorProvider.ts`): while a session is not inactive
 * (`isStatusbarInDebugMode`; running and stopped alike) the status bar takes `statusBar.debugging*`.
 * Upstream also skips sessions with `noDebug`/`suppressDebugStatusbar` — the stub has none.
 */
export class StatusBarColorProvider extends Disposable {
    public static dependencies = [DebugStubModelDIToken, StatusBarComponentDIToken] as const;

    public constructor(model: DebugStubModel, statusBar: StatusBarComponent) {
        super();
        const update = (): void => {
            statusBar.overrideColors(
                model.state === "inactive"
                    ? null
                    : { fg: "statusBar.debuggingForeground", bg: "statusBar.debuggingBackground" },
            );
        };
        this.register(model.onDidChangeState(update));
        update();
    }
}
