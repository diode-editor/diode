import { Uri } from "../../../../base/common/uri.ts";
import { type ILanguageService, LanguageServiceDIToken } from "../../../../editor/common/languages/iLanguageService.ts";
import {
    type ITokenStyleResolver,
    TokenStyleResolverDIToken,
} from "../../../../editor/common/languages/iTokenStyleResolver.ts";
import {
    type TokenizationRegistry,
    TokenizationRegistryDIToken,
} from "../../../../editor/common/languages/tokenizationRegistry.ts";
import { type IFileService, IFileServiceDIToken } from "../../../../platform/files/common/files.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { type UndoRedoService, UndoRedoServiceDIToken } from "../../../../platform/undoRedo/common/undoRedoService.ts";
import { DiffEditorPane2 } from "../../../browser/parts/editor/diffEditorPane2.ts";
import { EditorServiceDIToken, type IEditorService } from "../../../services/editor/common/editorService.ts";

import { ACTUAL_LABEL, EXPECTED_LABEL } from "./testMessageView.ts";

export const TestMessageDiffFactoryDIToken = token<TestMessageDiffFactory>("TestMessageDiffFactory");

/**
 * Upstream `DiffContentProvider`'s `DiffEditorWidget` in the panel: the expected output against the actual one,
 * read-only snapshots side by side whatever the width (`useInlineViewWhenSpaceIsLimited: false`), the editor's
 * configuration as upstream's `applyEditorMirrorOptions`.
 */
export class TestMessageDiffFactory {
    public static dependencies = [
        LanguageServiceDIToken,
        UndoRedoServiceDIToken,
        IFileServiceDIToken,
        TokenizationRegistryDIToken,
        TokenStyleResolverDIToken,
        EditorServiceDIToken,
    ] as const;

    public constructor(
        private readonly languages: ILanguageService,
        private readonly undoRedo: UndoRedoService,
        private readonly files: IFileService,
        private readonly tokenization: TokenizationRegistry,
        private readonly tokenStyles: ITokenStyleResolver,
        private readonly editors: Pick<IEditorService, "editorConfiguration">,
    ) {}

    public create(expected: string, actual: string): DiffEditorPane2 {
        const pane = new DiffEditorPane2(
            this.languages,
            this.undoRedo,
            this.files,
            this.tokenization,
            this.tokenStyles,
            {
                // Stryker disable next-line ObjectLiteral,StringLiteral: equivalent — the pane is in the panel, not a tab: its uri and label name nothing
                uri: Uri.from({ scheme: "diode-test-message", path: "/diff" }),
                // Stryker disable next-line StringLiteral: equivalent — the pane is in the panel, not a tab: its label is not shown
                label: `${EXPECTED_LABEL} ↔ ${ACTUAL_LABEL}`,
                originalLabel: EXPECTED_LABEL,
                modifiedLabel: ACTUAL_LABEL,
                original: { kind: "snapshot", text: expected },
                modified: { kind: "snapshot", text: actual },
                // Stryker disable next-line StringLiteral: equivalent — an unknown language is plain text too
                languageId: "plaintext",
                modeOverride: "side-by-side",
            },
        );
        for (const side of pane.sidePanes()) this.editors.editorConfiguration.apply(side);
        return pane;
    }
}
