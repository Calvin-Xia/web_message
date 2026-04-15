import { z } from 'zod';
import {
  ADMIN_SORT_VALUES,
  ADMIN_SORT_FIELD_VALUES,
  CATEGORY_VALUES,
  DISTRESS_TYPE_VALUES,
  METRIC_PERIOD_VALUES,
  PRIORITY_VALUES,
  PUBLIC_SORT_VALUES,
  PUBLIC_SORT_FIELD_VALUES,
  SCENE_TAG_VALUES,
  SORT_ORDER_VALUES,
  STATUS_VALUES,
  TRACKING_CODE_PATTERN,
} from './constants.js';

const studentIdPattern = /^\d{4}$|^\d{5}$|^\d{13}$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function emptyToUndefined(value) {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function emptyToNull(value) {
  if (value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function csvToArray(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  if (trimmed === '') {
    return undefined;
  }

  return trimmed
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function stringToBoolean(value) {
  if (typeof value === 'boolean' || value === undefined) {
    return value;
  }

  if (typeof value !== 'string') {
    return value;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === '') {
    return undefined;
  }

  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }

  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }

  return value;
}

function enumListSchema(values, message) {
  return z.preprocess(csvToArray, z.array(z.enum(values, {
    error: () => ({ message }),
  })).optional());
}

function makeCounselingFieldSchemas(values, message) {
  const valueSchema = z.enum(values, {
    error: () => ({ message }),
  });

  return {
    optional: z.preprocess(emptyToUndefined, valueSchema.optional()),
    nullable: z.preprocess(emptyToNull, z.union([valueSchema, z.null()]).optional()),
  };
}

function validateDateRange(value, ctx) {
  if (value.startDate && value.endDate && value.startDate > value.endDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['startDate'],
      message: '开始日期不能晚于结束日期',
    });
  }
}

function isValidTimestamp(value) {
  return typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Date.parse(value));
}

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
const dateQuerySchema = z.preprocess(emptyToUndefined, z.string().regex(datePattern, '日期格式必须为 YYYY-MM-DD').optional());
const daysQuerySchema = z.preprocess(emptyToUndefined, z.coerce.number().int().min(1, '统计天数不能少于1天').max(365, '统计天数不能超过365天').default(90));
const booleanQuerySchema = z.preprocess(stringToBoolean, z.boolean().optional());
const optionalEmailSchema = z.preprocess(emptyToUndefined, z.string().trim().max(254, '邮箱不能超过254个字符').email('邮箱格式无效').optional());
const distressTypeSchemas = makeCounselingFieldSchemas(DISTRESS_TYPE_VALUES, '困扰类别无效');
const sceneTagSchemas = makeCounselingFieldSchemas(SCENE_TAG_VALUES, '场景标签无效');

export const issueSchema = z.object({
  name: z.string().trim().min(1, '姓名不能为空').max(50, '姓名不能超过50个字符'),
  studentId: z.string().trim().regex(studentIdPattern, '学号必须为4位、5位或13位数字'),
  email: optionalEmailSchema,
  notifyByEmail: z.boolean().default(false),
  content: z.string().trim().min(10, '问题内容至少需要10个字符').max(2000, '问题内容不能超过2000个字符'),
  isPublic: z.boolean().default(false),
  isReported: z.boolean().default(false),
  category: z.enum(CATEGORY_VALUES, {
    error: () => ({ message: '分类无效' }),
  }),
  distressType: distressTypeSchemas.optional,
  sceneTag: sceneTagSchemas.optional,
}).strict().superRefine((value, ctx) => {
  if (value.category === 'counseling') {
    return;
  }

  if (value.distressType !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['distressType'],
      message: '仅心理咨询分类可选择困扰类别',
    });
  }

  if (value.sceneTag !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['sceneTag'],
      message: '仅心理咨询分类可选择场景标签',
    });
  }
}).transform((value) => ({
  // 邮箱是提醒能力的前提；未提供邮箱时统一关闭提醒，避免出现“开启提醒但无投递目标”的状态。
  ...value,
  email: value.email?.toLowerCase(),
  notifyByEmail: Boolean(value.email) && value.notifyByEmail,
  distressType: value.category === 'counseling' ? value.distressType ?? null : null,
  sceneTag: value.category === 'counseling' ? value.sceneTag ?? null : null,
}));

export const publicIssueListQuerySchema = paginationSchema.extend({
  status: enumListSchema(STATUS_VALUES, '状态无效'),
  category: enumListSchema(CATEGORY_VALUES, '分类无效'),
  q: z.preprocess(emptyToUndefined, z.string().max(100, '搜索关键词不能超过100个字符').optional()),
  startDate: dateQuerySchema,
  endDate: dateQuerySchema,
  sort: z.preprocess(emptyToUndefined, z.enum(PUBLIC_SORT_VALUES).default('newest')),
  sortField: z.preprocess(emptyToUndefined, z.enum(PUBLIC_SORT_FIELD_VALUES).optional()),
  sortOrder: z.preprocess(emptyToUndefined, z.enum(SORT_ORDER_VALUES).optional()),
}).superRefine(validateDateRange);

export const publicInsightsQuerySchema = z.object({
  startDate: dateQuerySchema,
  endDate: dateQuerySchema,
  days: daysQuerySchema,
}).superRefine(validateDateRange).superRefine((value, ctx) => {
  if (!value.startDate || !value.endDate) {
    return;
  }

  const start = Date.parse(`${value.startDate}T00:00:00.000Z`);
  const end = Date.parse(`${value.endDate}T00:00:00.000Z`);
  const rangeDays = Math.floor((end - start) / 86400000) + 1;
  if (rangeDays > 365) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endDate'],
      message: '公开热区统计范围不能超过365天',
    });
  }
});

