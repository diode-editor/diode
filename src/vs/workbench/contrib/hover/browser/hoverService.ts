import { LatestRequest } from "../../../../base/common/cancellation.ts";
import { Disposable } from "../../../../base/common/lifecycle.ts";
import { EditorElement } from "../../../../editor/browser/editorElement.ts";
import { rangeContainsPosition } from "../../../../editor/common/core/iRange.ts";
import type { ILanguageFeaturesService } from "../../../../editor/common/services/languageFeatures.ts";
import { LanguageFeaturesServiceDIToken } from "../../../../editor/common/services/languageFeatures.ts";
import type { IContextKeyContributor } from "../../../../platform/contextkey/common/contextKeyContributor.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { markerOriginLabel } from "../../../../platform/markers/common/iMarker.ts";
import type { MarkerService } from "../../../../platform/markers/common/markerService.ts";
import { MarkerServiceDIToken } from "../../../../platform/markers/common/markerService.ts";
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

const THEMATIC_BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
/** A fenced-block fence: inside it `---` is content (YAML), not a separator. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
/** An ATX heading's opening `#`s (CommonMark: up to 3 spaces of indent, 1 to 6 `#`, then a space or the line end). */
const ATX_HEADING = /^ {0,3}#{1,6}(?:[ \t]+|$)/;
/** The optional closing `#`s: preceded by a space (or alone), so `C#` keeps its `#`. */
const ATX_CLOSING = /(?:^|[ \t]+)#+[ \t]*$/;

/** The closing fence is of the opener's kind and no shorter. */
function closesFence(opener: string | undefined, fence: string): boolean {
    // Stryker disable next-line MethodExpression: a fence is one character repeated, so startsWith ≡ endsWith
    return opener?.startsWith(fence[0]) === true && opener.length >= fence.length;
}

/** `#### Person` from the YAML server is the text `Person`; a `# comment` inside a fenced block stays. */
function stripHeadings(value: string): string {
    let fence: string | null = null;
    return value
        .split("\n")
        .map((line) => {
            const opener = FENCE.exec(line)?.[1];
            if (fence !== null) {
                if (closesFence(opener, fence)) fence = null;
                return line;
            }
            if (opener !== undefined) {
                fence = opener;
                return line;
            }
            return ATX_HEADING.test(line) ? line.replace(ATX_HEADING, "").replace(ATX_CLOSING, "") : line;
        })
        .join("\n");
}

/** CommonMark raw HTML (§6.6) whitespace: spaces or tabs with at most one line ending (a tag wraps inside a paragraph). */
// Unambiguous (a run of spaces matches one way only), so a long run with no `>` doesn't backtrack.
const HTML_OPTIONAL_SPACE = String.raw`[ \t]*(?:\n[ \t]*)?`;
const HTML_SPACE = String.raw`(?=[ \t\n])${HTML_OPTIONAL_SPACE}`;
const HTML_ATTRIBUTE = String.raw`${HTML_SPACE}[A-Za-z_:][\w.:-]*(?:${HTML_OPTIONAL_SPACE}=${HTML_OPTIONAL_SPACE}(?:[^"'=<>\x60\s]+|'[^']*'|"[^"]*"))?`;
/** An open tag (`/>` included), a closing tag or a comment; `a < b`, `<https://…>` and `<user@host>` are not tags. */
const HTML_TAG = new RegExp(
    [
        String.raw`<[A-Za-z][A-Za-z0-9-]*(?:${HTML_ATTRIBUTE})*${HTML_OPTIONAL_SPACE}\/?>`,
        String.raw`<\/[A-Za-z][A-Za-z0-9-]*${HTML_OPTIONAL_SPACE}>`,
        String.raw`<!--(?:-?>|[\s\S]*?-->)`,
    ].join("|"),
    "g",
);
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    // A plain space, not U+00A0: the same indent in the terminal, and the popup still wraps there.
    nbsp: " ",
};

