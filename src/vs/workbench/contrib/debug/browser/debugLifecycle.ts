/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/common/debugLifecycle.ts
// `debug.confirmOnExit`: closing the window with debug sessions asks first. The dialog has a title of its own
// ("Stop Debugging"): ours always has one.

import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { type DialogService, DialogServiceDIToken } from "../../../services/dialogs/browser/dialogService.ts";
import {
    type LifecycleService,
    LifecycleServiceDIToken,
    type ShutdownReason,
} from "../../../services/lifecycle/browser/lifecycleService.ts";
import type { IDebugService } from "../common/debug.ts";

import { DebugServiceDIToken } from "./debugService.ts";

export const DebugLifecycleDIToken = token<DebugLifecycle>("DebugLifecycle");

export class DebugLifecycle implements IDisposable {
    public static dependencies = [
        LifecycleServiceDIToken,
        DebugServiceDIToken,
        IConfigurationServiceDIToken,
        DialogServiceDIToken,
    ] as const;

    private readonly disposable: IDisposable;

    public constructor(
        lifecycleService: Pick<LifecycleService, "registerShutdownVeto">,
        private readonly debugService: Pick<IDebugService, "getModel">,
        private readonly configurationService: Pick<IConfigurationService, "get">,
        private readonly dialogService: Pick<DialogService, "confirm">,
    ) {
        this.disposable = lifecycleService.registerShutdownVeto((reason) => this.shouldVetoShutdown(reason));
    }

    private shouldVetoShutdown(reason: ShutdownReason): boolean | Promise<boolean> {
        if (reason === "reload") {
            return false;
        }

        const rootSessions = this.debugService
            .getModel()
            .getSessions()
            .filter((s) => s.parentSession === undefined);
        if (rootSessions.length === 0) {
            return false;
        }

        const shouldConfirmOnExit = this.configurationService.get("debug.confirmOnExit");
        if (shouldConfirmOnExit === "never") {
            return false;
        }

        return this.showWindowCloseConfirmation(rootSessions.length);
    }

    public dispose(): void {
        this.disposable.dispose();
    }

    private async showWindowCloseConfirmation(numSessions: number): Promise<boolean> {
        let message: string;
        if (numSessions === 1) {
            message = "There is an active debug session, are you sure you want to stop it?";
        } else {
            message = "There are active debug sessions, are you sure you want to stop them?";
        }
        const confirmed = await this.dialogService.confirm({
            title: "Stop Debugging",
            message,
            confirmLabel: "Stop Debugging",
            warning: true,
        });
        return !confirmed;
    }
}
