export const ALERT_RULES = {
  errorRate: {
    threshold: 0.05,
    duration: '5m',
  },
  responseTime: {
    threshold: 1000,
    duration: '5m',
  },
  databaseLatency: {
    threshold: 100,
    duration: '1m',
  },
};

const METRIC_BUCKET_MS = 5 * 60 * 1000;
const MAX_BUCKETS = 36;
const MAX_ERROR_LOGS = 12;
const SNAPSHOT_TTL_SECONDS = 7 * 24 * 60 * 60;

function createEmptySnapshot() {
  return {
    buckets: [],
    recentErrors: [],
    updatedAt: null,
  };
}

function getObservationStore(env) {
  return env.OBSERVABILITY_STORE ?? env.DB ?? null;
}

function toBucketTimestamp(timestamp = Date.now()) {
  return Math.floor(timestamp / METRIC_BUCKET_MS) * METRIC_BUCKET_MS;
}

function toIsoString(timestamp) {
  return new Date(timestamp).toISOString();
}

function normalizeBucket(bucket) {
  const timestamp = Number(bucket?.timestamp);
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  return {
    timestamp,
    requestCount: Number(bucket?.requestCount) || 0,
    errorCount: Number(bucket?.errorCount) || 0,
    rateLimitHits: Number(bucket?.rateLimitHits) || 0,
    totalResponseTime: Number(bucket?.totalResponseTime) || 0,
  };
}

function trimBuckets(buckets) {
  if (buckets.length > MAX_BUCKETS) {
    buckets.splice(0, buckets.length - MAX_BUCKETS);
  }

  return buckets;
}

function insertBucketInOrder(buckets, bucket) {
  if (buckets.length === 0 || bucket.timestamp >= buckets[buckets.length - 1].timestamp) {
    buckets.push(bucket);
    return bucket;
  }

  if (bucket.timestamp <= buckets[0].timestamp) {
    buckets.unshift(bucket);
    return bucket;
  }

  const insertAt = buckets.findIndex((entry) => entry.timestamp > bucket.timestamp);
  if (insertAt === -1) {
    buckets.push(bucket);
  } else {
    buckets.splice(insertAt, 0, bucket);
  }

  return bucket;
}

function upsertBucket(buckets, bucket) {
  const existingBucket = buckets.find((entry) => entry.timestamp === bucket.timestamp);
  if (existingBucket) {
    existingBucket.requestCount += bucket.requestCount;
    existingBucket.errorCount += bucket.errorCount;
    existingBucket.rateLimitHits += bucket.rateLimitHits;
    existingBucket.totalResponseTime += bucket.totalResponseTime;
    return existingBucket;
  }

  insertBucketInOrder(buckets, bucket);
  trimBuckets(buckets);
  return bucket;
}

function normalizeBuckets(buckets) {
  if (!Array.isArray(buckets)) {
    return [];
  }

  const normalizedBuckets = [];
  for (const bucket of buckets) {
    const normalized = normalizeBucket(bucket);
    if (!normalized) {
      continue;
    }

    upsertBucket(normalizedBuckets, normalized);
  }

  return normalizedBuckets;
}

function normalizeErrorLog(log) {
  if (!log || typeof log !== 'object') {
    return null;
  }

  return {
    timestamp: typeof log.timestamp === 'string' ? log.timestamp : new Date().toISOString(),
    path: typeof log.path === 'string' ? log.path : '/api/unknown',
    method: typeof log.method === 'string' ? log.method : 'GET',
    status: Number(log.status) || 500,
    message: sanitizeErrorMessage(log.message, Number(log.status) || 500),
  };
}

