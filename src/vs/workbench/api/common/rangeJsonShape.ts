import { Range, Selection } from "./vscodeTypes.ts";

// The upstream JSON shape, and extensions rely on it: Merge Conflict parses `JSON.stringify(range)` back as a pair.
// On the prototypes, not in the classes: `vscode.d.ts` has no `toJSON`, so a public member would make every `vscode.Range`
// handed back to `vscodeTypes.ts` fail to type-check. A module of its own, imported only by the extension API: only
// extensions see these objects, and `vscodeTypes.ts` is shared with the main bundle under a size budget.
Object.defineProperty(Range.prototype, "toJSON", {
    value(this: Range): unknown {
        return [this.start, this.end];
    },
});

Object.defineProperty(Selection.prototype, "toJSON", {
    value(this: Selection): unknown {
        return { start: this.start, end: this.end, active: this.active, anchor: this.anchor };
    },
});
