import { parseJsonValue, toBoolean } from './utils.js';

const CAMPUS_CARE_WORDS = [
  '心理咨询',
  '学业压力',
  '考试成绩',
  '考试',
  '成绩',
  '挂科',
  '人际关系',
  '情绪波动',
  '睡眠问题',
  '适应困难',
  '宿舍',
  '图书馆',
  '自习室',
  '食堂',
  '操场',
  '空调',
  '热水',
  '维修',
  '辅导员',
];
const CUSTOM_DICTIONARY = CAMPUS_CARE_WORDS.map((word) => `${word} 10 n`).join('\n');

let jiebaModulePromise = null;
let dictionaryConfigured = false;

function normalizeToken(value) {
  return String(value || '').trim().toLowerCase();
}

function uniq(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function parseKeywords(value) {
  const parsed = Array.isArray(value) ? value : parseJsonValue(value, []);
  if (!Array.isArray(parsed)) {
    return [];
  }

  return uniq(parsed.map(normalizeToken));
}

function fallbackSegment(text) {
  const normalized = normalizeToken(text);
  const words = normalized.split(/[\s,，。！？；;:：、()[\]{}"'“”‘’<>《》]+/).filter(Boolean);
  const grams = [];

  for (const word of words) {
    grams.push(word);
    for (let size = 2; size <= 4; size += 1) {
      for (let index = 0; index <= word.length - size; index += 1) {
        grams.push(word.slice(index, index + size));
      }
    }
  }

  return uniq(grams);
}

async function loadJiebaModule() {
  if (!jiebaModulePromise) {
    jiebaModulePromise = import('jieba-wasm')
      .then(async (module) => {
        if (typeof module.default === 'function') {
          await module.default();
        }

        if (!dictionaryConfigured && typeof module.with_dict === 'function') {
          module.with_dict(CUSTOM_DICTIONARY);
          dictionaryConfigured = true;
        }

        return module;
      })
      .catch(() => {
        jiebaModulePromise = null;
        return null;
      });
  }

  return jiebaModulePromise;
}

export function mapAssignRule(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category ?? null,
    keywords: parseKeywords(row.keywords),
    assignTo: row.assign_to,
    priority: Number(row.priority) || 0,
    isEnabled: toBoolean(row.is_enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function segmentChineseText(text) {
  const normalized = String(text || '').trim();
  if (!normalized) {
    return [];
  }

  const jieba = await loadJiebaModule();
  if (!jieba?.cut_for_search) {
    return fallbackSegment(normalized);
  }

  try {
    return uniq([
      ...jieba.cut_for_search(normalized, true).map(normalizeToken),
      ...fallbackSegment(normalized),
    ]);
  } catch {
    return fallbackSegment(normalized);
  }
}

export async function getEnabledAssignRules(db) {
  const rows = await db.prepare(`
    SELECT *
    FROM assign_rules
    WHERE is_enabled = 1
    ORDER BY priority DESC, id ASC
  `).all();

  return (rows.results || []).map(mapAssignRule);
}

export async function matchAssignRule(issue, rules) {
  const enabledRules = (rules || [])
    .filter((rule) => rule.isEnabled !== false)
    .sort((left, right) => (right.priority - left.priority) || (left.id - right.id));
  const tokens = new Set(await segmentChineseText(`${issue.content || ''} ${issue.publicSummary || ''}`));

  for (const rule of enabledRules) {
    if (rule.category && rule.category !== issue.category) {
      continue;
    }

    if (!rule.keywords || rule.keywords.length === 0) {
      return rule;
    }

    if (rule.keywords.some((keyword) => tokens.has(keyword))) {
      return rule;
    }
  }

  return null;
}

export async function findAssignmentForIssue(db, issue) {
  const rules = await getEnabledAssignRules(db);
  return matchAssignRule(issue, rules);
}
