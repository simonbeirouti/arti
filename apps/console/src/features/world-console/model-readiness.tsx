import { useState } from "react";
import { activateWorld, canRequestActivation, evaluateModel, listModelEvaluations, type Evaluation } from "./model-readiness-api";

export function ModelReadiness({ mode, refresh }: { mode: string; refresh?: () => Promise<void> }) {
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [evaluationId, setEvaluationId] = useState<string | null>(null);

  async function run(action: "refresh" | "evaluate" | "activate") {
    setPending(true);
    setError("");
    setNotice("");

    try {
      if (action === "evaluate") {
        // Keep the same ID on retry so interrupted requests cannot incur a second run.
        const id = evaluationId ?? crypto.randomUUID();
        setEvaluationId(id);
        const result = await evaluateModel(id);
        setEvaluations(runs => [result, ...runs.filter(run => run.id !== result.id)]);

        if (result.status !== "running") setEvaluationId(null);
      } else if (action === "activate") {
        await activateWorld();
        setNotice("Live activation accepted. Refreshing world state…");
        await refresh?.();
      } else {
        setEvaluations(await listModelEvaluations());
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Model operation failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="panel" aria-label="Model readiness">
      <h3>GLM model readiness</h3>
      <p>Run cloud tool, privacy, and coding checks with a $0.10 maximum evaluation allowance. Evaluation spending is tracked separately from the world allowance.</p>
      <p className="muted">Activation requests $5/day for the world. The server checks the current release, approved evaluation, environment settings, and configured entity caps before enabling agents.</p>
      <div className="inline-form">
        <button className="button" disabled={pending} onClick={() => { void run("refresh"); }}>Refresh model checks</button>
        <button className="button" disabled={pending || mode !== "simulation"} onClick={() => { void run("evaluate"); }}>
          {evaluationId ? "Retry existing evaluation ($0.10 cap)" : "Run GLM evaluation ($0.10 cap)"}
        </button>
        {canRequestActivation(mode, evaluations) && <button className="button" disabled={pending} onClick={() => { void run("activate"); }}>Activate agents ($5/day)</button>}
      </div>
      {pending && <output>Waiting for the model operation. Coding checks can take several minutes.</output>}
      {evaluationId && <p>Pending evaluation: <code>{evaluationId}</code></p>}
      {error && <p role="alert">{error}</p>}
      {notice && <output>{notice}</output>}
      {evaluations.map(run => (
        <details key={run.id}>
          <summary>{run.status} · {run.id}</summary>
          <dl className="operations-list">
            <dt>Model</dt><dd>{run.model}</dd>
            <dt>Environment</dt><dd>{run.environment}</dd>
            <dt>Release fingerprint</dt><dd>{run.fingerprint}</dd>
            <dt>Recorded reservation</dt><dd>${run.reservedUsd.toFixed(4)} / ${run.allowanceUsd.toFixed(2)}</dd>
          </dl>
          {run.cases.map(item => <div key={item.id}>
            <strong>{item.id}: {item.passed ? "passed" : "failed"}</strong>
            <ul>{item.assertions.map(assertion => <li key={assertion}>{assertion}</li>)}</ul>
            {item.responseHash && <p>Response hash: <code>{item.responseHash}</code></p>}
            {item.captureKey && <p>Private evidence reference: <code>{item.captureKey}</code></p>}
          </div>)}
        </details>
      ))}
      {!evaluations.length && !pending && <p className="muted">Refresh model checks to load existing private evaluation receipts.</p>}
    </section>
  );
}
