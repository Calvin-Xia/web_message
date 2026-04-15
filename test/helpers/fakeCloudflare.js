function normalizeSql(sql) {
  return sql.replace(/\s+/g, ' ').trim();
}

function parseInsertColumns(sql, tableName) {
  const match = sql.match(new RegExp(`^INSERT INTO ${tableName} \\((.+?)\\) VALUES`));
  if (!match) {
    return [];
  }

  return match[1].split(',').map((column) => column.trim());
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function extractPlaceholderCount(sql, pattern) {
  const match = sql.match(pattern);
  if (!match) {
    return 0;
  }

  return (match[1].match(/\?/g) || []).length;
}

function normalizeSearchPattern(value) {
  return String(value || '')
    .replace(/^%|%$/g, '')
    .replace(/\\([%_\\])/g, '$1')
    .toLowerCase();
}

function hasColumnEqualsOne(sql, columnName) {
  return new RegExp(`\\b(?:issues\\.)?${columnName}\\s*=\\s*1(?=\\s|\\)|$)`).test(sql);
}

function hasColumnEqualsLiteral(sql, columnName, value) {
  return new RegExp(`\\b(?:issues\\.)?${columnName}\\s*=\\s*'${value}'(?=\\s|\\)|$)`).test(sql);
}

function hasColumnNotNull(sql, columnName) {
  return new RegExp(`\\b(?:issues\\.)?${columnName}\\s+IS\\s+NOT\\s+NULL\\b`).test(sql);
}

export function createRateLimitKv(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async put(key, value) {
      store.set(key, value);
    },
    async delete(key) {
      store.delete(key);
    },
  };
}

class FakeD1Database {
  constructor() {
    this.issues = [];
    this.issueUpdates = [];
    this.issueInternalNotes = [];
    this.adminActions = [];
    this.rateLimitState = [];
    this.requestObservations = [];
    this.ids = {
      issue: 1,
      update: 1,
      note: 1,
      action: 1,
      observation: 1,
    };
  }

  snapshot() {
    return {
      issues: clone(this.issues),
      issueUpdates: clone(this.issueUpdates),
      issueInternalNotes: clone(this.issueInternalNotes),
      adminActions: clone(this.adminActions),
      rateLimitState: clone(this.rateLimitState),
      requestObservations: clone(this.requestObservations),
      ids: clone(this.ids),
    };
  }

  restore(snapshot) {
    this.issues = snapshot.issues;
    this.issueUpdates = snapshot.issueUpdates;
    this.issueInternalNotes = snapshot.issueInternalNotes;
    this.adminActions = snapshot.adminActions;
    this.rateLimitState = snapshot.rateLimitState;
    this.requestObservations = snapshot.requestObservations;
    this.ids = snapshot.ids;
  }

  prepare(sql) {
    const normalized = normalizeSql(sql);
    const execute = async (bindings = [], mode = 'all') => this.execute(normalized, bindings, mode);

    return {
      bind: (...bindings) => ({
        run: async () => execute(bindings, 'run'),
        first: async () => execute(bindings, 'first'),
        all: async () => execute(bindings, 'all'),
      }),
      run: async () => execute([], 'run'),
      first: async () => execute([], 'first'),
      all: async () => execute([], 'all'),
    };
  }

  async batch(statements) {
    const snapshot = this.snapshot();
    const results = [];

    try {
      for (const statement of statements) {
        if (typeof statement.run === 'function') {
          results.push(await statement.run());
        } else if (typeof statement.first === 'function') {
          results.push(await statement.first());
        } else if (typeof statement.all === 'function') {
          results.push(await statement.all());
        } else {
          results.push(null);
        }
      }

      return results;
    } catch (error) {
      this.restore(snapshot);
      throw error;
    }
  }

  findIssueById(issueId) {
    return this.issues.find((issue) => issue.id === issueId);
  }

  findIssueByTrackingCode(trackingCode) {
    return this.issues.find((issue) => issue.tracking_code === trackingCode);
  }

  filterAdminIssues(sql, bindings = []) {
    let bindingIndex = 0;
    let issues = this.issues.slice();

    const statusCount = extractPlaceholderCount(sql, /issues\.status IN \(([^)]+)\)/);
    if (statusCount > 0) {
      const values = bindings.slice(bindingIndex, bindingIndex + statusCount);
      bindingIndex += statusCount;
      issues = issues.filter((issue) => values.includes(issue.status));
    }

