import { Emitter } from "../../../base/common/event.ts";
import { Disposable, type IDisposable } from "../../../base/common/lifecycle.ts";
import type { Uri } from "../../../base/common/uri.ts";
import type { EndOfLine } from "../../../editor/common/core/endOfLine.ts";
import { createSelection, type ISelection } from "../../../editor/common/core/iSelection.ts";
import type { ITextEdit } from "../../../editor/common/core/iTextEdit.ts";
import type { ILanguageService } from "../../../editor/common/languages/iLanguageService.ts";
import type { IDocumentLanguageChange } from "../../../editor/common/model/iDocumentLanguageChange.ts";
import type { IUndoElement } from "../../../editor/common/model/iUndoElement.ts";
import { TextDocument, type TextSource } from "../../../editor/common/model/textDocument.ts";
import type { IUndoViewBinding, UndoStepToken } from "../../../editor/common/model/undoManager.ts";
import { UndoManager } from "../../../editor/common/model/undoManager.ts";
import type { ICursorStateComputer } from "../../../editor/common/viewModel/trackedSelections.ts";
import type { IUndoRedoElement } from "../../../platform/undoRedo/common/iUndoRedoElement.ts";
import type { UndoRedoService } from "../../../platform/undoRedo/common/undoRedoService.ts";

let nextUndoContextId = 1;

const BUFFER_ENCODING = "utf8";

/**
 * Why "Enable Editing" did not happen ({@link BaseTextEditorModel.enableEditing}): the file holds more than a string
 * can (`too-large`), would not fit the memory left (`out-of-memory`), or could not be read (`read-failed`).
 * `cancelled` is silent: the model was reloaded or closed while the file streamed in.
 */
export type EnableEditingRefusal = "too-large" | "out-of-memory" | "read-failed" | "cancelled";

/**
 * Model edits go through the acting view's view state, which holds selections and the
 * inverse edits for undo. There can be several targets (a document in several groups):
 * the caller passes the acting one, and `markDirty` is broadcast to all.
 */
export interface ITextEditTarget {
    cloneSelections(): ISelection[];
    applyEdits(
        edits: readonly ITextEdit[],
        label: string,
        computeCursorState?: ICursorStateComputer,
    ): IUndoElement | undefined;
    markDirty(): void;
}

/** Upstream `TextEditor.edit` options: without a stop on either side of it, two edits are one undo step. */
export interface IUndoStops {
    readonly undoStopBefore?: boolean;
    readonly undoStopAfter?: boolean;
}

export abstract class BaseTextEditorModel extends Disposable {
    /**
     * One for the model's whole lifetime: a reload replaces the text inside it ({@link replaceText})
     * instead of swapping the object, so views, tokens and extensions see it as a regular edit.
     */
    protected readonly doc: TextDocument;
    /**
     * Relaying document events waits until {@link replaceText} reconciles the
     * "saved" version; otherwise a subscriber would see the fresh text as unsaved.
     */
    private replacingText = false;
    /** The text coming in is the file's: the document is clean already while its events go out. */
    private loadingFromDisk = false;
    /** Version after an edit with `undoStopAfter: false`: the next edit may join its step. */
    private openUndoStepVersion: number | null = null;
    private readonly onDidChangeLanguageEmitter = this.register(new Emitter<IDocumentLanguageChange>());
    private readonly onDidChangeEolEmitter = this.register(new Emitter<void>());
    private readonly onDidChangeContentEmitter = this.register(new Emitter<void>());
    private readonly onDidChangeTooLargeForTokenizationEmitter = this.register(new Emitter<void>());
    private readonly onDidMarkSavedEmitter = this.register(new Emitter<void>());
    /**
     * Upstream `TextModel._isTooLargeForTokenization`: decided once, when the file is first loaded
     * (`largeFileOptimizations` and the thresholds), and kept through reloads — "permanently respect this
     * decision". Our deviation: the file also opens read-only, and {@link forcefullyEnableFeatures} is the
     * only way out (upstream's "Forcefully Enable Features" turns the setting off and asks to reopen).
     */
    private tooLargeForTokenization = false;
    protected uriValue: Uri;
    protected savedVersionId = 0;
    protected savedEol: EndOfLine;
    protected readonly languageService: ILanguageService;
    private readonly undoRedoService: UndoRedoService;
    /** The first one is the default target for programmatic paths with no acting view (a save participant). */
    private editTargets: ITextEditTarget[] = [];
    /** One history per document, however many views show it. */
    private readonly undoManagerValue: UndoManager;
    /**
     * Lives only for the synchronous window of the call: the wrapper element in `UndoRedoService`
     * runs before the first await inside `undo(context)`.
     */
    private actingView: IUndoViewBinding | null = null;
    /** When not `null`, steps go to the caller of {@link applyExternalEditsDetached} instead of the shared bucket. */
    private detachedUndoSteps: IUndoRedoElement[] | null = null;