async function loadSnapshotFromD1(store) {
  const bucketCutoff = toBucketTimestamp(Date.now() - ((MAX_BUCKETS - 1) * METRIC_BUCKET_MS));

  const [bucketRows, recentErrorRows] = await Promise.all([
    store.prepare(`
      SELECT
        bucket_timestamp AS timestamp,
        COUNT(*) AS requestCount,
        SUM(CASE WHEN status >= 500 THEN 1 ELSE 0 END) AS errorCount,
        SUM(CASE WHEN status = 429 THEN 1 ELSE 0 END) AS rateLimitHits,
        SUM(duration_ms) AS totalResponseTime
      FROM request_observations
      WHERE bucket_timestamp >= ?
      GROUP BY bucket_timestamp
      ORDER BY bucket_timestamp ASC
    `)
      .bind(bucketCutoff)
      .all(),
    store.prepare(`
      SELECT observed_at, path, method, status, sanitized_message
      FROM request_observations
      WHERE status >= 400
      ORDER BY observed_at DESC, id DESC
      LIMIT ?
    `)
      .bind(MAX_ERROR_LOGS)
      .all(),
  ]);

  const buckets = normalizeBuckets((bucketRows.results || []).map((row) => ({
    timestamp: row.timestamp,
    requestCount: row.requestCount,
    errorCount: row.errorCount,
    rateLimitHits: row.rateLimitHits,
    totalResponseTime: row.totalResponseTime,
  })));

  const recentErrors = (recentErrorRows.results || [])
    .map((row) => normalizeErrorLog({
      timestamp: toIsoString(Number(row.observed_at) || Date.now()),
      path: row.path,
      method: row.method,
      status: row.status,
      message: row.sanitized_message,
    }))
    .filter(Boolean)
    .slice(0, MAX_ERROR_LOGS);

  const latestBucketTimestamp = buckets.length > 0 ? buckets[buckets.length - 1].timestamp : null;
  const latestErrorTimestamp = recentErrors.length > 0 ? Date.parse(recentErrors[0].timestamp) : null;
  const latestTimestamp = Math.max(
    Number.isFinite(latestBucketTimestamp) ? latestBucketTimestamp : 0,
    Number.isFinite(latestErrorTimestamp) ? latestErrorTimestamp : 0,
  );

  return {
    buckets,
    recentErrors,
    updatedAt: latestTimestamp > 0 ? toIsoString(latestTimestamp) : null,
  };
}

export async function loadObservabilitySnapshot(env) {
  const store = getObservationStore(env);
  if (!store?.prepare) {
    return createEmptySnapshot();
  }

  try {
    return await loadSnapshotFromD1(store);
  } catch (error) {
    console.error('Failed to load observability snapshot:', error);
    return createEmptySnapshot();
  }
}

export function sanitizeErrorMessage(message, status = 500) {
  const normalized = typeof message === 'string' ? message.trim() : '';

  if (status >= 500) {
    return '服务器内部错误';
  }

  if (!normalized) {
    return status === 429 ? '请求过于频繁，请稍后再试' : '请求失败';
  }

  return normalized.slice(0, 160);
}

export async function readErrorMessageFromResponse(response) {
  if (!response || response.status < 400 || response.bodyUsed) {
    return null;
  }

  const contentType = response.headers.get('Content-Type') || '';

  try {
    const clone = response.clone();

    if (contentType.includes('application/json')) {
      const payload = await clone.json();
      return payload?.error || payload?.message || null;
    }

    const text = await clone.text();
    return text.trim().slice(0, 160) || null;
  } catch {
    return null;
  }
}

