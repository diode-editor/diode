/**
 * Присваиваемость (`U extends T`), а не `satisfies`: лишние члены разрешены —
 * рантайм законно опережает частично раскомментированный `vscode.d.ts`, и
 * excess-check ловил бы именно их. `U` в сигнатуре один раз и снимает excess-check.
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- см. JSDoc: `U` снимает excess-check
export function implementsApi<T>(): <U extends T>(impl: U) => T {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- то же
    return <U extends T>(impl: U): T => impl;
}
