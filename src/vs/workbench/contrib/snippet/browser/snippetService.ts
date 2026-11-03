import { Disposable, toDisposable } from "../../../../base/common/lifecycle.ts";
import { SnippetController2 } from "../../../../editor/contrib/snippet/browser/snippetController2.ts";
import type { IContextKeyContributor } from "../../../../platform/contextkey/common/contextKeyContributor.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { bindActiveEditor } from "../../../services/editor/browser/activeEditorBinding.ts";
import { EditorServiceDIToken, type IEditorService } from "../../../services/editor/common/editorService.ts";

export const SnippetServiceDIToken = token<SnippetService>("SnippetService");

/**
 * The workbench side of upstream `SnippetController2`: its context keys and commands for the active editor. A session
 * ends when its editor stops being active (upstream's `onDidChangeModel`): the tab closed or another one took over.
 */
export class SnippetService extends Disposable implements IContextKeyContributor {
    public static dependencies = [EditorServiceDIToken] as const;

    public constructor(private readonly group: IEditorService) {
        super();
        this.register(
            bindActiveEditor(group, (editor, store) => {
                if (editor === null) return;
                store.add(
                    toDisposable(() => {
                        SnippetController2.get(editor).cancel();
                    }),
                );
            }),
        );
    }

    public updateContextKeys(contextKeys: ContextKeyService): void {
        const controller = this.controller();
        contextKeys.set("inSnippetMode", controller?.isInSnippet ?? false);
        contextKeys.set("hasNextTabstop", controller?.hasNextTabstop ?? false);
        contextKeys.set("hasPrevTabstop", controller?.hasPrevTabstop ?? false);
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
