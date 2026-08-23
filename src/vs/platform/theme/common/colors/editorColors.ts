import type { ColorContribution } from "../colorRegistry.ts";

/** Редактор: фон/текст, номера строк, курсор, подсветки, squiggles, gutter, виджеты. */
export const editorColors = {
    "editor.background": {
        defaults: { dark: "#1E1E1E", light: "#FFFFFF" },
        description: "Editor background color.",
    },
    "editor.foreground": {
        defaults: { dark: "#D4D4D4", light: "#3B3B3B" },
        description: "Editor default foreground color.",
    },
    "editorLineNumber.foreground": {
        defaults: { dark: "#858585", light: "#6E7681" },
        description: "Color of editor line numbers.",
    },
    "editorLineNumber.activeForeground": {
        defaults: { dark: "#C6C6C6", light: "#171184" },
        description: "Color of the active editor line number.",
    },
    "editorCursor.foreground": {
        defaults: { dark: "#AEAFAD", light: "#000000" },
        description: "Color of the editor cursor.",
    },
    // В VS Code ключ зарегистрирован без дефолта, а фоллбэк вычисляется как
    // `Color.opposite()` от `editorCursor.foreground`. Производных цветов у нас нет, поэтому
    // результат запечён в hex на месте определения (та же политика, что у
    // `editor.wordHighlightBackground`); `defaults: null` тут нельзя — `styleVar` без
    // фоллбэка бросает, а инлайн-фоллбэки запрещены.
    "editorCursor.background": {
        defaults: { dark: "#515052", light: "#FFFFFF" },
        description:
            "Background color of the editor cursor. Allows customizing the color of a character overlapped by a block cursor.",
    },
    "editor.selectionBackground": {
        defaults: null,
        description: "Color of the editor selection.",
    },
    "editor.lineHighlightBackground": {
        defaults: null,
        description: "Background color for the highlight of line at the cursor position.",
    },
    // Opaque approximations of VS Code's #575757b8 (dark) / #57575740 (light)
    // composited over the editor bg — терминальный рендер без альфы.
    "editor.wordHighlightBackground": {
        defaults: { dark: "#474747", light: "#C6C6C6" },
        description: "Background color of a symbol during read-access, for example when reading a variable.",
    },
    "editorIndentGuide.background1": {
        defaults: null,
        description: "Color of the editor indentation guides (VS Code 1.x `background1`).",
    },
    "editorIndentGuide.activeBackground1": {
        defaults: null,
        description: "Color of the active editor indentation guide (VS Code 1.x `activeBackground1`).",
    },
    "editorError.foreground": {
        defaults: { dark: "#F14C4C", light: "#E51400" },
        description: "Foreground color of error squiggles in the editor.",
    },
    "editorWarning.foreground": {
        defaults: { dark: "#CCA700", light: "#BF8803" },
        description: "Foreground color of warning squiggles in the editor.",
    },
    "editorInfo.foreground": {
        defaults: { dark: "#3794FF", light: "#1A85FF" },
        description: "Foreground color of info squiggles in the editor.",
    },
    "editorHint.foreground": {
        defaults: { dark: "#EEEEEE", light: "#6C6C6C" },
        description: "Foreground color of hints in the editor.",
    },
    "editorGutter.background": {
        defaults: null,
        description: "Background color of the editor gutter.",
    },
    "editorGutter.modifiedBackground": {
        defaults: { dark: "#1B81A8", light: "#2090D3" },
        description: "Editor gutter background color for lines that are modified.",
    },
    "editorGutter.addedBackground": {
        defaults: { dark: "#487E02", light: "#48985D" },
        description: "Editor gutter background color for lines that are added.",
    },
    "editorGutter.deletedBackground": {
        defaults: { dark: "#F14C4C", light: "#E51400" },
        description: "Editor gutter background color for lines that are deleted.",
    },
    "editorGutter.foldingControlForeground": {
        defaults: null,
        description: "Color of the folding control in the editor gutter.",
    },
    "editorWidget.foreground": {
        defaults: { dark: "#CCCCCC", light: "#616161" },
        description: "Foreground color of editor widgets, such as find/replace.",
    },
    "editorWidget.background": {
        defaults: { dark: "#252526", light: "#F3F3F3" },
        description: "Background color of editor widgets, such as Find/Replace.",
    },
    "editorWidget.border": {
        defaults: { dark: "#454545", light: "#C8C8C8" },
        description: "Border color of the editor widget.",
    },
} as const satisfies ColorContribution;
