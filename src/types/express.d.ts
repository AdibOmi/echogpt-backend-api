import type { AuthUser } from '../common/types/auth-user.js';

// Declaration merging: teach Express's Request type about the `user` property
// that JwtAuthGuard attaches, so we get type safety instead of `as any`.
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export {};
