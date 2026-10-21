import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ensureE2eArtifacts } from "../scripts/e2e-artifacts.mjs";
import { setup as setupTmpRoot } from "../src/TestUtils/tmpRoot.ts";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

// Бинари — неизменяемая сборка из общего кэша по хешу исходников (scripts/e2e-artifacts.mjs);
// рабочий `dist/` прогон не трогает, ручной `build:sea` посреди e2e ничего не ломает.
// Пути уходят воркерам через env (`DIODE_E2E_BINARY`, `DIODE_E2E_SELFEXTRACT`): форки
// наследуют env на момент спавна, то есть после globalSetup; воркер не собирает никогда.
// Тем же путём едет `TMPDIR`: временные каталоги прогона — в одном корне, который
// teardown сносит вместе с живущими в нём процессами (src/TestUtils/tmpRoot.ts).
export default function setup(): () => void {
    const artifacts = ensureE2eArtifacts({ repoRoot });
    const teardownTmpRoot = setupTmpRoot();
    process.env.DIODE_E2E_BINARY = artifacts.binary;
    if (artifacts.selfExtract !== undefined) process.env.DIODE_E2E_SELFEXTRACT = artifacts.selfExtract;
    return () => {
        teardownTmpRoot();
        artifacts.release();
    };
}
