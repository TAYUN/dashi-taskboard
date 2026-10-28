export type AgentPlatformId =
  | "codex"
  | "claude"
  | "codebuddy"
  | "omp"
  | "cline"
  | "command-code"
  | "pi"
  | "agy"
  | "grok";

export type AgentActorId = `${AgentPlatformId}-agent`;

export interface AgentAcpDefinition {
  readonly command: string;
  readonly args: readonly string[];
}

export interface AgentDefinition {
  readonly platform: AgentPlatformId;
  readonly id: AgentActorId;
  readonly name: string;
  readonly attribution?: "thread";
  readonly avatar?: string;
  readonly resume: string;
  readonly sessionIdMaxLength?: number;
  readonly acp?: AgentAcpDefinition;
}

export interface AgentActorIdentity {
  readonly type: "agent";
  readonly id: AgentActorId;
  readonly name: string;
  readonly avatarUrl: null;
}

export const AGENTS: readonly AgentDefinition[];

export function agentActorId(platform: AgentPlatformId): AgentActorId;
export function agentDefinition(platform: string): AgentDefinition | undefined;
export function agentDefinitionById(id: string): AgentDefinition | undefined;
export function agentDefinitionByActorId(actorId: string): AgentDefinition | undefined;
export function agentIdFromActorId(actorId: string): string;
export function isAgentActorId(actorId: string): boolean;
export function agentAvatar(actorId: string): string | undefined;
export function agentSessionPlatforms(): AgentPlatformId[];
export function agentPlatformLabel(platform: string): string;
export function agentSessionIdMaxLength(platform: string): number;
export function agentActor(platform: string): AgentActorIdentity | undefined;
export function agentActorForId(actorId: string): AgentActorIdentity | undefined;
export function agentResumeCommand(platform: string, sessionId: string): string | null;
