import { onTestFinished } from "vitest";

import { type AppEnvOptions, type HeadlessApp, type PtyApp, type PtyAppOptions, startHeadlessApp, startPtyApp } from "./appSession.ts";
import { dumpSession, type DumpableSession } from "./diagnostics.ts";

// Vitest-обёртки над `startHeadlessApp`/`startPtyApp`: сессия сама убирается по
// окончании теста (`onTestFinished`), поэтому в сьютах не нужен ни `afterEach`,
// ни ручной `dispose`. Держим отдельно от `appSession.ts`, чтобы тот оставался
// свободным от vitest (его импортит `runScenario`, живущий и вне раннера).

/**
 * Изолированная headless-сессия, привязанная к жизненному циклу теста. При
 * падении печатает пост-мортем (кадр, фокус, дерево) до уборки; гасится и на
 * успехе, и на падении.
 */
export async function useHeadlessApp(options: AppEnvOptions = {}): Promise<HeadlessApp> {
    const app = await startHeadlessApp(options);
    // Пост-мортем и уборка — ОДНИМ хуком: vitest зовёт `onTestFinished` РАНЬШЕ
    // `onTestFailed` (runner: `test.onFinished` → `test.onFailed`), и снимок из
    // `onTestFailed` доставался уже убранной сессии — ни кадра, ни дерева, а
    // запрос в закрытый сокет висел весь `hookTimeout` (три минуты на падение).
    onTestFinished(async ({ task }) => {
        await finishHeadlessApp(app, task.result?.state === "fail");
    });
    return app;
}

/** Часть {@link HeadlessApp}, нужная завершению теста (сужена — фейкается в тесте). */
export interface FinishableApp {
    readonly session: DumpableSession;
    readonly env: { readonly root: string };
    dispose(): Promise<void>;
}

/**
 * Завершение теста с headless-сессией: у упавшего — пост-мортем с ЕЩЁ ЖИВОЙ
 * сессии, затем уборка. Уборка — в любом случае: диагностика не должна ни
 * маскировать исходное падение, ни оставить редактор сиротой.
 */
export async function finishHeadlessApp(
    app: FinishableApp,
    failed: boolean,
    print: (text: string) => void = (text) => {
        console.error(text);
    },
): Promise<void> {
    try {
        if (failed) print(`\n${await dumpSession(app.session, { root: app.env.root, label: "e2e failure" })}`);
    } finally {
        await app.dispose();
    }
}

/** То же для PTY-транспорта (ANSI-уровень). */
export async function usePtyApp(options: PtyAppOptions = {}): Promise<PtyApp> {
    const app = await startPtyApp(options);
    onTestFinished(async () => {
        await app.dispose();
    });
    return app;
}
