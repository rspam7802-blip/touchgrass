import { type INestApplication, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import type { AdapterInstances } from './adapters/adapters.module.js';
import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter.js';
import type { Env } from './config/env.js';

export interface CreateApiOptions {
  adapterOverrides?: Partial<AdapterInstances>;
  logger?: boolean;
}

/** Builds and configures the API app. Shared by main.ts and integration tests so tests hit the real pipeline. */
export async function createApiApp(
  env: Env,
  options: CreateApiOptions = {},
): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.forRoot(env, options.adapterOverrides),
    {
      bufferLogs: true,
      rawBody: true,
      logger: options.logger === false ? false : undefined,
    },
  );
  if (options.logger !== false) app.useLogger(app.get(Logger));
  app.set('trust proxy', env.TRUST_PROXY_HOPS);
  app.disable('x-powered-by');
  app.useBodyParser('json', { limit: '256kb' });
  app.use(helmet());
  app.enableCors({ origin: env.CORS_ORIGINS, credentials: false, maxAge: 600 });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalFilters(new AllExceptionsFilter(env.NODE_ENV !== 'production'));
  app.enableShutdownHooks();

  if (env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('TouchGrass API')
      .setDescription(
        'Log off. Pull up. Error format: { error: { code, message, details } }. See docs/ARCHITECTURE.md#error-codes.',
      )
      .setVersion(env.APP_VERSION)
      .addBearerAuth()
      .build();
    SwaggerModule.setup('docs', app, () => SwaggerModule.createDocument(app, config), {
      jsonDocumentUrl: 'docs/openapi.json',
    });
  }
  return app;
}
