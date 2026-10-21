// Вместо `main.ts`, чтобы не поднимать TUI/CLI; запуск — `node --import tsx`, см. `subprocessSpawnArgsForTests()`.
import { runExtensionHostSubprocess } from "../extensionHostSubprocess.ts";

runExtensionHostSubprocess();
