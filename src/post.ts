import * as core from "@actions/core";

// POC values — final schema should reconcile with TRD branch_class enum before production ingestion
function branchClass(trigger: string, branch: string): string {
  if (branch === "main" || branch === "master") return "default";
  if (trigger === "pull_request") return "pr";
  if (trigger === "merge_group") return "merge_queue";
  return "other";
}

const branch = core.getState("branch");
const trigger = core.getState("trigger");
const attempt = core.getState("attempt");

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
    conclusion: null,
    conclusion_note:
      "job.status is not available as an env var in post hooks; requires a separate if:always() step to pass ${{ job.status }} as an input",
    failure_type: null,
    failure_type_note:
      "not a GitHub Actions concept; must be inferred from logs or test results",
  }),
);
