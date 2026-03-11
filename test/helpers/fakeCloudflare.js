function normalizeSql(sql) {
  return sql.replace(/\s+/g, ' ').trim();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
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
    this.ids = {
      issue: 1,
      update: 1,
      note: 1,
      action: 1,
    };
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
    const results = [];
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
  }

  async execute(sql, bindings, mode) {
    if (sql === 'SELECT 1 AS ok') {
      return mode === 'first' ? { ok: 1 } : { results: [{ ok: 1 }] };
    }

    if (sql.startsWith('INSERT INTO issues (')) {
      const [trackingCode, name, studentId, content, isPublic, isReported, category, priority, status, createdAt, updatedAt] = bindings;
      const issue = {
        id: this.ids.issue++,
        tracking_code: trackingCode,
        name,
        student_id: studentId,
        content,
        is_public: isPublic,
        is_reported: isReported,
        category,
        priority,
        status,
        public_summary: null,
        assigned_to: null,
        first_response_at: null,
        resolved_at: null,
        created_at: createdAt,
        updated_at: updatedAt,
      };
      this.issues.push(issue);
      return { success: true, meta: { last_row_id: issue.id } };
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
      return { success: true, meta: { last_row_id: update.id } };
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
      return { success: true, meta: { last_row_id: note.id } };
    }

    if (sql.startsWith('INSERT INTO admin_actions')) {
      const [actionType, targetType, targetId, details, performedBy, performedAt, ipAddress] = bindings;
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
      return { success: true, meta: { last_row_id: action.id } };
    }

    if (sql === 'SELECT id FROM issues WHERE tracking_code = ? LIMIT 1') {
      const [trackingCode] = bindings;
      const row = this.issues.find((issue) => issue.tracking_code === trackingCode);
      return row ? { id: row.id } : null;
    }

    if (sql === 'SELECT * FROM issues WHERE tracking_code = ? LIMIT 1') {
      const [trackingCode] = bindings;
      const row = this.issues.find((issue) => issue.tracking_code === trackingCode);
      return row ? clone(row) : null;
    }

    if (sql === 'SELECT * FROM issues WHERE id = ? LIMIT 1') {
      const [issueId] = bindings;
      const row = this.issues.find((issue) => issue.id === issueId);
      return row ? clone(row) : null;
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

    if (sql.startsWith('UPDATE issues SET ')) {
      const match = sql.match(/^UPDATE issues SET (.+) WHERE id = \?$/);
      if (!match) {
        throw new Error(`Unsupported update statement: ${sql}`);
      }

      const assignments = match[1].split(',').map((item) => item.trim());
      const issueId = bindings[bindings.length - 1];
      const issue = this.issues.find((item) => item.id === issueId);
      if (!issue) {
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
      const rows = this.issues
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

export function createAppEnv(overrides = {}) {
  return {
    ADMIN_SECRET_KEY: 'test-secret',
    ENVIRONMENT: 'development',
    RATE_LIMIT_KV: createRateLimitKv(),
    DB: new FakeD1Database(),
    ...overrides,
  };
}
