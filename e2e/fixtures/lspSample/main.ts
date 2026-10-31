import { f, greet } from "./defs";

const reply: number = greet("world");

f("overloaded");

export { reply };
