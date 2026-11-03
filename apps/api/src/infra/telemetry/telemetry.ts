import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';
import * as Sentry from '@sentry/nestjs';

/** Must run before any other import that should be instrumented. No-ops when not configured. */
export function initTelemetry(service: string): void {
  const dsn = process.env.SENTRY_DSN;
  if (dsn) {
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV,
      release: process.env.APP_VERSION,
      tracesSampleRate: 0.1,
    });
  }
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (endpoint) {
    const sdk = new NodeSDK({
      serviceName: `touchgrass-${service}`,
      traceExporter: new OTLPTraceExporter({ url: `${endpoint.replace(/\/$/, '')}/v1/traces` }),
      instrumentations: [
        getNodeAutoInstrumentations({ '@opentelemetry/instrumentation-fs': { enabled: false } }),
      ],
    });
    sdk.start();
    process.once('SIGTERM', () => {
      void sdk.shutdown();
    });
  }
}
