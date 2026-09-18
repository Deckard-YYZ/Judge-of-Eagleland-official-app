import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const inventory = JSON.parse(await readFile(join(root, "src-tauri/voice/keywords.json"), "utf8"));
const tokens = new Set(
  (await readFile(join(root, "artifacts/voice/model/tokens.txt"), "utf8"))
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split(/\s+/)[0]),
);
const jing = ["īng", "íng", "ǐng", "ìng", "ing"];
const jin = ["īn", "ín", "ǐn", "ìn", "in"];
const li = ["ī", "í", "ǐ", "ì", "i"];
const output = join(root, "artifacts/voice-cli/keywords");
await mkdir(output, { recursive: true });
for (const [name, finals, initials] of [
  ["salute-tones", jing, ["l"]],
  ["salute-near", [...jing, ...jin], ["l", "n"]],
]) {
  const lines = new Set(inventory.keywords["zh-CN"].trim().split(/\r?\n/));
  // Experimental pronunciation paths share an action label. Do not add single syllables.
  for (const final of finals) {
    for (const initial of initials) {
      for (const vowel of li) {
        const sequence = ["j", final, initial, vowel];
        if (sequence.some((token) => !tokens.has(token))) throw new Error("Unknown model token");
        lines.add(`${sequence.join(" ")} @salute`);
      }
    }
  }
  await writeFile(join(output, `${name}.txt`), [...lines].join("\n") + "\n", "utf8");
  console.log(`${name}: ${lines.size} keyword paths`);
}
