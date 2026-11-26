import { LatestRequest } from "../../../../base/common/cancellation.ts";
import type { Uri } from "../../../../base/common/uri.ts";
import type { IPosition } from "../../../../editor/common/core/iPosition.ts";
import { rangeContainsPosition } from "../../../../editor/common/core/iRange.ts";
import { findWordRangeAt } from "../../../../editor/common/core/wordClassification.ts";
import type { ICoreReference } from "../../../../editor/common/languages/iReferenceSource.ts";
import type { ILanguageFeaturesService } from "../../../../editor/common/services/languageFeatures.ts";
import { LanguageFeaturesServiceDIToken } from "../../../../editor/common/services/languageFeatures.ts";
import type { IFileService } from "../../../../platform/files/common/files.ts";
import { IFileServiceDIToken } from "../../../../platform/files/common/files.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IWorkspaceContextService } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import { IWorkspaceContextServiceDIToken } from "../../../../platform/workspace/common/iWorkspaceContextServiceDIToken.ts";
import type { SidebarService } from "../../../browser/parts/sidebar/sidebarService.ts";
import { SidebarServiceDIToken } from "../../../browser/parts/sidebar/sidebarService.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import {
    type TextFileModelService,
    TextFileModelServiceDIToken,
} from "../../../services/textfile/common/textFileModelService.ts";

import { getReferences } from "./getReferences.ts";
import { buildReferenceGroups, type IReferenceGroup, type IReferenceTextSource } from "./referencePreview.ts";
import type { ReferencesComponent } from "./referencesComponent.ts";
import { REFERENCES_VIEWLET_ID, ReferencesComponentDIToken } from "./referencesComponent.ts";

export const ReferencesServiceDIToken = token<ReferencesService>("ReferencesService");

/** No RPC cancellation: a request counter guards against stale responses (as in `CompletionService`/`HoverService`). */
export class ReferencesService {
    public static dependencies = [
        ReferencesComponentDIToken,
        EditorServiceDIToken,
        TextFileModelServiceDIToken,
        IWorkspaceContextServiceDIToken,
        IFileServiceDIToken,
        SidebarServiceDIToken,
        LanguageFeaturesServiceDIToken,
    ] as const;

    private readonly latest = new LatestRequest();

    private readonly textSource: IReferenceTextSource;

    public constructor(
        private readonly component: ReferencesComponent,
        private readonly group: IEditorService,
        models: TextFileModelService,
        private readonly workspaceContext: IWorkspaceContextService,
        providers: IFileService,
        private readonly sidebarService: SidebarService,
        private readonly languageFeatures: ILanguageFeaturesService,
    ) {
        this.textSource = {
            // The open model is the source of truth for open files: it shows
            // unsaved edits, which the server also sees via didChange.
            openText: (uri: Uri) => models.get(uri)?.getText() ?? null,
            readText: async (uri: Uri) => {
                // A go-to target may be off disk (`jdt:`): the file service knows nothing about it.
                const virtual = this.group.virtualDocumentSource;
                if (virtual.canProvide(uri.scheme)) {
                    const text = await virtual.provide(uri);
                    // Stryker disable next-line ConditionalExpression,StringLiteral,CallExpression: no text and a failed read end the same way, the row is dropped
                    if (text === null) throw new Error(`No content for ${uri.toString()}`);
                    return text;
                }
                return new TextDecoder().decode((await providers.readFile(uri)).value);
            },
        };
    }

    /** Cursor not on a word — do nothing: an empty panel would explain nothing. */
    public async findReferences(): Promise<void> {
        const editor = this.group.getActiveEditor();
        if (editor === null) return;
        // No providers for the document — a "No results" panel would lie:
        // nobody even looked for references (in vscode `editorHasReferenceProvider` disables the command).
        const registry = this.languageFeatures.referenceProvider;
        if (!registry.has(editor)) return;

        const caret = editor.viewState.selections[0].active;
        const text = editor.getText();
        if (!isOnWord(text, caret.line, caret.character)) return;

        const ticket = this.latest.start();
        const references = await getReferences(
            registry,
            editor,
            {
                uri: editor.uri.toString(),
                languageId: editor.languageId,
                versionId: editor.model.document.versionId,
                line: caret.line,
                character: caret.character,
                // VS Code shows the declaration as the first list row.
                includeDeclaration: true,
            },
            // Clear and a repeated search cancel the request at the provider too.
            ticket.token,
        );
        if (ticket.isStale()) return;

        const groups = await this.buildGroups(references);
        if (ticket.isStale()) return;

        this.component.setResults(groups);
        this.component.revealResults();
        this.sidebarService.showViewlet(REFERENCES_VIEWLET_ID);
    }

    /**
     * A given set of locations in the panel: the targets of a go-to command or of a code lens. Without `reveal`
     * the panel stays as it is, and F4/Shift+F4 walk the list. An empty list changes nothing: unlike a search
     * there is nothing to report ("No results" is the caller's message).
     * `active` as a position means a location of the active editor containing it.
     */
    public async showLocations(
        title: string,
        locations: readonly ICoreReference[],
        active?: IPosition | ICoreReference,
        options: { readonly reveal: boolean } = { reveal: true },
    ): Promise<void> {
        if (locations.length === 0) return;
        const ticket = this.latest.start();
        const groups = await this.buildGroups(locations);
        if (ticket.isStale()) return;

        this.component.setResults(groups, { title, active: this.resolveActive(locations, active) });
        if (options.reveal) {
            this.component.revealResults();
            this.sidebarService.showViewlet(REFERENCES_VIEWLET_ID);
        }
    }

    private resolveActive(
        locations: readonly ICoreReference[],
        active: IPosition | ICoreReference | undefined,
    ): ICoreReference | undefined {
        if (active === undefined) return undefined;
        const uri = "uri" in active ? active.uri : this.group.getActiveEditor()?.uri.toString();
        const position = "uri" in active ? active.range.start : active;
        return locations.find((location) => location.uri === uri && rangeContainsPosition(location.range, position));
    }

    private buildGroups(references: readonly ICoreReference[]): Promise<IReferenceGroup[]> {
        // `folders.at(0)` is a visible narrowing to single-folder semantics (multi-root is stage C in
        // docs/TODO/MultiRoot.md).
        // Stryker disable next-line StringLiteral: root without an open folder — any string that isn't a prefix of the reference path gives the same result (the path is shown whole)
        const root = this.workspaceContext.getWorkspace().folders.at(0)?.uri.fsPath ?? "";
        return buildReferenceGroups(references, this.textSource, root);
    }

    public clear(): void {
        // A response to an already sent request must not fill the cleared panel.
        this.latest.cancel();
        this.component.clear();
    }
}

function isOnWord(text: string, line: number, character: number): boolean {
    const lineText = text.split("\n").at(line);
    if (lineText === undefined) return false;
    return findWordRangeAt(lineText, character) !== null;
}
