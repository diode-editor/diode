// Replaces `main.ts` so the TUI/CLI never boots; run via `node --import tsx`, see `subprocessSpawnArgsForTests()`.
import { runExtensionHostSubprocess } from "../extensionHostSubprocess.ts";

runExtensionHostSubprocess();
