import type { StateStack } from "vscode-textmate";

import type { IState } from "../../../../editor/common/languages/iState.ts";

/**
 * `StateStack` иммутабелен (`clone()` — self), `equals()` сравнивает контент: так
 * `DocumentTokenStore` обрывает перетокенизацию хвоста, когда end-state стабилизировался.
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
