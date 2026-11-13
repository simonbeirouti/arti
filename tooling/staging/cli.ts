import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { stagingConfiguration, resourceInventory } from "./configuration";
import { generateConfigurations } from "./generate";
import { CloudflareAdmin } from "./provider";
import { provision, provisionPlan } from "./provision";
import { seedRepositories } from "./seed";
import { checkTools } from "./tools";
import { z } from "zod";

export async function stagingCli(args: string[]) {
  const [command, file, ...options] = args;

  if (command === "doctor") {
    console.log(JSON.stringify(await checkTools(process.cwd()), null, 2));

    return;
  }

  if (!file || !["plan", "inspect", "apply", "generate"].includes(command))
    throw new Error(
      "Usage: staging <plan|inspect|apply|generate> configuration.json [--confirm PREFIX | --inventory FILE]",
    );

  const config = stagingConfiguration.parse(
    JSON.parse(await readFile(resolve(file), "utf8")),
  );

  if (command === "plan") {
    console.log(JSON.stringify(provisionPlan(config), null, 2));

    return;
  }

  const output = resolve(".arti/staging", config.prefix);
  await mkdir(output, { recursive: true });

  if (command === "generate") {
    const index = options.indexOf("--inventory");

    if (index < 0 || !options[index + 1])
      throw new Error(
        "generate requires --inventory FILE from a successful inspect/apply",
      );

    const inventory = resourceInventory.parse(
      JSON.parse(await readFile(options[index + 1], "utf8")),
    );

    for (const [name, content] of Object.entries(
      generateConfigurations(config, inventory, process.cwd()),
    ))
      await writeFile(
        resolve(output, `${name}.json`),
        JSON.stringify(content, null, 2) + "\n",
      );
    console.log(`Generated disabled staging configurations in ${output}`);

    return;
  }

  const apply = command === "apply";

  if (
    apply &&
    (options.length !== 2 ||
      options[0] !== "--confirm" ||
      options[1] !== config.prefix)
  )
    throw new Error(
      "apply requires --confirm matching the configured staging prefix",
    );
  await checkTools(process.cwd());

  const admin = new CloudflareAdmin(
    process.env.CLOUDFLARE_API_TOKEN ?? "",
    config.accountId,
  );

  const inventory = await provision(config, admin, apply);

  if (apply) await seedRepositories(config, admin, process.cwd());
  await writeFile(
    resolve(output, "inventory.json"),
    JSON.stringify(inventory, null, 2) + "\n",
  );
  console.log(
    `Verified resource inventory saved in ${output}; no Worker deployment or live activation performed`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  stagingCli(process.argv.slice(2)).catch((error) => {
    if (error instanceof z.ZodError)
      console.error(
        error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("\n"),
      );
    console.error(
      "Staging command failed. Check configuration, resource drift, credentials and provider permissions. Provider bodies and credentials are intentionally omitted.",
    );
    process.exitCode = 1;
  });
