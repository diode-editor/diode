/**
 * Состояние TextMate (стек правил) клонируется перед мутацией; равенство даёт
 * кэшу остановить перетокенизацию, когда конечное состояние совпало.
 */
export interface IState {
    clone(): IState;
    equals(other: IState): boolean;
}

export const NULL_STATE: IState = {
    clone(): IState {
        return NULL_STATE;
    },
    equals(other: IState): boolean {
        return other === NULL_STATE;
    },
};
