import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard.js';

const contextFor = (user?: { role: string }) =>
  ({
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;

describe('RolesGuard', () => {
  const guardRequiring = (roles?: string[]) => {
    const reflector = {
      getAllAndOverride: () => roles,
    } as unknown as Reflector;
    return new RolesGuard(reflector);
  };

  it('allows any authenticated user when no roles are required', () => {
    expect(
      guardRequiring(undefined).canActivate(contextFor({ role: 'USER' })),
    ).toBe(true);
  });

  it('allows a user with a required role', () => {
    expect(
      guardRequiring(['ADMIN']).canActivate(contextFor({ role: 'ADMIN' })),
    ).toBe(true);
  });

  it('rejects a user without the required role (403)', () => {
    expect(() =>
      guardRequiring(['ADMIN']).canActivate(contextFor({ role: 'USER' })),
    ).toThrow(ForbiddenException);
  });

  it('rejects when there is no user at all', () => {
    expect(() => guardRequiring(['ADMIN']).canActivate(contextFor())).toThrow(
      ForbiddenException,
    );
  });
});
