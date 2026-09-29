import { z } from 'zod';

/**
 * Validates process.env at startup. If a required variable is missing or
 * malformed, the app refuses to boot — failing fast is far better than
 * discovering a bad secret when the first user tries to log in.
 *
 * Env vars are always strings, so numbers use z.coerce to convert them.
 */
export const envValidationSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'production', 'test'])
      .default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),

    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),

    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
    JWT_REFRESH_SECRET: z.string().min(32),
    JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

    // 32 bytes encoded as hex = 64 characters, used for AES-256-GCM
    ENCRYPTION_KEY: z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/, 'must be 64 hex chars'),

    AI_MOCK_RESPONSES: z.stringbool().default(false),
    AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).default(60_000),

    SEARCH_ENGINE: z.enum(['mock', 'brave']).default('mock'),
    SEARCH_API_KEY: z.string().optional(),
    SEARCH_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).default(3600),
  })
  .refine((env) => env.SEARCH_ENGINE !== 'brave' || !!env.SEARCH_API_KEY, {
    message: 'SEARCH_API_KEY is required when SEARCH_ENGINE=brave',
    path: ['SEARCH_API_KEY'],
  });

export type Env = z.infer<typeof envValidationSchema>;
