import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "extensions/**/*.test.ts", "tools/**/*.test.ts"],
    // onUnexpectedError (incl. an Emitter listener exception) fails the test instead of drowning in the console.
    setupFiles: ["src/TestUtils/unexpectedErrors.setup.ts"],
    // Known flakes from test-flakes.json are retried or skipped (docs/TODO/TestFlakes.md); Stryker reuses this config.
    runner: "src/TestUtils/flakeTestRunner.ts",
    // Temp directories go under one root (TMPDIR) that teardown removes entirely:
    // after SIGKILL/OOM afterEach does not run, and leftovers stayed in /tmp forever.
    globalSetup: ["src/TestUtils/tmpRoot.ts"],
    coverage: {
      skipFull: true,
      reportOnFailure: true,
      provider: "v8",
      // Ratchet: autoUpdate raises the numbers after coverage; exclusions are in docs/TESTING.md.
      thresholds: {
        autoUpdate: true,
        statements: 54.86,
        branches: 48.71,
        functions: 37.5,
        lines: 57.28,
      },
      reporter: ["text", "lcov", "json", "json-summary", "text-summary"],
      include: ["src/**/*.ts", "extensions/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",

        "src/**/*.bench.ts", // perf benchmarks, run separately by test:perf
        "src/TestUtils/perfFixtures.ts", // fixtures for benches only (shim)
        "src/vs/workbench/api/common/testStubRpc.ts", // test RpcEndpoint stub for namespace unit tests
        "src/TestUtils/basedpyrightFixture.ts", // pythonLsp* suite harness: the until() timeout branch is reachable only in a red run
        "src/TestUtils/stockVsix.ts", // downloads a vsix from the marketplace (error branches, network/broken registry, are reachable only in a red run)
        "src/TestUtils/eslintFixture.ts", // eslintLsp* suite harness: npm install of the library is reachable only on a cold cache (network), the rename race only in a parallel run
        "src/**/*.stories.ts",
        "src/demos/**",
        "src/vs/diode/main.ts",
        "src/vs/diode/roles/**", // lazy chunk entries for process roles (ext host, watcher): run only in a fork; gate: e2e on the SEA binary and the role integration suites
        "src/vs/diode/runAsNode.ts", // node mode of the SEA binary (DIODE_RUN_AS_NODE); gate: smoke in build-sea + e2e lspBundled; eval mode: runAsNode.eval.test.ts (child process, v8 coverage does not see the fork)
        "src/vs/diode/runAsNode.testEntry.ts", // child-process entry of runAsNode.eval.test.ts, runs only in a fork
        "src/vs/workbench/services/extensions/node/loadTsServer.ts", // the bundle source choice depends on the SEA/self-extract environment; pure extraction: extractBundleToCache (units), end to end: e2e lspBundled
        "src/StoryRunner/**",
        "src/vs/workbench/services/extensions/node/__fixtures__/**",

        // --- Vendored copy of upstream (scripts/import-vscode-editor.mjs): not our code ---
        // Gate: the upstream fixture corpus (diff/diffFixtures.test.ts), it catches a broken
        // copy more precisely than coverage. Shims base/common/{arrays,arraysFind,assert,errors,map,
        // strings}.ts are NOT here: they are hand-written and covered by the ratchet.
        "src/vs/editor/common/diff/linesDiffComputer.ts",
        "src/vs/editor/common/diff/rangeMapping.ts",
        "src/vs/editor/common/diff/defaultLinesDiffComputer/**",
        "src/vs/editor/common/core/{position,range,editOperation}.ts",
        "src/vs/editor/common/core/{ranges,text,edits}/**",
        "src/vs/base/common/charCode.ts",
        // Model tokenization: its gate is our adapter tests
        // (editor/common/tokens/documentTokenStore.*.test.ts) through the public seam.
        "src/vs/base/common/stopwatch.ts",
        "src/vs/editor/common/model/{textModelTokens,fixedArray}.ts",
        "src/vs/editor/common/core/misc/eolCounter.ts",
        // Binary token format (B2): gate is the same adapter and render tests.
        "src/vs/editor/common/encodedTokenAttributes.ts",
        "src/vs/editor/common/tokens/{lineTokens,contiguousMultilineTokens,contiguousMultilineTokensBuilder,contiguousTokensEditing}.ts",
        "src/vs/editor/common/languages/nullTokenize.ts",
        // PieceTree and buffer search: gate is the upstream PieceTree tests with
        // random edits (editor/test/common/model/pieceTreeTextBuffer/).
        "src/vs/editor/common/model/pieceTreeTextBuffer/**",
        "src/vs/editor/common/model/textModelSearch.ts",
        "src/vs/editor/common/core/{textChange,wordCharacterClassifier,characterClassifier}.ts",
        "src/vs/base/common/uint.ts",
        "**/__fixtures__/**", // test DATA (foreign sources), not executable code

        // --- Pure types: nothing to execute ---
        "src/**/*.d.ts", // vscode.d.ts
        // Pure types that fell out of the runtime graph after imports became
        // import type (eslint --fix during the move to the vs layout):
        "src/vs/editor/common/languages/iCompletionSource.ts",
        "src/vs/editor/common/languages/iInlineCompletionSource.ts",
        "src/vs/editor/common/languages/iFoldingSource.ts",
        "src/vs/editor/common/model/iDocumentLanguageChange.ts",
        "src/vs/platform/clipboard/common/iFileClipboard.ts",
        "src/vs/platform/state/common/iStateService.ts",
        "src/vs/platform/undoRedo/common/iUndoRedoElement.ts",
        "src/vs/workbench/api/common/vscodeHostContext.ts",
        "src/vs/workbench/browser/iActivatable.ts",
        "src/vs/workbench/common/iWorkbenchContribution.ts",
        "src/vs/workbench/contrib/quickaccess/common/iQuickAccessProvider.ts",
        "src/vs/workbench/services/textfile/common/iSaveParticipant.ts",
        "src/vs/workbench/services/themes/common/index.ts", // barrel re-export
        "src/vs/platform/clipboard/common/iClipboard.ts",
        "src/vs/base/common/assets/iAssetAccess.ts",
        "src/vs/platform/log/common/iLogService.ts",
        "src/vs/platform/log/common/iLogger.ts",
        "src/vs/platform/configuration/common/iConfigurationService.ts",
        "src/vs/editor/common/model/iGutterChangeDecoration.ts",
        "src/vs/editor/common/model/iDocumentContentChange.ts",
        "src/vs/editor/common/model/iTextDocument.ts",
        "src/vs/editor/common/model/iUndoElement.ts",
        "src/vs/platform/extensions/common/iExtension.ts",
        "src/vs/platform/extensions/common/iExtensionManifest.ts",
        "src/vs/platform/extensions/common/iGrammarContribution.ts",
        "src/vs/platform/extensions/common/iLanguageConfiguration.ts",
        "src/vs/platform/extensions/common/iLanguageContribution.ts",
        "src/vs/workbench/api/common/iEditorOptionsService.ts",
        "src/vs/workbench/api/common/iEditorDecorationsService.ts",
        "src/vs/workbench/api/common/iFileDecorationsService.ts",
        "src/vs/workbench/api/common/iThemeColorResolver.ts",
        "src/vs/workbench/services/extensions/node/iExtensionEntry.ts",
        "src/vs/workbench/api/common/iMessageChannel.ts",
        "src/vs/platform/theme/common/iEditorTokenTheme.ts",
        "src/vs/platform/theme/common/iThemeFile.ts",
        "src/vs/base/common/equals.ts", // shim of a single IEquatable interface

        // --- Not unit-testable (covered by e2e) ---
        "src/vs/platform/files/node/chokidarFileWatcher.ts", // real fs watcher (chokidar), e2e
        "src/vs/base/node/isSea.ts", // node:sea, only in the SEA binary
        "src/vs/base/node/assets/createDefaultAssetAccess.ts", // SEA vs dev + fs resolution
        "src/vs/base/node/assets/packagedRuntime.ts", // node:sea + import.meta.url resolution; the I/O part is in BundleFile.ts (units)
        "src/vs/workbench/services/extensions/node/extensionHostSubprocess.ts", // subprocess entry point + IPC
        "src/vs/platform/files/node/treeWatcherMain.ts", // watcher process entry point (process.send/on/exit); gate: treeWatcherMain.integration.test (real child process, v8 coverage does not see the fork)
        "src/vs/platform/files/node/treeWatcherMain.testEntry.ts", // child-process entry of the same suite, runs only in a fork
        "extensions/git/main.ts", // extension entry (subprocess IO/glue); logic is in git/lib/* (units), e2e covers integration
        "extensions/diode-lsp-typescript/main.ts", // extension entry (spawns languageclient); resolution logic is in lib/* (units), integration: the stock server in extensionHost.typescriptLsp.test
        "extensions/diode-settings/main.ts", // extension entry (loaded in a subprocess); behavior: ExtensionHost.SettingsCompletion.test.ts + e2e
        "src/**/*.generated.ts", // generated data files (e.g. settings-schema.generated.ts), run in a subprocess
        "src/vs/workbench/api/common/vscodeNamespace.ts", // RPC wiring in a subprocess
        "src/vs/diode/modules/**", // DI wiring (integration/e2e)
        "src/vs/platform/configuration/common/nullConfigurationService.ts", // null object stub
        "src/vs/platform/state/common/nullStateService.ts", // null object stub
      ],
    },
  },
});