/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/browser/debugSessionPicker.ts
// Debug: Select Debug Session — the sessions, the focused one active, then "Start a New Debug Session". Picking one
// focuses it and shows the Debug Console. Deviation: the picker has no separators, so a child session names its
// parent in the description, the compact ones too (upstream puts those under a separator with the parent's name),
// and there is no line between the roots.

import { codicon } from "../../../../base/common/codicons.ts";
import type { IProductIconService } from "../../../../platform/theme/common/productIconService.ts";
import type { QuickInputService } from "../../../browser/parts/quickinput/quickInputService.ts";
import type { ViewsService } from "../../../browser/parts/views/viewsService.ts";
import type { QuickPickItem } from "../../../common/quickPickItem.ts";
import { type IDebugService, type IDebugSession, REPL_VIEW_ID } from "../common/debug.ts";

export const START_NEW_DEBUG_SESSION = "Start a New Debug Session";

/** Upstream's `openView(REPL_VIEW_ID, true)` of a pick, unless the console is visible. */
export function showReplIfHidden(views: Pick<ViewsService, "isViewShown" | "openView">): void {
    if (!views.isViewShown(REPL_VIEW_ID)) {
        views.openView(REPL_VIEW_ID, true);
    }
}

interface IPickerDebugItem extends QuickPickItem {
    readonly accept: () => void;
}

export interface IDebugSessionPickerServices {
    readonly debugService: IDebugService;
    readonly quickInput: Pick<QuickInputService, "quickPick">;
    readonly icons: Pick<IProductIconService, "glyph">;
    /** Upstream's `openView(REPL_VIEW_ID, true)` unless the console is visible. */
    readonly showRepl: () => void;
    readonly execute: (commandId: string) => void;
}

/** Upstream `showDebugSessionMenu`. */
export async function showDebugSessionMenu(services: IDebugSessionPickerServices, selectAndStartID: string): Promise<void> {
    const { picks, activeIndex } = getPicksAndActiveItem(services, selectAndStartID);
    const picked = (await services.quickInput.quickPick({
        placeholder: "Search debug sessions by name",
        items: picks,
        activeIndex,
    })) as IPickerDebugItem | undefined;
    picked?.accept();
}

function getPicksAndActiveItem(
    services: IDebugSessionPickerServices,
    selectAndStartID: string,
): { picks: IPickerDebugItem[]; activeIndex: number | undefined } {
    const { debugService } = services;
    const debugConsolePicks: IPickerDebugItem[] = [];
    const headerSessions: IDebugSession[] = [];

    const currSession = debugService.getViewModel().focusedSession;
    const sessions = debugService.getModel().getSessions(false);
    let activeIndex: number | undefined;

    sessions.forEach((session) => {
        if (session.compact && session.parentSession) {
            headerSessions.push(session.parentSession);
        }
    });

    sessions.forEach((session) => {
        if (!headerSessions.includes(session)) {
            if (session.getId() === currSession?.getId()) {
                activeIndex = debugConsolePicks.length;
            }
            debugConsolePicks.push(createPick(session, services));
        }
    });

    debugConsolePicks.push({
        icon: services.icons.glyph(codicon("plus")),
        label: START_NEW_DEBUG_SESSION,
        accept: () => {
            services.execute(selectAndStartID);
        },
    });

    return { picks: debugConsolePicks, activeIndex };
}

function createPick(session: IDebugSession, services: IDebugSessionPickerServices): IPickerDebugItem {
    const label = session.configuration.name.length ? session.configuration.name : session.name;
    return {
        label,
        description: session.parentSession?.configuration.name,
        accept: () => {
            void services.debugService.focusStackFrame(undefined, undefined, session, { explicit: true });
            services.showRepl();
        },
    };
}