export async function recordRequestObservation(env, {
  path,
  method,
  status,
  durationMs,
  timestamp = Date.now(),
  message = null,
}) {
  const store = getObservationStore(env);
  if (!store?.prepare) {
    return;
  }

  const observedAt = Math.max(0, Math.trunc(Number(timestamp) || Date.now()));
  const normalizedStatus = Math.max(0, Math.trunc(Number(status) || 0));
  const normalizedDuration = Math.max(0, Math.round(Number(durationMs) || 0));
  const createdAt = toIsoString(observedAt);
  const retentionCutoff = observedAt - (SNAPSHOT_TTL_SECONDS * 1000);

  try {
    await store.batch([
      store.prepare(`
        INSERT INTO request_observations (
          bucket_timestamp, observed_at, path, method, status, duration_ms, sanitized_message, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
        .bind(
          toBucketTimestamp(observedAt),
          observedAt,
          typeof path === 'string' ? path : '/api/unknown',
          typeof method === 'string' ? method : 'GET',
          normalizedStatus,
          normalizedDuration,
          normalizedStatus >= 400 ? sanitizeErrorMessage(message, normalizedStatus) : null,
          createdAt,
        ),
      store.prepare('DELETE FROM request_observations WHERE observed_at < ?')
        .bind(retentionCutoff),
    ]);
  } catch (error) {
    console.error('Failed to record observability event:', error);
  }
}

export function buildMetricsSummary(snapshot) {
  const buckets = (snapshot?.buckets || [])
    .map((bucket) => {
      const requestCount = Number(bucket.requestCount) || 0;
      const errorCount = Number(bucket.errorCount) || 0;
      const totalResponseTime = Number(bucket.totalResponseTime) || 0;
      const rateLimitHits = Number(bucket.rateLimitHits) || 0;

      return {
        timestamp: toIsoString(bucket.timestamp),
        requestCount,
        errorCount,
        errorRate: requestCount > 0 ? Math.round((errorCount / requestCount) * 10000) / 10000 : 0,
        avgResponseTime: requestCount > 0 ? Math.round(totalResponseTime / requestCount) : 0,
        rateLimitHits,
      };
    })
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp));

  const totals = buckets.reduce((accumulator, bucket) => {
    accumulator.requestCount += bucket.requestCount;
    accumulator.errorCount += bucket.errorCount;
    accumulator.rateLimitHits += bucket.rateLimitHits;
    accumulator.totalResponseTime += bucket.avgResponseTime * bucket.requestCount;
    return accumulator;
  }, {
    requestCount: 0,
    errorCount: 0,
    rateLimitHits: 0,
    totalResponseTime: 0,
  });

  return {
    requestCount: totals.requestCount,
    errorRate: totals.requestCount > 0 ? Math.round((totals.errorCount / totals.requestCount) * 10000) / 10000 : 0,
    avgResponseTime: totals.requestCount > 0 ? Math.round(totals.totalResponseTime / totals.requestCount) : 0,
    rateLimitHits: totals.rateLimitHits,
    trends: buckets,
  };
}

export function evaluateAlerts({ metrics, services }) {
  const alerts = [];
  const latestTrend = metrics?.trends?.[metrics.trends.length - 1] || null;

  if (latestTrend && latestTrend.errorRate >= ALERT_RULES.errorRate.threshold) {
    alerts.push({
      key: 'errorRate',
      severity: 'critical',
      message: '最近 5 分钟错误率超过阈值',
      actual: latestTrend.errorRate,
      threshold: ALERT_RULES.errorRate.threshold,
    });
  }

  if (latestTrend && latestTrend.avgResponseTime >= ALERT_RULES.responseTime.threshold) {
    alerts.push({
      key: 'responseTime',
      severity: 'warning',
      message: '最近 5 分钟平均响应时间过高',
      actual: latestTrend.avgResponseTime,
      threshold: ALERT_RULES.responseTime.threshold,
    });
  }

  const d1Latency = Number(services?.d1?.latency) || 0;
  if (services?.d1?.status !== 'connected') {
    alerts.push({
      key: 'database',
      severity: 'critical',
      message: 'D1 数据库连接异常',
      actual: services?.d1?.status || 'error',
      threshold: 'connected',
    });
  } else if (d1Latency >= ALERT_RULES.databaseLatency.threshold) {
    alerts.push({
      key: 'databaseLatency',
      severity: 'warning',
      message: 'D1 数据库延迟超过阈值',
      actual: d1Latency,
      threshold: ALERT_RULES.databaseLatency.threshold,
    });
  }

  if (services?.kv?.status === 'error') {
    alerts.push({
      key: 'kv',
      severity: 'warning',
      message: 'KV 服务连接异常',
      actual: 'error',
      threshold: 'connected',
    });
  }

  return alerts;
}
