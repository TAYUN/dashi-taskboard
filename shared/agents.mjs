// Single source of truth for every agent platform the taskboard knows about.
//
// Adding an agent means adding one row here. Platform validation, actor
// identity, CLI help text, display name, avatar and resume command all derive
// from this list.
//
// Rows with attribution "thread" are Codex-style: their conversation binding
// comes from --thread-id / CODEX_THREAD_ID instead of --agent-platform.
const DEFINITIONS = [
  {
    platform: "codex",
    name: "Codex Agent",
    attribution: "thread",
    avatar: "codex-agent-logo.png",
    resume: "codex resume {session}",
  },
  {
    platform: "claude",
    name: "Claude Code",
    resume: "claude --resume {session}",
  },
  {
    platform: "codebuddy",
    name: "CodeBuddy",
    resume: "codebuddy --resume {session}",
  },
  {
    platform: "omp",
    name: "OMP",
    resume: "omp --resume={session}",
  },
  {
    platform: "cline",
    name: "Cline",
    resume: "cline --id {session}",
  },
  {
    platform: "command-code",
    name: "Command Code",
    resume: "command-code --resume {session}",
  },
  {
    platform: "pi",
    name: "Pi",
    resume: "pi --session {session}",
    sessionIdMaxLength: 4096,
  },
  {
    platform: "agy",
    name: "Google Antigravity (AGY)",
    resume: "agy --conversation {session}",
  },
  {
    platform: "grok",
    name: "Grok",
    resume: "grok --resume {session}",
  },
];

export const AGENTS = Object.freeze(DEFINITIONS.map((definition) => Object.freeze({
  ...definition,
  id: agentActorId(definition.platform),
})));

export function agentActorId(platform) {
  return `${platform}-agent`;
}

export function agentDefinition(platform) {
  return AGENTS.find((agent) => agent.platform === platform);
}

// Actor IDs may be namespaced by the cloud worker ("basic:name:codex-agent").
export function agentIdFromActorId(actorId) {
  const index = actorId.lastIndexOf(":");
  return index === -1 ? actorId : actorId.slice(index + 1);
}

export function agentDefinitionById(id) {
  return AGENTS.find((agent) => agent.id === id);
}

export function agentDefinitionByActorId(actorId) {
  return agentDefinitionById(agentIdFromActorId(actorId));
}

export function isAgentActorId(actorId) {
  return agentDefinitionByActorId(actorId) !== undefined;
}

export function agentAvatar(actorId) {
  return agentDefinitionByActorId(actorId)?.avatar;
}

export function agentSessionPlatforms() {
  return AGENTS
    .filter((agent) => agent.attribution !== "thread")
    .map((agent) => agent.platform);
}

export function agentPlatformLabel(platform) {
  return agentDefinition(platform)?.name ?? platform;
}

export function agentSessionIdMaxLength(platform) {
  return agentDefinition(platform)?.sessionIdMaxLength ?? 256;
}

export function agentActor(platform) {
  const definition = agentDefinition(platform);
  if (!definition) return undefined;
  return { type: "agent", id: definition.id, name: definition.name, avatarUrl: null };
}

export function agentActorForId(actorId) {
  const definition = agentDefinitionByActorId(actorId);
  if (!definition) return undefined;
  return { type: "agent", id: definition.id, name: definition.name, avatarUrl: null };
}

// Quote for POSIX shells (sh/bash/zsh); preserve the complete, original argument.
function quoteSessionArgument(sessionId) {
  return /^[A-Za-z0-9_./:@+-]+$/.test(sessionId)
    ? sessionId
    : "'" + sessionId.replace(/'/g, "'\"'\"'") + "'";
}

export function agentResumeCommand(platform, sessionId) {
  const definition = agentDefinition(platform);
  if (!definition) return null;
  return definition.resume.replace("{session}", quoteSessionArgument(sessionId));
}
