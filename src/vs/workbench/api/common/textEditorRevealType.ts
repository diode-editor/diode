/** Not in `vscodeTypes.ts`: that module is shared with `main.cjs`, and only the extension host role needs this one. */
export enum TextEditorRevealType {
    Default = 0,
    InCenter = 1,
    InCenterIfOutsideViewport = 2,
    AtTop = 3,
}
