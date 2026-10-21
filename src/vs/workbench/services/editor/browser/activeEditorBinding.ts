import {
    DisposableStore,
    type IDisposable,
    MutableDisposable,
    toDisposable,
} from "../../../../base/common/lifecycle.ts";

export interface IActiveEditorSource<E> {
    getActiveEditor(): E | null;
    onActiveEditorChanged(listener: (editor: E | null) => void): IDisposable;
}

/**
 * Counterpart of the upstream `IEditorContribution` lifetime: subscriptions in `store` are disposed as soon as
 * the editor stops being active. `bind` is called for `null` too — put the change side effect ("close the popup") first.
 */
export function bindActiveEditor<E>(
    source: IActiveEditorSource<E>,
    bind: (editor: E | null, store: DisposableStore) => void,
): IDisposable {
    const current = new MutableDisposable<DisposableStore>();
    const rebind = (editor: E | null): void => {
        const store = new DisposableStore();
        current.value = store;
        bind(editor, store);
    };
    const subscription = source.onActiveEditorChanged(rebind);
    rebind(source.getActiveEditor());
    return toDisposable(() => {
        subscription.dispose();
        current.dispose();
    });
}
