export const STATUS_VALUES = ['submitted', 'in_review', 'in_progress', 'resolved', 'closed'];
export const PRIORITY_VALUES = ['low', 'normal', 'high', 'urgent'];
export const CATEGORY_VALUES = ['academic', 'facility', 'service', 'complaint', 'counseling', 'other'];
export const PUBLIC_SORT_VALUES = ['newest', 'oldest', 'updated'];
export const ADMIN_SORT_VALUES = ['newest', 'oldest', 'updated'];
export const PUBLIC_SORT_FIELD_VALUES = ['createdAt', 'updatedAt', 'status'];
export const ADMIN_SORT_FIELD_VALUES = ['createdAt', 'updatedAt', 'priority'];
export const SORT_ORDER_VALUES = ['asc', 'desc'];
export const METRIC_PERIOD_VALUES = ['day', 'week', 'month'];
export const TRACKING_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{8}$/;

export const STATUS_TRANSITIONS = {
  submitted: ['in_review', 'closed'],
  in_review: ['in_progress', 'closed'],
  in_progress: ['resolved', 'closed'],
  resolved: ['closed', 'in_progress'],
  closed: [],
};

export function canTransitionStatus(currentStatus, nextStatus) {
  if (currentStatus === nextStatus) {
    return true;
  }

  return STATUS_TRANSITIONS[currentStatus]?.includes(nextStatus) ?? false;
}

export function getAllowedTransitionStatuses(currentStatus, { includeCurrent = false } = {}) {
  const allowed = STATUS_TRANSITIONS[currentStatus] ?? [];
  return includeCurrent ? [currentStatus, ...allowed] : [...allowed];
}