    /**
     * Deliberately NOT a path or uri: with paths, all untitled buffers collapsed into one shared
     * `"untitled"` bucket, and `saveAs` orphaned the accumulated history. There is one model per
     * document, so split views share history through it.
     */
    // Ids stay unique when counting down too (0, -1, …), so the mutant is unobservable.
    // Stryker disable next-line UpdateOperator: equivalent, see above
    public readonly undoContext = `editor-${nextUndoContextId++}`;

    public readonly onDidChangeContent = this.onDidChangeContentEmitter.event;

    public readonly onDidChangeLanguage = this.onDidChangeLanguageEmitter.event;

    /** Fires on any path: a command, undo/redo, a reload with a different EOL. */
    public readonly onDidChangeEol = this.onDidChangeEolEmitter.event;

    /** The document matches the file again: a save or a reload. No text moved, so no content event says it. */
    public readonly onDidMarkSaved = this.onDidMarkSavedEmitter.event;

    /** Only one transition, true → false ({@link forcefullyEnableFeatures}). */
    public readonly onDidChangeTooLargeForTokenization = this.onDidChangeTooLargeForTokenizationEmitter.event;

    /**
     * The large-file mode: tokenization, wrapping, folding, word highlighting, quick diff and the
     * extension host sync are off, and the file's tabs open read-only.
     */
    public get isTooLargeForTokenization(): boolean {
        return this.tooLargeForTokenization;
    }

    /** A subclass decides on load; the mode never turns on later (as upstream). */
    protected markTooLargeForTokenization(): void {
        this.tooLargeForTokenization = true;
    }

    /**
     * Upstream's "Forcefully Enable Features" for this model only, in the session: the features come back.
     * `false` — the model refused (a document on disk too large for memory, `TextFileModel`); otherwise the
     * mode is off afterwards, whether or not it was on.
     */
    public forcefullyEnableFeatures(): boolean {
        if (!this.tooLargeForTokenization) return true;
        this.tooLargeForTokenization = false;
        this.onDidChangeTooLargeForTokenizationEmitter.fire();
        return true;
    }

    /**
     * "Enable Editing" of the large-file toast: whatever has to happen before the features come back, then
     * {@link forcefullyEnableFeatures}. A model whose text is already in memory has nothing to wait for; a document
     * on disk is streamed into memory first (`TextFileModel`). `null` — the mode is off.
     */
    public enableEditing(): Promise<EnableEditingRefusal | null> {
        this.forcefullyEnableFeatures();
        return Promise.resolve(null);
    }

    protected constructor(languageService: ILanguageService, undoRedoService: UndoRedoService, uri: Uri) {
        super();

        this.languageService = languageService;
        this.undoRedoService = undoRedoService;
        this.uriValue = uri;

        this.doc = new TextDocument("");
        this.savedEol = this.doc.eol;
        this.bindDocumentListeners();
        this.undoManagerValue = this.createUndoManager();

        this.register({
            dispose: () => {
                this.undoRedoService.clear(this.undoContext);
                // The piece tree has nothing to free; the document on disk closes its file and stops indexing.
                this.doc.dispose();
            },
        });
    }

