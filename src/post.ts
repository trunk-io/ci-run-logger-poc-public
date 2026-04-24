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

  if (!token || !repo || !runId || !attempt) return null;

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
    if (!res.ok) return null;

    const data = (await res.json()) as JobsResponse;
    const attemptNum = Number(attempt);

    // Match by job name first (GITHUB_JOB = kebab-case, API name = Title Case).
    // Fall back to in_progress if name is unavailable. Name-first avoids
    // accidentally matching another parallel in_progress job in the same run.
    const job = ciJobName
      ? data.jobs.find(
          (j) =>
            j.run_attempt === attemptNum &&
            normalizeJobName(j.name) === normalizeJobName(ciJobName),
        )
      : data.jobs.find(
          (j) => j.run_attempt === attemptNum && j.status === "in_progress",
        );

    return job?.steps ?? null;
  } catch {
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

// Map runner-internal result names to GitHub API conclusion values.
// Runner uses Title Case (Succeeded/Failed/Cancelled); API uses lowercase.
function normalizeResult(result: string): string {
  if (result === "Succeeded") return "success";
  if (result === "Failed") return "failure";
  return result.toLowerCase();
}

function extractConclusionFromWorkerLog(log: string): string | null {
  // The runner logs one of two patterns after each step completes:
  //   "Updating job result with current step result 'X'."
  //     → step X degraded the job result (e.g. Succeeded → Failed)
  //   "No need for updating job result with current step result 'X'."
  //     → step X didn't change the job result (already at X or worse)
  //
  // Note: continue-on-error steps are converted to Succeeded before this
  // logging, so we correctly treat them as non-failures.

  // If any step updated the job to a non-success result, that's the conclusion.
  const updateMatches = [
    ...log.matchAll(
      /StepsRunner\] Updating job result with current step result '(\w+)'/g,
    ),
  ];
  if (updateMatches.length > 0) {
    return normalizeResult(updateMatches[updateMatches.length - 1][1]);
  }

  // No updates: check there are "No need for" lines confirming a clean run.
  if (/StepsRunner\] No need for updating job result/.test(log)) {
    return "success";
  }

  return null;
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  const branch = core.getState("branch");
  const trigger = core.getState("trigger");
  const attempt = core.getState("attempt");

  const [steps, workerLog] = await Promise.all([
    fetchJobSteps(),
    Promise.resolve(readWorkerLogs()),
  ]);

  const conclusion = workerLog
    ? extractConclusionFromWorkerLog(workerLog)
    : null;

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
