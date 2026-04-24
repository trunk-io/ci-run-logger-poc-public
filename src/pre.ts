import * as core from "@actions/core";

const startTime = new Date().toISOString();

core.saveState("start_time", startTime);
core.saveState("ci_job_name", process.env.GITHUB_JOB ?? "");
core.saveState("workflow_name", process.env.GITHUB_WORKFLOW ?? "");
core.saveState("sha", process.env.GITHUB_SHA ?? "");
core.saveState("run_id", process.env.GITHUB_RUN_ID ?? "");
core.saveState("attempt", process.env.GITHUB_RUN_ATTEMPT ?? "");
core.saveState("branch", process.env.GITHUB_REF_NAME ?? "");
core.saveState("trigger", process.env.GITHUB_EVENT_NAME ?? "");

console.log(
  JSON.stringify({
    event: "ci_run_start",
    ci_job_name: process.env.GITHUB_JOB ?? null,
    workflow_name: process.env.GITHUB_WORKFLOW ?? null,
    sha: process.env.GITHUB_SHA ?? null,
    run_id: process.env.GITHUB_RUN_ID ?? null,
    attempt: process.env.GITHUB_RUN_ATTEMPT
      ? Number(process.env.GITHUB_RUN_ATTEMPT)
      : null,
    branch: process.env.GITHUB_REF_NAME ?? null,
    trigger: process.env.GITHUB_EVENT_NAME ?? null,
    start: startTime,
  }),
);
