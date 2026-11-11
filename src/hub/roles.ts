// The hub mirrors the database's rules (20261111090000_hub_role_levels.sql) to
// show each team member only what they may do. The database still decides.
export type Role = "super_admin" | "admin" | "moderator";

export const SUPER_ADMIN_LIMIT = 3;

const RANKS: Record<Role, number> = { moderator: 1, admin: 2, super_admin: 3 };

/** Each level holds the powers of the levels below it. */
export function hasRole(role: Role, minimum: Role) {
  return RANKS[role] >= RANKS[minimum];
}

/** Administrators and super administrators work network-wide; a moderator within their promotion. */
export function coversNetwork(role: Role) {
  return hasRole(role, "admin");
}

/** The roles a team member hands out: those below their own, and super administrators also their peers. */
export function assignableRoles(role: Role): Role[] {
  if (role === "super_admin") return ["moderator", "admin", "super_admin"];
  return role === "admin" ? ["moderator"] : [];
}

/** A super administrator leaves by resigning or through the database, never from someone else's hub. */
export function canRemoveRole(actor: Role, target: Role) {
  return target !== "super_admin" && RANKS[target] < RANKS[actor];
}

/** Reads the role the database sends once, where the hub's context comes in. */
export function isRole(value: unknown): value is Role {
  return value === "super_admin" || value === "admin" || value === "moderator";
}
