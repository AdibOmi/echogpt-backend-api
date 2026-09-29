import {
  applyDecorators,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiBadRequestResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import {
  ApiAuth,
  ApiValidationError,
} from '../common/decorators/api-errors.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { PaginationQueryDto } from '../common/dto/pagination.dto.js';
import { ChatService } from './chat.service.js';
import {
  ChatResponseDto,
  ConversationDetailDto,
  PaginatedConversationsDto,
  RenameConversationDto,
  SendMessageDto,
} from './dto/chat.dto.js';

/** Errors shared by both "send" endpoints. */
const ChatErrors = () =>
  applyDecorators(
    ApiValidationError(),
    ApiNotFoundResponse({
      description: 'Conversation not found',
      type: ErrorResponseDto,
    }),
    ApiTooManyRequestsResponse({
      description: 'Daily plan limit reached',
      type: ErrorResponseDto,
    }),
    ApiServiceUnavailableResponse({
      description: 'No AI provider available',
      type: ErrorResponseDto,
    }),
  );

@ApiTags('Chat')
@ApiAuth()
@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Send a prompt and receive the full AI response',
    description:
      'Starts a new conversation or continues one. Uses 1 request from the daily quota (refunded if the provider fails).',
  })
  @ApiOkResponse({ type: ChatResponseDto })
  @ChatErrors()
  @ApiBadGatewayResponse({
    description: 'AI provider returned an error',
    type: ErrorResponseDto,
  })
  send(@CurrentUser('id') userId: string, @Body() dto: SendMessageDto) {
    return this.chat.send(userId, dto);
  }

  @Post('stream')
  @ApiOperation({
    summary: 'Send a prompt and stream the response (Server-Sent Events)',
    description: [
      'Response is `text/event-stream`. Events, in order:',
      '- `meta`  → `{ conversationId, provider, model }`',
      '- `delta` → `{ text }` (many; append them)',
      '- `done`  → same body as `POST /chat`',
      '- `error` → `{ message }` if the provider fails mid-stream',
      '',
      'Use `fetch()` + a stream reader on the client (EventSource only supports GET).',
      'Closing the connection aborts the upstream AI request.',
    ].join('\n'),
  })
  @ApiProduces('text/event-stream')
  @ApiOkResponse({
    description: 'SSE stream',
    content: {
      'text/event-stream': {
        example:
          'event: meta\ndata: {"conversationId":"…","provider":{"id":"…","name":"OpenAI"},"model":"gpt-5-mini"}\n\n' +
          'event: delta\ndata: {"text":"Hello"}\n\n' +
          'event: done\ndata: {"conversationId":"…","userMessage":{…},"assistantMessage":{…}}\n\n',
      },
    },
  })
  @ChatErrors()
  async stream(
    @CurrentUser('id') userId: string,
    @Body() dto: SendMessageDto,
    @Res() res: Response,
  ) {
    const abort = new AbortController();
    // 'close' also fires after a normal end, so only abort if we hadn't finished.
    res.on('close', () => {
      if (!res.writableEnded) abort.abort();
    });

    // Throws BEFORE headers are sent → the global filter returns a JSON error.
    const events = await this.chat.startStream(userId, dto, abort.signal);

    res.status(HttpStatus.OK).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // stop nginx from buffering the stream
    });
    res.flushHeaders();

    for await (const { event, data } of events) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }
    res.end();
  }

  @Get('conversations')
  @ApiOperation({
    summary: 'List my conversations (most recently active first)',
  })
  @ApiOkResponse({ type: PaginatedConversationsDto })
  list(@CurrentUser('id') userId: string, @Query() query: PaginationQueryDto) {
    return this.chat.listConversations(userId, query);
  }

  @Get('conversations/:id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Get a conversation with all its messages' })
  @ApiOkResponse({ type: ConversationDetailDto })
  @ApiNotFoundResponse({
    description: 'Conversation not found',
    type: ErrorResponseDto,
  })
  get(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.chat.getConversation(userId, id);
  }

  @Patch('conversations/:id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Rename a conversation' })
  @ApiOkResponse({ type: ConversationDetailDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({
    description: 'Conversation not found',
    type: ErrorResponseDto,
  })
  rename(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RenameConversationDto,
  ) {
    return this.chat.renameConversation(userId, id, dto.title);
  }

  @Delete('conversations/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Delete a conversation and its messages' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiNotFoundResponse({
    description: 'Conversation not found',
    type: ErrorResponseDto,
  })
  async remove(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.chat.deleteConversation(userId, id);
  }
}
