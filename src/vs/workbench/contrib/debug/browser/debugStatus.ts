/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/browser/debugStatus.ts
// The `status.debug` entry (`debug.showInStatusBar`): the selected launch configuration, a click runs Select and
// Start Debugging. The entry has no tooltip and no aria label: the status bar has neither.

import { Disposable, MutableDisposable } from "../../../../base/common/lifecycle.ts";
import { type CommandRegistry, CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import {
    type IProductIconService,
    ProductIconServiceDIToken,
} from "../../../../platform/theme/common/productIconService.ts";
import {
    type IStatusBarEntryHandle,
    type StatusBarService,
    StatusBarServiceDIToken,
} from "../../../services/statusbar/common/statusBarService.ts";
import { type IDebugService, State } from "../common/debug.ts";

import { SELECT_AND_START_ID } from "./debugCommands.ts";
import { DebugServiceDIToken } from "./debugService.ts";

export const DebugStatusContributionDIToken = token<DebugStatusContribution>("DebugStatusContribution");

export class DebugStatusContribution extends Disposable {
    public static dependencies = [
        StatusBarServiceDIToken,
        DebugServiceDIToken,
        IConfigurationServiceDIToken,
        CommandRegistryDIToken,
        ProductIconServiceDIToken,
    ] as const;

    private readonly entryAccessor = this.register(new MutableDisposable<IStatusBarEntryHandle>());

    public constructor(
        private readonly statusBarService: Pick<StatusBarService, "addEntry">,
        private readonly debugService: Pick<IDebugService, "onDidChangeState" | "getConfigurationManager">,
        private readonly configurationService: Pick<IConfigurationService, "get" | "onDidChangeConfiguration">,
        private readonly commands: Pick<CommandRegistry, "execute">,
        private readonly icons: Pick<IProductIconService, "renderCodicons" | "onDidChange">,
    ) {
        super();
        this.addEntryIfAlways();
        this.register(
            debugService.onDidChangeState((state) => {
                if (state !== State.Inactive && this.showInStatusBar() === "onFirstSessionStart") this.addEntry();
            }),
        );
        this.register(
            // Any setting (upstream filters `debug.showInStatusBar`): both steps are idempotent.
            configurationService.onDidChangeConfiguration(() => {
                this.addEntryIfAlways();
                if (this.showInStatusBar() === "never") this.entryAccessor.clear();
            }),
        );
        const update = (): void => {
            this.entryAccessor.value?.update({ text: this.text() });
        };
        this.register(debugService.getConfigurationManager().onDidSelectConfiguration(update));
        this.register(icons.onDidChange(update));
    }

    private showInStatusBar(): "never" | "always" | "onFirstSessionStart" {
        return this.configurationService.get("debug.showInStatusBar");
    }

    private addEntryIfAlways(): void {
        if (this.showInStatusBar() === "always") this.addEntry();
    }

    private addEntry(): void {
        this.entryAccessor.value ??= this.statusBarService.addEntry({
            id: "status.debug",
            name: "Debug",
            text: this.text(),
            alignment: "left",
            // Low priority.
            priority: 30,
            onClick: () => {
                this.commands.execute(SELECT_AND_START_ID);
            },
        });
    }

    private text(): string {
        const manager = this.debugService.getConfigurationManager();
        const { name, launch } = manager.selectedConfiguration;
        const text =
            name === undefined || name === "" || launch === undefined
                ? ""
                : manager.getLaunches().length > 1
                  ? `${name} (${launch.name})`
                  : name;
        return this.icons.renderCodicons(`$(debug-alt-small) ${text}`);
    }
}
