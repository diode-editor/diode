/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/common/loadedScriptsPicker.ts
// Debug: Open Loaded Script... — the loaded sources of the sessions: the file's name, its folder, and the picked one
// opens. Deviations: the picker has no separators, so the session's name is the row's hint instead of a header over
// its rows, and the picker's own filter matches the names (upstream matches folders too); a session whose adapter
// has no `loadedSources` request is left out (upstream's request fails, and the picker with it).

import { type Uri, UriUtils } from "../../../../base/common/uri.ts";
import type { QuickInputService } from "../../../browser/parts/quickinput/quickInputService.ts";
import type { QuickPickItem } from "../../../common/quickPickItem.ts";
import type { IDebugService, IDebugSession } from "../common/debug.ts";
import type { Source } from "../common/debugSource.ts";

import type { IBreakpointSources } from "./breakpointsView.ts";

interface IPickerDebugItem extends QuickPickItem {
    readonly accept: () => void;
}

export interface ILoadedScriptsPickerServices {
    readonly debugService: IDebugService;
    readonly quickInput: Pick<QuickInputService, "quickPick">;
    readonly sources: Pick<IBreakpointSources, "uriLabel" | "openSource">;
}

/** Upstream `showLoadedScriptMenu`. */
export async function showLoadedScriptMenu(services: ILoadedScriptsPickerServices): Promise<void> {
    const sessions = services.debugService
        .getModel()
        .getSessions(false)
        .filter((session) => session.capabilities.supportsLoadedSourcesRequest);
    const picks = await Promise.all(sessions.map((session) => getPicksFromSession(session, services)));
    const picked = (await services.quickInput.quickPick({
        placeholder: "Search loaded scripts by name",
        items: picks.flat(),
    })) as IPickerDebugItem | undefined;
    picked?.accept();
}

async function getPicksFromSession(
    session: IDebugSession,
    services: ILoadedScriptsPickerServices,
): Promise<IPickerDebugItem[]> {
    const sources = await session.getLoadedSources();
    return sources.map((source) => createPick(source, session, services));
}

/** The folder of a file as upstream's label service shows it; a `debug:` source's path. */
function folderLabel(uri: Uri, sources: ILoadedScriptsPickerServices["sources"]): string {
    const folder = UriUtils.dirname(uri);
    return uri.scheme === "file" ? sources.uriLabel(folder) : folder.path;
}

function createPick(source: Source, session: IDebugSession, services: ILoadedScriptsPickerServices): IPickerDebugItem {
    const desc = folderLabel(source.uri, services.sources);
    return {
        label: UriUtils.basename(source.uri),
        // The workspace folder itself (upstream: ".").
        description: desc === "" ? undefined : desc,
        hint: session.name,
        accept: () => {
            if (source.available) {
                void services.sources.openSource(source.uri);
            }
        },
    };
}
