import {
    LARGE_FILE_LINE_COUNT_THRESHOLD,
    LARGE_FILE_SIZE_THRESHOLD_MB,
} from "../../../editor/common/model/largeFileOptions.ts";
import type { IConfigurationNode } from "../../../platform/configuration/common/configurationRegistry.ts";

const gotoLocationMultiple = {
    scope: "language-overridable",
    type: "string",
    enum: ["peek", "gotoAndPeek", "goto"],
    default: "peek",
    enumDescriptions: [
        "Show Peek view of the results (default)",
        "Go to the primary result and show a Peek view",
        "Go to the primary result and enable Peek-less navigation to others",
    ],
} as const;

/** Upstream `alternativeCommandOptions`, verbatim. */
const gotoLocationAlternative = {
    scope: "language-overridable",
    type: "string",
    enum: [
        "",
        "editor.action.referenceSearch.trigger",
        "editor.action.goToReferences",
        "editor.action.peekImplementation",
        "editor.action.goToImplementation",
        "editor.action.peekTypeDefinition",
        "editor.action.goToTypeDefinition",
        "editor.action.peekDeclaration",
        "editor.action.revealDeclaration",
        "editor.action.peekDefinition",
        "editor.action.revealDefinitionAside",
        "editor.action.revealDefinition",
    ],
} as const;

