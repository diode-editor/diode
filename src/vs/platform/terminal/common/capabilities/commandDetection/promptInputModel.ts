// Upstream `src/vs/platform/terminal/common/capabilities/commandDetection/promptInputModel.ts`, the slice `runCommand`
// reads: is the prompt taking input, and is anything typed on it. Not ported: the cursor index, ghost text,
// continuation prompts and right prompts, the input and interrupt events, serialization — they serve upstream UI
// (suggest, accessibility, the prompt input of the chat).

import type { IMarker, Terminal } from "@xterm/headless";

import { Emitter } from "../../../../../base/common/event.ts";
import type { IDisposable } from "../../../../../base/common/lifecycle.ts";

/** Upstream `PromptInputState`: `unknown` until the first command start, `input` from `B`, `execute` from `C`. */
export type PromptInputState = "unknown" | "input" | "execute";

export class PromptInputModel implements IDisposable {
    private stateValue: PromptInputState = "unknown";
    /** Where the typed command begins: the `B` mark and the cursor column then. */
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
     * trimmed. Empty out of the input state (upstream clears it when the command finishes).
     */
    public get value(): string {
        const { start } = this;
        if (this.stateValue !== "input" || start === undefined) return "";
        const buffer = this.terminal.buffer.active;
        const end = buffer.baseY + buffer.cursorY;
        let value = "";
        for (let i = start.marker.line; i <= end; i++) {
            // A start trimmed out of the scrollback has a disposed mark, its line is -1.
            value += buffer.getLine(i)?.translateToString(true, i === start.marker.line ? start.x : 0) ?? "";
        }
        return value.trimEnd();
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
