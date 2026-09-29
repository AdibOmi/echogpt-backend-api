import { SetMetadata } from '@nestjs/common';
import type { RoleName } from '../../generated/prisma/enums.js';

export const ROLES_KEY = 'roles';

/** Restrict a route (or whole controller) to the given roles. */
export const Roles = (...roles: RoleName[]) => SetMetadata(ROLES_KEY, roles);