    public get isModified(): boolean {
        if (this.loadingFromDisk) return false;
        return this.doc.versionId !== this.savedVersionId || this.doc.eol !== this.savedEol;
    }

    /** What extensions read as `TextDocument.isDirty`; only an untitled buffer can differ from {@link isModified}. */
    public get isDirtyForExtensions(): boolean {
        return this.isModified;
    }

    /** A buffer that isn't a file has no bytes to decode. */
    public get encoding(): string {
        return BUFFER_ENCODING;
    }

    public get eol(): EndOfLine {
        return this.doc.eol;
    }

    public get document(): TextDocument {
        return this.doc;
    }

    public get languageId(): string {
        return this.doc.languageId;
    }

    public setLanguage(languageId: string): void {
        this.doc.setLanguage(languageId);
    }

    public get uri(): Uri {
        return this.uriValue;
    }

    public getText(): string {
        return this.doc.getText();
    }

    /** The disposable detaches the target when the view closes before the model (splits). */
    public attachEditTarget(target: ITextEditTarget): IDisposable {
        this.editTargets.push(target);
        return {
            dispose: () => {
                const i = this.editTargets.indexOf(target);
                if (i >= 0) this.editTargets.splice(i, 1);
            },
        };
    }

    /**
     * A model without a view (`openTextDocument` without a tab) has nobody to track selections: it only applies
     * edits (`markDirty` is broadcast to the attached views, selections are read from them).
     */
    private readonly headlessEditTarget: Pick<ITextEditTarget, "applyEdits"> = {
        applyEdits: (edits, label) => {
            const versionBefore = this.doc.versionId;
            const { appliedVersion, inverseEdits } = this.doc.applyEdits(edits);
            const selections = [createSelection(0, 0, 0, 0)];
            return {
                label,
                versionBefore,
                versionAfter: appliedVersion,
                forwardEdits: edits,
                backwardEdits: inverseEdits,
                beforeSelections: selections,
                afterSelections: selections,
            };
        },
    };

    public get undoManager(): UndoManager {
        return this.undoManagerValue;
    }

    protected broadcastMarkDirty(): void {
        for (const target of [...this.editTargets]) target.markDirty();
    }

    /** `IUndoRedoElement.resources`: empty for a buffer with no file on disk. */
    protected get undoResources(): string[] {
        return [];
    }

    /**
     * Each step registers an ordering token wrapper in `UndoRedoService`; its undo/redo
     * delegate to {@link UndoManager} (LIFO 1:1, so the stacks stay in step).
     */
    private createUndoManager(): UndoManager {
        const undoManager = new UndoManager(this.doc);
        undoManager.onDidPush = (element) => {
            const wrapper = this.wrapUndoStep(element.label);
            // Otherwise one workspace edit would take as many Ctrl+Z presses as documents it touched.
            if (this.detachedUndoSteps !== null) {
                this.detachedUndoSteps.push(wrapper);
                return;
            }
            this.undoRedoService.pushElement(wrapper, this.undoContext);
        };
        return undoManager;
    }

    private resetUndoHistory(): void {
        this.undoRedoService.clear(this.undoContext, "replaced");
        this.undoManagerValue.clear();
    }

    /** Multi-document steps that touched the file before its buffer was opened also go into its history. */
    protected adoptWorkspaceUndo(resource: string, label: string): void {
        this.undoRedoService.adopt(this.undoContext, resource, label);
    }

    /**
     * A streamed save passes the version and EOL its snapshot was taken at: edits typed while the bytes were being
     * written are not in the file and keep the buffer modified.
     */
    protected markSaved(versionId = this.doc.versionId, eol = this.doc.eol): void {
        this.savedVersionId = versionId;
        this.savedEol = eol;
        this.onDidMarkSavedEmitter.fire();
    }

