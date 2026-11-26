import { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import { TUIElement } from "@tuidom/core/dom/tuiElement";
import { ButtonElement } from "@tuidom/elements/button/buttonElement";
import { HFlexElement, hflexFill, hflexFit } from "@tuidom/elements/layout/hFlexElement";
import { ScrollBarDecorator } from "@tuidom/elements/scrollbar/scrollContainerElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";
import type { ITreeDataProvider, ITreeItem } from "@tuidom/elements/tree/iTreeDataProvider";
import { TreeViewElement } from "@tuidom/elements/tree/treeViewElement";

import { onUnexpectedError } from "../../../../base/common/errors.ts";
import { Disposable, DisposableStore } from "../../../../base/common/lifecycle.ts";
import { removeAnsiEscapeCodes } from "../../../../base/common/strings.ts";
import { Uri, UriUtils } from "../../../../base/common/uri.ts";
import type { IProductIconService } from "../../../../platform/theme/common/productIconService.ts";
import type { IWireTestMessage, IWireTestMessageStackFrame } from "../../../api/common/testingWireTypes.ts";
import type { DiffEditorPane2 } from "../../../browser/parts/editor/diffEditorPane2.ts";
import { stripMarkdown } from "../../hover/browser/hoverService.ts";

import { TestMessageTextElement } from "./testMessageTextElement.ts";
import type { TestResultsSubject } from "./testResultsOutput.ts";

export type TestMessageSubject = Extract<TestResultsSubject, { readonly kind: "message" }>;

/** Upstream's labels of the diff's sides (`testingOutputExpected`, `testingOutputActual`). */
export const EXPECTED_LABEL = "Expected result";
export const ACTUAL_LABEL = "Actual result";

/** The stack's share of the height while the message is shown above it, at least its first frames. */
const MIN_STACK_ROWS = 3;

/**
 * Upstream `ITestMessage.isDiffable`: with both outputs the message is a diff (`DiffContentProvider`), else its text
 * (`MarkdownTestMessagePeek`, `PlainTextMessagePeek`).
 */
export function messageDiff(message: IWireTestMessage): { readonly expected: string; readonly actual: string } | null {
    const { expected, actual } = message;
    return expected === undefined || actual === undefined ? null : { expected, actual };
}

/**
 * The text of a markdown or a plain message: markdown as the hover draws it (there is no markdown renderer), plain
 * without its ANSI codes (upstream's message model is `removeAnsiEscapeCodes` of it).
 */
export function messageText(message: IWireTestMessage): string {
    return message.markdown === true ? stripMarkdown(message.message) : removeAnsiEscapeCodes(message.message);
}

export function messageOf(subject: TestMessageSubject): IWireTestMessage {
    return subject.test.tasks[subject.taskIndex].messages[subject.messageIndex] as IWireTestMessage;
}

/** A message's identity across refreshes: its run, task, test and index. */
export function messageKey(subject: TestMessageSubject): string {
    return `${subject.result.id}/${String(subject.taskIndex)}/${subject.test.item.extId}/${String(subject.messageIndex)}`;
}

/** What the view needs from the workbench. */
export interface ITestMessageViewHost {
    /** Upstream `DiffContentProvider`'s widget: the read-only diff of the two outputs. */
    createDiff(expected: string, actual: string): DiffEditorPane2;
    /** Opens the place in the editor, the keyboard goes there. */
    open(uri: string, position: { readonly line: number; readonly character: number }): void;
    /** Upstream's `FloatingClickMenu` of `testing/message/content`, resolved for the message. */
    contentActions(subject: TestMessageSubject): readonly { readonly label: string; run(): unknown }[];
}

interface IFrameRow {
    readonly index: number;
    readonly frame: IWireTestMessageStackFrame;
}

/**
 * Upstream `TestResultsViewContent`'s `CallStackWidget` with the message as its top frame: the message's header with
 * the buttons of `testing/message/content`, the message (a diff, markdown or plain text) and the stack's frames, a
 * frame with a place opening it. Deviation: a frame is a row without the code around it (upstream embeds an editor
 * per frame), so Collapse Stack Frames folds the message, the only part with a body.
 */
export class TestMessageView extends Disposable {
    public readonly element: TestMessageLayoutElement;
    public readonly frames: TreeViewElement<IFrameRow>;
    private readonly text = new TestMessageTextElement();
    private readonly textView = verticalScroll(this.text);
    private readonly subjectStore = this.register(new DisposableStore());
    private subject: TestMessageSubject | null = null;
    private body: TUIElement = this.textView;
    // Stryker disable next-line ArrayDeclaration: equivalent — show() sets the stack before the frames are asked for it
    private stack: readonly IWireTestMessageStackFrame[] = [];
    // Stryker disable next-line BooleanLiteral: equivalent — show() unfolds before anything reads it
    private collapsed = false;

    public constructor(
        private readonly host: ITestMessageViewHost,
        private readonly icons: IProductIconService,
    ) {
        super();
        const provider: ITreeDataProvider<IFrameRow> = {
            getTreeItem: (row) => frameItem(row.frame),
            getChildren: () => this.stack.map((frame, index) => ({ index, frame })),
            // Stryker disable next-line ArrowFunction: equivalent — the frames refresh only on show(), which replaces them all; no row is kept
            getKey: (row) => String(row.index),
        };
        // A click opens the frame as Enter does: upstream's frame header is a link to its place.
        this.frames = new TreeViewElement(provider, { leftPadding: 1, openOnSingleClick: true });
        this.frames.onActivate = (row) => {
            const { uri, position } = row.frame;
            if (uri !== undefined) this.host.open(uri, position ?? { line: 0, character: 0 });
        };
        this.element = new TestMessageLayoutElement(verticalScroll(this.frames));
    }

    /** Upstream `inspectSubjectHasStack`. */
    public get hasStack(): boolean {
        return this.stack.length > 0;
    }

    public show(subject: TestMessageSubject): void {
        // Stryker disable next-line CallExpression: hygiene — the replaced diff's models go; nothing shows it any more
        this.subjectStore.clear();
        this.subject = subject;
        this.collapsed = false;
        const message = messageOf(subject);
        this.stack = message.stackTrace ?? [];
        const diff = messageDiff(message);
        if (diff !== null) {
            this.body = this.subjectStore.add(this.host.createDiff(diff.expected, diff.actual)).view;
        } else {
            this.text.setText(messageText(message));
            this.body = this.textView;
        }
        this.layout(subject);
        void this.frames.refresh().catch(onUnexpectedError);
    }

    /** Nothing shown: the diff goes. */
    // Stryker disable next-line BlockStatement: hygiene — the hidden view lets its diff and subject go; show() sets both again
    public clear(): void {
        // Stryker disable next-line CallExpression: hygiene — the hidden diff's models go
        this.subjectStore.clear();
        this.subject = null;
    }

    /** Upstream `collapseStack`: every part with a body folds to its header. */
    public collapseStack(): void {
        this.setCollapsed(true);
    }

    private setCollapsed(collapsed: boolean): void {
        if (this.subject === null) return;
        this.collapsed = collapsed;
        this.layout(this.subject);
    }

    private layout(subject: TestMessageSubject): void {
        this.element.setParts(this.header(subject), this.collapsed ? null : this.body, this.stack.length);
    }

    /**
     * Upstream's top frame: its header (the test's label behind a chevron) only with a stack under it; the buttons
     * float over the message in any case.
     */
    private header(subject: TestMessageSubject): TUIElement | null {
        const actions = this.host.contentActions(subject);
        if (!this.hasStack && actions.length === 0) return null;
        const row = new HFlexElement();
        const chevron = this.icons.codicon(this.collapsed ? "chevron-right" : "chevron-down");
        const label = new TextLabelElement(this.hasStack ? ` ${chevron} ${subject.test.item.label}` : "");
        label.addEventListener("click", () => {
            this.setCollapsed(!this.collapsed);
        });
        row.addChild(label, { width: hflexFill(), height: 1 });
        for (const action of actions) {
            const button = new ButtonElement(action.label);
            button.onActivate = () => {
                action.run();
            };
            row.addChild(button, { width: hflexFit(), height: 1 });
        }
        return row;
    }
}

/** The text wraps and a frame row is cut at the width: a horizontal bar would only take a row. */
function verticalScroll(child: ConstructorParameters<typeof ScrollBarDecorator>[0]): ScrollBarDecorator {
    const decorator = new ScrollBarDecorator(child);
    // Stryker disable next-line StringLiteral: equivalent — the engine shows no bar for an unknown policy; "never" says so
    decorator.horizontalScrollBar = "never";
    return decorator;
}

/** Upstream `CallStackFrame`'s header: the label, then where; a frame without a place is dimmed. */
function frameItem(frame: IWireTestMessageStackFrame): ITreeItem {
    if (frame.uri === undefined) return { label: frame.label, labelColor: "descriptionForeground", collapsible: false };
    const { position } = frame;
    const at = position === undefined ? "" : `:${String(position.line + 1)}:${String(position.character + 1)}`;
    return { label: frame.label, description: `${UriUtils.basename(Uri.parse(frame.uri))}${at}`, collapsible: false };
}

/**
 * The header's row, the message under it, the stack at the bottom; a folded message (no body) gives its rows to the
 * stack.
 */
export class TestMessageLayoutElement extends TUIElement {
    private header: TUIElement | null = null;
    private body: TUIElement | null = null;
    private stackRows = 0;

    public constructor(private readonly stack: TUIElement) {
        super();
    }

    public setParts(header: TUIElement | null, body: TUIElement | null, stackRows: number): void {
        this.header = header;
        this.body = body;
        this.stackRows = stackRows;
        const children = [header, body, stackRows > 0 ? this.stack : null].filter((child) => child !== null);
        this.setChildren(children);
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const size = super.performLayout(constraints);
        const { width } = size;
        let y = 0;
        if (this.header !== null) {
            this.layoutChild(this.header, 0, 0, BoxConstraints.tight(new Size(width, Math.min(1, size.height))));
            y = this.header.layoutSize.height;
        }
        const rest = size.height - y;
        const { body } = this;
        const share = body === null ? rest : Math.max(MIN_STACK_ROWS, Math.floor(rest / 2));
        const stack = Math.min(this.stackRows, share, rest);
        if (body !== null) this.layoutChild(body, 0, y, BoxConstraints.tight(new Size(width, rest - stack)));
        this.layoutChild(this.stack, 0, size.height - stack, BoxConstraints.tight(new Size(width, stack)));
        return size;
    }
}
