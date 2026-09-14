// Тестовый вход runAsNode.eval.test.ts: эмулирует RUN_AS_NODE-ветку под
// обычным node (argv-арифметика совпадает: argv[1] — этот файл ↔ SEA-плейсхолдер).
import { runAsNode } from "./runAsNode.ts";

runAsNode();
