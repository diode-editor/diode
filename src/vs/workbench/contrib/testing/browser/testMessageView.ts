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

/** How a message is shown: upstream's `DiffContentProvider`, `MarkdownTestMessagePeek`, `PlainTextMessagePeek`. */
export type TestMessageShow = "diff" | "markdown" | "plain";

/** Upstream's labels of the diff's sides (`testingOutputExpected`, `testingOutputActual`). */
export const EXPECTED_LABEL = "Expected result";
export const ACTUAL_LABEL = "Actual result";

/** The stack's share of the height while the message is shown above it, at least its first frames. */
const MIN_STACK_ROWS = 3;

/** Upstream `ITestMessage.isDiffable` first, then a `MarkdownString`, else the plain text. */
export function messageShow(message: IWireTestMessage): TestMessageShow {
    if (message.expected !== undefined && message.actual !== undefined) return "diff";
    return message.markdown === true ? "markdown" : "plain";
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

/** What the view needs from the workbench. */
export interface ITestMessageViewHost {
    /** Upstream `DiffContentProvider`'s widget: the read-only diff of the two outputs. */
    createDiff(expected: string, actual: string): DiffEditorPane2;
    /** Opens the place in the editor, the keyboard goes there. */
    open(uri: string, position: { readonly line: number; readonly character: number }): void;
    /** Upstream's `FloatingClickMenu` of `testing/message/content`, resolved for the message. */
    contentActions(subject: TestMessageSubject): readonly { readonly label: string; run(): void }[];
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
    private readonly subjectStore = this.register(new DisposableStore());
    private subject: TestMessageSubject | null = null;
    private collapsed = false;

    public constructor(
        private readonly host: ITestMessageViewHost,
        private readonly icons: IProductIconService,
    ) {
        super();
        const provider: ITreeDataProvider<IFrameRow> = {
            getTreeItem: (row) => frameItem(row.frame),
            getChildren: (row) => (row === undefined ? this.frameRows() : []),
            getKey: (row) => String(row.index),
        };
        // A click opens the frame as Enter does: upstream's frame header is a link to its place.
        this.frames = new TreeViewElement(provider, { leftPadding: 1, openOnSingleClick: true });
        this.frames.id = "testMessageStack";
        this.frames.onActivate = (row) => {
            const { uri, position } = row.frame;
            if (uri !== undefined) this.host.open(uri, position ?? { line: 0, character: 0 });
        };
        this.element = new TestMessageLayoutElement(new ScrollBarDecorator(this.frames));
        this.element.id = "testMessage";
    }

    /** Upstream `inspectSubjectHasStack`. */
    public get hasStack(): boolean {
        return this.stack().length > 0;
    }

    public show(subject: TestMessageSubject): void {
        this.subjectStore.clear();
        this.subject = subject;
        this.collapsed = false;
        const message = messageOf(subject);
        let body: TUIElement;
        if (messageShow(message) === "diff") {
            const diff = this.subjectStore.add(this.host.createDiff(message.expected ?? "", message.actual ?? ""));
            body = diff.view;
        } else {
            this.text.setText(messageText(message));
            body = this.text;
        }
        this.element.setParts(this.header(subject), body, this.stack().length);
        void this.frames.refresh().catch(onUnexpectedError);
    }

    /** Nothing shown: the diff goes. */
    public clear(): void {
        this.subjectStore.clear();
        this.subject = null;
    }

    /** Upstream `collapseStack`: every part with a body folds to its header. */
    public collapseStack(): void {
        this.setCollapsed(true);
    }

    private setCollapsed(collapsed: boolean): void {
        const { subject } = this;
        if (subject === null || this.collapsed === collapsed) return;
        this.collapsed = collapsed;
        this.element.setCollapsed(collapsed);
        this.element.setHeader(this.header(subject));
    }

    private stack(): readonly IWireTestMessageStackFrame[] {
        return this.subject === null ? [] : (messageOf(this.subject).stackTrace ?? []);
    }

    private frameRows(): IFrameRow[] {
        return this.stack().map((frame, index) => ({ index, frame }));
    }

    /**
     * Upstream's top frame: its header (the test's label behind a chevron) only with a stack under it; the buttons
     * float over the message in any case.
     */
    private header(subject: TestMessageSubject): TUIElement | null {
        const actions = this.host.contentActions(subject);
        if (!this.hasStack && actions.length === 0) return null;
        const row = new HFlexElement();
        row.id = "testMessageHeader";
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

/** Upstream `CallStackFrame`'s header: the label, then where; a frame without a place is dimmed. */
function frameItem(frame: IWireTestMessageStackFrame): ITreeItem {
    if (frame.uri === undefined) return { label: frame.label, labelColor: "descriptionForeground", collapsible: false };
    const line = frame.position === undefined ? "" : `:${String(frame.position.line + 1)}`;
    const column = frame.position === undefined ? "" : `:${String(frame.position.character + 1)}`;
    return {
        label: frame.label,
        description: `${UriUtils.basename(Uri.parse(frame.uri))}${line}${column}`,
        collapsible: false,
    };
}

/** The header's row, the message under it, the stack at the bottom; a folded message gives its rows to the stack. */
export class TestMessageLayoutElement extends TUIElement {
    private header: TUIElement | null = null;
    private body: TUIElement | null = null;
    private stackRows = 0;
    private collapsed = false;

    public constructor(private readonly stack: TUIElement) {
        super();
    }

    public setParts(header: TUIElement | null, body: TUIElement, stackRows: number): void {
        this.header = header;
        this.body = body;
        this.stackRows = stackRows;
        this.collapsed = false;
        this.sync();
    }

    public setHeader(header: TUIElement | null): void {
        this.header = header;
        this.sync();
    }

    public setCollapsed(collapsed: boolean): void {
        this.collapsed = collapsed;
        this.sync();
    }

    private sync(): void {
        const children: TUIElement[] = [];
        if (this.header !== null) children.push(this.header);
        if (this.body !== null && !this.collapsed) children.push(this.body);
        if (this.stackRows > 0) children.push(this.stack);
        this.setChildren(children);
        this.markDirty();
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
        const showBody = this.body !== null && !this.collapsed;
        const stack =
            this.stackRows === 0
                ? 0
                : showBody
                  ? Math.min(this.stackRows, Math.max(MIN_STACK_ROWS, Math.floor(rest / 2)), rest)
                  : rest;
        if (showBody && this.body !== null)
            this.layoutChild(this.body, 0, y, BoxConstraints.tight(new Size(width, rest - stack)));
        if (stack > 0)
            this.layoutChild(this.stack, 0, size.height - stack, BoxConstraints.tight(new Size(width, stack)));
        return size;
    }
}
