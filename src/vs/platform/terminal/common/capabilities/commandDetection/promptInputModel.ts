// Upstream `src/vs/platform/terminal/common/capabilities/commandDetection/promptInputModel.ts`, the slice `runCommand`
// reads: is the prompt taking input, and is anything typed on it. Not ported: the cursor index, ghost text,
// continuation prompts and right prompts, the input and interrupt events, serialization — they serve upstream UI
// (suggest, accessibility, the prompt input of the chat).

import type { IMarker, Terminal } from "@xterm/headless";

import { assertReturnsDefined } from "../../../../../base/common/assert.ts";
import { Emitter } from "../../../../../base/common/event.ts";
import type { IDisposable } from "../../../../../base/common/lifecycle.ts";

/** Upstream `PromptInputState`: `unknown` until the first command start, `input` from `B`, `execute` from `C`. */
export type PromptInputState = "unknown" | "input" | "execute";

export class PromptInputModel implements IDisposable {
    private stateValue: PromptInputState = "unknown";
    /** Where the typed command begins: the `B` mark and the cursor column then; set exactly in the input state. */
    private start: { readonly marker: IMarker; readonly x: number } | undefined;
    private readonly onDidStartInputEmitter = new Emitter<void>();

    /** Fires when the prompt starts taking input; a repeated `B` while it does is not a new start, as upstream. */
    public readonly onDidStartInput = this.onDidStartInputEmitter.event;

    public constructor(private readonly terminal: Terminal) {}

    public get state(): PromptInputState {
        return this.stateValue;
    }

    /**
     * What is typed on the prompt: the cells from the command start to the end of the cursor's line, trailing spaces
     * trimmed. Empty out of the input state (upstream clears it when the command finishes). A start trimmed out of
     * the scrollback (its mark disposed, the line -1) leaves the cursor's line alone.
     */
    public get value(): string {
        const { start } = this;
        if (start === undefined) return "";
        const buffer = this.terminal.buffer.active;
        const end = buffer.baseY + buffer.cursorY;
        const first = start.marker.line < 0 ? end : start.marker.line;
        const rows: string[] = [];
        for (let i = first; i <= end; i++) {
            // Every row from the top of the buffer to the cursor's exists.
            const line = assertReturnsDefined(buffer.getLine(i));
            rows.push(line.translateToString(true, i === start.marker.line ? start.x : 0));
        }
        return rows.join("").trimEnd();
    }

    /** `B`: the mark is the capability's, which disposes the previous one; the latest is read. */
    public handleCommandStart(marker: IMarker, x: number): void {
        this.start = { marker, x };
        if (this.stateValue === "input") return;
        this.stateValue = "input";
        this.onDidStartInputEmitter.fire();
    }

    /** `C`. */
    public handleCommandExecuted(): void {
        this.stateValue = "execute";
        this.start = undefined;
    }

    public dispose(): void {
        this.onDidStartInputEmitter.dispose();
    }
}
