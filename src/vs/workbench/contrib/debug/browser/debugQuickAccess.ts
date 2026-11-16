/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/browser/debugQuickAccess.ts
// Select and Start Debugging: the launch configurations and compounds of the window, then "Add Configuration..." of
// each visible launch. Deviations: the picker has no separators, so the most recent configuration goes first with
// the hint "most recent"; a row has no "Configure Launch Configuration" button. Not here yet: the configurations of
// the providers of extensions, recent and contributed (the next step of `vscode.debug`).

import { fuzzyMatchPrepared, prepareQuery } from "../../../../base/common/fuzzySearch.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IWorkspaceContextService } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import { IWorkspaceContextServiceDIToken } from "../../../../platform/workspace/common/iWorkspaceContextServiceDIToken.ts";
import { toMatchRanges } from "../../quickaccess/browser/pathMatchRanges.ts";
import type { IQuickAccessProvider, QuickAccessItem } from "../../quickaccess/common/iQuickAccessProvider.ts";
import type { IDebugService } from "../common/debug.ts";

import { DebugServiceDIToken } from "./debugService.ts";

export const ADD_CONFIGURATION_ID = "debug.addConfiguration";

export const DebugQuickAccessProviderDIToken = token<StartDebugQuickAccessProvider>("StartDebugQuickAccessProvider");

export const NO_DEBUG_RESULTS = "No matching launch configurations";
export const MOST_RECENT_HINT = "most recent";

export class StartDebugQuickAccessProvider implements IQuickAccessProvider {
    public static readonly PREFIX = "debug ";

    public static dependencies = [
        DebugServiceDIToken,
        IWorkspaceContextServiceDIToken,
        CommandRegistryDIToken,
    ] as const;

    public constructor(
        private readonly debugService: IDebugService,
        private readonly contextService: Pick<IWorkspaceContextService, "getWorkbenchState">,
        private readonly commands: Pick<CommandRegistry, "execute">,
    ) {}

    public getPlaceholder(): string {
        return "Type the name of a launch configuration to run.";
    }

    public getItems(query: string): QuickAccessItem[] {
        const picks = this.getPicks(prepareQuery(query.slice(StartDebugQuickAccessProvider.PREFIX.length)));
        return picks.length > 0 ? picks : [{ label: NO_DEBUG_RESULTS }];
    }

    private getPicks(filter: ReturnType<typeof prepareQuery>): QuickAccessItem[] {
        const picks: QuickAccessItem[] = [];
        if (!this.debugService.getAdapterManager().hasEnabledDebuggers()) {
            return [];
        }

        const inWorkspace = this.contextService.getWorkbenchState() === "workspace";
        const configManager = this.debugService.getConfigurationManager();
        const selectedConfiguration = configManager.selectedConfiguration;

        // Entries: configs
        for (const config of configManager.getAllConfigurations()) {
            const highlights = fuzzyMatchPrepared(filter, config.name);
            if (highlights) {
                const isMostRecent =
                    selectedConfiguration.name === config.name && selectedConfiguration.launch === config.launch;
                const pick: QuickAccessItem = {
                    label: config.name,
                    description: inWorkspace ? config.launch.name : "",
                    hint: isMostRecent ? MOST_RECENT_HINT : undefined,
                    labelMatchRanges: toMatchRanges(highlights.matchedIndices),
                    accept: () => {
                        void (async () => {
                            await configManager.selectConfiguration(config.launch, config.name);
                            // `startDebugging` shows its error itself.
                            await this.debugService
                                .startDebugging(config.launch, undefined, { startedByUser: true })
                                .catch(() => undefined);
                        })();
                    },
                };

                // Most recently used configuration
                if (isMostRecent) {
                    picks.unshift(pick);
                } else {
                    picks.push(pick);
                }
            }
        }

        // Entries: launches
        const visibleLaunches = configManager.getLaunches().filter((launch) => !launch.hidden);
        for (const launch of visibleLaunches) {
            const label = inWorkspace ? `Add Config (${launch.name})...` : "Add Configuration...";
            const highlights = fuzzyMatchPrepared(filter, label);
            // Add Config entry
            picks.push({
                label,
                description: inWorkspace ? launch.name : "",
                labelMatchRanges: highlights ? toMatchRanges(highlights.matchedIndices) : undefined,
                accept: () => {
                    this.commands.execute(ADD_CONFIGURATION_ID, launch.uri.toString());
                },
            });
        }

        return picks;
    }
}
