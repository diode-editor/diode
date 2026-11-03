import { Disposable, MutableDisposable, toDisposable } from "../../../../base/common/lifecycle.ts";
import { positionsEqual } from "../../../../editor/common/core/iPosition.ts";
import type {
    CompletionItemProvider,
    ICompletionRequest,
    ICoreCompletionItem,
} from "../../../../editor/common/languages/iCompletionSource.ts";
import {
    type ILanguageFeaturesService,
    LanguageFeaturesServiceDIToken,
} from "../../../../editor/common/services/languageFeatures.ts";
import { SnippetController2 } from "../../../../editor/contrib/snippet/browser/snippetController2.ts";
import type { Choice } from "../../../../editor/contrib/snippet/browser/snippetParser.ts";
import type { IContextKeyContributor } from "../../../../platform/contextkey/common/contextKeyContributor.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import { bindActiveEditor } from "../../../services/editor/browser/activeEditorBinding.ts";
import { EditorServiceDIToken, type IEditorService } from "../../../services/editor/common/editorService.ts";
import { type CompletionService, CompletionServiceDIToken } from "../../suggest/browser/completionService.ts";

export const SnippetServiceDIToken = token<SnippetService>("SnippetService");

/** `vscode.CompletionItemKind.Value`. */
const KIND_VALUE = 11;

/**
 * Upstream `SnippetController2`'s completions of a choice, for one editor: while the session is on a choice, a
 * provider exclusive to the document offers its options; reaching a choice opens the popup with them.
 */
class SnippetChoiceCompletions extends Disposable {
    private currentChoice: Choice | undefined;
    private readonly registration = this.register(new MutableDisposable());
    private readonly provider: CompletionItemProvider = {
        // Stryker disable next-line ArrayDeclaration: a typed character never equals the mutant's string
        triggerCharacters: [],
        // Stryker disable next-line BooleanLiteral: a re-request asks this provider again and gets the same options back
        provideCompletionItems: (request) => Promise.resolve({ items: this.items(request), isIncomplete: false }),
    };

    public constructor(
        private readonly editor: TextEditorPane,
        private readonly controller: SnippetController2,
        private readonly languageFeatures: ILanguageFeaturesService,
        private readonly completion: CompletionService,
    ) {
        super();
        this.register(
            controller.onDidUpdateState(() => {
                this.update();
            }),
        );
    }

    /**
     * Upstream `_handleChoice`. Leaving the choice closes its popup: while the provider is registered, it is the only
     * one asked, so an open popup is the choice's.
     */
    private update(): void {
        const choice = this.controller.activeChoice?.choice;
        if (choice === this.currentChoice) return;
        this.currentChoice = choice;
        if (choice === undefined) {
            this.registration.clear();
            this.completion.close();
            return;
        }
        const { editor } = this;
        this.registration.value ??= this.languageFeatures.completionProvider.register(
            { language: editor.languageId, scheme: editor.uri.scheme, pattern: editor.uri.fsPath, exclusive: true },
            this.provider,
        );
        // After the selection change that brought the session here, as upstream.
        queueMicrotask(() => {
            if (this.currentChoice === choice) void this.completion.showSimpleSuggestions(this.provider);
        });
    }

    /**
     * The options in their order; while the text is one of them, every option's filter text starts with it, so the
     * filter hides none. Upstream answers only at the primary caret.
     */
    private items(request: ICompletionRequest): ICoreCompletionItem[] {
        const active = this.controller.activeChoice;
        const caret = this.editor.viewState.selections[0].active;
        if (active === undefined || !positionsEqual(caret, request)) return [];
        const { choice, range } = active;
        const word = this.editor.viewState.document.getTextInRange(range);
        const isAnyOfOptions = choice.options.some((option) => option.value === word);
        return choice.options.map((option, i) => ({
            label: option.value,
            insertText: option.value,
            kind: KIND_VALUE,
            sortText: "a".repeat(i + 1),
            range,
            ...(isAnyOfOptions ? { filterText: `${word}_${option.value}` } : {}),
            command: { command: "jumpToNextSnippetPlaceholder" },
        }));
    }
}

/**
 * The workbench side of upstream `SnippetController2`: its context keys, commands and choice completions for the
 * active editor. A session ends when its editor stops being active (upstream's `onDidChangeModel`): the tab closed or
 * another one took over.
 */
export class SnippetService extends Disposable implements IContextKeyContributor {
    public static dependencies = [
        EditorServiceDIToken,
        LanguageFeaturesServiceDIToken,
        CompletionServiceDIToken,
    ] as const;

    public constructor(
        private readonly group: IEditorService,
        languageFeatures: ILanguageFeaturesService,
        completion: CompletionService,
    ) {
        super();
        this.register(
            bindActiveEditor(group, (editor, store) => {
                if (editor === null) return;
                const controller = SnippetController2.get(editor);
                store.add(new SnippetChoiceCompletions(editor, controller, languageFeatures, completion));
                store.add(
                    toDisposable(() => {
                        controller.cancel();
                    }),
                );
            }),
        );
    }

    public updateContextKeys(contextKeys: ContextKeyService): void {
        const controller = this.controller();
        const inSnippet = controller?.isInSnippet ?? false;
        contextKeys.set("inSnippetMode", inSnippet);
        // A live session always has a next tab stop: it ends on reaching its last group.
        contextKeys.set("hasNextTabstop", inSnippet);
        contextKeys.set("hasPrevTabstop", controller?.hasPrevTabstop ?? false);
        contextKeys.set("inSnippetChoice", controller?.activeChoice !== undefined);
    }

    /** `jumpToNextSnippetPlaceholder`. */
    public next(): void {
        this.controller()?.next();
    }

    /** `jumpToPrevSnippetPlaceholder`. */
    public prev(): void {
        this.controller()?.prev();
    }

    /** `leaveSnippet`: the primary selection stays. */
    public leave(): void {
        this.controller()?.cancel(true);
    }

    /** `acceptSnippet`. */
    public accept(): void {
        this.controller()?.finish();
    }

    private controller(): SnippetController2 | null {
        const editor = this.group.getActiveEditor();
        return editor === null ? null : SnippetController2.get(editor);
    }
}
