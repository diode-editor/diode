import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ensureE2eArtifacts } from "../scripts/e2e-artifacts.mjs";
import { setup as setupTmpRoot } from "../src/TestUtils/tmpRoot.ts";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

// Бинари для прогона — неизменяемая сборка из общего кэша по хешу исходников
// (scripts/e2e-artifacts.mjs): попадание — ноль секунд, промах — одна сборка в
// отдельный каталог, публикуемая атомарно и затем read-only. Рабочий `dist/` прогон
// не трогает вовсе: ручной `build:sea` посреди e2e больше ничего не ломает, а
// редактор, открытый сценарием на репозитории, не смотрит на сотни МБ записи.
//
// Пути уходят воркерам через env (`DIODE_E2E_BINARY`, `DIODE_E2E_SELFEXTRACT`):
// форки наследуют env родителя на момент спавна, то есть после globalSetup.
// Воркер не собирает никогда (helpers/buildOnce.ts). Self-extract — POSIX
// sh-стаб, под Windows его нет (selfextract.test.ts там пропускается).
//
// Тем же наследованием едет `TMPDIR`: все временные каталоги прогона ложатся в
// один корень, который teardown сносит целиком — вместе с процессами, которые
// в нём ещё живут (см. src/TestUtils/tmpRoot.ts).
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
