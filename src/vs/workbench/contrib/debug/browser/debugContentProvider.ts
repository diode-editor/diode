/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/common/debugContentProvider.ts
// The content of `debug:` documents: the sources a debug adapter gives by `sourceReference` (the `source` request).
// They open read-only, as every document of a provider here. Deviations: the content goes to the editor service as
// text, so the language comes from the path, not from the answer's `mimeType`; an open document is not reloaded
// (upstream `refreshDebugContent` on a `loadedSource` event); a `debug:` tab is not restored, its session is gone.

import { Disposable } from "../../../../base/common/lifecycle.ts";
import type { Uri as uri } from "../../../../base/common/uri.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { EditorServiceDIToken, type IEditorService } from "../../../services/editor/common/editorService.ts";
import { DEBUG_SCHEME, type IDebugService } from "../common/debug.ts";
import { Source } from "../common/debugSource.ts";

import { DebugServiceDIToken } from "./debugService.ts";

export const DebugContentProviderDIToken = token<DebugContentProvider>("DebugContentProvider");

/** Upstream's end of a session with `debug.closeReadonlyTabsOnEnd`: closes the tabs of its `debug:` documents. */
export function closeSessionEditors(
    editors: Pick<IEditorService, "editorGroups" | "closeEditors">,
    sessionId: string,
): void {
    // Copy the list: a group that becomes empty leaves it right inside the loop.
    for (const group of [...editors.editorGroups.groups]) {
        // Only a `debug:` document has a session.
        const panes = group.getPanes().filter((pane) => Source.getEncodedDebugData(pane.uri).sessionId === sessionId);
        // Read-only tabs ask for no confirmation.
        void editors.closeEditors(group, panes);
    }
}

export class DebugContentProvider extends Disposable {
    public static dependencies = [DebugServiceDIToken, EditorServiceDIToken] as const;

    public constructor(
        private readonly debugService: IDebugService,
        editors: Pick<IEditorService, "registerDocumentSource">,
    ) {
        super();
        this.register(editors.registerDocumentSource(DEBUG_SCHEME, (resource) => this.provideTextContent(resource)));
    }

    public async provideTextContent(resource: uri): Promise<string> {
        // Without `?session=` in the query the session id is undefined, and the fallback is the focused session.
        const session =
            this.debugService.getModel().getSession(Source.getEncodedDebugData(resource).sessionId) ??
            this.debugService.getViewModel().focusedSession;

        if (!session) {
            throw new Error("Unable to resolve the resource without a debug session");
        }
        const createErrModel = (errMsg?: string): string => {
            this.debugService.sourceIsNotAvailable(resource);
            return errMsg
                ? `Could not load source '${resource.path}': ${errMsg}.`
                : `Could not load source '${resource.path}'.`;
        };

        let response: DebugProtocol.SourceResponse | undefined;
        try {
            response = await session.loadSource(resource);
        } catch (err) {
            return createErrModel((err as DebugProtocol.ErrorResponse).message);
        }
        return response?.body ? response.body.content : createErrModel();
    }
}
