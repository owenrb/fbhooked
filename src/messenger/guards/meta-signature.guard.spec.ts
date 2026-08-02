import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MetaSignatureGuard } from './meta-signature.guard';
import * as crypto from 'crypto';

describe('MetaSignatureGuard', () => {
  let guard: MetaSignatureGuard;
  let configService: jest.Mocked<Partial<ConfigService>>;

  const mockAppSecret = 'test_app_secret';

  beforeEach(() => {
    configService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'MESSENGER_APP_SECRET') return mockAppSecret;
        return undefined;
      }),
    };

    guard = new MetaSignatureGuard(configService as ConfigService);
  });

  const createMockContext = (
    headers: Record<string, string>,
    body: Record<string, unknown>,
  ) => {
    const rawBody = Buffer.from(JSON.stringify(body));
    const request = {
      headers,
      body,
      rawBody,
    };
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;
  };

  it('should pass validation when signature matches', () => {
    const body = { object: 'page' };
    const rawBody = Buffer.from(JSON.stringify(body));
    const hash = crypto
      .createHmac('sha256', mockAppSecret)
      .update(rawBody)
      .digest('hex');

    const context = createMockContext(
      { 'x-hub-signature-256': `sha256=${hash}` },
      body,
    );

    expect(guard.canActivate(context)).toBe(true);
  });

  it('should throw UnauthorizedException if header is missing', () => {
    const context = createMockContext({}, { object: 'page' });
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('should throw UnauthorizedException if signature does not match', () => {
    const context = createMockContext(
      { 'x-hub-signature-256': 'sha256=invalid_hash' },
      { object: 'page' },
    );
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('should bypass signature check if APP_SECRET is not set', () => {
    (configService.get as jest.Mock).mockReturnValue(undefined);
    const context = createMockContext({}, { object: 'page' });
    expect(guard.canActivate(context)).toBe(true);
  });
});
