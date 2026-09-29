import type { RoleName } from '../../generated/prisma/enums.js';

/** Claims inside the short-lived access token. */
export interface AccessTokenPayload {
  sub: string; // user id
  sid: string; // session id — lets us revoke tokens on logout
  role: RoleName;
}

/** Claims inside the long-lived refresh token. */
export interface RefreshTokenPayload {
  sub: string;
  sid: string;
}

/** What guards attach to `request.user` after authenticating. */
export interface AuthUser {
  id: string;
  email: string;
  role: RoleName;
  sessionId: string;
}
