import { z } from 'zod';
import {
  ADMIN_SORT_VALUES,
  CATEGORY_VALUES,
  PRIORITY_VALUES,
  PUBLIC_SORT_VALUES,
  STATUS_VALUES,
  TRACKING_CODE_PATTERN,
} from './constants.js';

const studentIdPattern = /^\d{4}$|^\d{5}$|^\d{13}$/;

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

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const issueSchema = z.object({
  name: z.string().trim().min(1, '姓名不能为空').max(50, '姓名不能超过50个字符'),
  studentId: z.string().trim().regex(studentIdPattern, '学号必须为4位、5位或13位数字'),
  content: z.string().trim().min(10, '问题内容至少需要10个字符').max(2000, '问题内容不能超过2000个字符'),
  isPublic: z.boolean().default(false),
  isReported: z.boolean().default(false),
  category: z.enum(CATEGORY_VALUES, {
    error: () => ({ message: '分类无效' }),
  }),
}).strict();

export const publicIssueListQuerySchema = paginationSchema.extend({
  status: z.preprocess(emptyToUndefined, z.enum(STATUS_VALUES).optional()),
  category: z.preprocess(emptyToUndefined, z.enum(CATEGORY_VALUES).optional()),
  q: z.preprocess(emptyToUndefined, z.string().max(100, '搜索关键词不能超过100个字符').optional()),
  sort: z.preprocess(emptyToUndefined, z.enum(PUBLIC_SORT_VALUES).default('newest')),
});

export const trackingCodeSchema = z.string().trim().transform((value) => value.toUpperCase()).refine((value) => TRACKING_CODE_PATTERN.test(value), {
  message: '追踪编号格式无效',
});

export const adminIssueListQuerySchema = paginationSchema.extend({
  status: z.preprocess(emptyToUndefined, z.enum(STATUS_VALUES).optional()),
  category: z.preprocess(emptyToUndefined, z.enum(CATEGORY_VALUES).optional()),
  priority: z.preprocess(emptyToUndefined, z.enum(PRIORITY_VALUES).optional()),
  assignedTo: z.preprocess(emptyToUndefined, z.string().max(50, '指派人不能超过50个字符').optional()),
  q: z.preprocess(emptyToUndefined, z.string().max(100, '搜索关键词不能超过100个字符').optional()),
  sort: z.preprocess(emptyToUndefined, z.enum(ADMIN_SORT_VALUES).default('newest')),
});

export const issueIdSchema = z.coerce.number().int().positive('问题 ID 无效');

export const adminIssuePatchSchema = z.object({
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
  isPublic: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: '至少提供一个更新字段',
});

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

export function formatZodError(error) {
  const issue = error.issues?.[0];
  return issue?.message || '请求参数无效';
}
