import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { actionLexicons } from "../src/input/actionLexicons";

/** Single alias source for text and voice; no parallel hand-maintained action map. */
export const voiceAliasRows = Object.entries(actionLexicons).flatMap(([locale, actions]) =>
  Object.entries(actions).flatMap(([actionId, aliases]) =>
    aliases.map((alias) => ({ locale, actionId, alias })),
  ),
);
export const voiceAliasHash = createHash("sha256")
  .update(JSON.stringify(voiceAliasRows))
  .digest("hex");
const mode = process.argv[2];
if (mode === "--raw") {
  await mkdir("artifacts/voice", { recursive: true });
  await writeFile(
    "artifacts/voice/aliases.json",
    JSON.stringify({ aliasHash: voiceAliasHash, rows: voiceAliasRows }, null, 2),
  );
} else if (mode === "--check") {
  const generated = JSON.parse(await readFile("src-tauri/voice/keywords.json", "utf8"));
  if (
    generated.aliasHash !== voiceAliasHash ||
    JSON.stringify(generated.rows) !== JSON.stringify(voiceAliasRows)
  )
    throw new Error(
      "Voice aliases drifted; run npm run voice:prepare to regenerate official tokens",
    );
  for (const locale of Object.keys(actionLexicons)) {
    const words = generated.keywords[locale] as string;
    if (typeof words !== "string" || !words.trim())
      throw new Error(`Missing voice keywords for ${locale}`);
    const ids = new Set(
      words
        .split("\n")
        .filter(Boolean)
        .map((line) => line.split(" @")[1]),
    );
    for (const action of Object.keys(actionLexicons[locale as keyof typeof actionLexicons]))
      if (!ids.has(action)) throw new Error(`Missing voice action ${action}`);
  }
  console.log("Voice aliases match generated bilingual keyword inventory.");
}
