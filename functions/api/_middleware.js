import { recordRequestObservation, readErrorMessageFromResponse } from '../../src/shared/observability.js';
import { appendSecurityHeaders, createHttpsRedirectResponse, shouldForceHttps } from '../../src/shared/security.js';

function queueBackgroundTask(context, promise) {
  if (typeof context.waitUntil === 'function') {
    context.waitUntil(promise);
    return;
  }

  void promise;
}

function shouldObserveRequest(request) {
  const url = new URL(request.url);
  return url.pathname !== '/api/health' && request.method !== 'OPTIONS';
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const startedAt = Date.now();
  const shouldObserve = shouldObserveRequest(request);

  if (shouldForceHttps(request, env)) {
    const redirectResponse = appendSecurityHeaders(createHttpsRedirectResponse(request), request, env, { api: true });

    if (shouldObserve) {
      queueBackgroundTask(context, recordRequestObservation(env, {
        path: url.pathname,
        method: request.method,
        status: redirectResponse.status,
        durationMs: Date.now() - startedAt,
        message: 'HTTPS required',
      }));
    }

    return redirectResponse;
  }

  try {
    const response = await context.next();
    const errorMessagePromise = shouldObserve && response.status >= 400
      ? readErrorMessageFromResponse(response)
      : Promise.resolve(null);
    const securedResponse = appendSecurityHeaders(response, request, env, { api: true });

    if (shouldObserve) {
      queueBackgroundTask(context, (async () => {
        await recordRequestObservation(env, {
          path: url.pathname,
          method: request.method,
          status: securedResponse.status,
          durationMs: Date.now() - startedAt,
          message: await errorMessagePromise,
        });
      })());
    }

    return securedResponse;
  } catch (error) {
    if (shouldObserve) {
      queueBackgroundTask(context, recordRequestObservation(env, {
        path: url.pathname,
        method: request.method,
        status: 500,
        durationMs: Date.now() - startedAt,
        message: error instanceof Error ? error.message : String(error),
      }));
    }

    throw error;
  }
}
