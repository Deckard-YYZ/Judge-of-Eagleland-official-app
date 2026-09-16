import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));

// main.tsx / app 是装配入口；业务层只允许按表向下依赖。
const allowedLayers = {
  game: new Set(["game", "content", "shared"]),
  content: new Set(["content", "platform", "shared"]),
  storage: new Set(["storage", "game", "content", "shared"]),
  application: new Set(["application", "game", "content", "storage", "shared"]),
  ui: new Set(["ui", "application", "content", "input", "shared"]),
  input: new Set(["input", "shared"]),
  platform: new Set(["platform"]),
  shared: new Set(["shared"]),
};

const allowedPackages = {
  game: new Set(["zod"]),
  content: new Set(["zod"]),
  storage: new Set(["zod", "@tauri-apps/plugin-sql"]),
  application: new Set(["zod", "zustand"]),
  ui: new Set(["react", "react-dom"]),
  input: new Set(),
  platform: new Set(["@tauri-apps/api"]),
  shared: new Set(),
};

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const groups = await Promise.all(
    entries.map((entry) => {
      const filename = path.join(directory, entry.name);

      return entry.isDirectory()
        ? sourceFiles(filename)
        : /\.tsx?$/.test(filename)
          ? [filename]
          : [];
    }),
  );

  return groups.flat();
}

function packageName(specifier) {
  return specifier.startsWith("@")
    ? specifier.split("/").slice(0, 2).join("/")
    : specifier.split("/")[0];
}

const violations = [];

for (const filename of await sourceFiles(sourceRoot)) {
  const relative = path.relative(sourceRoot, filename);
  const layer = relative.split(path.sep)[0];

  if (!(layer in allowedLayers)) {
    continue;
  }

  const source = ts.createSourceFile(
    filename,
    await readFile(filename, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );

  function check(specifier, typeOnly) {
    if (specifier.startsWith(".")) {
      const target = path.relative(sourceRoot, path.resolve(path.dirname(filename), specifier));
      const targetLayer = target.split(path.sep)[0];

      if (!allowedLayers[layer].has(targetLayer)) {
        violations.push(`${relative}: ${layer} cannot import ${specifier}`);
      }

      // 模型复用纯 Zod Schema；规则与 UI 不读取具体内容包或加载实现。
      const sharedSchema =
        relative === path.join("game", "model.ts") && target === path.join("content", "schema");

      if (
        ["ui", "game"].includes(layer) &&
        targetLayer === "content" &&
        !typeOnly &&
        !sharedSchema
      ) {
        violations.push(`${relative}: content imports must use import type`);
      }
    } else if (!allowedPackages[layer].has(packageName(specifier))) {
      violations.push(`${relative}: ${layer} cannot import ${specifier}`);
    }
  }

  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const typeOnly = ts.isImportDeclaration(node)
        ? Boolean(node.importClause?.isTypeOnly)
        : node.isTypeOnly;

      check(node.moduleSpecifier.text, typeOnly);
    }

    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      const argument = node.arguments[0];

      if (argument && ts.isStringLiteral(argument)) {
        check(argument.text, false);
      } else {
        violations.push(`${relative}: dynamic module paths cannot be checked`);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(source);
}

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Module dependency boundaries passed.");
}
