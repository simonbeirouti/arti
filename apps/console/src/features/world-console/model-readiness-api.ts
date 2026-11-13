import { z } from "zod";

const evaluationSchema = z.object({
  id: z.string().uuid(),
  model: z.string(),
  fingerprint: z.string(),
  environment: z.string(),
  status: z.enum(["running", "passed", "failed"]),
  allowanceUsd: z.number(),
  reservedUsd: z.number(),
  cases: z.array(z.object({
    id: z.string(),
    passed: z.boolean(),
    assertions: z.array(z.string()),
    responseHash: z.string().optional(),
    captureKey: z.string().optional(),
  })),
});

export type Evaluation = z.infer<typeof evaluationSchema>;

export function canRequestActivation(mode: string, evaluations: Evaluation[]): boolean {
  return mode === "simulation" && evaluations.some(run => run.status === "passed");
}

async function checkedResponse(path: string, options?: RequestInit): Promise<Response> {
  const response = await fetch(path, options);

  if (response.status === 404) throw new Error("Model checks are available in the authenticated Cloudflare operator console. Local simulation does not run paid evaluations.");

  if (!response.ok) throw new Error((await response.text()) || `Request failed (${response.status})`);

  return response;
}

export async function listModelEvaluations(): Promise<Evaluation[]> {
  const response = await checkedResponse("/api/v1/evaluations");

  return z.object({ evaluations: z.array(evaluationSchema) }).parse(await response.json()).evaluations;
}

export async function evaluateModel(id: string): Promise<Evaluation> {
  const response = await checkedResponse("/api/v1/evaluations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, allowanceUsd: 0.1, acknowledge: "RUN_PAID_MODEL_EVALUATION" }),
  });

  return evaluationSchema.parse(await response.json());
}

export async function activateWorld(): Promise<void> {
  await checkedResponse("/api/v1/activation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ acknowledgement: "ENABLE_LIVE_WORLD", dailyAllowanceUsd: 5 }),
  });
}

