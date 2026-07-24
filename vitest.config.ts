import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "extensions/**/*.test.ts", "tuidom/**/*.test.ts", "tuidom/**/*.test.tsx"],
    coverage: {
      skipFull: true,
      reportOnFailure: true,
      provider: "v8",
      // Храповик: CI падает при регрессе покрытия, планка сама ползёт вверх,
      // когда покрытие растёт (autoUpdate перезаписывает числа ниже).
      // Цель — покрываем весь новый код; исключения см. ниже + docs/TESTING.md.
      thresholds: {
        autoUpdate: true,
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
      reporter: ["text", "lcov", "json", "json-summary", "text-summary"],
      include: ["src/**/*.ts", "extensions/**/*.ts", "tuidom/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",

        "src/**/*.bench.ts", // перф-бенчмарки, гоняются отдельным test:perf
        "tuidom/**/*.bench.ts",
        "src/TestUtils/perfFixtures.ts", // фикстуры только для бенчей
        "src/vs/workbench/api/common/testStubRpc.ts", // тестовый стаб RpcEndpoint для unit-тестов namespace'ов
        "src/**/*.stories.ts",
        "tuidom/**/*.stories.ts",
        "src/demos/**",
        "tuidom/demos/**",
        "src/vs/vexx/main.ts",
        "src/StoryRunner/**",
        "src/vs/workbench/services/extensions/node/__fixtures__/**",

        // --- Дословный перенос upstream vscode: не наш код ---
        // Переносится машинно (scripts/import-vscode-diff.mjs), правится только
        // сменой пина, ручные правки запрещены — покрывать нечего и незачем.
        // Настоящий гейт этого кода — фикстурный корпус upstream на 58 кейсов
        // (src/vs/editor/common/diff/diffFixtures.test.ts): он ловит поехавший
        // перенос точнее, чем построчное покрытие. Прецедент — vscode.d.ts ниже.
        // ВАЖНО: шимы в src/vs/base/common/{arrays,arraysFind,assert,errors,map,
        // strings}.ts сюда НЕ входят — они написаны руками, значит покрываются
        // храповиком на общих основаниях (тесты рядом с ними).
        "src/vs/editor/common/diff/linesDiffComputer.ts",
        "src/vs/editor/common/diff/rangeMapping.ts",
        "src/vs/editor/common/diff/defaultLinesDiffComputer/**",
        "src/vs/editor/common/core/{position,range,editOperation}.ts",
        "src/vs/editor/common/core/{ranges,text,edits}/**",
        "src/vs/base/common/charCode.ts",
        "**/__fixtures__/**", // тестовые ДАННЫЕ (чужие исходники), не исполняемый код

        // --- Чистые типы: нечего исполнять ---
        "src/**/*.d.ts", // vscode.d.ts
        // Чистые типы, выпавшие из рантайм-графа после перевода импортов в
        // import type (eslint --fix при переезде на vs-раскладку):
        "src/vs/editor/common/languages/iCompletionSource.ts",
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
        "tuidom/common/iTerminalSurface.ts",
        "tuidom/inspector/index.ts", // barrel re-export
        "tuidom/dom/styles/index.ts", // barrel re-export
        "src/vs/workbench/services/themes/common/index.ts", // barrel re-export
        "tuidom/backend/iTerminalBackend.ts",
        "src/vs/platform/clipboard/common/iClipboard.ts",
        "src/vs/base/common/assets/iAssetAccess.ts",
        "src/vs/platform/log/common/iLogService.ts",
        "src/vs/platform/log/common/iLogger.ts",
        "src/vs/platform/configuration/common/iConfigurationService.ts",
        "src/vs/editor/common/model/iGutterChangeDecoration.ts",
        "src/vs/editor/common/model/iDocumentContentChange.ts",
        "src/vs/editor/common/model/iTextDocument.ts",
        "src/vs/editor/common/model/iUndoElement.ts",
        "src/vs/editor/common/languages/iTokenizationSupport.ts",
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
        "tuidom/input/rawTerminalToken.ts",
        "tuidom/ui/tree/iTreeDataProvider.ts",
        "tuidom/ui/scrollbar/iScrollable.ts", // только интерфейсы (type guards удалены как мёртвые)
        "src/vs/platform/theme/common/iEditorTokenTheme.ts",
        "src/vs/platform/theme/common/iThemeFile.ts",
        "src/vs/platform/theme/common/ivsCodeThemeFile.ts",
        "src/Theme/IWorkbenchColors.ts",
        "src/vs/base/common/equals.ts", // шим из одного интерфейса IEquatable

        // --- Непокрываемо юнит-тестами (есть e2e) ---
        "tuidom/backend/nodeTerminalBackend.ts", // реальный tty/stdin/stdout
        "src/vs/platform/files/node/chokidarFileWatcher.ts", // реальный fs-watcher (chokidar), e2e
        "src/vs/base/node/isSea.ts", // node:sea, только в SEA-бинаре
        "src/vs/base/node/assets/createDefaultAssetAccess.ts", // SEA vs dev + fs-резолв
        "src/vs/base/node/assets/packagedRuntime.ts", // node:sea + резолв import.meta.url; I/O-часть — в BundleFile.ts (юниты)
        "src/vs/workbench/contrib/terminal/node/loadNodePty.ts", // SEA-путь загрузки нативного node-pty: node:sea + распаковка .node в tmp + dlopen; e2e — terminal.scenario.ts на реальном SEA-бинаре
        "src/vs/workbench/services/search/node/loadRipgrep.ts", // SEA-путь загрузки rg: node:sea + распаковка бинаря в tmp; dev-путь гоняет textSearchService.integration.test, e2e — search.scenario.ts на реальном SEA-бинаре
        "src/vs/workbench/services/extensions/node/extensionHostSubprocess.ts", // точка входа subprocess + IPC
        "extensions/git/main.ts", // extension entry (subprocess IO/glue); логика — в git/lib/* (юниты), e2e — интеграция
        "extensions/vexx-settings/main.ts", // extension entry (грузится в subprocess); поведение — в ExtensionHost.SettingsCompletion.test.ts + e2e
        "src/**/*.generated.ts", // сгенерированные data-файлы (напр. settings-schema.generated.ts), исполняются в subprocess
        "src/vs/workbench/api/common/vscodeNamespace.ts", // RPC-проводка в subprocess
        "src/vs/vexx/modules/**", // DI-проводка (integration/e2e)
        "src/vs/platform/configuration/common/nullConfigurationService.ts", // null-object заглушка
        "src/vs/platform/state/common/nullStateService.ts", // null-object заглушка
        "tuidom/inspector/InspectorDriver.ts", // только интерфейс write/capture-порта
        "tuidom/inspector/InspectorServer.ts", // рукописный ws-транспорт (смоук-тест)
        "tuidom/inspector/ws/**", // рукописный RFC6455 фрейминг
        "tuidom/inspector/attachInspector.ts", // поднимает реальный сервер (смоук-тест)
      ],
    },
  },
});