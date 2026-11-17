import { Size } from "@tuidom/core/common/geometryPromitives";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { InputElement } from "@tuidom/elements/inputbox/inputElement";
import { HFlexElement, hflexFill, hflexFixed } from "@tuidom/elements/layout/hFlexElement";
import { VFlexElement, vflexFill, vflexFixed } from "@tuidom/elements/layout/vFlexElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import type { ICancellationToken as CancellationToken } from "../../../../base/common/cancellation.ts";
import type { Position } from "../../../../editor/common/core/position.ts";
import type { IDebugSession } from "../common/debug.ts";

import { ReplSuggest } from "./replSuggest.ts";

type Targets = DebugProtocol.CompletionItem[] | undefined;

/** The adapter's side: what each request asked, and its answer, given when the test resolves it. */
interface IAsked {
    readonly frameId: number | undefined;
    readonly threadId: number;
    readonly text: string;
    readonly line: number;
    readonly column: number;
    readonly token: CancellationToken;
    answer(targets: Targets): Promise<void>;
}

describe("ReplSuggest", () => {
    let app: TestApp;
    let input: InputElement;
    let suggest: ReplSuggest;
    let asked: IAsked[];
    let supports: boolean;
    let running: boolean;
    let history: string[];
    let historySuggestions: boolean;
    let acceptOnEnter: boolean;

    const session = {
        get capabilities() {
            return { supportsCompletionsRequest: supports };
        },
        completions(frameId, threadId, text, position: Position, token: CancellationToken) {
            return new Promise((resolve) => {
                asked.push({
                    frameId,
                    threadId,
                    text,
                    line: position.lineNumber,
                    column: position.column,
                    token,
                    answer: async (targets) => {
                        resolve(
                            targets === undefined
                                ? undefined
                                : ({ body: { targets } } as DebugProtocol.CompletionsResponse),
                        );
                        await new Promise((done) => setTimeout(done, 0));
                    },
                });
            });
        },
    } as Pick<IDebugSession, "capabilities" | "completions"> as IDebugSession;

    beforeEach(() => {
        asked = [];
        supports = true;
        running = true;
        history = [];
        historySuggestions = true;
        acceptOnEnter = false;
        const body = new BodyElement();
        const column = new VFlexElement();
        column.addChild(new TextLabelElement(""), { height: vflexFill(), width: "fill" });
        input = new InputElement();
        input.multiline = true;
        // A field of 20 columns on a wider screen, so the popup is not clamped to the screen at its end.
        const row = new HFlexElement();
        row.addChild(input, { width: hflexFixed(20), height: "fill" });
        row.addChild(new TextLabelElement(""), { width: hflexFill(), height: "fill" });
        column.addChild(row, { height: vflexFixed(3), width: "fill" });
        body.setContent(column);
        app = TestApp.create(body, new Size(60, 12));
        suggest = new ReplSuggest(
            input,
            {
                session: () => (running ? session : undefined),
                frame: () => ({ frameId: 7, threadId: 3 }),
                history: () => history,
                historySuggestions: () => historySuggestions,
                acceptOnEnter: () => acceptOnEnter,
            },
            () => body,
        );
        app.render();
    });

    afterEach(() => {
        suggest.dispose();
    });

    /** The input's text with the cursor at `|`. */
    function setInput(text: string): void {
        const at = text.indexOf("|");
        input.inputState.value = text.replace("|", "");
        input.inputState.moveCursorTo(at === -1 ? text.length : at);
        app.render();
    }

    function value(): string {
        const state = input.inputState;
        return `${state.value.slice(0, state.cursorOffset)}|${state.value.slice(state.cursorOffset)}`;
    }

    async function open(text: string, targets: Targets, explicit = false): Promise<void> {
        setInput(text);
        suggest.trigger(explicit);
        await asked.at(-1)?.answer(targets);
        app.render();
    }

    function labels(): string[] {
        return suggest.list.items.map((item) => item.label);
    }

    function selected(): string | undefined {
        return suggest.list.getSelectedItem()?.label;
    }

    describe("asking", () => {
        it("asks for the text with the cursor's 1-based line and column, in the focused frame", async () => {
            setInput("a\nbc|d");
            suggest.trigger(false);
            expect(asked).toMatchObject([{ frameId: 7, threadId: 3, text: "a\nbcd", line: 2, column: 3 }]);
            setInput("ab|");
            suggest.trigger(false);
            expect(asked[1]).toMatchObject({ line: 1, column: 3 });
            await asked[1].answer([{ label: "abc" }]);
            expect(suggest.isOpen).toBe(true);
        });

        it("asks nothing without a running session, an adapter without completions, or a blank input unless explicit", () => {
            running = false;
            setInput("cf");
            suggest.trigger(true);
            supports = false;
            running = true;
            suggest.trigger(true);
            supports = true;
            setInput("  ");
            suggest.trigger(false);
            expect(asked).toEqual([]);
            suggest.trigger(true);
            expect(asked).toHaveLength(1);
        });

        it("a request that finds the input blank closes the popup that is open", async () => {
            await open("c", [{ label: "cfg" }]);
            expect(suggest.isOpen).toBe(true);
            setInput("");
            suggest.trigger(false);
            expect(suggest.isOpen).toBe(false);
        });

        it("a newer request cancels the older one, whose answer shows nothing", async () => {
            setInput("c");
            suggest.trigger(false);
            setInput("cf");
            suggest.trigger(false);
            expect(asked[0].token.isCancellationRequested).toBe(true);
            expect(asked[1].token.isCancellationRequested).toBe(false);
            await asked[1].answer([{ label: "cfg" }]);
            await asked[0].answer([{ label: "count" }]);
            expect(labels()).toEqual(["cfg"]);
        });

        it("close and dispose cancel the request on its way", async () => {
            setInput("c");
            suggest.trigger(false);
            suggest.close();
            expect(asked[0].token.isCancellationRequested).toBe(true);
            await asked[0].answer([{ label: "cfg" }]);
            expect(suggest.isOpen).toBe(false);

            suggest.trigger(false);
            suggest.dispose();
            expect(asked[1].token.isCancellationRequested).toBe(true);
        });

        it("no answer, or no item in it, keeps the popup closed; an empty answer closes it", async () => {
            historySuggestions = false;
            await open("c", undefined);
            expect(suggest.isOpen).toBe(false);
            await open("c", []);
            expect(suggest.isOpen).toBe(false);
            await open("c", [{ label: "cfg" }]);
            expect(suggest.isOpen).toBe(true);
            await open("cx", []);
            expect(suggest.isOpen).toBe(false);
        });

        it("without an answer the history is still offered", async () => {
            history = ["count"];
            await open("c", undefined);
            expect(labels()).toEqual(["count"]);
        });
    });

    describe("the items", () => {
        it("are DAP's targets: an empty label is none, no type and an unknown one are properties", async () => {
            await open("c", [
                { label: "" },
                { label: "cplain" },
                { label: "codd", type: "weird" as "text" },
                { label: "cfn", type: "function", detail: "() => void" },
            ]);
            expect(suggest.list.items.map(({ label, kind, detail }) => ({ label, kind, detail }))).toEqual([
                { label: "cfn", kind: 2, detail: "() => void" },
                { label: "codd", kind: 9, detail: undefined },
                { label: "cplain", kind: 9, detail: undefined },
            ]);
            expect(suggest.list.items.map((item) => "detail" in item)).toEqual([true, false, false]);
        });

        it("are filtered by the `length` characters before the cursor, case-insensitively, as contained", async () => {
            history = [];
            await open("x.CF|", [
                { label: "cfg", length: 2 },
                { label: "my_cf", length: 2 },
                { label: "count", length: 2 },
                // No length: the word is empty, it is kept.
                { label: "other" },
                // A length past the input's start takes all of it.
                { label: "x.cfgall", length: 9 },
                { label: "cfgall", length: 9 },
            ]);
            expect(labels()).toEqual(["cfg", "my_cf", "other", "x.cfgall"]);
        });

        it("are sorted by their lower-cased sortText, else by label", async () => {
            await open("c", [{ label: "cb", sortText: "B" }, { label: "ca", sortText: "a" }, { label: "cc" }]);
            expect(labels()).toEqual(["ca", "cb", "cc"]);
            expect(suggest.list.items.map((item) => item.sortText)).toEqual(["a", "b", "cc"]);
        });

        it("the history comes after the targets, most recent first, filtered by what is typed", async () => {
            history = Array.from({ length: 10 }, (_, i) => `c${String(i)}`);
            history.push("other");
            await open("c", [{ label: "zz" }, { label: "cfg" }]);
            expect(labels()).toEqual(["cfg", "zz", "c9", "c8", "c7", "c6", "c5", "c4", "c3", "c2", "c1", "c0"]);
            expect(suggest.list.items.slice(2).every((item) => item.kind === 0)).toBe(true);
            suggest.close();
            historySuggestions = false;
            await open("c", [{ label: "cfg" }]);
            expect(labels()).toEqual(["cfg"]);
        });
    });

    describe("keys", () => {
        it("are not the popup's while it is closed", () => {
            for (const key of ["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Tab", "Escape", "Enter", "a"]) {
                expect(suggest.handleKey(key)).toBe(false);
            }
        });

        it("move the selection: Down, Up, PageDown, PageUp", async () => {
            await open(
                "c",
                Array.from({ length: 30 }, (_, i) => ({ label: `c${String(i).padStart(2, "0")}` })),
            );
            expect(selected()).toBe("c00");
            expect(suggest.handleKey("ArrowDown")).toBe(true);
            expect(selected()).toBe("c01");
            expect(suggest.handleKey("ArrowUp")).toBe(true);
            expect(selected()).toBe("c00");
            expect(suggest.handleKey("PageDown")).toBe(true);
            const paged = selected();
            expect(paged).not.toBe("c00");
            expect(paged).not.toBe("c01");
            expect(suggest.handleKey("PageUp")).toBe(true);
            expect(selected()).toBe("c00");
            expect(suggest.handleKey("x")).toBe(false);
            expect(suggest.isOpen).toBe(true);
        });

        it("Tab accepts the selected item; Escape closes", async () => {
            await open("c", [{ label: "ca" }, { label: "cb" }]);
            suggest.handleKey("ArrowDown");
            expect(suggest.handleKey("Tab")).toBe(true);
            expect(value()).toBe("ccb|");
            expect(suggest.isOpen).toBe(false);
            app.render();
            expect(app.backend.screenToString()).toContain("ccb");

            await open("c", [{ label: "ca", length: 1 }]);
            expect(suggest.handleKey("Escape")).toBe(true);
            expect(suggest.isOpen).toBe(false);
            expect(value()).toBe("c|");
        });

        it("Enter closes the popup and is the input's; with acceptSuggestionOnEnter it accepts", async () => {
            await open("c", [{ label: "ca", length: 1 }]);
            expect(suggest.handleKey("Enter")).toBe(false);
            expect(suggest.isOpen).toBe(false);
            expect(value()).toBe("c|");

            acceptOnEnter = true;
            await open("c", [{ label: "ca", length: 1 }]);
            expect(suggest.handleKey("Enter")).toBe(true);
            expect(suggest.isOpen).toBe(false);
            expect(value()).toBe("ca|");
        });
    });

    describe("accepting", () => {
        it("replaces the `length` before the cursor, keeps what is after it, puts the cursor at selectionStart", async () => {
            await open("x.cf|;", [{ label: "cfg", text: "cfg()", length: 2, selectionStart: 4 }]);
            suggest.handleKey("Tab");
            expect(value()).toBe("x.cfg(|);");

            await open("x.cf|;", [{ label: "cfg", length: 2 }]);
            suggest.handleKey("Tab");
            expect(value()).toBe("x.cfg|;");

            // A length past the input's start replaces from its start.
            await open("cf|", [{ label: "cfg", length: 5 }]);
            suggest.handleKey("Tab");
            expect(value()).toBe("cfg|");
        });

        it("a click on an item accepts it", async () => {
            await open("c", [
                { label: "ca", length: 1 },
                { label: "cb", length: 1 },
            ]);
            const { x, y } = suggest.list.globalPosition;
            const rows = app.backend.screenToString().split("\n");
            const row = rows.findIndex((line, i) => i >= y && line.includes("cb"));
            for (const action of ["press", "release"] as const) {
                app.backend.simulateMouse({
                    kind: "mouse",
                    button: "left",
                    x: x + 3,
                    y: row + 1,
                    action,
                    shiftKey: false,
                    altKey: false,
                    ctrlKey: false,
                    raw: "",
                });
            }
            expect(value()).toBe("cb|");
            expect(suggest.isOpen).toBe(false);
        });
    });

    describe("where it opens", () => {
        /** The popup's screen cell under its border, at the input's cursor: above the cursor's row. */
        async function anchorOf(text: string): Promise<{ x: number; bottom: number }> {
            await open(text, [{ label: "c" }], true);
            const { x, y } = suggest.list.globalPosition;
            const height = suggest.list.layoutSize.height;
            suggest.close();
            return { x, bottom: y + height };
        }

        it("at the cursor's column and line in the field, clamped to the field", async () => {
            const inputY = input.globalPosition.y;
            const base = await anchorOf("|");
            expect(base.bottom).toBe(inputY);
            const second = await anchorOf("ab\ncd|");
            expect(second.x - base.x).toBe(2);
            // The cursor just before a line break: still on its line.
            expect((await anchorOf("ab|\ncd")).x - base.x).toBe(2);
            expect(second.bottom).toBe(inputY + 1);
            // Columns of the cursor's own line, wide characters by their cells.
            expect((await anchorOf("abcdef\n界|")).x - base.x).toBe(2);
            // A line longer than the field: its last column.
            expect((await anchorOf(`${"a".repeat(40)}|`)).x - base.x).toBe(19);
            // A line below the field's last: its last line.
            expect((await anchorOf("a\nb\nc\nd\ne|")).bottom).toBe(inputY + 2);
        });
    });
});
