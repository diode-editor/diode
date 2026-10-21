import { onTestFinished } from "vitest";

import { type AppEnvOptions, type HeadlessApp, type PtyApp, type PtyAppOptions, startHeadlessApp, startPtyApp } from "./appSession.ts";
import { dumpSession, type DumpableSession } from "./diagnostics.ts";

// Отдельно от `appSession.ts`, чтобы тот оставался свободным от vitest: его импортит
// `runScenario`, живущий и вне раннера.

/** Сессия убирается сама по окончании теста; на падении — сперва пост-мортем. */
export async function useHeadlessApp(options: AppEnvOptions = {}): Promise<HeadlessApp> {
    const app = await startHeadlessApp(options);
    // Пост-мортем и уборка — ОДНИМ хуком: vitest зовёт `onTestFinished` РАНЬШЕ `onTestFailed`, и
    // снимок из `onTestFailed` доставался уже убранной сессии, а запрос в закрытый сокет висел весь `hookTimeout`.
    onTestFinished(async ({ task }) => {
        await finishHeadlessApp(app, task.result?.state === "fail");
    });
    return app;
}

/** Сужена, чтобы фейкаться в тесте. */
export interface FinishableApp {
    readonly session: DumpableSession;
    readonly env: { readonly root: string };
    dispose(): Promise<void>;
}

/**
 * Уборка — в любом случае: диагностика не должна ни маскировать исходное падение, ни оставить
 * редактор сиротой.
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

export async function usePtyApp(options: PtyAppOptions = {}): Promise<PtyApp> {
    const app = await startPtyApp(options);
    onTestFinished(async () => {
        await app.dispose();
    });
    return app;
}
