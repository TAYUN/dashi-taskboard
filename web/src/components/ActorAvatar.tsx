import type { ActorIdentity } from "../types";
import { agentAvatar } from "../../../shared/agents.mjs";

export function ActorAvatar({
  actor,
  className = "",
}: {
  actor: ActorIdentity;
  className?: string;
}) {
  const image = (actor.type === "agent" ? agentAvatar(actor.id) : undefined) ?? actor.avatarUrl;
  const initial = image ? "" : " is-initial";
  return (
    <span
      className={`actor-avatar actor-avatar-${actor.type}${initial}${className ? ` ${className}` : ""}`}
      aria-hidden="true"
      title={actor.name}
    >
      {image ? (
        <img
          className={`actor-avatar-image${actor.type === "agent" ? " actor-avatar-agent-image" : ""}`}
          src={image}
          alt=""
          referrerPolicy="no-referrer"
        />
      ) : actor.name.slice(0, 1)}
    </span>
  );
}
