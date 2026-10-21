import { onTestFinished } from "vitest";

import { type AppEnvOptions, type HeadlessApp, type PtyApp, type PtyAppOptions, startHeadlessApp, startPtyApp } from "./appSession.ts";
import { dumpSession, type DumpableSession } from "./diagnostics.ts";

// Separate from `appSession.ts` so that file stays free of vitest: it is imported by
// `runScenario`, which also runs outside the test runner.

/** The session cleans itself up when the test ends; on failure, a post-mortem comes first. */
export async function useHeadlessApp(options: AppEnvOptions = {}): Promise<HeadlessApp> {
    const app = await startHeadlessApp(options);
    // Post-mortem and cleanup in ONE hook: vitest calls `onTestFinished` BEFORE `onTestFailed`, so the
    // snapshot from `onTestFailed` hit an already disposed session, and the request to the closed socket hung
    // for the whole `hookTimeout`.
    onTestFinished(async ({ task }) => {
        await finishHeadlessApp(app, task.result?.state === "fail");
    });
    return app;
}

/** Narrowed so it can be faked in tests. */
export interface FinishableApp {
    readonly session: DumpableSession;
    readonly env: { readonly root: string };
    dispose(): Promise<void>;
}

/**
 * Cleanup always runs: diagnostics must neither mask the original failure nor leave the
 * editor orphaned.
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
