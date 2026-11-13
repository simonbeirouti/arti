import type {
  Entity,
  Goal,
  WorldState,
} from "../../../../../packages/contracts/src/index";

export function currentGoal(state: WorldState): Goal | undefined {
  return (
    state.goals.find(
      (goal) => !["completed", "cancelled"].includes(goal.status),
    ) ?? state.goals.at(-1)
  );
}

export function lines(value: string): string[] {
  return value
    .split("\n")
    .flatMap((line) => (line.trim() ? [line.trim()] : []));
}

export function entityShowcase(entity: Entity): string {
  return `/showcase?entity=${encodeURIComponent(entity.id)}`;
}

export function readable(value: string): string {
  return value.replaceAll("_", " ").replaceAll(".", " / ");
}

export function formatTime(value: string): string {
  return new Date(value).toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Australia/Sydney",
  });
}
