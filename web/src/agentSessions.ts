import type { AgentPlatform } from "./types";
import {
  agentPlatformLabel as platformLabel,
  agentResumeCommand,
} from "../../shared/agents.mjs";

export function agentPlatformLabel(platform: AgentPlatform | "codex") {
  return platformLabel(platform);
}

// Resume commands are fixed CLI entry points defined per platform in
// shared/agents.mjs, not user-configurable command templates.
export function sessionResumeCommand(platform: AgentPlatform | "codex", sessionId: string) {
  return agentResumeCommand(platform, sessionId) ?? sessionId;
}