    /**
     * Afterwards the buffer has no history and is clean, except with `unsaved` — text not from disk
     * (edits that followed a moved file): the previous version stays the "saved" one.
     */
    protected replaceText(text: TextSource, { unsaved = false }: { unsaved?: boolean } = {}): void {
        const eolBefore = this.doc.eol;
        this.replacingText = true;
        this.loadingFromDisk = !unsaved;
        try {
            this.doc.setText(text);
        } finally {
            this.replacingText = false;
            this.loadingFromDisk = false;
        }
        if (!unsaved) this.markSaved();
        this.resetUndoHistory();
        this.onDidChangeContentEmitter.fire();
        if (this.doc.eol !== eolBefore) this.onDidChangeEolEmitter.fire();
    }

    /**
     * Text the file gained at its end (follow, OpenPerformance 4.4): the document stays clean, and the undo
     * history stays too — its steps are all before the old end.
     */
    protected appendFromDisk(text: string): void {
        this.replacingText = true;
        this.loadingFromDisk = true;
        try {
            this.doc.appendText(text);
        } finally {
            this.replacingText = false;
            this.loadingFromDisk = false;
        }
        this.markSaved();
        this.onDidChangeContentEmitter.fire();
    }

    /**
     * The step token answers "will MY step be the one undone" ({@link IUndoRedoElement.canUndo});
     * on undo/redo the entry moves to the other stack as a new object, so the token re-reads it.
     */
    private wrapUndoStep(label: string): IUndoRedoElement {
        let undoToken = this.undoManagerValue.peekUndoStep();
        let redoToken: UndoStepToken | undefined;
        return {
            label,
            resources: this.undoResources,
            canUndo: () => this.undoManagerValue.canUndoStep(undoToken),
            canRedo: () => this.undoManagerValue.canRedoStep(redoToken),
            undo: () => {
                this.undoManagerValue.undo(this.actingView);
                redoToken = this.undoManagerValue.peekRedoStep();
                this.broadcastMarkDirty();
            },
            redo: () => {
                this.undoManagerValue.redo(this.actingView);
                undoToken = this.undoManagerValue.peekUndoStep();
                this.broadcastMarkDirty();
            },
        };
    }

    /** EOL is a "modified" axis separate from content ({@link isModified}). */
    public setEol(eol: EndOfLine, target?: ITextEditTarget): void {
        const previous = this.doc.eol;
        if (previous === eol) return;

        const acting = target ?? this.editTargets.at(0);
        const selections = acting?.cloneSelections() ?? [];
        const version = this.doc.versionId;
        this.doc.setEol(eol);
        this.undoManagerValue.pushUndoElement({
            label: "Change End of Line Sequence",
            versionBefore: version,
            versionAfter: this.doc.versionId,
            // The step doesn't touch text: undo/redo run backwardEdits, and an EOL step's
            // forwardEdits never run, so the array mutant is unobservable.
            // Stryker disable next-line ArrayDeclaration: equivalent, see above
            forwardEdits: [],
            backwardEdits: [],
            beforeSelections: selections,
            afterSelections: selections,
            eolBefore: previous,
            eolAfter: eol,
        });
        this.broadcastMarkDirty();
    }

    /**
     * One undo step. Only `target` recomputes selections exactly; other views remap on
     * the document event. Without `computeCursorState` selections shift along with the edits.
     */
    public applyExternalEdits(
        edits: readonly ITextEdit[],
        label: string,
        target?: ITextEditTarget,
        computeCursorState?: ICursorStateComputer,
        undoStops: IUndoStops = {},
    ): void {
        const acting = target ?? this.editTargets.at(0) ?? this.headlessEditTarget;
        const joins = undoStops.undoStopBefore === false && this.openUndoStepVersion === this.doc.versionId;
        const element = acting.applyEdits(edits, label, computeCursorState);
        if (element) {
            if (joins) this.undoManagerValue.joinUndoElement(element);
            else this.undoManagerValue.pushUndoElement(element);
        }
        this.openUndoStepVersion = undoStops.undoStopAfter === false ? this.doc.versionId : null;
        this.broadcastMarkDirty();
    }

