/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/browser/statusbarColorProvider.ts
// While debugging (`debug.enableStatusBarColor`) the status bar takes `statusBar.debugging*`. Not here: the
// command center's `commandCenter.debuggingBackground` (there is no command center) and the border color (the
// status bar has no border).

import { Disposable, MutableDisposable } from "../../../../base/common/lifecycle.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { type StatusBarService, StatusBarServiceDIToken } from "../../../services/statusbar/common/statusBarService.ts";
import { type IDebugService, type IDebugSession, State } from "../common/debug.ts";

import { DebugServiceDIToken } from "./debugService.ts";

export const StatusBarColorProviderDIToken = token<StatusBarColorProvider>("StatusBarColorProvider");

export class StatusBarColorProvider extends Disposable {
    public static dependencies = [DebugServiceDIToken, StatusBarServiceDIToken, IConfigurationServiceDIToken] as const;

    private readonly override = this.register(new MutableDisposable());

    public constructor(
        private readonly debugService: Pick<IDebugService, "state" | "onDidChangeState" | "getModel">,
        private readonly statusbarService: Pick<StatusBarService, "overrideStyle">,
        private readonly configurationService: Pick<IConfigurationService, "get" | "onDidChangeConfiguration">,
    ) {
        super();
        const update = (): void => {
            this.update();
        };
        this.register(debugService.onDidChangeState(update));
        // Any setting: the update is idempotent (upstream filters `debug.enableStatusBarColor`).
        this.register(configurationService.onDidChangeConfiguration(update));
        this.update();
    }

    private update(): void {
        const enabled =
            this.configurationService.get("debug.enableStatusBarColor") &&
            isStatusbarInDebugMode(this.debugService.state, this.debugService.getModel().getSessions());
        if (enabled === (this.override.value !== undefined)) return;
        this.override.value = enabled
            ? this.statusbarService.overrideStyle({
                  priority: 10,
                  foreground: "statusBar.debuggingForeground",
                  background: "statusBar.debuggingBackground",
              })
            : undefined;
    }
}

export function isStatusbarInDebugMode(state: State, sessions: readonly IDebugSession[]): boolean {
    if (
        state === State.Inactive ||
        state === State.Initializing ||
        sessions.every((s) => s.suppressDebugStatusbar || s.configuration.noDebug === true)
    ) {
        return false;
    }

    return true;
}
