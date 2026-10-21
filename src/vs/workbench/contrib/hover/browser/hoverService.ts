import { LatestRequest } from "../../../../base/common/cancellation.ts";
import { Disposable } from "../../../../base/common/lifecycle.ts";
import { EditorElement } from "../../../../editor/browser/editorElement.ts";
import type { ILanguageFeaturesService } from "../../../../editor/common/services/languageFeatures.ts";
import { LanguageFeaturesServiceDIToken } from "../../../../editor/common/services/languageFeatures.ts";
import type { IContextKeyContributor } from "../../../../platform/contextkey/common/contextKeyContributor.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { bindActiveEditor } from "../../../services/editor/browser/activeEditorBinding.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import type { FocusTracker } from "../../../services/focus/browser/focusTracker.ts";
import { FocusTrackerDIToken } from "../../../services/focus/browser/focusTracker.ts";

import { getHovers } from "./getHover.ts";
import type { HoverComponent } from "./hoverComponent.ts";
import { HoverComponentDIToken } from "./hoverComponent.ts";

// Stryker disable next-line StringLiteral: token() returns a new Token and dependencies resolve by reference to it; the string inside is only a debug label
export const HoverServiceDIToken = token<HoverService>("HoverService");

/** There's no markdown renderer (docs/arch/Extensions.md#lsp-и-стоковые-клиенты), so the popup gets plain text. */
export function stripMarkdown(value: string): string {
    // Escaped characters are hidden FIRST (the stripSnippetPlaceholders trick):
    // otherwise `\*text\*` would be parsed along the way as "italic".
    // Stryker disable next-line ArrayDeclaration: the hidden-chars accumulator; the seed is overwritten by the first entry, and without escaped characters it's never read
    const escaped: string[] = [];
    const hidden = value.replace(/\\([\\`*_{}[\]()#+\-.!])/g, (_all, char: string) => {
        escaped.push(char);
        return "\u0000" + String(escaped.length - 1) + "\u0000";
    });
    return (
        hidden
            .replace(/```[^\n]*\n([\s\S]*?)\n?```/g, "$1")
            .replace(/`([^`]+)`/g, "$1")
            .replace(/\*\*([^*]+)\*\*/g, "$1")
            .replace(/__([^_]+)__/g, "$1")
            .replace(/\*([^*]+)\*/g, "$1")
            // `_italic_` only at a word boundary, as in CommonMark: inside
            // `aws_instance` or `snake_case` underscores stay.
            .replace(/(^|[^\p{L}\p{N}_])_([^_\s](?:[^_]*[^_\s])?)_(?![\p{L}\p{N}_])/gu, "$1$2")
            .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
            // eslint-disable-next-line no-control-regex -- \u0000 is the very marker used above to hide escaped characters
            .replace(/\u0000(\d+)\u0000/g, (_all, index: string) => escaped[Number(index)])
            .trim()
    );
}

const THEMATIC_BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
/** A fenced-block fence: inside it `---` is content (YAML), not a separator. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Empty sections are kept: they show the separator was at the edge. `---` right below a paragraph
 * line is a setext heading underline (CommonMark), not a separator.
 */
export function splitMarkdownSections(value: string): string[] {
    const sections: string[][] = [[]];
    let fence: string | null = null;
    let paragraph = false;
    for (const line of value.split("\n")) {
        const current = sections[sections.length - 1];
        const opener = FENCE.exec(line)?.[1];
        const ruler = THEMATIC_BREAK.exec(line)?.[1];
        if (fence !== null) {
            // Stryker disable next-line MethodExpression: a fence is one character repeated, so startsWith ≡ endsWith
            if (opener?.startsWith(fence[0]) === true && opener.length >= fence.length) fence = null;
            current.push(line);
            paragraph = false;
        } else if (opener !== undefined) {
            // `paragraph` is reset by the very first line inside the block (the branch above).
            fence = opener;
            current.push(line);
        } else if (ruler !== undefined) {
            if (!(paragraph && ruler === "-")) sections.push([]);
            paragraph = false;
        } else {
            current.push(line);
            paragraph = line.trim() !== "";
        }
    }
    return sections.map((lines) => stripMarkdown(lines.join("\n")));
}

/** The caller drops empty sections. */
function hoverBlocks(contents: readonly string[]): string[] {
    const blocks: string[] = [];
    for (const content of contents) {
        const [first, ...rest] = splitMarkdownSections(content);
        const tail = blocks.pop() ?? "";
        blocks.push([tail, first].filter((text) => text !== "").join("\n\n"), ...rest);
    }
    return blocks;
}

export class HoverService extends Disposable implements IContextKeyContributor {
    public static dependencies = [
        HoverComponentDIToken,
        EditorServiceDIToken,
        FocusTrackerDIToken,
        LanguageFeaturesServiceDIToken,
    ] as const;

    private readonly latest = new LatestRequest();

    public constructor(
        private readonly component: HoverComponent,
        private readonly group: IEditorService,
        focusTracker: FocusTracker,
        private readonly languageFeatures: ILanguageFeaturesService,
    ) {
        super();
        this.register(
            focusTracker.onDidChangeFocus((active) => {
                if (!(active instanceof EditorElement) && this.isOpen()) this.close();
            }),
        );
        this.register(
            bindActiveEditor(this.group, (editor, store) => {
                // In the app an editor change comes with a focus change; this close is
                // for a programmatic change without focus (session restore, split).
                // Stryker disable next-line CallExpression: see above
                this.close();
                if (editor === null) return;
                // The cursor subscription is enough for edits too: an edit moves or recomputes
                // the cursor in the same tick.
                store.add(
                    editor.onDidChangeCursorPosition(() => {
                        // Stryker disable next-line ConditionalExpression: close() on a closed popup is a no-op, so the check saves a call rather than changing behavior
                        if (this.isOpen()) this.close();
                    }),
                );
            }),
        );
    }

    public async showHover(): Promise<void> {
        const editor = this.group.getActiveEditor();
        if (editor === null) return;

        const caret = editor.viewState.selections[0].active;
        const ticket = this.latest.start();
        const hovers = await getHovers(
            this.languageFeatures.hoverProvider,
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
        if (ticket.isStale()) return;

        const blocks = hovers.flatMap((hover) => hoverBlocks(hover.contents)).filter((block) => block !== "");
        if (blocks.length === 0) return;

        // The cursor may have moved during the await, so take the current anchor.
        const anchor = editor.getCaretAnchor();
        if (anchor === null) return;

        this.component.setBlocks(blocks);
        this.component.openAt(anchor);
    }

    public isOpen(): boolean {
        return this.component.isOpen();
    }

    public close(): void {
        this.component.close();
        this.latest.cancel();
    }

    public updateContextKeys(contextKeys: ContextKeyService): void {
        contextKeys.set("editorHoverVisible", this.isOpen());
    }
}
