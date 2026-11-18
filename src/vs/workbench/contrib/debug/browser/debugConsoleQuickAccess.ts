/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/browser/debugConsoleQuickAccess.ts
// `debug consoles ` (Debug: Select Debug Console): the sessions with a console of their own, then "Start a New Debug
// Session". Picking one focuses it and shows the Debug Console. Deviation: no line before the last item (the picker
// has no separators).

import { codicon } from "../../../../base/common/codicons.ts";
import { fuzzyMatchPrepared, prepareQuery } from "../../../../base/common/fuzzySearch.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import {
    type IProductIconService,
    ProductIconServiceDIToken,
} from "../../../../platform/theme/common/productIconService.ts";
import type { ViewsService } from "../../../browser/parts/views/viewsService.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import { toMatchRanges } from "../../quickaccess/browser/pathMatchRanges.ts";
import type { IQuickAccessProvider, QuickAccessItem } from "../../quickaccess/common/iQuickAccessProvider.ts";
import type { IDebugService, IDebugSession } from "../common/debug.ts";

import { SELECT_AND_START_ID } from "./debugCommands.ts";
import { DebugServiceDIToken } from "./debugService.ts";
import { showReplIfHidden, START_NEW_DEBUG_SESSION } from "./debugSessionPicker.ts";
import { DEBUG_CONSOLE_QUICK_ACCESS_PREFIX } from "./replActions.ts";

export const DebugConsoleQuickAccessDIToken = token<DebugConsoleQuickAccess>("DebugConsoleQuickAccess");

export class DebugConsoleQuickAccess implements IQuickAccessProvider {
    public static readonly PREFIX = DEBUG_CONSOLE_QUICK_ACCESS_PREFIX;

    public static dependencies = [
        DebugServiceDIToken,
        ViewsServiceDIToken,
        CommandRegistryDIToken,
        ProductIconServiceDIToken,
    ] as const;

    public constructor(
        private readonly debugService: IDebugService,
        private readonly views: Pick<ViewsService, "isViewShown" | "openView">,
        private readonly commands: Pick<CommandRegistry, "execute">,
        private readonly icons: Pick<IProductIconService, "glyph">,
    ) {}

    public getPlaceholder(): string {
        return "";
    }

    public getItems(query: string): QuickAccessItem[] {
        const filter = prepareQuery(query.slice(DebugConsoleQuickAccess.PREFIX.length));
        const debugConsolePicks: QuickAccessItem[] = [];

        for (const session of this.debugService
            .getModel()
            .getSessions(true)
            .filter((s) => s.hasSeparateRepl())) {
            const pick = this.createPick(session, filter);
            if (pick) {
                debugConsolePicks.push(pick);
            }
        }

        debugConsolePicks.push({
            icon: this.icons.glyph(codicon("plus")),
            label: START_NEW_DEBUG_SESSION,
            accept: () => {
                this.commands.execute(SELECT_AND_START_ID);
            },
        });
        return debugConsolePicks;
    }

    private createPick(session: IDebugSession, filter: ReturnType<typeof prepareQuery>): QuickAccessItem | undefined {
        const label = session.name;
        const highlights = fuzzyMatchPrepared(filter, label);
        if (highlights) {
            return {
                label,
                labelMatchRanges: toMatchRanges(highlights.matchedIndices),
                accept: () => {
                    void this.debugService.focusStackFrame(undefined, undefined, session, { explicit: true });
                    showReplIfHidden(this.views);
                },
            };
        }
        return undefined;
    }
}