    const categoryCount = extractPlaceholderCount(sql, /issues\.category IN \(([^)]+)\)/);
    if (categoryCount > 0) {
      const values = bindings.slice(bindingIndex, bindingIndex + categoryCount);
      bindingIndex += categoryCount;
      issues = issues.filter((issue) => values.includes(issue.category));
    }

    const priorityCount = extractPlaceholderCount(sql, /issues\.priority IN \(([^)]+)\)/);
    if (priorityCount > 0) {
      const values = bindings.slice(bindingIndex, bindingIndex + priorityCount);
      bindingIndex += priorityCount;
      issues = issues.filter((issue) => values.includes(issue.priority));
    }

    const distressTypeCount = extractPlaceholderCount(sql, /issues\.distress_type IN \(([^)]+)\)/);
    if (distressTypeCount > 0) {
      const values = bindings.slice(bindingIndex, bindingIndex + distressTypeCount);
      bindingIndex += distressTypeCount;
      issues = issues.filter((issue) => values.includes(issue.distress_type));
    }

    const sceneTagCount = extractPlaceholderCount(sql, /issues\.scene_tag IN \(([^)]+)\)/);
    if (sceneTagCount > 0) {
      const values = bindings.slice(bindingIndex, bindingIndex + sceneTagCount);
      bindingIndex += sceneTagCount;
      issues = issues.filter((issue) => values.includes(issue.scene_tag));
    }

    if (hasColumnEqualsOne(sql, 'is_public')) {
      issues = issues.filter((issue) => Number(issue.is_public) === 1);
    }

    if (hasColumnEqualsLiteral(sql, 'category', 'counseling')) {
      issues = issues.filter((issue) => issue.category === 'counseling');
    }

    if (hasColumnNotNull(sql, 'distress_type')) {
      issues = issues.filter((issue) => issue.distress_type != null);
    }

    if (hasColumnNotNull(sql, 'scene_tag')) {
      issues = issues.filter((issue) => issue.scene_tag != null);
    }

    if (sql.includes('issues.assigned_to = ?')) {
      const assignedTo = bindings[bindingIndex];
      bindingIndex += 1;
      issues = issues.filter((issue) => issue.assigned_to === assignedTo);
    }

    if (sql.includes("COALESCE(TRIM(issues.assigned_to), '') <> ''")) {
      issues = issues.filter((issue) => String(issue.assigned_to || '').trim() !== '');
    } else if (sql.includes("COALESCE(TRIM(issues.assigned_to), '') = ''")) {
      issues = issues.filter((issue) => String(issue.assigned_to || '').trim() === '');
    }

    if (sql.includes('date(issues.created_at) >= date(?)')) {
      const startDate = bindings[bindingIndex];
      bindingIndex += 1;
      issues = issues.filter((issue) => String(issue.created_at || '').slice(0, 10) >= startDate);
    }

    if (sql.includes('date(issues.created_at) <= date(?)')) {
      const endDate = bindings[bindingIndex];
      bindingIndex += 1;
      issues = issues.filter((issue) => String(issue.created_at || '').slice(0, 10) <= endDate);
    }

    if (sql.includes('date(issues.updated_at) >= date(?)')) {
      const updatedAfter = bindings[bindingIndex];
      bindingIndex += 1;
      issues = issues.filter((issue) => String(issue.updated_at || '').slice(0, 10) >= updatedAfter);
    }

    if (sql.includes('EXISTS (SELECT 1 FROM issue_internal_notes notes WHERE notes.issue_id = issues.id)')) {
      issues = issues.filter((issue) => this.issueInternalNotes.some((note) => note.issue_id === issue.id));
    } else if (sql.includes('NOT EXISTS (SELECT 1 FROM issue_internal_notes notes WHERE notes.issue_id = issues.id)')) {
      issues = issues.filter((issue) => !this.issueInternalNotes.some((note) => note.issue_id === issue.id));
    }

    if (sql.includes("EXISTS (SELECT 1 FROM issue_updates updates WHERE updates.issue_id = issues.id AND updates.update_type = 'public_reply')")) {
      issues = issues.filter((issue) => this.issueUpdates.some((update) => update.issue_id === issue.id && update.update_type === 'public_reply'));
    } else if (sql.includes("NOT EXISTS (SELECT 1 FROM issue_updates updates WHERE updates.issue_id = issues.id AND updates.update_type = 'public_reply')")) {
      issues = issues.filter((issue) => !this.issueUpdates.some((update) => update.issue_id === issue.id && update.update_type === 'public_reply'));
    }

    if (sql.includes('issues.tracking_code LIKE ? ESCAPE')) {
      const keyword = normalizeSearchPattern(bindings[bindingIndex]);
      bindingIndex += 5;
      issues = issues.filter((issue) => {
        const values = [
          issue.tracking_code,
          issue.name,
          issue.student_id,
          issue.content,
          issue.public_summary,
        ];
        return values.some((value) => String(value || '').toLowerCase().includes(keyword));
      });
    }

    return issues;
  }

  insertAdminAction({ actionType, targetType, targetId, details, performedBy, performedAt, ipAddress }) {
    const action = {
      id: this.ids.action++,
      action_type: actionType,
      target_type: targetType,
      target_id: targetId,
      details,
      performed_by: performedBy,
      performed_at: performedAt,
      ip_address: ipAddress,
    };
    this.adminActions.push(action);
    return { success: true, meta: { last_row_id: action.id, changes: 1 } };
  }

  async execute(sql, bindings, mode) {
    if (sql === 'SELECT 1 AS ok') {
      return mode === 'first' ? { ok: 1 } : { results: [{ ok: 1 }] };
    }

    if (sql.startsWith('INSERT INTO issues (')) {
      const columns = parseInsertColumns(sql, 'issues');
      const valuesByColumn = Object.fromEntries(columns.map((column, index) => [column, bindings[index]]));
      const trackingCode = valuesByColumn.tracking_code;
      if (this.findIssueByTrackingCode(trackingCode)) {
        throw new Error('UNIQUE constraint failed: issues.tracking_code');
      }

      const issue = {
        id: this.ids.issue++,
        tracking_code: trackingCode,
        name: valuesByColumn.name,
        student_id: valuesByColumn.student_id,
        email: valuesByColumn.email ?? null,
        notify_by_email: valuesByColumn.notify_by_email ?? 0,
        content: valuesByColumn.content,
        is_public: valuesByColumn.is_public,
        is_reported: valuesByColumn.is_reported,
        category: valuesByColumn.category,
        distress_type: valuesByColumn.distress_type ?? null,
        scene_tag: valuesByColumn.scene_tag ?? null,
        priority: valuesByColumn.priority,
        status: valuesByColumn.status,
        public_summary: null,
        assigned_to: null,
        first_response_at: null,
        resolved_at: null,
        created_at: valuesByColumn.created_at,
        updated_at: valuesByColumn.updated_at,
      };
      this.issues.push(issue);
      return { success: true, meta: { last_row_id: issue.id, changes: 1 } };
    }

    if (sql.startsWith('INSERT INTO issue_updates (') && sql.includes('SELECT id,')) {
      const [updateType, oldValue, newValue, content, isPublic, createdBy, createdAt, issueIdOrCode, updatedAt] = bindings;
      const issue = bindings.length === 8
        ? this.findIssueByTrackingCode(issueIdOrCode)
        : this.findIssueById(issueIdOrCode);

      if (!issue) {
        return { success: true, meta: { last_row_id: null, changes: 0 } };
      }

      if (bindings.length === 9 && issue.updated_at !== updatedAt) {
        return { success: true, meta: { last_row_id: null, changes: 0 } };
      }

      const update = {
        id: this.ids.update++,
        issue_id: issue.id,
        update_type: updateType,
        old_value: oldValue,
        new_value: newValue,
        content,
        is_public: isPublic,
        created_by: createdBy,
        created_at: createdAt,
      };
      this.issueUpdates.push(update);
      return { success: true, meta: { last_row_id: update.id, changes: 1 } };
    }

    if (sql.startsWith('INSERT INTO issue_updates (')) {
      const [issueId, updateType, oldValue, newValue, content, isPublic, createdBy, createdAt] = bindings;
      const update = {
        id: this.ids.update++,
        issue_id: issueId,
        update_type: updateType,
        old_value: oldValue,
        new_value: newValue,
        content,
        is_public: isPublic,
        created_by: createdBy,
        created_at: createdAt,
      };
      this.issueUpdates.push(update);
      return { success: true, meta: { last_row_id: update.id, changes: 1 } };
    }

    if (sql.startsWith('INSERT INTO issue_internal_notes')) {
      const [issueId, content, createdBy, createdAt] = bindings;
      const note = {
        id: this.ids.note++,
        issue_id: issueId,
        content,
        created_by: createdBy,
        created_at: createdAt,
      };
      this.issueInternalNotes.push(note);
      return { success: true, meta: { last_row_id: note.id, changes: 1 } };
    }

    if (sql.startsWith('INSERT INTO admin_actions (') && sql.includes('SELECT ?, ?, id,')) {
      const [actionType, targetType, details, performedBy, performedAt, ipAddress, issueIdOrCode, updatedAt] = bindings;
      const issue = bindings.length === 7
        ? this.findIssueByTrackingCode(issueIdOrCode)
        : this.findIssueById(issueIdOrCode);

      if (!issue) {
        return { success: true, meta: { last_row_id: null, changes: 0 } };
      }

      if (bindings.length === 8 && issue.updated_at !== updatedAt) {
        return { success: true, meta: { last_row_id: null, changes: 0 } };
      }

      return this.insertAdminAction({
        actionType,
        targetType,
        targetId: issue.id,
        details,
        performedBy,
        performedAt,
        ipAddress,
      });
    }

    if (sql.startsWith('INSERT INTO admin_actions')) {
      const [actionType, targetType, targetId, details, performedBy, performedAt, ipAddress] = bindings;
      return this.insertAdminAction({
        actionType,
        targetType,
        targetId,
        details,
        performedBy,
        performedAt,
        ipAddress,
      });
    }

    if (sql.startsWith('INSERT INTO rate_limit_state')) {
      const [endpoint, clientIp, windowStartedAt, updatedAt, nowA, nowB, nowC, maxRequests, blockedUntil] = bindings;
      let row = this.rateLimitState.find((item) => item.endpoint === endpoint && item.client_ip === clientIp);

      if (!row) {
        row = {
          endpoint,
          client_ip: clientIp,
          window_started_at: windowStartedAt,
          request_count: 1,
          blocked_until: null,
          updated_at: updatedAt,
        };
        this.rateLimitState.push(row);
      } else {
        const hasActiveBlock = row.blocked_until != null && row.blocked_until > nowA;
        if (hasActiveBlock) {
          row.updated_at = updatedAt;
        } else if (row.window_started_at === windowStartedAt) {
          row.request_count += 1;
          row.blocked_until = row.request_count > maxRequests ? blockedUntil : null;
          row.updated_at = updatedAt;
        } else {
          row.window_started_at = windowStartedAt;
          row.request_count = 1;
          row.blocked_until = null;
          row.updated_at = updatedAt;
        }

        if (row.blocked_until != null && row.blocked_until <= nowB && row.window_started_at !== windowStartedAt) {
          row.blocked_until = null;
        }

        if (row.blocked_until != null && row.blocked_until <= nowC && row.request_count <= maxRequests) {
          row.blocked_until = null;
        }
      }

      return {
        request_count: row.request_count,
        blocked_until: row.blocked_until,
        window_started_at: row.window_started_at,
      };
    }

    if (sql.startsWith('INSERT INTO request_observations')) {
      const [bucketTimestamp, observedAt, path, methodName, status, durationMs, sanitizedMessage, createdAt] = bindings;
      const observation = {
        id: this.ids.observation++,
        bucket_timestamp: bucketTimestamp,
        observed_at: observedAt,
        path,
        method: methodName,
        status,
        duration_ms: durationMs,
        sanitized_message: sanitizedMessage,
        created_at: createdAt,
      };
      this.requestObservations.push(observation);
      return { success: true, meta: { last_row_id: observation.id, changes: 1 } };
    }

    if (sql === 'DELETE FROM request_observations WHERE observed_at < ?') {
      const [cutoff] = bindings;
      const before = this.requestObservations.length;
      this.requestObservations = this.requestObservations.filter((item) => item.observed_at >= cutoff);
      return { success: true, meta: { changes: before - this.requestObservations.length } };
    }

    if (sql === 'SELECT id FROM issues WHERE tracking_code = ? LIMIT 1') {
      const [trackingCode] = bindings;
      const row = this.findIssueByTrackingCode(trackingCode);
      return row ? { id: row.id } : null;
    }

    if (sql === 'SELECT * FROM issues WHERE tracking_code = ? LIMIT 1') {
      const [trackingCode] = bindings;
      const row = this.findIssueByTrackingCode(trackingCode);
      return row ? clone(row) : null;
    }

    if (sql === 'SELECT * FROM issues WHERE id = ? LIMIT 1') {
      const [issueId] = bindings;
      const row = this.findIssueById(issueId);
      return row ? clone(row) : null;
    }

    if (sql.startsWith('SELECT COUNT(*) AS total FROM issues')) {
      return {
        total: this.filterAdminIssues(sql, bindings).length,
      };
    }

    if (sql.startsWith('SELECT scene_tag AS scene,')) {
      const grouped = new Map();
      for (const issue of this.filterAdminIssues(sql, bindings)) {
        if (!issue.scene_tag) {
          continue;
        }

        const current = grouped.get(issue.scene_tag) || { scene: issue.scene_tag, total: 0, pending: 0 };
        current.total += 1;
        if (['submitted', 'in_review', 'in_progress'].includes(issue.status)) {
          current.pending += 1;
        }
        grouped.set(issue.scene_tag, current);
      }

      return {
        results: Array.from(grouped.values()).sort((left, right) => right.total - left.total || left.scene.localeCompare(right.scene)),
      };
    }

    if (sql.startsWith('SELECT distress_type AS label,') || sql.startsWith('SELECT scene_tag AS label,')) {
      const column = sql.startsWith('SELECT distress_type AS label,') ? 'distress_type' : 'scene_tag';
      const grouped = new Map();
      for (const issue of this.filterAdminIssues(sql, bindings)) {
        const label = issue[column];
        if (!label) {
          continue;
        }

        grouped.set(label, (grouped.get(label) || 0) + 1);
      }

      return {
        results: Array.from(grouped.entries())
          .map(([label, total]) => ({ label, total }))
          .sort((left, right) => right.total - left.total || left.label.localeCompare(right.label)),
      };
    }

    if (sql.includes('FROM issue_updates WHERE issue_id = ?') && sql.includes("AND (update_type = 'status_change' OR is_public = 1)")) {
      const [issueId] = bindings;
      const results = this.issueUpdates
        .filter((item) => item.issue_id === issueId)
        .filter((item) => item.update_type === 'status_change' || Number(item.is_public) === 1)
        .filter((item) => !(item.update_type === 'status_change' && item.old_value == null && item.new_value === 'submitted'))
        .sort((left, right) => left.created_at.localeCompare(right.created_at) || left.id - right.id)
        .map((item) => ({
          update_type: item.update_type,
          old_value: item.old_value,
          new_value: item.new_value,
          content: item.content,
          is_public: item.is_public,
          created_at: item.created_at,
          id: item.id,
        }));
      return { results };
    }

    if (sql === 'SELECT * FROM issue_updates WHERE issue_id = ? ORDER BY created_at ASC, id ASC') {
      const [issueId] = bindings;
      return {
        results: this.issueUpdates
          .filter((item) => item.issue_id === issueId)
          .sort((left, right) => left.created_at.localeCompare(right.created_at) || left.id - right.id)
          .map((item) => clone(item)),
      };
    }

    if (sql === 'SELECT * FROM issue_internal_notes WHERE issue_id = ? ORDER BY created_at DESC, id DESC') {
      const [issueId] = bindings;
      return {
        results: this.issueInternalNotes
          .filter((item) => item.issue_id === issueId)
          .sort((left, right) => right.created_at.localeCompare(left.created_at) || right.id - left.id)
          .map((item) => clone(item)),
      };
    }

    if (sql.includes('FROM admin_actions') && sql.includes("WHERE target_type = 'issue' AND target_id = ?")) {
      const [targetId] = bindings;
      return {
        results: this.adminActions
          .filter((item) => item.target_type === 'issue' && item.target_id === targetId)
          .sort((left, right) => right.performed_at.localeCompare(left.performed_at) || right.id - left.id)
          .map((item) => clone(item)),
      };
    }

    if (sql.startsWith('SELECT bucket_timestamp AS timestamp,')) {
      const [cutoff] = bindings;
      const grouped = new Map();

      for (const item of this.requestObservations.filter((entry) => entry.bucket_timestamp >= cutoff)) {
        const key = item.bucket_timestamp;
        const bucket = grouped.get(key) || {
          timestamp: key,
          requestCount: 0,
          errorCount: 0,
          rateLimitHits: 0,
          totalResponseTime: 0,
        };
        bucket.requestCount += 1;
        if (item.status >= 500) {
          bucket.errorCount += 1;
        }
        if (item.status === 429) {
          bucket.rateLimitHits += 1;
        }
        bucket.totalResponseTime += Number(item.duration_ms) || 0;
        grouped.set(key, bucket);
      }

      return {
        results: Array.from(grouped.values()).sort((left, right) => left.timestamp - right.timestamp),
      };
    }

    if (sql.startsWith('SELECT observed_at, path, method, status, sanitized_message FROM request_observations')) {
      const [limit] = bindings;
      return {
        results: this.requestObservations
          .filter((item) => item.status >= 400)
          .sort((left, right) => right.observed_at - left.observed_at || right.id - left.id)
          .slice(0, limit)
          .map((item) => ({
            observed_at: item.observed_at,
            path: item.path,
            method: item.method,
            status: item.status,
            sanitized_message: item.sanitized_message,
          })),
      };
    }

    if (sql.startsWith('UPDATE issues SET ')) {
      let match = sql.match(/^UPDATE issues SET (.+) WHERE id = \? AND updated_at = \?$/);
      let hasUpdatedAtGuard = true;
      if (!match) {
        match = sql.match(/^UPDATE issues SET (.+) WHERE id = \?$/);
        hasUpdatedAtGuard = false;
      }
      if (!match) {
        throw new Error(`Unsupported update statement: ${sql}`);
      }

      const assignments = match[1].split(',').map((item) => item.trim());
      const issueId = bindings[assignments.length];
      const expectedUpdatedAt = hasUpdatedAtGuard ? bindings[assignments.length + 1] : null;
      const issue = this.findIssueById(issueId);
      if (!issue) {
        return { success: true, meta: { changes: 0 } };
      }

      if (hasUpdatedAtGuard && issue.updated_at !== expectedUpdatedAt) {
        return { success: true, meta: { changes: 0 } };
      }

      assignments.forEach((assignment, index) => {
        const column = assignment.replace(/ = \?$/, '');
        issue[column] = bindings[index];
      });

      return { success: true, meta: { changes: 1 } };
    }

    if (sql.startsWith('SELECT issues.id,') && sql.includes('FROM issues')) {
      const lastId = Number(bindings[bindings.length - 2]) || 0;
      const limit = Number(bindings[bindings.length - 1]) || this.issues.length;
      const filterBindings = bindings.slice(0, -2);
      const rows = this.filterAdminIssues(sql, filterBindings)
        .filter((issue) => issue.id > lastId)
        .sort((left, right) => left.id - right.id)
        .slice(0, limit)
        .map((issue) => clone(issue));
      return { results: rows };
    }

    if (sql.startsWith('SELECT DISTINCT assigned_to')) {
      const results = Array.from(new Set(this.issues.map((issue) => issue.assigned_to).filter(Boolean)))
        .sort((left, right) => left.localeCompare(right))
        .map((assignedTo) => ({ assigned_to: assignedTo }));
      return { results };
    }

    throw new Error(`Unsupported SQL in fake DB: ${sql}`);
  }
}

export function createD1Database() {
  return new FakeD1Database();
}

export function createAppEnv(overrides = {}) {
  return {
    ADMIN_SECRET_KEY: 'test-secret',
    ENVIRONMENT: 'development',
    RATE_LIMIT_KV: createRateLimitKv(),
    DB: createD1Database(),
    ...overrides,
  };
}
