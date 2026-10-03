import {
    DisposableStore,
    type IDisposable,
    MutableDisposable,
    toDisposable,
} from "../../../../base/common/lifecycle.ts";

/**
 * Источник активного редактора — ровно то, что нужно привязке. Узкий интерфейс,
 * а не `EditorService`: фичам достаточно этих двух членов, а тестам — фейка.
 */
export interface IActiveEditorSource<E> {
    getActiveEditor(): E | null;
    onActiveEditorChanged(listener: (editor: E | null) => void): IDisposable;
}

/**
 * Привязка фичи к активному редактору — наш аналог времени жизни upstream
 * `IEditorContribution`: тело `bind(editor, store)` вызывается для текущего
 * редактора сразу и для каждого следующего при смене, подписки кладутся в
 * `store` и снимаются, как только редактор перестаёт быть активным. `editor` —
 * `null`, когда активного редактора нет (побочный эффект смены — «закрыть
 * попап» — пишется первой строкой тела и для `null` тоже).
 *
 * Возвращает подписку: её `dispose()` снимает слежение за сменой и подписки
 * текущего редактора.
 */
export function bindActiveEditor<E>(
    source: IActiveEditorSource<E>,
    bind: (editor: E | null, store: DisposableStore) => void,
): IDisposable {
    const current = new MutableDisposable<DisposableStore>();
    const rebind = (editor: E | null): void => {
        const store = new DisposableStore();
        // Новое значение слота освобождает подписки прежнего редактора.
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