export const editorConfiguration = {
    id: "editor",
    title: "Editor",
    properties: {
        "editor.tabSize": {
            scope: "language-overridable",
            type: "number",
            default: 4,
            description: "The number of spaces a tab is equal to.",
        },
        "editor.insertSpaces": {
            scope: "language-overridable",
            type: "boolean",
            default: true,
            description: "Insert spaces when pressing Tab.",
        },
        "editor.detectIndentation": {
            scope: "language-overridable",
            type: "boolean",
            default: true,
            description:
                "Controls whether `editor.tabSize` and `editor.insertSpaces` are automatically detected " +
                "from the file contents when a file is opened.",
        },
        // Upstream defaults to 0; the margin comes from issue #89: the cursor doesn't hug the edge when scrolled into view.
        "editor.cursorSurroundingLines": {
            scope: "language-overridable",
            type: "number",
            default: 3,
            description: "Controls the minimal number of visible leading lines around the cursor.",
        },
        // Upstream defaults to "line"; here no default (human's decision 2026-10-26, #887): unset leaves the
        // terminal's own cursor shape. The terminal draws three shapes, so -thin/-outline fold into their base.
        "editor.cursorStyle": {
            scope: "language-overridable",
            type: "string",
            enum: ["line", "block", "underline", "line-thin", "block-outline", "underline-thin"],
            description:
                "Controls the cursor style in insert input mode. " +
                "When not set, the cursor keeps the shape configured in the terminal.",
        },
        // The terminal only blinks or not: every value but "solid" is a blinking cursor.
        "editor.cursorBlinking": {
            scope: "language-overridable",
            type: "string",
            enum: ["blink", "smooth", "phase", "expand", "solid"],
            default: "blink",
            description: "Control the cursor animation style.",
        },
        // Upstream's limit is applied by nesting level to the merged regions (provider ∪ indentation); the
        // "folding regions limit reached" status-bar reporter is not ported.
        "editor.foldingMaximumRegions": {
            scope: "language-overridable",
            type: "number",
            default: 5000,
            minimum: 10,
            // Upstream: "limit must be less than foldingRanges MAX_FOLDING_REGIONS".
            maximum: 65000,
            description:
                "The maximum number of foldable regions. Increasing this value may result in the editor becoming " +
                "less responsive when the current source has a large number of foldable regions.",
        },
        // Without a color picker: "and color picker" is upstream's wording. `colorDecoratorsActivatedOn` is not ported.
        "editor.colorDecorators": {
            scope: "language-overridable",
            type: "boolean",
            default: true,
            description: "Controls whether the editor should render the inline color decorators and color picker.",
        },
        "editor.defaultColorDecorators": {
            scope: "language-overridable",
            type: "string",
            enum: ["auto", "always", "never"],
            enumDescriptions: [
                "Show default color decorators only when no extension provides colors decorators.",
                "Always show default color decorators.",
                "Never show default color decorators.",
            ],
            default: "auto",
            description:
                "Controls whether inline color decorations should be shown using the default document color provider.",
        },
        "editor.colorDecoratorsLimit": {
            scope: "language-overridable",
            type: "integer",
            default: 500,
            minimum: 1,
            maximum: 1000000,
            description: "Controls the max number of color decorators that can be rendered in an editor at once.",
        },
        // "multiFile" is not supported and behaves like "singleFile".
        "editor.occurrencesHighlight": {
            scope: "language-overridable",
            type: "string",
            enum: ["off", "singleFile", "multiFile"],
            default: "singleFile",
            description: "Controls whether the editor highlights semantic symbol occurrences.",
        },
        // Our own key: VS Code draws the overview ruler inside its scrollbar and has nowhere else to put it.
        "editor.scrollbarMarkers": {
            scope: "language-overridable",
            type: "string",
            enum: ["off", "auto", "inside", "outside"],
            enumDescriptions: [
                "Do not mark highlights on the scrollbar.",
                "Draw the marks in a column of their own when the editor is at least 80 columns wide, inside the scrollbar otherwise.",
                "Draw the marks inside the scrollbar; the scrollbar thumb then moves in whole cells.",
                "Always draw the marks in a column of their own, left of the scrollbar.",
            ],
            default: "auto",
            description:
                "Controls where the editor marks what the file has highlighted (problems, find matches, source control changes, occurrences of the word under the cursor) along the scrollbar.",
        },
        // Upstream has no `type` (only `enum`); our schema requires it.
        "editor.semanticHighlighting.enabled": {
            scope: "language-overridable",
            type: ["boolean", "string"],
            enum: [true, false, "configuredByTheme"],
            enumDescriptions: [
                "Semantic highlighting enabled for all color themes.",
                "Semantic highlighting disabled for all color themes.",
                "Semantic highlighting is configured by the current color theme's `semanticHighlighting` setting.",
            ],
            default: "configuredByTheme",
            description: "Controls whether the semanticHighlighting is shown for the languages that support it.",
        },
        "editor.smartSelect.selectLeadingAndTrailingWhitespace": {
            scope: "language-overridable",
            type: "boolean",
            default: true,
            description: "Whether leading and trailing whitespace should always be selected.",
        },
        "editor.smartSelect.selectSubwords": {
            scope: "language-overridable",
            type: "boolean",
            default: true,
            description: "Whether subwords (like 'foo' in 'fooBar' or 'foo_bar') should be selected.",
        },
        "editor.emptySelectionClipboard": {
            scope: "language-overridable",
            type: "boolean",
            default: true,
            description: "Controls whether copying without a selection copies the current line.",
        },
        "editor.contextmenu": {
            scope: "language-overridable",
            type: "boolean",
            default: true,
            description: "Controls whether the editor shows the context menu.",
        },
        "editor.wordWrap": {
            scope: "language-overridable",
            type: "string",
            enum: ["off", "on", "wordWrapColumn", "bounded"],
            default: "off",
            description:
                "Controls how lines should wrap: never ('off'), at the viewport width ('on'), or at " +
                "`editor.wordWrapColumn` ('wordWrapColumn'/'bounded'; both are capped by the viewport width).",
        },
        "editor.wordWrapColumn": {
            scope: "language-overridable",
            type: "number",
            default: 80,
            description: "Controls the wrapping column when `editor.wordWrap` is 'wordWrapColumn' or 'bounded'.",
        },
        // Upstream: a file above 20 MB or 300K lines gets its heavy features turned off. Our deviation: it also
        // opens read-only (docs/arch/Editor.md, "Large-file mode"), and the thresholds are settings of our own.
        "editor.largeFileOptimizations": {
            scope: "language-overridable",
            type: "boolean",
            default: true,
            description: "Special handling for large files to disable certain memory intensive features.",
        },
        // Our own keys (human's decision 2026-10-23: the threshold is a setting); upstream has constants.
        "editor.largeFileSizeThreshold": {
            scope: "language-overridable",
            type: "number",
            default: LARGE_FILE_SIZE_THRESHOLD_MB,
            minimum: 1,
            description:
                "The size in megabytes above which a file is treated as large when `editor.largeFileOptimizations` " +
                "is on: it opens read-only with tokenization, wrapping, folding, word highlighting, quick diff and " +
                "extension sync turned off.",
        },
        "editor.largeFileLineCountThreshold": {
            scope: "language-overridable",
            type: "number",
            default: LARGE_FILE_LINE_COUNT_THRESHOLD,
            minimum: 1,
            description:
                "The number of lines above which a file is treated as large when `editor.largeFileOptimizations` " +
                "is on.",
        },
        "editor.formatOnSave": {
            scope: "language-overridable",
            type: "boolean",
            default: false,
            description: "Format a file on save. A formatter must be available (an extension providing it).",
        },
        // As upstream, gates only the automatic request: `editor.action.inlineSuggest.trigger` works even with `false`.
        "editor.inlineSuggest.enabled": {
            scope: "language-overridable",
            type: "boolean",
            default: true,
            description: "Controls whether to automatically show inline suggestions in the editor.",
        },
        "editor.inlineSuggest.suppressSuggestions": {
            scope: "language-overridable",
            type: "boolean",
            default: false,
            description:
                "Controls how inline suggestions interact with the suggest widget. If enabled, the suggest widget is " +
                "not shown automatically when inline suggestions are available.",
        },
        // Upstream's schema is anyOf; we have no anyOf, so three types without enum, and
        // `readQuickSuggestions` validates the modes (garbage → default, like upstream's `validate`).
        "editor.quickSuggestions": {
            scope: "language-overridable",
            type: ["boolean", "string", "object"],
            default: { other: "offWhenInlineCompletions", comments: "off", strings: "off" },
            description:
                "Controls whether suggestions should automatically show up while typing. This can be controlled for " +
                "typing in comments, strings, and other code. Quick suggestion can be configured to show as ghost " +
                "text or with the suggest widget. Also be aware of the `#editor.suggestOnTriggerCharacters#`-setting " +
                "which controls if suggestions are triggered by special characters.",
        },
        "editor.quickSuggestionsDelay": {
            scope: "language-overridable",
            type: "number",
            default: 10,
            minimum: 0,
            // Upstream's Constants.MAX_SAFE_SMALL_INTEGER (1 << 30).
            maximum: 1073741824,
            description: "Controls the delay in milliseconds after which quick suggestions will show up.",
        },
        "editor.suggestOnTriggerCharacters": {
            scope: "language-overridable",
            type: "boolean",
            default: true,
            description: "Controls whether suggestions should automatically show up when typing trigger characters.",
        },
        // `offWithInlineSuggestions` looks at `github.copilot.enable`, not `editor.inlineSuggest.enabled`,
        // like upstream (`CompletionService.wordBasedSuggestionsOff`).
        "editor.wordBasedSuggestions": {
            scope: "language-overridable",
            type: "string",
            enum: ["off", "offWithInlineSuggestions", "currentDocument", "matchingDocuments", "allDocuments"],
            enumDescriptions: [
                "Turn off Word Based Suggestions.",
                "Turn off Word Based Suggestions when Inline Suggestions are present.",
                "Only suggest words from the active document.",
                "Suggest words from all open documents of the same language.",
                "Suggest words from all open documents.",
            ],
            default: "offWithInlineSuggestions",
            description:
                "Controls whether completions should be computed based on words in the document and from which " +
                "documents they are computed.",
        },
        // Our own keys: upstream's debounce is adaptive and hardcoded, and it has no timeout (CancellationToken).
        "editor.inlineSuggest.delay": {
            scope: "language-overridable",
            type: "number",
            default: 50,
            minimum: 0,
            description:
                "Milliseconds to wait after a change before automatically requesting an inline suggestion. " +
                "0 requests on every change; higher values spare a slow or metered provider.",
        },
        "editor.inlineSuggest.requestTimeout": {
            scope: "language-overridable",
            type: "number",
            default: 5000,
            minimum: 1,
            description:
                "Milliseconds to wait for an inline suggestion provider to answer. " +
                "After that the request is given up on and no suggestion is shown.",
        },
        // "explicit" ≡ true: every diode save is manual.
        "editor.codeActionsOnSave": {
            scope: "language-overridable",
            type: ["object", "array"],
            default: {},
            description:
                'Code action kinds to be run on save (e.g. `{"source.fixAll": true}`). ' +
                "Kinds match hierarchically: `source.fixAll` also runs `source.fixAll.ruff`.",
        },
        // There is no Peek widget: "peek" shows the References panel instead (Extensions.md, Definition seam).
        // The deprecated `editor.gotoLocation.multiple` is not registered.
        "editor.gotoLocation.multipleDefinitions": {
            ...gotoLocationMultiple,
            description: "Controls the behavior the 'Go to Definition'-command when multiple target locations exist.",
        },
        "editor.gotoLocation.multipleTypeDefinitions": {
            ...gotoLocationMultiple,
            description:
                "Controls the behavior the 'Go to Type Definition'-command when multiple target locations exist.",
        },
        "editor.gotoLocation.multipleDeclarations": {
            ...gotoLocationMultiple,
            description: "Controls the behavior the 'Go to Declaration'-command when multiple target locations exist.",
        },
        "editor.gotoLocation.multipleImplementations": {
            ...gotoLocationMultiple,
            description:
                "Controls the behavior the 'Go to Implementations'-command when multiple target locations exist.",
        },
        "editor.gotoLocation.multipleReferences": {
            ...gotoLocationMultiple,
            description: "Controls the behavior the 'Go to References'-command when multiple target locations exist.",
        },
        "editor.gotoLocation.alternativeDefinitionCommand": {
            ...gotoLocationAlternative,
            default: "editor.action.goToReferences",
            description:
                "Alternative command id that is being executed when the result of 'Go to Definition' is the current location.",
        },
        "editor.gotoLocation.alternativeTypeDefinitionCommand": {
            ...gotoLocationAlternative,
            default: "editor.action.goToReferences",
            description:
                "Alternative command id that is being executed when the result of 'Go to Type Definition' is the current location.",
        },
        "editor.gotoLocation.alternativeDeclarationCommand": {
            ...gotoLocationAlternative,
            default: "editor.action.goToReferences",
            description:
                "Alternative command id that is being executed when the result of 'Go to Declaration' is the current location.",
        },
        "editor.gotoLocation.alternativeImplementationCommand": {
            ...gotoLocationAlternative,
            default: "",
            description:
                "Alternative command id that is being executed when the result of 'Go to Implementation' is the current location.",
        },
        "editor.gotoLocation.alternativeReferenceCommand": {
            ...gotoLocationAlternative,
            default: "",
            description:
                "Alternative command id that is being executed when the result of 'Go to Reference' is the current location.",
        },
    },
} as const satisfies IConfigurationNode;
