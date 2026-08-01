import { describe, expect, it } from "vitest";

import { unthemedTreeViewStyles } from "../../../../../tuidom/ui/tree/treeViewElement.ts";
import { unthemedEditorStyles } from "../../../editor/browser/editorElement.ts";
import { dark2026Theme } from "../../../workbench/services/themes/common/themes/dark2026.ts";
import { darkPlusTheme } from "../../../workbench/services/themes/common/themes/darkPlus.ts";
import { WorkbenchTheme } from "../common/workbenchTheme.ts";

import {
    getDialogStyles,
    getEditorStyles,
    getFileTreeStyles,
    getFindWidgetStyles,
    getProblemsTreeStyles,
} from "./defaultStyles.ts";

function makeTheme(): WorkbenchTheme {
    return WorkbenchTheme.fromThemeFile(darkPlusTheme);
}

describe("dialog and find-widget styles", () => {
    it("getDialogStyles maps the dialog window to editorWidget.*/description/link/warning keys", () => {
        const theme = makeTheme();

        const styles = getDialogStyles(theme);

        expect(styles.bg).toBe(theme.getRequiredColor("editorWidget.background"));
        expect(styles.fg).toBe(theme.getRequiredColor("editorWidget.foreground"));
        expect(styles.borderFg).toBe(theme.getRequiredColor("editorWidget.border"));
        expect(styles.descriptionFg).toBe(theme.getRequiredColor("descriptionForeground"));
        expect(styles.warningFg).toBe(theme.getRequiredColor("editorWarning.foreground"));
        expect(styles.linkFg).toBe(theme.getRequiredColor("textLink.foreground"));
    });

    it("getFindWidgetStyles maps the find widget to editorWidget.*/description/error keys", () => {
        const theme = makeTheme();
        expect(getFindWidgetStyles(theme)).toEqual({
            bg: theme.getRequiredColor("editorWidget.background"),
            fg: theme.getRequiredColor("editorWidget.foreground"),
            borderFg: theme.getRequiredColor("editorWidget.border"),
            counterFg: theme.getRequiredColor("descriptionForeground"),
            noResultsFg: theme.getRequiredColor("editorError.foreground"),
        });
    });
});

describe("getEditorStyles", () => {
    it("resolves the registry-guaranteed editor keys from the theme", () => {
        const theme = makeTheme();

        const styles = getEditorStyles(theme);

        expect(styles.lineNumberForeground).toBe(theme.getRequiredColor("editorLineNumber.foreground"));
        expect(styles.lineNumberActiveForeground).toBe(theme.getRequiredColor("editorLineNumber.activeForeground"));
        expect(styles.occurrenceHighlightBackground).toBe(theme.getRequiredColor("editor.wordHighlightBackground"));
        expect(styles.errorForeground).toBe(theme.getRequiredColor("editorError.foreground"));
        expect(styles.warningForeground).toBe(theme.getRequiredColor("editorWarning.foreground"));
        expect(styles.infoForeground).toBe(theme.getRequiredColor("editorInfo.foreground"));
        expect(styles.hintForeground).toBe(theme.getRequiredColor("editorHint.foreground"));
    });

    it("uses the optional gutter/indent-guide keys when the theme defines them (Dark+)", () => {
        // darkPlus defines editorGutter.foldingControlForeground and both indent-guide keys.
        const theme = makeTheme();

        const styles = getEditorStyles(theme);

        expect(styles.foldingControlForeground).toBe(theme.getColor("editorGutter.foldingControlForeground"));
        expect(styles.indentGuideForeground).toBe(theme.getColor("editorIndentGuide.background1"));
        expect(styles.indentGuideActiveForeground).toBe(theme.getColor("editorIndentGuide.activeBackground1"));
    });

    it("uses editorGutter.background when the theme defines it (Dark 2026)", () => {
        const theme = WorkbenchTheme.fromThemeFile(dark2026Theme);

        expect(getEditorStyles(theme).gutterBackground).toBe(theme.getColor("editorGutter.background"));
    });

    it("falls back to the editor background for themes without a gutter color", () => {
        // darkPlus defines no editorGutter.background (and the key has no registry default).
        const theme = makeTheme();

        expect(getEditorStyles(theme).gutterBackground).toBe(theme.getRequiredColor("editor.background"));
    });

    it("keeps the unthemed baseline for optional keys absent from the theme", () => {
        // No theme colors at all: the registry backfills the guaranteed keys, but
        // the fold-control/indent-guide keys stay undefined → unthemed defaults.
        const theme = WorkbenchTheme.fromThemeFile({ name: "sparse", type: "dark", colors: {} });

        const styles = getEditorStyles(theme);

        expect(styles.foldingControlForeground).toBe(unthemedEditorStyles.foldingControlForeground);
        expect(styles.indentGuideForeground).toBe(unthemedEditorStyles.indentGuideForeground);
        expect(styles.indentGuideActiveForeground).toBe(unthemedEditorStyles.indentGuideActiveForeground);
    });
});

describe("getFileTreeStyles", () => {
    it("resolves the list.* selection/hover keys from the theme", () => {
        const theme = makeTheme();

        const styles = getFileTreeStyles(theme);

        expect(styles.activeSelectionBg).toBe(theme.getRequiredColor("list.activeSelectionBackground"));
        expect(styles.activeSelectionFg).toBe(theme.getRequiredColor("list.activeSelectionForeground"));
        expect(styles.inactiveSelectionBg).toBe(theme.getRequiredColor("list.inactiveSelectionBackground"));
        expect(styles.inactiveSelectionFg).toBe(theme.getRequiredColor("list.inactiveSelectionForeground"));
        expect(styles.hoverBg).toBe(theme.getRequiredColor("list.hoverBackground"));
        expect(styles.hoverFg).toBe(theme.getColor("list.hoverForeground"));
    });

    it("deemphasizes cut rows and the symlink arrow with list.deemphasizedForeground", () => {
        const theme = makeTheme();

        const styles = getFileTreeStyles(theme);

        expect(styles.cutFg).toBe(theme.getRequiredColor("list.deemphasizedForeground"));
        expect(styles.symlinkFg).toBe(theme.getRequiredColor("list.deemphasizedForeground"));
    });
});

describe("getProblemsTreeStyles", () => {
    it("shares the list.* selection mapping with the file tree", () => {
        const theme = makeTheme();

        const styles = getProblemsTreeStyles(theme);
        const fileTree = getFileTreeStyles(theme);

        expect(styles.activeSelectionBg).toBe(fileTree.activeSelectionBg);
        expect(styles.activeSelectionFg).toBe(fileTree.activeSelectionFg);
        expect(styles.inactiveSelectionBg).toBe(fileTree.inactiveSelectionBg);
        expect(styles.inactiveSelectionFg).toBe(fileTree.inactiveSelectionFg);
        expect(styles.hoverBg).toBe(fileTree.hoverBg);
        expect(styles.hoverFg).toBe(fileTree.hoverFg);
    });

    it("keeps cut/symlink colours at the unthemed baseline (Problems never themed them)", () => {
        const theme = makeTheme();

        const styles = getProblemsTreeStyles(theme);

        expect(styles.cutFg).toBe(unthemedTreeViewStyles.cutFg);
        expect(styles.symlinkFg).toBe(unthemedTreeViewStyles.symlinkFg);
    });
});
