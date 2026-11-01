import type { ColorContribution } from "../colorRegistry.ts";

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
    // VS Code has no default, falling back to `Color.opposite()` of `editorCursor.foreground`; we
    // bake it as hex. `defaults: null` won't do: `styleVar` throws without a fallback.
    "editorCursor.background": {
        defaults: { dark: "#515052", light: "#FFFFFF" },
        description:
            "Background color of the editor cursor. Allows customizing the color of a character overlapped by a block cursor.",
    },
    "editor.selectionBackground": {
        defaults: { dark: "#264F78", light: "#ADD6FF" },
        description: "Color of the editor selection.",
    },
    "editor.lineHighlightBackground": {
        defaults: null,
        description: "Background color for the highlight of line at the cursor position.",
    },
    // Opaque approximations of VS Code's #575757b8 (dark) / #57575740 (light)
    // composited over the editor bg: terminal rendering has no alpha.
    "editor.wordHighlightBackground": {
        defaults: { dark: "#474747", light: "#C6C6C6" },
        description: "Background color of a symbol during read-access, for example when reading a variable.",
    },
    // Opaque approximations of VS Code's #004972B8 (dark) / #0e639c40 (light), as above.
    "editor.wordHighlightStrongBackground": {
        defaults: { dark: "#083D5B", light: "#C3D8E6" },
        description:
            "Background color of a symbol during write-access, like writing to a variable. The color must not be opaque so as not to hide underlying decorations.",
    },
    "editor.wordHighlightTextBackground": {
        defaults: { dark: "editor.wordHighlightBackground", light: "editor.wordHighlightBackground" },
        description:
            "Background color of a textual occurrence for a symbol. The color must not be opaque so as not to hide underlying decorations.",
    },
    // For themes only: a terminal cell has no border to draw. VS Code's hc default is `activeContrastBorder`.
    "editor.wordHighlightBorder": {
        defaults: null,
        description: "Border color of a symbol during read-access, like reading a variable.",
    },
    "editor.wordHighlightStrongBorder": {
        defaults: null,
        description: "Border color of a symbol during write-access, like writing to a variable.",
    },
    "editor.wordHighlightTextBorder": {
        defaults: null,
        description: "Border color of a textual occurrence for a symbol.",
    },
    // VS Code's hcLight is #CCCCCC; hc kinds map to dark/light here.
    "editorWhitespace.foreground": {
        defaults: { dark: "#e3e4e229", light: "#33333333" },
        description: "Color of whitespace characters in the editor.",
    },
    // Deprecated in VS Code in favor of `background1`/`activeBackground1`, but still the default
    // they derive from: themes such as Monokai set only these.
    "editorIndentGuide.background": {
        defaults: { dark: "editorWhitespace.foreground", light: "editorWhitespace.foreground" },
        description: "Color of the editor indentation guides.",
    },
    "editorIndentGuide.activeBackground": {
        defaults: { dark: "editorWhitespace.foreground", light: "editorWhitespace.foreground" },
        description: "Color of the active editor indentation guides.",
    },
    "editorIndentGuide.background1": {
        defaults: { dark: "editorIndentGuide.background", light: "editorIndentGuide.background" },
        description: "Color of the editor indentation guides (1).",
    },
    "editorIndentGuide.activeBackground1": {
        defaults: { dark: "editorIndentGuide.activeBackground", light: "editorIndentGuide.activeBackground" },
        description: "Color of the active editor indentation guides (1).",
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
    // Opaque approximations of VS Code's #ffffff56 (dark) / #0007 (light)
    // composited over the editor bg, as for `editor.wordHighlightBackground`.
    "editorGhostText.foreground": {
        defaults: { dark: "#6A6A6A", light: "#888888" },
        description: "Foreground color of the ghost text in the editor.",
    },
    "editorCodeLens.foreground": {
        defaults: { dark: "#999999", light: "#919191" },
        description: "Foreground color of editor CodeLens",
    },
    "editorInlayHint.foreground": {
        defaults: { dark: "#969696", light: "#969696" },
        description: "Foreground color of inline hints",
    },
    // Upstream `transparent(badgeBackground, .10)`: there are no color expressions here, so it is baked.
    "editorInlayHint.background": {
        defaults: { dark: "#4D4D4D1A", light: "#C4C4C41A" },
        description: "Background color of inline hints",
    },
    "editorInlayHint.typeForeground": {
        defaults: { dark: "editorInlayHint.foreground", light: "editorInlayHint.foreground" },
        description: "Foreground color of inline hints for types",
    },
    "editorInlayHint.typeBackground": {
        defaults: { dark: "editorInlayHint.background", light: "editorInlayHint.background" },
        description: "Background color of inline hints for types",
    },
    "editorInlayHint.parameterForeground": {
        defaults: { dark: "editorInlayHint.foreground", light: "editorInlayHint.foreground" },
        description: "Foreground color of inline hints for parameters",
    },
    "editorInlayHint.parameterBackground": {
        defaults: { dark: "editorInlayHint.background", light: "editorInlayHint.background" },
        description: "Background color of inline hints for parameters",
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
    "editorOverviewRuler.errorForeground": {
        defaults: { dark: "#FF1212B3", light: "#FF1212B3" },
        description: "Overview ruler marker color for errors.",
    },
    "editorOverviewRuler.warningForeground": {
        defaults: { dark: "editorWarning.foreground", light: "editorWarning.foreground" },
        description: "Overview ruler marker color for warnings.",
    },
    "editorOverviewRuler.infoForeground": {
        defaults: { dark: "editorInfo.foreground", light: "editorInfo.foreground" },
        description: "Overview ruler marker color for infos.",
    },
    "editorOverviewRuler.findMatchForeground": {
        defaults: { dark: "#D186167E", light: "#D186167E" },
        description:
            "Overview ruler marker color for find matches. The color must not be opaque so as not to hide underlying decorations.",
    },
    "editorOverviewRuler.wordHighlightForeground": {
        defaults: { dark: "#A0A0A0CC", light: "#A0A0A0CC" },
        description:
            "Overview ruler marker color for symbol highlights. The color must not be opaque so as not to hide underlying decorations.",
    },
    "editorOverviewRuler.wordHighlightStrongForeground": {
        defaults: { dark: "#C0A0C0CC", light: "#C0A0C0CC" },
        description:
            "Overview ruler marker color for write-access symbol highlights. The color must not be opaque so as not to hide underlying decorations.",
    },
    "editorOverviewRuler.selectionHighlightForeground": {
        defaults: { dark: "#A0A0A0CC", light: "#A0A0A0CC" },
        description:
            "Overview ruler marker color for selection highlights. The color must not be opaque so as not to hide underlying decorations.",
    },
    "editorOverviewRuler.wordHighlightTextForeground": {
        defaults: {
            dark: "editorOverviewRuler.selectionHighlightForeground",
            light: "editorOverviewRuler.selectionHighlightForeground",
        },
        description:
            "Overview ruler marker color of a textual occurrence for a symbol. The color must not be opaque so as not to hide underlying decorations.",
    },
    "editorGutter.foldingControlForeground": {
        defaults: null,
        description: "Color of the folding control in the editor gutter.",
    },
    "editorWidget.foreground": {
        defaults: { dark: "foreground", light: "foreground" },
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
    // Popup shadow (`TUIElement.shadow` in tuidom): translucent black, as in VS Code; the engine
    // composites it with whatever is under the overlay.
    "widget.shadow": {
        defaults: { dark: "#0000005C", light: "#00000029" },
        description: "Shadow color of widgets such as find/replace inside the editor.",
    },
    // Derived from editorWidget.*, as in the VS Code registry.
    "editorHoverWidget.foreground": {
        defaults: { dark: "editorWidget.foreground", light: "editorWidget.foreground" },
        description: "Foreground color of the editor hover.",
    },
    "editorHoverWidget.background": {
        defaults: { dark: "editorWidget.background", light: "editorWidget.background" },
        description: "Background color of the editor hover.",
    },
    "editorHoverWidget.border": {
        defaults: { dark: "editorWidget.border", light: "editorWidget.border" },
        description: "Border color of the editor hover.",
    },
    // Suggest widget (the tuidom `completionlist` widget reads these tokens): derived as in the
    // VS Code registry, background/border from editorWidget.*, text from the editor, selection
    // from the list.
    "editorSuggestWidget.background": {
        defaults: { dark: "editorWidget.background", light: "editorWidget.background" },
        description: "Background color of the suggest widget.",
    },
    "editorSuggestWidget.border": {
        defaults: { dark: "editorWidget.border", light: "editorWidget.border" },
        description: "Border color of the suggest widget.",
    },
    "editorSuggestWidget.foreground": {
        defaults: { dark: "editor.foreground", light: "editor.foreground" },
        description: "Foreground color of the suggest widget.",
    },
    "editorSuggestWidget.selectedBackground": {
        defaults: { dark: "list.activeSelectionBackground", light: "list.activeSelectionBackground" },
        description: "Background color of the selected entry in the suggest widget.",
    },
    "editorSuggestWidget.selectedForeground": {
        defaults: { dark: "list.activeSelectionForeground", light: "list.activeSelectionForeground" },
        description: "Foreground color of the selected entry in the suggest widget.",
    },
    // Active parameter in the hover (VS Code derives this color from list.highlightForeground;
    // we bake the values, like the neighbors above).
    "editorHoverWidget.highlightForeground": {
        defaults: { dark: "#2AAAFF", light: "#0066BF" },
        description: "Foreground color of the active item in the parameter hint.",
    },
} as const satisfies ColorContribution;
