import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { InputElement } from "@tuidom/elements/inputbox/inputElement";
import { HFlexElement, hflexFill, hflexFit, hflexFixed } from "@tuidom/elements/layout/hFlexElement";
import { PaddingContainerElement } from "@tuidom/elements/layout/paddingContainerElement";
import { VFlexElement, vflexFill, vflexFixed } from "@tuidom/elements/layout/vFlexElement";
import { ScrollBarDecorator } from "@tuidom/elements/scrollbar/scrollContainerElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";

import { codicon } from "../../../../base/common/codicons.ts";
import { onUnexpectedError } from "../../../../base/common/errors.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import {
    type IProductIconService,
    ProductIconServiceDIToken,
} from "../../../../platform/theme/common/productIconService.ts";
import { Component } from "../../../browser/component.ts";
import { type ViewsService, ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import {
    type DebugStubModel,
    DebugStubModelDIToken,
    type IDebugValue,
    type ReplEntry,
    type ReplSeverity,
} from "../common/debugStubModel.ts";

import { spansLabel, splitRow, valueColor, valueSpans } from "./debugRows.ts";
import { DebugTreeList } from "./debugTreeList.ts";

/** Upstream `REPL_VIEW_ID` and its container. */
export const REPL_CONTAINER_ID = "workbench.panel.repl";
export const REPL_VIEW_ID = "workbench.panel.repl.view";

export const ReplComponentDIToken = token<ReplComponent>("ReplComponent");

type ReplItem = { readonly kind: "entry"; readonly entry: ReplEntry } | { readonly kind: "child"; readonly value: IDebugValue };

const SEVERITY_COLORS: Record<ReplSeverity, string | undefined> = {
    stdout: undefined,
    stderr: "debugConsole.errorForeground",
    info: "debugConsole.infoForeground",
    warning: "debugConsole.warningForeground",
    error: "debugConsole.errorForeground",
};

/** Upstream's input marker of the console (`codicon-debug-console-evaluation-input`). */
const INPUT_ICON = codicon("chevron-right");

/**
 * SPIKE: upstream `Repl` (`repl.ts`, `replViewer.ts`): the output is a tree — plain lines, the echo of an
 * evaluation and its result with expandable children — and an input line under it. Enter evaluates, Up/Down walk
 * the history; the tree follows its tail while the tail is in view.
 */
export class ReplComponent extends Component {
    public static dependencies = [DebugStubModelDIToken, ViewsServiceDIToken, ProductIconServiceDIToken] as const;

    public readonly view: TUIElement;
    public readonly tree: DebugTreeList<ReplItem>;
    public readonly input = new InputElement();
    private readonly history: string[] = [];
    private historyIndex = -1;

    public constructor(
        private readonly model: DebugStubModel,
        views: ViewsService,
        icons: IProductIconService,
    ) {
        super();
        this.tree = new DebugTreeList<ReplItem>("repl", {
            getRoots: () => model.repl.map((entry) => ({ kind: "entry", entry }) as const),
            getChildren: async (item) => {
                const value = item.kind === "child" ? item.value : item.entry.kind === "result" ? item.entry.value : undefined;
                if (value === undefined) return [];
                return (await value.getChildren()).map((child) => ({ kind: "child", value: child }) as const);
            },
            key: (item) => (item.kind === "child" ? item.value.id : item.entry.id),
            hasChildren: (item) =>
                item.kind === "child" ? item.value.expandable : item.entry.kind === "result" && item.entry.value.expandable,
            render: (item) => this.renderItem(item, icons),
        });
        this.tree.stickToBottom = true;

        this.input.placeholder = "Evaluate an expression (e.g. sum, nums[i], p, total / count, head)";
        this.input.addEventListener("keydown", (event) => {
            if (event.ctrlKey || event.altKey || event.metaKey) return;
            if (event.key === "Enter") {
                event.preventDefault();
                this.submit();
            } else if (event.key === "ArrowUp") {
                event.preventDefault();
                this.walkHistory(-1);
            } else if (event.key === "ArrowDown") {
                event.preventDefault();
                this.walkHistory(1);
            } else if (event.key === "Escape" && this.input.inputState.value !== "") {
                event.preventDefault();
                this.setInput("");
            }
        });
        const prompt = new TextLabelElement(`${icons.glyph(INPUT_ICON)} `);
        prompt.style = { fg: "debugConsoleInputIcon.foreground" };
        const inputRow = new HFlexElement();
        inputRow.addChild(new TextLabelElement(""), { width: hflexFixed(1), height: 1 });
        inputRow.addChild(prompt, { width: hflexFit(), height: 1 });
        inputRow.addChild(this.input, { width: hflexFill(), height: 1 });
        const root = new VFlexElement();
        root.addChild(new PaddingContainerElement(new ScrollBarDecorator(this.tree.list), { left: 1, right: 1 }), {
            height: vflexFill(),
            width: "fill",
        });
        root.addChild(inputRow, { height: vflexFixed(1), width: "fill" });
        root.id = "debugReplView";
        this.view = root;

        views.registerContainer({
            id: REPL_CONTAINER_ID,
            title: "DEBUG CONSOLE",
            label: "Debug Console",
            location: "panel",
            // Upstream: after Output, before Terminal.
            order: 1.5,
        });
        views.registerView({
            id: REPL_VIEW_ID,
            containerId: REPL_CONTAINER_ID,
            title: "DEBUG CONSOLE",
            order: 10,
            body: root,
            canMoveView: true,
            focus: () => {
                this.input.focus();
            },
        });

        let wasInactive = true;
        this.register(
            model.onDidChangeRepl(() => {
                this.refresh();
            }),
        );
        this.register(
            model.onDidChangeState(() => {
                // Upstream `debug.internalConsoleOptions: openOnFirstSessionStart`.
                if (wasInactive && model.state !== "inactive") views.openView(REPL_VIEW_ID, false);
                wasInactive = model.state === "inactive";
            }),
        );
        this.refresh();
    }

    public clear(): void {
        this.model.clearRepl();
    }

    private refresh(): void {
        void this.tree.refresh().catch(onUnexpectedError);
    }

    private submit(): void {
        const text = this.input.inputState.value.trim();
        if (text === "") return;
        this.history.push(text);
        this.historyIndex = -1;
        this.setInput("");
        this.model.evaluateInRepl(text);
    }

    private walkHistory(direction: -1 | 1): void {
        if (this.history.length === 0) return;
        let index = this.historyIndex === -1 ? this.history.length : this.historyIndex;
        index = Math.max(0, Math.min(this.history.length, index + direction));
        this.historyIndex = index === this.history.length ? -1 : index;
        this.setInput(this.historyIndex === -1 ? "" : (this.history[index] ?? ""));
    }

    private setInput(text: string): void {
        this.input.inputState.value = text;
        this.input.markDirty();
    }

    private renderItem(item: ReplItem, icons: IProductIconService): TUIElement {
        if (item.kind === "child") return spansLabel(valueSpans(item.value, false));
        const { entry } = item;
        if (entry.kind === "input") {
            return spansLabel([
                { text: `${icons.glyph(INPUT_ICON)} `, fg: "debugConsoleInputIcon.foreground" },
                { text: entry.text },
            ]);
        }
        if (entry.kind === "result") {
            // Upstream shows a result by its value alone; an object keeps the twistie to its children.
            return spansLabel([{ text: entry.value.value, fg: valueColor(entry.value.kind) }]);
        }
        const fg = SEVERITY_COLORS[entry.severity];
        return splitRow(
            [{ text: entry.text, ...(fg === undefined ? {} : { fg }) }],
            entry.source === undefined ? [] : [{ text: entry.source, fg: "debugConsole.sourceForeground", italic: true }],
        );
    }
}
