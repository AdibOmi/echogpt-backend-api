import { applyDecorators } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../dto/error-response.dto.js';

/** Swagger: route needs a bearer token (documents the 401 as well). */
export const ApiAuth = () =>
  applyDecorators(
    ApiBearerAuth('access-token'),
    ApiUnauthorizedResponse({
      description: 'Missing, invalid or expired access token',
      type: ErrorResponseDto,
    }),
    ApiTooManyRequestsResponse({
      description: 'Rate limit exceeded',
      type: ErrorResponseDto,
    }),
  );

/** Swagger: route is admin-only (documents the 403 as well). */
export const ApiAdmin = () =>
  applyDecorators(
    ApiAuth(),
    ApiForbiddenResponse({
      description: 'Requires ADMIN role',
      type: ErrorResponseDto,
    }),
  );

export const ApiValidationError = () =>
  ApiBadRequestResponse({
    description: 'Request body failed validation',
    type: ErrorResponseDto,
  });