export const trackingCodeSchema = z.string().trim().transform((value) => value.toUpperCase()).refine((value) => TRACKING_CODE_PATTERN.test(value), {
  message: '追踪编号格式无效',
});

export const adminIssueListQuerySchema = paginationSchema.extend({
  status: enumListSchema(STATUS_VALUES, '状态无效'),
  category: enumListSchema(CATEGORY_VALUES, '分类无效'),
  priority: enumListSchema(PRIORITY_VALUES, '优先级无效'),
  distressType: enumListSchema(DISTRESS_TYPE_VALUES, '困扰类别无效'),
  sceneTag: enumListSchema(SCENE_TAG_VALUES, '场景标签无效'),
  assignedTo: z.preprocess(emptyToUndefined, z.string().max(50, '指派人不能超过50个字符').optional()),
  q: z.preprocess(emptyToUndefined, z.string().max(100, '搜索关键词不能超过100个字符').optional()),
  sort: z.preprocess(emptyToUndefined, z.enum(ADMIN_SORT_VALUES).default('newest')),
  startDate: dateQuerySchema,
  endDate: dateQuerySchema,
  updatedAfter: dateQuerySchema,
  hasNotes: booleanQuerySchema,
  hasReplies: booleanQuerySchema,
  isAssigned: booleanQuerySchema,
  sortField: z.preprocess(emptyToUndefined, z.enum(ADMIN_SORT_FIELD_VALUES).optional()),
  sortOrder: z.preprocess(emptyToUndefined, z.enum(SORT_ORDER_VALUES).optional()),
}).superRefine(validateDateRange);

export const issueIdSchema = z.coerce.number().int().positive('问题 ID 无效');

const adminIssuePatchBaseSchema = z.object({
  updatedAt: z.string().trim().refine(isValidTimestamp, '更新时间格式无效'),
  category: z.preprocess(emptyToUndefined, z.enum(CATEGORY_VALUES).optional()),
  priority: z.preprocess(emptyToUndefined, z.enum(PRIORITY_VALUES).optional()),
  status: z.preprocess(emptyToUndefined, z.enum(STATUS_VALUES).optional()),
  assignedTo: z.preprocess(emptyToNull, z.union([
    z.string().trim().min(1, '指派人不能为空').max(50, '指派人不能超过50个字符'),
    z.null(),
  ]).optional()),
  publicSummary: z.preprocess(emptyToNull, z.union([
    z.string().trim().min(1, '公开摘要不能为空').max(500, '公开摘要不能超过500个字符'),
    z.null(),
  ]).optional()),
  distressType: distressTypeSchemas.nullable,
  sceneTag: sceneTagSchemas.nullable,
  isPublic: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).some((key) => key !== 'updatedAt'), {
  message: '至少提供一个更新字段',
});

function hasNonNullCounselingField(value) {
  return value != null;
}

export function createAdminIssuePatchSchema(existingCategory) {
  return adminIssuePatchBaseSchema.superRefine((value, ctx) => {
    const effectiveCategory = value.category ?? existingCategory;
    if (effectiveCategory === 'counseling') {
      return;
    }

    if (hasNonNullCounselingField(value.distressType)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['distressType'],
        message: '仅心理咨询分类可选择困扰类别',
      });
    }

    if (hasNonNullCounselingField(value.sceneTag)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sceneTag'],
        message: '仅心理咨询分类可选择场景标签',
      });
    }
  });
}

export const adminIssuePatchSchema = createAdminIssuePatchSchema();

export const statusUpdateSchema = adminIssuePatchSchema;

export const noteSchema = z.object({
  content: z.string().trim().min(1, '备注内容不能为空').max(1000, '备注内容不能超过1000个字符'),
}).strict();

export const replySchema = z.object({
  content: z.string().trim().min(1, '回复内容不能为空').max(1000, '回复内容不能超过1000个字符'),
  isPublic: z.boolean().default(true),
}).strict();

export const adminActionListQuerySchema = paginationSchema.extend({
  targetId: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().optional()),
  actionType: z.preprocess(emptyToUndefined, z.string().max(50).optional()),
});

export const adminMetricsQuerySchema = z.object({
  startDate: dateQuerySchema,
  endDate: dateQuerySchema,
  period: z.preprocess(emptyToUndefined, z.enum(METRIC_PERIOD_VALUES).default('week')),
  refresh: booleanQuerySchema,
}).superRefine(validateDateRange);

export const adminExportQuerySchema = z.object({
  format: z.preprocess(emptyToUndefined, z.literal('csv').default('csv')),
  status: enumListSchema(STATUS_VALUES, '状态无效'),
  category: enumListSchema(CATEGORY_VALUES, '分类无效'),
  priority: enumListSchema(PRIORITY_VALUES, '优先级无效'),
  distressType: enumListSchema(DISTRESS_TYPE_VALUES, '困扰类别无效'),
  sceneTag: enumListSchema(SCENE_TAG_VALUES, '场景标签无效'),
  assignedTo: z.preprocess(emptyToUndefined, z.string().max(50, '指派人不能超过50个字符').optional()),
  q: z.preprocess(emptyToUndefined, z.string().max(100, '搜索关键词不能超过100个字符').optional()),
  startDate: dateQuerySchema,
  endDate: dateQuerySchema,
  updatedAfter: dateQuerySchema,
  hasNotes: booleanQuerySchema,
  hasReplies: booleanQuerySchema,
  isAssigned: booleanQuerySchema,
}).superRefine(validateDateRange);

export function formatZodError(error) {
  const issue = error.issues?.[0];
  return issue?.message || '请求参数无效';
}
