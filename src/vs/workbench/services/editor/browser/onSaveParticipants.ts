import { CancellationTokenNone } from "../../../../base/common/cancellation.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange, type IRange } from "../../../../editor/common/core/iRange.ts";
import type { ILanguageFeaturesService } from "../../../../editor/common/services/languageFeatures.ts";
import { getCodeActions } from "../../../../editor/contrib/codeAction/codeAction.ts";
import { formatDocument } from "../../../../editor/contrib/format/format.ts";
import { documentRange } from "../../../../editor/contrib/smartSelect/lineText.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { applyFormattingEdits } from "../../../browser/parts/editor/applyFormattingEdits.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import type { SaveParticipant } from "../../textfile/common/iSaveParticipant.ts";

// Source actions (`editor.codeActionsOnSave`) first, then format: edits land in the buffer BEFORE the write.
// The setting is read at save time.

/** The pane is looked up by the snapshot resource: an inactive tab can be saved too. */
export interface IOnSaveParticipantHost {
    readonly configuration: IConfigurationService;
    readonly languageFeatures: ILanguageFeaturesService;
    paneForUri(uri: string): TextEditorPane | null;
}

/**
 * VS Code shape: `true | "explicit" | "always"` enable a kind (all diode saves are manual, so
 * `"explicit"` ≡ `true`); an array enables all listed kinds. Run order is key order.
 */
export function enabledCodeActionKindsOnSave(configuration: IConfigurationService, languageId?: string): string[] {
    const raw: unknown = configuration.get("editor.codeActionsOnSave", { overrideIdentifier: languageId });
    if (Array.isArray(raw)) {
        return raw.filter((kind): kind is string => typeof kind === "string");
    }
    if (typeof raw !== "object" || raw === null) return [];
    return Object.entries(raw)
        .filter(([, value]) => value === true || value === "explicit" || value === "always")
        .map(([kind]) => kind);
}

/**
 * `only` matches hierarchically in the subprocess (`source.fixAll` includes `source.fixAll.ruff`). The subprocess
 * applies edits via `workspace.applyEdit` during the await, so the next kind reads FRESH text from the pane —
 * the snapshot is stale by then.
 */
export function createCodeActionsOnSaveParticipant(host: IOnSaveParticipantHost): SaveParticipant {
    return async (snapshot) => {
        const target = { uri: Uri.parse(snapshot.uri), languageId: snapshot.languageId };
        if (!host.languageFeatures.codeActionProvider.has(target)) return [];
        for (const kind of enabledCodeActionKindsOnSave(host.configuration, snapshot.languageId)) {
            // Fresh range and version come from the pane: the previous kind's actions may already have edited the buffer.
            const pane = host.paneForUri(snapshot.uri);
            const items = await getCodeActions(
                host.languageFeatures.codeActionProvider,
                target,
                {
                    uri: snapshot.uri,
                    languageId: snapshot.languageId,
                    versionId: pane?.model.document.versionId ?? snapshot.versionId,
                    range: pane !== null ? documentRange(pane.model.document) : textRange(snapshot.text),
                    only: kind,
                },
                // The save pipeline has no cancellation: the participant waits for the response.
                CancellationTokenNone,
            );
            for (const { action, provider } of items) {
                // Disabled actions are not applied (upstream takes `validActions`).
                if (action.disabled !== undefined) continue;
                await provider.applyCodeAction(action.id, { onSave: true });
            }
        }
        return [];
    };
}

/**
 * Formats the fresh text (code actions may have edited the buffer before); a stale response is discarded.
 * No provider/pane — a silent no-op: saving is no place for "no formatter" notifications.
 */
export function createFormatOnSaveParticipant(host: IOnSaveParticipantHost): SaveParticipant {
    return async (snapshot) => {
        if (!host.configuration.get("editor.formatOnSave", { overrideIdentifier: snapshot.languageId })) return [];
        const pane = host.paneForUri(snapshot.uri);
        if (pane === null) return [];
        const versionId = pane.model.document.versionId;
        const target = { uri: Uri.parse(snapshot.uri), languageId: snapshot.languageId };
        const edits = await formatDocument(
            host.languageFeatures,
            target,
            {
                uri: snapshot.uri,
                languageId: snapshot.languageId,
                versionId,
                tabSize: pane.viewState.tabSize,
                insertSpaces: pane.viewState.insertSpaces,
            },
            documentRange(pane.model.document),
            // The version check below discards a stale response; the pipeline has no cancellation of its own.
            CancellationTokenNone,
        );
        if (edits === null || edits.length === 0) return [];
        if (pane.model.document.versionId !== versionId) return [];
        applyFormattingEdits(pane, edits, "Format on Save");
        return [];
    };
}

/** Saving without a tab. */
function textRange(text: string): IRange {
    const lines = text.split("\n");
    return createRange(0, 0, lines.length - 1, lines[lines.length - 1].length);
}
