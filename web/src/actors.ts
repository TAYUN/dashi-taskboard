import type { ActorIdentity, AssigneeTarget } from "./types";
import {
  AGENTS,
  agentActor,
  agentActorForId,
  agentIdFromActorId,
} from "../../shared/agents.mjs";

const CODEX_AGENT_ACTOR: ActorIdentity = agentActor("codex") as ActorIdentity;

export const AGENT_ACTORS: ActorIdentity[] = AGENTS.map(
  (agent) => agentActor(agent.platform) as ActorIdentity,
);

export function actorKey(actor: ActorIdentity): string {
  return `${actor.type}:${actor.id}`;
}

export function actorForAssigneeTarget(
  target: AssigneeTarget,
  currentUser: ActorIdentity,
): ActorIdentity {
  if (target === "current-user") return currentUser;
  return (agentActorForId(target) as ActorIdentity | undefined) ?? CODEX_AGENT_ACTOR;
}

export function assigneeTargetForActor(
  actor: ActorIdentity,
  currentUser: ActorIdentity,
): AssigneeTarget | undefined {
  if (actor.type === "agent") return agentIdFromActorId(actor.id) as AssigneeTarget;
  return actor.id === currentUser.id ? "current-user" : undefined;
}
