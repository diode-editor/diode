import type { ILineMessageDecoration } from "../model/iLineMessageDecoration.ts";
import type { ITextDocument } from "../model/iTextDocument.ts";

import { TrackedLineDecorations } from "./trackedLineDecorations.ts";

/** A message of a line with the owner that set it. */
export interface IShownLineMessage {
    readonly owner: string;
    readonly message: ILineMessageDecoration;
}

/**
 * The messages after the lines' ends by owner (the test messages, the debugger's inline values, the exception's
 * badge): an owner sets only its own, each rides its line through edits. A line shows the messages of every owner
 * one after another, by their `order`, a tie in the order the owners first set messages.
 */
export class LineMessageLayers {
    private readonly layers = new Map<string, TrackedLineDecorations<ILineMessageDecoration>>();

    public constructor(private readonly document: ITextDocument) {}

    public set(owner: string, decorations: readonly ILineMessageDecoration[]): void {
        let layer = this.layers.get(owner);
        if (layer === undefined) {
            layer = new TrackedLineDecorations(this.document);
            this.layers.set(owner, layer);
        }
        layer.set(decorations);
    }

    /** The owner's messages by the line they are on now: a deleted line's message is gone. */
    public byLineOf(owner: string): ReadonlyMap<number, ILineMessageDecoration> {
        return this.layers.get(owner)?.byLine() ?? new Map();
    }

    /** Every owner's messages by line, in the order a line shows them. */
    public byLine(): Map<number, IShownLineMessage[]> {
        const result = new Map<number, IShownLineMessage[]>();
        for (const [owner, layer] of this.layers) {
            for (const [line, message] of layer.byLine()) {
                const shown = result.get(line);
                if (shown === undefined) result.set(line, [{ owner, message }]);
                else shown.push({ owner, message });
            }
        }
        // `sort` is stable: a tie keeps the owners' order.
        for (const shown of result.values()) shown.sort((a, b) => (a.message.order ?? 0) - (b.message.order ?? 0));
        return result;
    }
}
