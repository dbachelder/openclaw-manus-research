/**
 * Manus Research Plugin
 * Delegates deep research tasks to Manus AI agent via their REST API.
 * Tasks run asynchronously — we poll until completion.
 *
 * API docs: https://open.manus.im/docs
 * Base URL: https://api.manus.ai
 * Auth: API_KEY header
 */

const MANUS_API_BASE = "https://api.manus.ai/v1";

/** How often to poll for task completion (ms) */
const POLL_INTERVAL_MS = 10_000;

/** Maximum time to wait for a task (ms) — 10 minutes */
const MAX_WAIT_MS = 600_000;

type ManusStatus = "running" | "pending" | "completed" | "error";

interface ManusCreateResponse {
  task_id: string;
  task_title: string;
  task_url: string;
  share_url?: string;
}

interface ManusOutputContent {
  type: string;
  text?: string;
  fileUrl?: string;
  fileName?: string;
  mimeType?: string;
}

interface ManusOutputMessage {
  id: string;
  role: "user" | "assistant";
  content: ManusOutputContent[];
}

interface ManusTaskResponse {
  id: string;
  status: ManusStatus;
  error?: string;
  metadata?: {
    task_title?: string;
    task_url?: string;
  };
  output?: ManusOutputMessage[];
  credit_usage?: number;
}

export default function register(api: any) {
  const getApiKey = (): string | undefined => {
    try {
      const fs = require("fs");
      const path = require("path");
      const authPath = path.join(
        process.env.HOME || "",
        ".clawdbot/agents/main/agent/auth-profiles.json"
      );
      if (fs.existsSync(authPath)) {
        const authData = JSON.parse(fs.readFileSync(authPath, "utf-8"));
        return authData.profiles?.["manus:default"]?.key;
      }
    } catch (e) {
      api.logger.error("Failed to read Manus auth profile:", e);
    }
    return undefined;
  };

  async function createTask(
    apiKey: string,
    prompt: string,
    agentProfile: string,
  ): Promise<ManusCreateResponse> {
    const response = await fetch(`${MANUS_API_BASE}/tasks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "API_KEY": apiKey,
      },
      body: JSON.stringify({
        prompt,
        agentProfile,
        taskMode: "agent",
        hideInTaskList: false,
        createShareableLink: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Manus API error ${response.status}: ${errorText}`);
    }

    return response.json() as Promise<ManusCreateResponse>;
  }

  async function getTask(
    apiKey: string,
    taskId: string,
  ): Promise<ManusTaskResponse> {
    const response = await fetch(`${MANUS_API_BASE}/tasks/${taskId}`, {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "API_KEY": apiKey,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Manus API error ${response.status}: ${errorText}`);
    }

    return response.json() as Promise<ManusTaskResponse>;
  }

  async function pollUntilDone(
    apiKey: string,
    taskId: string,
    maxWaitMs: number,
  ): Promise<ManusTaskResponse> {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const task = await getTask(apiKey, taskId);

      if (task.status === "completed" || task.status === "error") {
        return task;
      }

      // "pending" means waiting for user input — we treat as complete
      // since we don't support interactive mode
      if (task.status === "pending") {
        return task;
      }

      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }

    throw new Error(`Task ${taskId} timed out after ${maxWaitMs / 1000}s`);
  }

  function extractResult(task: ManusTaskResponse): string {
    if (!task.output || task.output.length === 0) {
      return "(no output)";
    }

    const parts: string[] = [];
    for (const msg of task.output) {
      if (msg.role !== "assistant") continue;
      for (const block of msg.content) {
        if (block.type === "output_text" && block.text) {
          parts.push(block.text);
        }
        if (block.fileUrl) {
          const label = block.fileName || "file";
          parts.push(`[${label}](${block.fileUrl})`);
        }
      }
    }

    return parts.join("\n\n") || "(no assistant output)";
  }

  api.registerTool({
    id: "manus_research",
    name: "manus_research",
    description:
      "Delegate a deep research task to Manus AI. Manus can browse the web, analyze documents, " +
      "create reports, and execute multi-step workflows autonomously. Use for tasks that need " +
      "extensive web research, competitive analysis, market research, or comprehensive reports. " +
      "Tasks run asynchronously and may take several minutes.",
    optional: true,
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description:
            "The research task or question. Be specific and detailed for best results.",
        },
        agent_profile: {
          type: "string",
          enum: ["manus-1.6", "manus-1.6-lite", "manus-1.6-max"],
          description:
            'Agent profile to use. "manus-1.6" (default, balanced), ' +
            '"manus-1.6-lite" (faster, simpler tasks), ' +
            '"manus-1.6-max" (most capable, complex research)',
          default: "manus-1.6",
        },
        max_wait_minutes: {
          type: "number",
          description:
            "Maximum minutes to wait for completion. Default: 10. Set higher for complex research.",
          default: 10,
        },
      },
      required: ["prompt"],
    },
    execute: async (_id: string, params: any) => {
      const {
        prompt,
        agent_profile: agentProfile = "manus-1.6",
        max_wait_minutes: maxWaitMinutes = 10,
      } = params || {};

      if (!prompt || typeof prompt !== "string") {
        return { error: "Prompt is required and must be a string" };
      }

      const apiKey = getApiKey();
      if (!apiKey) {
        return {
          error:
            "Manus API key not found. Add manus:default to auth-profiles.json " +
            "(get key from https://manus.im/app?show_settings=integrations&app_name=api)",
        };
      }

      const maxWaitMs = Math.min(maxWaitMinutes * 60_000, MAX_WAIT_MS);

      api.logger.info(
        `[manus] Creating task (profile: ${agentProfile}): "${prompt.slice(0, 80)}..."`,
      );

      let created: ManusCreateResponse;
      try {
        created = await createTask(apiKey, prompt, agentProfile);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        api.logger.error(`[manus] Failed to create task: ${msg}`);
        return { error: `Failed to create Manus task: ${msg}` };
      }

      api.logger.info(
        `[manus] Task created: ${created.task_id} — ${created.task_url}`,
      );

      let task: ManusTaskResponse;
      try {
        task = await pollUntilDone(apiKey, created.task_id, maxWaitMs);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        api.logger.error(`[manus] Polling failed: ${msg}`);
        return {
          error: `Manus task polling failed: ${msg}. Check status at: ${created.task_url}`,
        };
      }

      if (task.status === "error") {
        api.logger.error(`[manus] Task failed: ${task.error}`);
        return {
          error: `Manus task failed: ${task.error || "unknown error"}. URL: ${created.task_url}`,
        };
      }

      const result = extractResult(task);
      const creditInfo = task.credit_usage
        ? ` (${task.credit_usage} credits used)`
        : "";

      api.logger.info(
        `[manus] Task ${task.status}${creditInfo}: ${created.task_id}`,
      );

      return {
        content: [
          {
            type: "text",
            text: result,
          },
        ],
        details: {
          task_id: created.task_id,
          task_url: created.task_url,
          share_url: created.share_url || undefined,
          status: task.status,
          credit_usage: task.credit_usage,
          agent_profile: agentProfile,
        },
      };
    },
  });

  api.logger.info("Manus Research plugin loaded");
}
