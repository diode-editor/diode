/**
 * Слой поверх дефолтов манифеста, ниже пользовательских настроек (переопределяем).
 *
 * - basedpyright: `fromEnvironment` ищет сервер через API ms-python.python и роняет всю активацию,
 *   когда того нет (вызов в activate() не обёрнут, проверено на 1.40.0), — остаётся вшитый сервер.
 * - ruff: `fromEnvironment` зависит от PATH; вшитый нативный бинарь детерминирован (bundled ≥ 0.5.3).
 * - redhat.java: lombok на jdt.ls 1.57 + JDK 21 ломает компиляцию всего проекта («Internal compiler
 *   error», `NoSuchFieldError … constructorCall`). `updateBuildConfiguration` не трогаем: вопрос
 *   «Synchronize now» с #352 отвечаем, `"automatic"` молча забрал бы решение у человека.
 * - Anthropic.claude-code: webview-панели в TUI нет (docs/public/API-COVERAGE.md) — рабочий только
 *   терминальный режим.
 *
 * Id без учёта регистра: id расширений VS Code регистронезависимы (`Anthropic`, `DetachHead`).
 */
export function curatedConfigInjection(extensionId: string): Record<string, unknown> {
    const id = extensionId.toLowerCase();
    if (id === "detachhead.basedpyright") {
        return { "basedpyright.importStrategy": "useBundled" };
    }
    if (id === "charliermarsh.ruff") {
        return { "ruff.importStrategy": "useBundled" };
    }
    if (id === "redhat.java") {
        return { "java.jdt.ls.lombokSupport.enabled": false };
    }
    if (id === "anthropic.claude-code") {
        return { "claudeCode.useTerminal": true };
    }
    return {};
}
