/**
 * Response DTO for auth endpoints that return a simple `{ success: true }`
 * acknowledgement (logout, forgot-password, reset-password, verify-email,
 * resend-verification). Documentation-only (Swagger/OpenAPI).
 */
export class AuthSuccessResponseDto {
  /** Always `true` — a failed operation throws an HTTP exception instead. */
  success: boolean;
}
