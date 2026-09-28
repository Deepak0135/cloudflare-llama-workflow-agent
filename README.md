# Cloudflare Llama 3.3 Workflow Agent

> **Live Demo:** [https://cf-ai-agent.deepak-software-dev.workers.dev](https://cf-ai-agent.deepak-software-dev.workers.dev)

An edge-native, real-time streaming AI chat application powered by Cloudflare Workers AI, durable session memory via Cloudflare KV, and Cloudflare Assets.
An autonomous edge AI application combining Cloudflare Workers AI, durable Cloudflare Workflows, and Cloudflare KV for memory.

## Architecture
- **LLM:** `@cf/meta/llama-3.3-70b-instruct` via Workers AI.
- **Workflow & Coordination:** Cloudflare Workflows (`AgentWorkflow` class running a 4-step durable pipeline).
- **User Interface:** Responsive web chat client served directly via Workers Assets / Pages.
- **State & Memory:** Cloudflare KV maintaining rolling conversation history per session ID.

## Local Setup & Development
1. Clone the repo and install dependencies:
   ```bash
   git clone <REPO_URL>
   cd cf-ai-agent
   npm install