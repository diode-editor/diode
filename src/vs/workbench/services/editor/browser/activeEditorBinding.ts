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
 * Аналог времени жизни upstream `IEditorContribution`: подписки из `store` снимаются, как только
 * редактор перестаёт быть активным. `bind` зовётся и для `null` — побочный эффект смены («закрыть попап») пишут первой строкой.
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
