import * as core from "@actions/core";

// POC values — final schema should reconcile with TRD branch_class enum before production ingestion
function branchClass(trigger: string, branch: string): string {
  if (branch === "main" || branch === "master") return "default";
  if (trigger === "pull_request") return "pr";
  if (trigger === "merge_group") return "merge_queue";
  return "other";
}

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

async function fetchJobSteps(): Promise<ApiStep[] | null> {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const runId = core.getState("run_id");
  const attempt = core.getState("attempt");

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
    const job = data.jobs.find(
      (j) =>
        j.run_attempt === Number(attempt) && j.status === "in_progress",
    );
    return job?.steps ?? null;
  } catch {
    return null;
  }
}

(async () => {
  const branch = core.getState("branch");
  const trigger = core.getState("trigger");
  const attempt = core.getState("attempt");
  const conclusion = process.env.CI_RUN_CONCLUSION || null;
  const steps = await fetchJobSteps();

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
})().catch(console.error);
