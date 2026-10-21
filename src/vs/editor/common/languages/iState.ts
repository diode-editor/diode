/**
 * TextMate state (the rule stack) is cloned before mutation; equality lets the cache
 * stop retokenizing once the end state matches.
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
