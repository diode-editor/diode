import { LatestRequest } from "../../../../base/common/cancellation.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { ICoreDefinitionLocation } from "../../../../editor/common/languages/iDefinitionSource.ts";
import type { ILanguageFeaturesService } from "../../../../editor/common/services/languageFeatures.ts";
import { LanguageFeaturesServiceDIToken } from "../../../../editor/common/services/languageFeatures.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import {
    EditorStateCancellationTokenSource,
    EditorStateFlag,
} from "../../../browser/parts/editor/editorStateCancellation.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import type { IJumpRecorder } from "../../../services/history/browser/historyService.ts";
import { JumpRecorderDIToken } from "../../../services/history/browser/historyService.ts";

import { getDefinitions } from "./goToSymbol.ts";

export const DefinitionServiceDIToken = token<DefinitionService>("DefinitionService");

export class DefinitionService {
    public static dependencies = [EditorServiceDIToken, JumpRecorderDIToken, LanguageFeaturesServiceDIToken] as const;

    /** A repeated F12 supersedes the previous request: only the latest one jumps. */
    private readonly latest = new LatestRequest();

    public constructor(
        private readonly group: IEditorService,
        private readonly jumps: IJumpRecorder,
        private readonly languageFeatures: ILanguageFeaturesService,
    ) {}

    /**
     * A response after an edit or a cursor move is not applied (upstream `EditorStateCancellationTokenSource`):
     * otherwise a slow provider (jdtls on a cold start) would retroactively carry the user off to another file.
     */
    public async revealDefinition({ toSide = false }: { toSide?: boolean } = {}): Promise<void> {
        const editor = this.group.getActiveEditor();
        if (editor === null) return;

        const state = new EditorStateCancellationTokenSource(editor, EditorStateFlag.Value | EditorStateFlag.Position);
        const ticket = this.latest.start(state.token);
        const caret = editor.viewState.selections[0].active;
        let locations: readonly ICoreDefinitionLocation[];
        // Cleanup of a finished request's subscriptions is unobservable: a forgotten subscription would only
        // cancel a token nobody needs anymore.
        // Stryker disable BlockStatement: see above, the empty-finally mutant
        try {
            locations = await getDefinitions(
                this.languageFeatures.definitionProvider,
                editor,
                {
                    uri: editor.uri.toString(),
                    languageId: editor.languageId,
                    versionId: editor.model.document.versionId,
                    line: caret.line,
                    character: caret.character,
                },
                ticket.token,
            );
        } finally {
            // Stryker disable next-line CallExpression: see above
            state.dispose();
        }
        // Stryker restore BlockStatement
        if (ticket.isStale()) return;
        const target = locations.at(0);
        if (target === undefined) return;
        await this.revealLocation(target, toSide);
    }

    /**
     * `jumpAsync`, not `jump`: a non-disk target (`jdt:`) opens via the scheme provider, and the
     * destination can be recorded only after that, without an intermediate "opened the file at the top".
     */
    private revealLocation(location: ICoreDefinitionLocation, toSide: boolean): Promise<void> {
        return this.jumps.jumpAsync(() => this.doRevealLocation(location, toSide));
    }

    private async doRevealLocation(location: ICoreDefinitionLocation, toSide: boolean): Promise<void> {
        // Don't compare against the `location.uri` string: `Uri` normalizes percent-encoding, and for
        // `jdt:` targets with a huge query the strings NEVER match.
        const uri = Uri.parse(location.uri);
        const key = uri.toString();
        // Open unconditionally, even in the same file: dedup by resource lives in `openUri`.
        await this.group.openUri(uri, toSide ? { group: "beside" } : {});
        const editor = this.group.getActiveEditor();
        // The resource may have failed to open: a non-disk target comes from the scheme provider, which
        // may be missing (the user has already seen a message, see `onDidFailOpen`).
        // Stryker disable next-line OptionalChaining: without an active editor we can't get here, since `revealDefinition` exits before asking providers; `?.` stays as a safeguard for future callers
        if (editor?.uri.toString() !== key) return;
        editor.goToPosition(location.range.start.line, location.range.start.character);
        editor.revealRange(location.range);
    }
}