/** `&amp;`, `&#39;`, `&#x41;`; an unknown name stays as is, an invalid code point is U+FFFD (CommonMark). */
function decodeEntities(value: string): string {
    return value.replace(
        /&(?:#(\d{1,7}|[xX][\da-fA-F]{1,6})|([A-Za-z]+));/g,
        // `name` is read only when `numeric` didn't match, and then it did.
        (all, numeric: string | undefined, name: string) => {
            if (numeric === undefined) return NAMED_ENTITIES[name] ?? all;
            // `0x41` and `041` are both numbers to Number().
            const code = Number("0" + numeric);
            return code === 0 || code > 0x10ffff ? "\uFFFD" : String.fromCodePoint(code);
        },
    );
}

/**
 * Hides backslash escapes (any ASCII punctuation) and code spans of N backticks (CommonMark §6.1)
 * through `hide`: nothing after this sees their contents.
 */
function hideInline(value: string, hide: (text: string) => string): string {
    let result = "";
    let index = 0;
    while (index < value.length) {
        const char = value[index];
        // At the end of the value `value[index + 1]` is undefined, and "undefined" has no punctuation.
        if (char === "\\" && /[!-/:-@[-`{-~]/.test(value[index + 1])) {
            result += hide(value[index + 1]);
            index += 2;
        } else if (char === "`") {
            let end = index;
            while (value[end] === "`") end += 1;
            const run = value.slice(index, end);
            const close = new RegExp(String.raw`(?<!\x60)${run}(?!\x60)`, "g");
            close.lastIndex = index + run.length;
            const match = close.exec(value);
            if (match === null) {
                result += run;
                index += run.length;
            } else {
                const content = value.slice(index + run.length, match.index);
                const padded = content.startsWith(" ") && content.endsWith(" ") && content.trim() !== "";
                result += hide(padded ? content.slice(1, -1) : content);
                index = match.index + run.length;
            }
        } else {
            result += char;
            index += 1;
        }
    }
    return result;
}

/** There's no markdown renderer (docs/arch/Extensions.md#lsp-и-стоковые-клиенты), so the popup gets plain text. */
export function stripMarkdown(value: string): string {
    // Code and escaped characters are hidden FIRST (the stripSnippetPlaceholders trick): otherwise
    // `\*text\*` would be parsed along the way as "italic" and `Array<string>` in code as a tag.
    // Stryker disable next-line ArrayDeclaration: the hidden-text accumulator; an index is taken after its push, so a seed entry is never read
    const hidden: string[] = [];
    const hide = (text: string): string => {
        hidden.push(text);
        return "\u0000" + String(hidden.length - 1) + "\u0000";
    };
    const fenced = value.replace(/```[^\n]*\n([\s\S]*?)\n?```/g, (_all, content: string) => hide(content));
    const markup = stripHeadings(hideInline(fenced, hide))
        // Tags go, the text between them stays: upstream drops them without supportHtml and sanitizes them with it.
        .replace(HTML_TAG, "")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/__([^_]+)__/g, "$1")
        .replace(/\*([^*]+)\*/g, "$1")
        // `_italic_` only at a word boundary, as in CommonMark: inside
        // `aws_instance` or `snake_case` underscores stay.
        .replace(/(^|[^\p{L}\p{N}_])_([^_\s](?:[^_]*[^_\s])?)_(?![\p{L}\p{N}_])/gu, "$1$2")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
    // Entities after the tags: `&lt;span&gt;` stays the text `<span>`, as upstream.
    return (
        decodeEntities(markup)
            // eslint-disable-next-line no-control-regex -- \u0000 is the very marker used above to hide code and escaped characters
            .replace(/\u0000(\d+)\u0000/g, (_all, index: string) => hidden[Number(index)])
            .trim()
    );
}

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
            if (closesFence(opener, fence)) fence = null;
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
        MarkerServiceDIToken,
    ] as const;

    private readonly latest = new LatestRequest();

    public constructor(
        private readonly component: HoverComponent,
        private readonly group: IEditorService,
        focusTracker: FocusTracker,
        private readonly languageFeatures: ILanguageFeaturesService,
        private readonly markers: MarkerService,
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

        // Upstream `MarkerHoverParticipant`: its ordinal puts the diagnostics above the providers' answers.
        const markerBlocks = this.markers
            .read({ resource: editor.uri.toString() })
            .filter((marker) => rangeContainsPosition(marker.range, caret))
            .map((marker) => `${marker.message} ${markerOriginLabel(marker)}`);
        const blocks = [...markerBlocks, ...hovers.flatMap((hover) => hoverBlocks(hover.contents))].filter(
            (block) => block !== "",
        );
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
