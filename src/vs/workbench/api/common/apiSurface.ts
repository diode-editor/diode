/**
 * Assignability (`U extends T`), not `satisfies`: extra members are allowed —
 * the runtime legitimately runs ahead of the partially uncommented `vscode.d.ts`, and
 * the excess check would catch exactly those. `U` occurs once in the signature and turns it off.
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- see JSDoc: `U` disables the excess check
export function implementsApi<T>(): <U extends T>(impl: U) => T {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- same as above
    return <U extends T>(impl: U): T => impl;
}
