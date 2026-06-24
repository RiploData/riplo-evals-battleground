// Re-export RBAC helpers from the main workos module for convenient imports
export type { AppRole, SessionUser } from './workos';
export { requireRole, ForbiddenError, UnauthorizedError } from './workos';
