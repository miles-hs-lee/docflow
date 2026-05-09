// Short-TTL HttpOnly cookie set by /auth/callback when the recovery
// link forwards to /reset-password. /reset-password (page + POST) gates
// on this cookie so an already-logged-in normal session cannot bypass
// current-password verification by navigating directly to the reset
// route. Lives in its own non-route module so both producer (callback)
// and consumers (reset page + POST) can import the constant — Next.js
// route files only allow HTTP method exports.

export const PASSWORD_RECOVERY_COOKIE = 'docflow_pw_recovery';
export const PASSWORD_RECOVERY_TTL_SECONDS = 5 * 60;
