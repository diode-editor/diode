import type { StateStack } from "vscode-textmate";

import type { IState } from "../../../../editor/common/languages/iState.ts";

/**
 * `StateStack` is immutable (`clone()` returns self), `equals()` compares content: this is how
 * `DocumentTokenStore` stops retokenizing the tail once the end state has stabilized.
 */
export class TextMateState implements IState {
    public readonly stack: StateStack;

    public constructor(stack: StateStack) {
        this.stack = stack;
    }

    public clone(): IState {
        return new TextMateState(this.stack.clone());
    }

    public equals(other: IState): boolean {
        if (!(other instanceof TextMateState)) return false;
        return this.stack.equals(other.stack);
    }
}