    /**
     * Upstream's `popUndoStop` + `executeEdits`: the edits join the top undo step, so one undo takes back both
     * them and whatever made that step. Selections shift along with the edits.
     */
    public applyEditsIntoLastUndoStep(edits: readonly ITextEdit[], label: string, target?: ITextEditTarget): void {
        const acting = target ?? this.editTargets.at(0) ?? this.headlessEditTarget;
        const element = acting.applyEdits(edits, label);
        if (element) this.undoManagerValue.joinUndoElement(element);
        this.broadcastMarkDirty();
    }

    /**
     * The step doesn't go into the shared `UndoRedoService`: bulk edit makes one step for the whole
     * `workspace.applyEdit`. It still lands in the document's {@link UndoManager} as usual;
     * otherwise the version gate would discard the document history as stale.
     * `null` means nothing to apply (no view, or the edits changed nothing).
     */
    public applyExternalEditsDetached(
        edits: readonly ITextEdit[],
        label: string,
        target?: ITextEditTarget,
    ): IUndoRedoElement | null {
        const acting = target ?? this.editTargets.at(0) ?? this.headlessEditTarget;
        return this.captureDetachedStep(() => {
            const element = acting.applyEdits(edits, label);
            if (element) this.undoManagerValue.pushUndoElement(element);
        });
    }

    /** {@link setEol} whose step goes to the caller, like {@link applyExternalEditsDetached}. */
    public setEolDetached(eol: EndOfLine, target?: ITextEditTarget): IUndoRedoElement | null {
        return this.captureDetachedStep(() => {
            this.setEol(eol, target);
        });
    }

    private captureDetachedStep(run: () => void): IUndoRedoElement | null {
        const captured: IUndoRedoElement[] = [];
        this.detachedUndoSteps = captured;
        try {
            run();
        } finally {
            this.detachedUndoSteps = null;
        }
        this.broadcastMarkDirty();
        return captured.at(0) ?? null;
    }

    /** `view` is where to restore the selection snapshot. */
    public undo(view?: IUndoViewBinding): void {
        this.actingView = view ?? null;
        try {
            void this.undoRedoService.undo(this.undoContext);
        } finally {
            this.actingView = null;
        }
    }

    public redo(view?: IUndoViewBinding): void {
        this.actingView = view ?? null;
        try {
            void this.undoRedoService.redo(this.undoContext);
        } finally {
            this.actingView = null;
        }
    }

    /**
     * Language features start for every model (like vscode's `requestRichLanguageFeatures`):
     * an extension with `onLanguage:<id>` activates not only for the active editor.
     */
    private bindDocumentListeners(): void {
        this.languageService.requestLanguageFeatures(this.doc.languageId);
        this.register(
            this.doc.onDidChangeLanguage((change) => {
                this.languageService.requestLanguageFeatures(change.newLanguageId);
                this.onDidChangeLanguageEmitter.fire(change);
            }),
        );
        this.register(
            this.doc.onDidChangeEol(() => {
                // A version of its own, but not a text edit: "modified" has a separate EOL axis, and setting the EOL
                // back leaves the document clean.
                if (this.doc.versionId - 1 === this.savedVersionId) this.savedVersionId = this.doc.versionId;
                if (!this.replacingText) this.onDidChangeEolEmitter.fire();
            }),
        );
        this.register(
            this.doc.onDidChangeContent(() => {
                if (!this.replacingText) this.onDidChangeContentEmitter.fire();
            }),
        );
    }
}
