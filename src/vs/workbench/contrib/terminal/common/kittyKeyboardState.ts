// Kitty keyboard protocol state of one emulator: the flags a program requested and the per-screen stacks.
// Upstream is xterm.js 6.1 (`InputHandler.kittyKeyboardSet/Query/Push/Pop`, `IKittyKeyboardState`,
// @xterm/xterm 6.1.0-beta.285), where the state lives in the emulator; @xterm/headless 6.0 has no protocol, so
// `XtermSurface` keeps it here and feeds it the sequences through public parser hooks. When a stable 6.1 with
// the flags in its public API ships, switch to `vtExtensions.kittyKeyboard` and drop this.

/** Upstream evicts the oldest entry past 16 pushes (DoS protection). */
const STACK_LIMIT = 16;

export class KittyKeyboardState {
    /** The active screen's flags; `0` — legacy encoding. */
    public flags = 0;
    private mainFlags = 0;
    private altFlags = 0;
    private mainStack: number[] = [];
    private altStack: number[] = [];
    private isAlt = false;

    /** `CSI = flags ; mode u`: mode 1 (default) assigns, 2 sets the given bits, 3 clears them. */
    public set(flags: number, mode: number): void {
        switch (mode) {
            case 1:
                this.flags = flags;
                break;
            case 2:
                this.flags |= flags;
                break;
            case 3:
                this.flags &= ~flags;
                break;
        }
    }

    /** `CSI ? u`: the reply the emulator sends to the program. */
    public query(): string {
        return `\x1b[?${this.flags}u`;
    }

    /** `CSI > flags u`: save the current flags on the active screen's stack and set new ones. */
    public push(flags: number): void {
        const stack = this.activeStack;
        if (stack.length >= STACK_LIMIT) stack.shift();
        stack.push(this.flags);
        this.flags = flags;
    }

    /** `CSI < n u`: pop `n` entries (at least 1); an emptied stack leaves the flags at 0. */
    public pop(count: number): void {
        const stack = this.activeStack;
        for (let i = 0; i < Math.max(1, count); i++) {
            const flags = stack.pop();
            if (flags === undefined) break;
            this.flags = flags;
        }
        if (stack.length === 0) this.flags = 0;
    }

    /** DECSET/DECRST 1049/1047/47: each screen keeps its own flags. */
    public switchScreen(isAlt: boolean): void {
        if (isAlt === this.isAlt) return;
        this.isAlt = isAlt;
        if (isAlt) {
            this.mainFlags = this.flags;
            this.flags = this.altFlags;
        } else {
            this.altFlags = this.flags;
            this.flags = this.mainFlags;
        }
    }

    /** RIS, DECSTR, or the protocol switched off. */
    public reset(): void {
        this.flags = 0;
        this.mainFlags = 0;
        this.altFlags = 0;
        this.mainStack = [];
        this.altStack = [];
    }

    private get activeStack(): number[] {
        return this.isAlt ? this.altStack : this.mainStack;
    }
}
