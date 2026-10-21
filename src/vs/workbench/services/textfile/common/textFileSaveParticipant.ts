import type { IRange } from "../../../../editor/common/core/iRange.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { ITextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import { createTextEdit } from "../../../../editor/common/core/iTextEdit.ts";

import type { ISaveEdit, ISaveSnapshot, SaveParticipant } from "./iSaveParticipant.ts";
import type { TextFileModel } from "./textFileModel.ts";

/**
 * Per participant. Same order of magnitude as language RPCs (5000 for a cold language server): a silent
 * participant behind an RPC to the host must not hang the save.
 */
const SAVE_PARTICIPANT_TIMEOUT_MS = 5000;

/** On timeout resolves to an empty edit set (save as is). */
function raceSaveParticipantTimeout(run: Promise<readonly ISaveEdit[]>): Promise<readonly ISaveEdit[]> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            // Stryker disable next-line ArrayDeclaration: the empty set is the timeout contract; a stray element without a valid kind is silently filtered out by the applySaveEdits gates anyway
            resolve([]);
        }, SAVE_PARTICIPANT_TIMEOUT_MS);
        run.then(
            (edits) => {
                clearTimeout(timer);
                resolve(edits);
            },
            (err: unknown) => {
                clearTimeout(timer);
                reject(err instanceof Error ? err : new Error(String(err)));
            },
        );
    });
}

/**
 * Counterpart of `TextFileSaveParticipant`. Participants run sequentially and each gets a FRESH
 * snapshot: the previous one may have edited the buffer (code actions are applied by the
 * subprocess via `workspace.applyEdit` right during the await).
 */
export class TextFileSaveParticipant {
    public constructor(private readonly participants: (model: TextFileModel) => readonly SaveParticipant[]) {}

    /**
     * `null`: no participants, so the write happens in the same tick without a single await. On
     * timeout saves as is (like VS Code); edits arriving later leave the buffer dirty.
     */
    public participate(model: TextFileModel): Promise<void> | null {
        const participants = this.participants(model);
        return participants.length > 0 ? this.run(model, participants) : null;
    }

    private async run(model: TextFileModel, participants: readonly SaveParticipant[]): Promise<void> {
        const document = model.document;
        for (const participant of participants) {
            const snapshot: ISaveSnapshot = {
                uri: model.uri.toString(),
                languageId: document.languageId,
                versionId: document.versionId,
                isDirty: model.isModified,
                // Full text only if the participant reads it: almost none do (extension will-save
                // reads the mirror), and a whole-file string per participant costs memory proportional to the file.
                get text() {
                    return document.getText();
                },
                eol: model.document.eol,
                encoding: model.encoding,
            };
            try {
                const edits = await raceSaveParticipantTimeout(participant(snapshot));
                applySaveEdits(model, edits);
            } catch {
                // A failing participant does not block the write; the next one runs as usual.
            }
        }
    }
}

/**
 * Edits are clamped to the current bounds (the user may have typed during the await) and
 * go in as one undoable batch; EOL goes as a separate undoable element.
 */
function applySaveEdits(model: TextFileModel, edits: readonly ISaveEdit[]): void {
    const textEdits: ITextEdit[] = [];
    for (const edit of edits) {
        if (edit.kind === "text") {
            textEdits.push(createTextEdit(clampRange(model, edit.range), edit.text));
        }
    }
    // An empty batch changes neither text nor history (`applyEdits` rejects it); the guard
    // only saves a redundant repaint, so the mutant is unobservable.
    // Stryker disable next-line ConditionalExpression,EqualityOperator: equivalent, see above
    if (textEdits.length > 0) {
        model.applyExternalEdits(textEdits, "editorconfig: pre-save");
    }
    for (const edit of edits) {
        if (edit.kind === "eol") model.setEol(edit.eol);
    }
}

function clampRange(model: TextFileModel, range: IRange): IRange {
    const start = clampPosition(model, range.start.line, range.start.character);
    const end = clampPosition(model, range.end.line, range.end.character);
    return createRange(start.line, start.character, end.line, end.character);
}

function clampPosition(model: TextFileModel, line: number, character: number): { line: number; character: number } {
    const clampedLine = Math.min(Math.max(line, 0), model.document.lineCount - 1);
    const clampedChar = Math.min(Math.max(character, 0), model.document.getLineLength(clampedLine));
    return { line: clampedLine, character: clampedChar };
}
