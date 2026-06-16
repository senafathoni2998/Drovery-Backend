/**
 * Response DTO for GET /users/me/stats.
 * Mirrors the exact shape returned by UsersService.getStats():
 *   { total, active, completed }
 * All three are Prisma count() results — plain non-negative integers.
 */
export class UserStatsDto {
  /** Total number of deliveries ever created by this user. */
  total: number;
  /** Deliveries currently in an in-progress status (PENDING → AWAITING_HANDOFF). */
  active: number;
  /** Deliveries that reached DELIVERED status. */
  completed: number;
}
