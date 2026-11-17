/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/browser/debugQuickAccess.ts
// Select and Start Debugging: the launch configurations and compounds of the window, the dynamic configurations
// started lately and a row per debug type with dynamic configurations (asked when the picker opens: listing the types
// activates nothing), then "Add Configuration..." of each visible launch. Deviations: the picker has no separators, so
// the first row of a group carries its name as a hint ("most recent", "contributed", "configure"); a row has no
// buttons ("Configure Launch Configuration", "Remove Launch Configuration").

import { onUnexpectedError } from "../../../../base/common/errors.ts";
import { fuzzyMatchPrepared, prepareQuery } from "../../../../base/common/fuzzySearch.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IWorkspaceContextService } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import { IWorkspaceContextServiceDIToken } from "../../../../platform/workspace/common/iWorkspaceContextServiceDIToken.ts";
import { toMatchRanges } from "../../quickaccess/browser/pathMatchRanges.ts";
import type { IQuickAccessProvider, QuickAccessItem } from "../../quickaccess/common/iQuickAccessProvider.ts";
import type { IDebugService, IDynamicConfigurationProvider } from "../common/debug.ts";

import { DebugServiceDIToken } from "./debugService.ts";

export const ADD_CONFIGURATION_ID = "debug.addConfiguration";

export const DebugQuickAccessProviderDIToken = token<StartDebugQuickAccessProvider>("StartDebugQuickAccessProvider");

export const NO_DEBUG_RESULTS = "No matching launch configurations";
export const MOST_RECENT_HINT = "most recent";
const CONTRIBUTED_HINT = "contributed";
const CONFIGURE_HINT = "configure";

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

    /** The types with dynamic configurations, as of the last time the picker opened. */
    private dynamicProviders: readonly IDynamicConfigurationProvider[] = [];

    public onShow(refresh: (preserveSelection: boolean) => void): void {
        void this.debugService
            .getConfigurationManager()
            .getDynamicProviders()
            .then((providers) => {
                this.dynamicProviders = providers;
                // The rows came after the cursor was placed: it goes back to the first one, as upstream shows them at once.
                refresh(false);
            })
            .catch(onUnexpectedError);
    }

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

        // Entries detected configurations
        const contributed: QuickAccessItem[] = [];
        for (const { name, type } of configManager.getRecentDynamicConfigurations()) {
            const highlights = fuzzyMatchPrepared(filter, name);
            if (highlights) {
                contributed.push({
                    label: name,
                    labelMatchRanges: toMatchRanges(highlights.matchedIndices),
                    accept: () => {
                        void (async () => {
                            await configManager.selectConfiguration(undefined, name, undefined, { type });
                            const { launch, getConfig } = configManager.selectedConfiguration;
                            const config = await getConfig();
                            await this.debugService
                                .startDebugging(launch, config, { startedByUser: true })
                                .catch(() => undefined);
                        })();
                    },
                });
            }
        }

        for (const provider of this.dynamicProviders) {
            contributed.push({
                label: `${provider.label}...`,
                accept: () => {
                    void (async () => {
                        const pick = await provider.pick();
                        if (pick) {
                            // Use the type of the provider, not of the config since config sometimes have subtypes (for example "node-terminal")
                            await configManager.selectConfiguration(pick.launch, pick.config.name, pick.config, {
                                type: provider.type,
                            });
                            await this.debugService
                                .startDebugging(pick.launch, pick.config, { startedByUser: true })
                                .catch(() => undefined);
                        }
                    })();
                },
            });
        }
        picks.push(...withGroupHint(contributed, this.dynamicProviders.length > 0 ? CONTRIBUTED_HINT : undefined));

        // Entries: launches
        const configure: QuickAccessItem[] = [];
        const visibleLaunches = configManager.getLaunches().filter((launch) => !launch.hidden);
        for (const launch of visibleLaunches) {
            const label = inWorkspace ? `Add Config (${launch.name})...` : "Add Configuration...";
            const highlights = fuzzyMatchPrepared(filter, label);
            // Add Config entry
            configure.push({
                label,
                description: inWorkspace ? launch.name : "",
                labelMatchRanges: highlights ? toMatchRanges(highlights.matchedIndices) : undefined,
                accept: () => {
                    this.commands.execute(ADD_CONFIGURATION_ID, launch.uri.toString());
                },
            });
        }
        picks.push(...withGroupHint(configure, CONFIGURE_HINT));

        return picks;
    }
}

/** Upstream's separator label, on the group's first row. */
function withGroupHint(group: readonly QuickAccessItem[], hint: string | undefined): readonly QuickAccessItem[] {
    return group.map((item, index) => (index === 0 && hint !== undefined ? { ...item, hint } : item));
}
