# Build and review a website locally

1. Configure `.arti/local-glm.json` privately with the Cloudflare account, `dailyUsd: 1`, and `activation: "ENABLE_PAID_LOCAL_GLM"`. Use an existing Wrangler login or a private `CLOUDFLARE_API_TOKEN` with Workers AI access. Start `pnpm dev:glm`.
2. Open localhost:5173. The header says **Local GLM agents**. **Ask the team** opens the target and criteria controls. The local status panel shows used and reserved spending, including failures that may have incurred cost.
3. Create the target. Supply and approve a public authoring brief that is safe to appear in the generated website. This separate field is not prefilled from private target text. Start the goal.
4. Observe agent nodes and **Discussions**. Expand the central project to keep the world on the left and generated preview on the right. In the operator showcase, **Inspect generated HTML** loads the canonical committed source.
5. When all local contributions have been checked, inspect the site against each criterion. Record your criterion verification from Overview or Evidence, then accept completion. Use change requests for further work; revise and approve a new public brief when public requirements change.
6. Pause the world or goal to stop further dispatch. A paid request already in progress may still incur cost, but changed scope fences its later publication. Resolve a fixed failure category before resuming blocked agents. Stop the development process when the session ends.

Simulation remains available with `pnpm dev`. Local GLM and production runtime activation are separate. No local action establishes cloud verification or deploys the website externally.
