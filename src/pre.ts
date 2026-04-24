import * as core from "@actions/core";
import { readFileSync } from "fs";

const trigger = process.env.GITHUB_EVENT_NAME ?? "";
const eventPath = process.env.GITHUB_EVENT_PATH ?? "";

// For PR events, GITHUB_SHA is the ephemeral merge commit — read the actual head SHA from the event payload
let sha = process.env.GITHUB_SHA ?? null;
if (trigger === "pull_request" && eventPath) {
  try {
    const event = JSON.parse(readFileSync(eventPath, "utf8")) as {
      pull_request?: { head?: { sha?: string } };
    };
    sha = event.pull_request?.head?.sha ?? sha;
  } catch {
    // fall back to GITHUB_SHA
  }
}

// For PR events, GITHUB_REF_NAME is the merge ref (e.g. "3731/merge") — GITHUB_HEAD_REF is the actual branch name
const branch =
  process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || null;

const startTime = new Date().toISOString();

core.saveState("start_time", startTime);
core.saveState("ci_job_name", process.env.GITHUB_JOB ?? "");
core.saveState("workflow_name", process.env.GITHUB_WORKFLOW ?? "");
core.saveState("sha", sha ?? "");
core.saveState("run_id", process.env.GITHUB_RUN_ID ?? "");
core.saveState("attempt", process.env.GITHUB_RUN_ATTEMPT ?? "");
core.saveState("branch", branch ?? "");
core.saveState("trigger", trigger);

console.log(
  JSON.stringify({
    event: "ci_run_start",
    ci_job_name: process.env.GITHUB_JOB ?? null,
    workflow_name: process.env.GITHUB_WORKFLOW ?? null,
    sha,
    run_id: process.env.GITHUB_RUN_ID ?? null,
    attempt: process.env.GITHUB_RUN_ATTEMPT
      ? Number(process.env.GITHUB_RUN_ATTEMPT)
      : null,
    branch,
    trigger: trigger || null,
    start: startTime,
  }),
);
