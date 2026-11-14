import type { ColorContribution } from "../colorRegistry.ts";

/**
 * Upstream `contrib/debug/browser/debugColors.ts`, the breakpoint glyphs of `breakpointEditorContribution.ts`, the
 * stack frame lines of `callStackEditorContribution.ts`, the inline values of `debugEditorContribution.ts`, the
 * exception widget of `exceptionWidget.ts` and `statusbarColorProvider.ts`. Upstream's `errorForeground` is not in
 * this registry: `debugConsole.errorForeground` bakes its values. `statusBar.debuggingBorder` refers to
 * `statusBar.border`, which has no default outside high contrast, so it has none either;
 * `commandCenter.debuggingBackground` is `transparent(statusBar.debuggingBackground, 0.258)` baked.
 */
export const debugColors = {
    "debugToolBar.background": {
        defaults: { dark: "#333333", light: "#F3F3F3" },
        description: "Debug toolbar background color.",
    },
    "debugToolBar.border": {
        defaults: null,
        description: "Debug toolbar border color.",
    },
    "debugIcon.startForeground": {
        defaults: { dark: "#89D185", light: "#388A34" },
        description: "Debug toolbar icon for start debugging.",
    },
    "debugTokenExpression.name": {
        defaults: { dark: "#c586c0", light: "#9b46b0" },
        description: "Foreground color for the token names shown in the debug views (ie. the Variables or Watch view).",
    },
    "debugTokenExpression.type": {
        defaults: { dark: "#4A90E2", light: "#4A90E2" },
        description: "Foreground color for the token types shown in the debug views (ie. the Variables or Watch view).",
    },
    "debugTokenExpression.value": {
        defaults: { dark: "#cccccc99", light: "#6c6c6ccc" },
        description:
            "Foreground color for the token values shown in the debug views (ie. the Variables or Watch view).",
    },
    "debugTokenExpression.string": {
        defaults: { dark: "#ce9178", light: "#a31515" },
        description: "Foreground color for strings in the debug views (ie. the Variables or Watch view).",
    },
    "debugTokenExpression.boolean": {
        defaults: { dark: "#4e94ce", light: "#0000ff" },
        description: "Foreground color for booleans in the debug views (ie. the Variables or Watch view).",
    },
    "debugTokenExpression.number": {
        defaults: { dark: "#b5cea8", light: "#098658" },
        description: "Foreground color for numbers in the debug views (ie. the Variables or Watch view).",
    },
    "debugTokenExpression.error": {
        defaults: { dark: "#f48771", light: "#e51400" },
        description:
            "Foreground color for expression errors in the debug views (ie. the Variables or Watch view) and for error logs shown in the debug console.",
    },
    "debugView.exceptionLabelForeground": {
        defaults: { dark: "foreground", light: "#FFFFFF" },
        description:
            "Foreground color for a label shown in the CALL STACK view when the debugger breaks on an exception.",
    },
    "debugView.exceptionLabelBackground": {
        defaults: { dark: "#6C2022", light: "#A31515" },
        description:
            "Background color for a label shown in the CALL STACK view when the debugger breaks on an exception.",
    },
    "debugView.stateLabelForeground": {
        defaults: { dark: "foreground", light: "foreground" },
        description:
            "Foreground color for a label in the CALL STACK view showing the current session's or thread's state.",
    },
    "debugView.stateLabelBackground": {
        defaults: { dark: "#88888844", light: "#88888844" },
        description:
            "Background color for a label in the CALL STACK view showing the current session's or thread's state.",
    },
    "debugView.valueChangedHighlight": {
        defaults: { dark: "#569CD6", light: "#569CD6" },
        description: "Color used to highlight value changes in the debug views (ie. in the Variables view).",
    },
    "debugConsole.infoForeground": {
        defaults: { dark: "editorInfo.foreground", light: "editorInfo.foreground" },
        description: "Foreground color for info messages in debug REPL console.",
    },
    "debugConsole.warningForeground": {
        defaults: { dark: "editorWarning.foreground", light: "editorWarning.foreground" },
        description: "Foreground color for warning messages in debug REPL console.",
    },
    "debugConsole.errorForeground": {
        defaults: { dark: "#F48771", light: "#A1260D" },
        description: "Foreground color for error messages in debug REPL console.",
    },
    "debugConsole.sourceForeground": {
        defaults: { dark: "foreground", light: "foreground" },
        description: "Foreground color for source filenames in debug REPL console.",
    },
    "debugConsoleInputIcon.foreground": {
        defaults: { dark: "foreground", light: "foreground" },
        description: "Foreground color for debug console input marker icon.",
    },
    "debugIcon.pauseForeground": {
        defaults: { dark: "#75BEFF", light: "#007ACC" },
        description: "Debug toolbar icon for pause.",
    },
    "debugIcon.stopForeground": {
        defaults: { dark: "#F48771", light: "#A1260D" },
        description: "Debug toolbar icon for stop.",
    },
    "debugIcon.disconnectForeground": {
        defaults: { dark: "#F48771", light: "#A1260D" },
        description: "Debug toolbar icon for disconnect.",
    },
    "debugIcon.restartForeground": {
        defaults: { dark: "#89D185", light: "#388A34" },
        description: "Debug toolbar icon for restart.",
    },
    "debugIcon.stepOverForeground": {
        defaults: { dark: "#75BEFF", light: "#007ACC" },
        description: "Debug toolbar icon for step over.",
    },
    "debugIcon.stepIntoForeground": {
        defaults: { dark: "#75BEFF", light: "#007ACC" },
        description: "Debug toolbar icon for step into.",
    },
    "debugIcon.stepOutForeground": {
        defaults: { dark: "#75BEFF", light: "#007ACC" },
        description: "Debug toolbar icon for step over.",
    },
    "debugIcon.continueForeground": {
        defaults: { dark: "#75BEFF", light: "#007ACC" },
        description: "Debug toolbar icon for continue.",
    },
    "debugIcon.stepBackForeground": {
        defaults: { dark: "#75BEFF", light: "#007ACC" },
        description: "Debug toolbar icon for step back.",
    },
    "debugIcon.breakpointForeground": {
        defaults: { dark: "#E51400", light: "#E51400" },
        description: "Icon color for breakpoints.",
    },
    "debugIcon.breakpointDisabledForeground": {
        defaults: { dark: "#848484", light: "#848484" },
        description: "Icon color for disabled breakpoints.",
    },
    "debugIcon.breakpointUnverifiedForeground": {
        defaults: { dark: "#848484", light: "#848484" },
        description: "Icon color for unverified breakpoints.",
    },
    "debugIcon.breakpointCurrentStackframeForeground": {
        defaults: { dark: "#FFCC00", light: "#BE8700" },
        description: "Icon color for the current breakpoint stack frame.",
    },
    "debugIcon.breakpointStackframeForeground": {
        defaults: { dark: "#89D185", light: "#89D185" },
        description: "Icon color for all breakpoint stack frames.",
    },
    "editor.stackFrameHighlightBackground": {
        defaults: { dark: "#ffff0033", light: "#ffff6673" },
        description: "Background color for the highlight of line at the top stack frame position.",
    },
    "editor.focusedStackFrameHighlightBackground": {
        defaults: { dark: "#7abd7a4d", light: "#cee7ce73" },
        description: "Background color for the highlight of line at focused stack frame position.",
    },
    "editor.inlineValuesForeground": {
        defaults: { dark: "#ffffff80", light: "#00000080" },
        description: "Color for the debug inline value text.",
    },
    "editor.inlineValuesBackground": {
        defaults: { dark: "#ffc80033", light: "#ffc80033" },
        description: "Color for the debug inline value background.",
    },
    "debugExceptionWidget.border": {
        defaults: { dark: "#a31515", light: "#a31515" },
        description: "Exception widget border color.",
    },
    "debugExceptionWidget.background": {
        defaults: { dark: "#420b0d", light: "#f1dfde" },
        description: "Exception widget background color.",
    },
    "statusBar.debuggingBackground": {
        defaults: { dark: "#CC6633", light: "#CC6633" },
        description:
            "Status bar background color when a program is being debugged. The status bar is shown in the bottom of the window",
    },
    "statusBar.debuggingForeground": {
        defaults: { dark: "statusBar.foreground", light: "statusBar.foreground" },
        description:
            "Status bar foreground color when a program is being debugged. The status bar is shown in the bottom of the window",
    },
    "statusBar.debuggingBorder": {
        defaults: null,
        description:
            "Status bar border color separating to the sidebar and editor when a program is being debugged. The status bar is shown in the bottom of the window",
    },
    "commandCenter.debuggingBackground": {
        defaults: { dark: "#CC663342", light: "#CC663342" },
        description: "Command center background color when a program is being debugged",
    },
} as const satisfies ColorContribution;
