import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

const execute = promisify(execFile);

export async function checkTools(root: string) {
  const nodeMajor = Number(process.versions.node.split(".")[0]);

  if (nodeMajor < 22)
    throw new Error("Node >=22 is required by the installed Wrangler");

  const wrangler = z
    .object({ version: z.string().regex(/^4\./) })
    .parse(
      JSON.parse(
        await readFile(
          resolve(root, "node_modules/wrangler/package.json"),
          "utf8",
        ),
      ),
    );

  const git = await execute("git", ["--version"], { timeout: 10_000 });

  if (!/^git version 2\./.test(git.stdout))
    throw new Error("Git 2.x is required");

  return {
    node: process.versions.node,
    wrangler: wrangler.version,
    git: git.stdout.trim(),
    cloudAccess: "not checked",
  };
}
