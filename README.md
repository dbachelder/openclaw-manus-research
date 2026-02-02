# openclaw-manus-research

An [OpenClaw](https://github.com/clawdbot/clawdbot) plugin that adds a `manus_research` tool, letting your agent delegate deep research tasks to [Manus AI](https://manus.im).

Instead of browsing the web yourself, hand off complex research to Manus — competitive analysis, market research, technical deep dives, comprehensive reports — and get structured results back.

## Install

```bash
openclaw plugins add dbachelder/openclaw-manus-research
```

## Setup

1. Get a Manus API key from [manus.im/app → Settings → API Integration](https://manus.im/app?show_settings=integrations&app_name=api)

2. Add it to your auth profiles (`~/.openclaw/agents/main/agent/auth-profiles.json`):

```json
{
  "profiles": {
    "manus:default": {
      "type": "api_key",
      "provider": "manus",
      "key": "sk-your-key-here"
    }
  }
}
```

3. Enable the tool for your agent in `openclaw.json`:

```json
{
  "agents": {
    "list": [
      {
        "id": "main",
        "tools": {
          "allow": ["manus_research"]
        }
      }
    ]
  }
}
```

4. Restart OpenClaw.

## Usage

Once installed, your agent has access to the `manus_research` tool. Just ask it to research something:

> "Research the competitive landscape for Solana trading bots — compare features, fees, and user base"

The agent will:
1. Create a Manus task via the API
2. Poll until completion (up to 10 minutes by default)
3. Return the full research results including any generated files/reports

### Tool Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `prompt` | string | *(required)* | The research task. Be specific for best results. |
| `agent_profile` | enum | `"manus-1.6"` | `"manus-1.6"` (balanced), `"manus-1.6-lite"` (faster), `"manus-1.6-max"` (most capable) |
| `max_wait_minutes` | number | `10` | Maximum minutes to wait for task completion |

### Example: Batch Research

Fire off multiple research tasks by asking your agent to research several topics. Each call creates an independent Manus task that runs in parallel on their infrastructure.

## How It Works

- **Create:** `POST /v1/tasks` to Manus API with your prompt and agent profile
- **Poll:** `GET /v1/tasks/{id}` every 10 seconds until status is `completed`
- **Extract:** Pulls all assistant text output and file URLs from the response
- **Return:** Structured result with content + metadata (task URL, credits used, shareable link)

## API Reference

- [Manus API Docs](https://open.manus.im/docs)
- [Create Task](https://open.manus.im/docs/api-reference/create-task)
- [OpenAI SDK Compatibility](https://open.manus.im/docs/openai-compatibility/index)

## Credits

Tasks consume Manus credits based on complexity and agent profile. `manus-1.6-max` uses more credits but produces better results for complex research. Check your usage at [manus.im/app](https://manus.im/app).

## License

MIT
