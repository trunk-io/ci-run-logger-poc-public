import * as core from "@actions/core";
import { execSync } from "child_process";
import { readdirSync, readFileSync } from "fs";
import * as path from "path";

// POC values — final schema should reconcile with TRD branch_class enum before production ingestion
function branchClass(trigger: string, branch: string): string {
  if (branch === "main" || branch === "master") return "default";
  if (trigger === "pull_request") return "pr";
  if (trigger === "merge_group") return "merge_queue";
  return "other";
}

// ── GitHub API ────────────────────────────────────────────────────────────────

type ApiStep = {
  number: number;
  name: string;
  status: string;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
};

type ApiJob = {
  name: string;
  status: string;
  conclusion: string | null;
  run_attempt: number;
  steps: ApiStep[];
};

type JobsResponse = {
  jobs: ApiJob[];
};

// GITHUB_JOB is kebab-case (e.g. "unit-tests"); API name is Title Case ("Unit Tests")
function normalizeJobName(name: string): string {
  return name.toLowerCase().replace(/[-_\s]+/g, " ").trim();
}

async function fetchJobSteps(): Promise<ApiStep[] | null> {
  // env: vars are not propagated to post hooks — token was saved to state in pre
  const token = core.getState("github_token") || process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const runId = core.getState("run_id");
  const attempt = core.getState("attempt");
  const ciJobName = core.getState("ci_job_name");

  console.log(
    `[DEBUG-PRE-GUARD] token=${!!token}, repo=${repo}, runId=${runId}, attempt="${attempt}", ciJobName="${ciJobName}"`,
  );

  if (!token || !repo || !runId || !attempt) {
    console.log(`[DEBUG-GUARD-FAIL] bailing early`);
    return null;
  }

  try {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/actions/runs/${runId}/jobs?filter=latest`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
        },
      },
    );
    console.log(`[DEBUG-FETCH] res.ok=${res.ok} status=${res.status}`);
    if (!res.ok) return null;

    const data = (await res.json()) as JobsResponse;
    const attemptNum = Number(attempt);

    console.log(
      `[DEBUG-DATA] attemptNum=${attemptNum}, ciJobName="${ciJobName}", jobs=${JSON.stringify(data.jobs.map((j) => ({ name: j.name, status: j.status, run_attempt: j.run_attempt, steps: j.steps?.length })))}`,
    );

    // Post hooks run after all steps complete, so the job may have transitioned
    // from in_progress to completed by the time we query. Try in_progress first,
    // then fall back to matching by job name (normalized from GITHUB_JOB).
    const job =
      data.jobs.find(
        (j) => j.run_attempt === attemptNum && j.status === "in_progress",
      ) ??
      (ciJobName
        ? data.jobs.find(
            (j) =>
              j.run_attempt === attemptNum &&
              normalizeJobName(j.name) === normalizeJobName(ciJobName),
          )
        : undefined);

    console.log(
      `[DEBUG-MATCH] job=${job ? JSON.stringify({ name: job.name, steps: job.steps?.length }) : "null"}`,
    );

    return job?.steps ?? null;
  } catch (e) {
    console.log(`[DEBUG-CATCH] ${e}`);
    return null;
  }
}

// ── Worker log sleuthing (ported from analytics-cli) ─────────────────────────

function findWorkerLogFiles(): string[] {
  try {
    const ps = execSync("ps aux", { encoding: "utf8" });
    const workerLine = ps
      .split("\n")
      .find((l) => l.includes("Runner.Worker"));
    if (!workerLine) return [];

    // Extract the path to the Runner.Worker executable
    const match = workerLine.match(/(\S+Runner\.Worker)/);
    if (!match) return [];

    // Runner root is one level up from bin/ (e.g. /home/runner/runners/2.x.x/)
    const runnerRoot = path.resolve(path.dirname(match[1]), "..");
    const diagDir = path.join(runnerRoot, "_diag");

    return readdirSync(diagDir)
      .filter((f) => f.startsWith("Worker_") && f.endsWith(".log"))
      .map((f) => path.join(diagDir, f));
  } catch {
    return [];
  }
}

function readWorkerLogs(): string | null {
  const logFiles = findWorkerLogFiles();
  if (logFiles.length === 0) return null;

  // Read the most recent log file (last alphabetically — they're timestamped)
  const logFile = logFiles.sort().at(-1)!;
  try {
    return readFileSync(logFile, "utf8");
  } catch {
    return null;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  const branch = core.getState("branch");
  const trigger = core.getState("trigger");
  const attempt = core.getState("attempt");
  const conclusion = process.env.CI_RUN_CONCLUSION || null;

  const [steps, workerLog] = await Promise.all([
    fetchJobSteps(),
    Promise.resolve(readWorkerLogs()),
  ]);

  console.log(
    JSON.stringify({
      event: "ci_run_end",
      ci_job_name: core.getState("ci_job_name") || null,
      workflow_name: core.getState("workflow_name") || null,
      sha: core.getState("sha") || null,
      run_id: core.getState("run_id") || null,
      attempt: attempt !== "" ? Number(attempt) : null,
      branch: branch || null,
      branch_class: branch && trigger ? branchClass(trigger, branch) : null,
      trigger: trigger || null,
      provider: "github",
      start: core.getState("start_time") || null,
      end: new Date().toISOString(),
      conclusion,
      failure_type: null,
      failure_type_note:
        "not a GitHub Actions concept; must be inferred from logs or test results",
      steps,
    }),
  );

  console.log("\n=== GitHub API job steps ===");
  console.log(JSON.stringify(steps, null, 2));

  console.log("\n=== Runner worker log ===");
  if (workerLog !== null) {
    console.log(workerLog);
  } else {
    console.log("(not found — Runner.Worker process or _diag dir not accessible)");
  }
})().catch(console.error);
