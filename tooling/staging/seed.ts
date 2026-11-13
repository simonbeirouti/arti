import { execFile } from "node:child_process";
import { cp, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import {
  repositoryIds,
  resourceNames,
  type StagingConfiguration,
} from "./configuration";
import { CloudflareAdmin, repositoryRecord } from "./provider";

const execute = promisify(execFile);

/** Prepare only trusted platform files; canonical repositories are seeded only when empty. */
export async function prepareRepositorySeed(root: string, cwd: string, id: typeof repositoryIds[number]): Promise<void> {
  await cp(join(root, "templates/entity"), cwd, { recursive: true });
  await writeFile(join(cwd, "entity.json"), JSON.stringify({ id, name: id === 'collective' ? 'Arti collective' : id, schemaVersion: 1 }) + "\n");

  if (id === 'collective') {
    await writeFile(join(cwd, 'project.json'), JSON.stringify({ id, name: 'Arti collective', repository: 'collective', schemaVersion: 1 }) + '\n');
    const worker = await readFile(join(cwd, 'site/worker.ts'), 'utf8');
    await writeFile(join(cwd, 'site/worker.ts'), worker.replace('Arti entity', 'Arti collective').replace('My public presence', 'One shared website').replace('This entity is growing within Arti.', 'A platform starter awaiting checked agent contributions. This is not evidence of completed autonomous work.'));
    const tests = await readFile(join(cwd, 'tests/worker.test.mjs'), 'utf8');
    await writeFile(join(cwd, 'tests/worker.test.mjs'), tests.replace('My public presence', 'One shared website'));

  }
}

export async function seedRepositories(
  config: StagingConfiguration,
  admin: CloudflareAdmin,
  root: string,
) {
  return seedCanonicalRepositories(admin, resourceNames(config).artifacts, config.accountId, root, repositoryIds);
}

/** Targeted setup for an already inspected namespace; never invent account configuration. */
export async function seedCanonicalRepositories(
  admin: CloudflareAdmin,
  namespace: string,
  accountId: string,
  root: string,
  ids: readonly typeof repositoryIds[number][],
): Promise<string[]> {
  z.string().regex(/^[a-f0-9]{32}$/).parse(accountId);
  z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/u).parse(namespace);
  const targets = z.array(z.enum(repositoryIds)).min(1).max(repositoryIds.length).parse([...ids]);

  if (admin.path('') !== `/accounts/${accountId}` || new Set(targets).size !== targets.length) throw new Error('Seed account or repository selection mismatch');
  const seeded: string[] = [];

  for (const id of targets) {
    const base = `/artifacts/namespaces/${namespace}`;

    const repo = await admin.call(
      "GET",
      admin.path(`${base}/repos/${id}`),
      repositoryRecord,
    );

    if (!repo) throw new Error(`Repository missing before seed: ${id}`);

    if (repo.last_push_at !== null) continue; // Never rewrite existing canonical history.

    const token = await admin.call(
      "POST",
      admin.path(`${base}/tokens`),
      z.object({ id: z.string(), plaintext: z.string().min(1) }),
      { repo: id, scope: "write", ttl: 900 },
    );

    if (!token) throw new Error("Repository token issuance failed");
    let cwd = "";

    const env = {
      PATH: process.env.PATH,
      TMPDIR: process.env.TMPDIR,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
      GIT_AUTHOR_NAME: "Arti provisioner",
      GIT_AUTHOR_EMAIL: "provisioner@arti.invalid",
      GIT_COMMITTER_NAME: "Arti provisioner",
      GIT_COMMITTER_EMAIL: "provisioner@arti.invalid",
    };

    const git = async (args: string[], authentication = false) => {
      const variables = authentication
        ? {
            ...env,
            GIT_CONFIG_COUNT: "1",
            GIT_CONFIG_KEY_0: `http.https://${accountId}.artifacts.cloudflare.net/.extraHeader`,
            GIT_CONFIG_VALUE_0: `Authorization: Bearer ${token.plaintext}`,
          }
        : env;

      await execute("git", ["-c", "core.hooksPath=/dev/null", ...args], {
        cwd,
        env: variables,
        timeout: 120_000,
        maxBuffer: 1024 * 1024,
      }).catch(() => {
        throw new Error(`Git repository initialization failed: ${id}`);
      });
    };

    try {
      cwd = await mkdtemp(join(tmpdir(), "arti-seed-"));
      await prepareRepositorySeed(root, cwd, id);
      await git(["init", "--initial-branch=main"]);
      await git(["add", "."]);
      await git(["commit", "-m", `Initialize ${id} from Arti trusted platform template`]);
      // No remote credential is stored in Git config or process arguments. No force push.
      await git(
        [
          "push",
          `https://${accountId}.artifacts.cloudflare.net/git/${namespace}/${id}.git`,
          "HEAD:refs/heads/main",
        ],
        true,
      );
      seeded.push(id);
    } finally {
      try {
        await admin.call(
          "DELETE",
          admin.path(`${base}/tokens/${encodeURIComponent(token.id)}`),
          z.json(),
        );
      } finally {
        if (cwd) await rm(cwd, { recursive: true, force: true });
      }
    }
  }

  return seeded;
}
