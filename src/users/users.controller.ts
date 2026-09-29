import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApiAuth,
  ApiValidationError,
} from '../common/decorators/api-errors.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import {
  ErrorResponseDto,
  MessageResponseDto,
} from '../common/dto/error-response.dto.js';
import type { AuthUser } from '../common/types/auth-user.js';
import {
  ChangePasswordDto,
  DeleteAccountDto,
  SessionDto,
  UpdateProfileDto,
  UserProfileDto,
} from './dto/users.dto.js';
import { UsersService } from './users.service.js';

@ApiTags('Users')
@ApiAuth()
@Controller('users/me')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'Get my profile (includes role and current plan)' })
  @ApiOkResponse({ type: UserProfileDto })
  getProfile(@CurrentUser('id') userId: string) {
    return this.users.getProfile(userId);
  }

  @Patch()
  @ApiOperation({ summary: 'Update my profile' })
  @ApiOkResponse({ type: UserProfileDto })
  @ApiValidationError()
  updateProfile(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.users.updateProfile(userId, dto);
  }

  @Patch('password')
  @ApiOperation({
    summary: 'Change my password',
    description: 'Requires the current password. Logs out all other devices.',
  })
  @ApiOkResponse({ type: MessageResponseDto })
  @ApiBadRequestResponse({
    description: 'Validation failed or new password equals current',
    type: ErrorResponseDto,
  })
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
  ) {
    await this.users.changePassword(user.id, user.sessionId, dto);
    return { message: 'Password changed' };
  }

  @Get('sessions')
  @ApiOperation({ summary: 'List my active sessions (logged-in devices)' })
  @ApiOkResponse({ type: [SessionDto] })
  listSessions(@CurrentUser() user: AuthUser) {
    return this.users.listSessions(user.id, user.sessionId);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete my account permanently',
    description: 'Requires the current password. This cannot be undone.',
  })
  @ApiNoContentResponse({ description: 'Account deleted' })
  @ApiValidationError()
  async deleteAccount(
    @CurrentUser('id') userId: string,
    @Body() dto: DeleteAccountDto,
  ) {
    await this.users.deleteAccount(userId, dto.password);
  }
}
