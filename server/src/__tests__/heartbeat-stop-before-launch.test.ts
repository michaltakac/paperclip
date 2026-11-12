import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  agents, companies, createDb, heartbeatRunEvents, heartbeatRuns, issueRecoveryActions, issues,
} from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { heartbeatService } from "../services/heartbeat.js";

// MHA PAP-1012: an operator stopped a claimed Hermes run one minute after the
// claim, while Paperclip was still preparing it. No process existed yet, but the
// task was held "until the stopped provider is reconciled" and stayed frozen for
// five days, because a run without a process can never produce a stop receipt.
const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)("stopping a legacy run before its adapter is reached", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("stop-before-launch-"); db = createDb(database.connectionString); }, 30000);
  afterAll(async () => { await database?.cleanup(); });

  async function seed(launched: "no" | "run_started" | "adapter_invoked" | "has_process") {
    const companyId = randomUUID(), agentId = randomUUID(), issueId = randomUUID(), runId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Stop before launch", defaultResponsibleUserId: "board", issuePrefix: `S${companyId.slice(0, 6)}` });
    await db.insert(agents).values({ id: agentId, companyId, name: "CEO", role: "ceo", adapterType: "hermes_local", status: "running",
      runtimeConfig: { heartbeat: { maxConcurrentRuns: 1 } } });
    await db.insert(issues).values({ id: issueId, companyId, title: "Audit", status: "in_progress", assigneeAgentId: agentId });
    await db.insert(heartbeatRuns).values({ id: runId, companyId, agentId, runtimeMode: "legacy", status: "running",
      startedAt: new Date(), contextSnapshot: { issueId },
      processPid: launched === "has_process" ? 999999999 : null,
      processStartedAt: launched === "has_process" ? new Date() : null });
    if (launched === "run_started") await db.insert(heartbeatRunEvents).values({ companyId, runId, agentId, seq: 900,
      eventType: "lifecycle", stream: "system", message: "run started" });
    if (launched === "adapter_invoked") await db.insert(heartbeatRunEvents).values({ companyId, runId, agentId, seq: 900,
      eventType: "adapter.invoke", stream: "system", message: "adapter invocation" });
    return { companyId, issueId, runId };
  }
  const holds = (f: { companyId: string; issueId: string }) => db.select().from(issueRecoveryActions).where(and(
    eq(issueRecoveryActions.companyId, f.companyId), eq(issueRecoveryActions.sourceIssueId, f.issueId),
    eq(issueRecoveryActions.cause, "legacy_execution_requires_reconciliation")));

  it("does not hold the task when the run was stopped during setup", async () => {
    const f = await seed("no");
    const heartbeat = heartbeatService(db);
    await heartbeat.cancelRun(f.runId, "Cancelled by a board operator", { suppressImmediateRecovery: true });
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, f.runId));
    expect(run.status).toBe("cancelled");
    expect(run.resultJson?.executionRecovery).toEqual({ kind: "bootstrap", providerWorkStarted: false });
    expect(await holds(f)).toHaveLength(0);
  });

  it.each(["run_started", "adapter_invoked", "has_process"] as const)("keeps the hold once the adapter was reached: %s", async launched => {
    const f = await seed(launched);
    const heartbeat = heartbeatService(db);
    await heartbeat.cancelRun(f.runId, "Cancelled by a board operator", { suppressImmediateRecovery: true });
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, f.runId));
    expect(run.status).toBe("cancelled");
    expect(run.resultJson?.executionRecovery).toBeUndefined();
    expect(await holds(f)).toHaveLength(1);
  });
});
