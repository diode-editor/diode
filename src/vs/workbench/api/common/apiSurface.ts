/**
 * Проверка поверхности `vscode`-API компилятором: `implementsApi<typeof
 * vscode.window>()(ns)` требует, чтобы в `ns` были все члены `T` с
 * совместимыми сигнатурами, и отдаёт значение уже как `T`.
 *
 * Проверка присваиваемостью (`U extends T`), а не `satisfies`/аннотацией
 * литерала: лишние члены разрешены. Рантайм законно опережает частично
 * раскомментированный `vscode.d.ts` (заглушки провайдеров, члены, которых ещё
 * нет в декларации), и excess-check ловил бы именно их — см. таблицу
 * отклонений в docs/arch/Extensions.md. Пропущенный член или сигнатура не той
 * формы — ошибка компиляции, а не рантайм-`undefined` внутри расширения.
 * Отсюда и `U`, встречающийся в сигнатуре один раз: он и снимает excess-check
 * с литерала-аргумента.
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- см. JSDoc: `U` снимает excess-check
export function implementsApi<T>(): <U extends T>(impl: U) => T {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- то же
    return <U extends T>(impl: U): T => impl;
}
