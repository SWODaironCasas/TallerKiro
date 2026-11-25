import type { Priority } from './types.js';

const HOUR_IN_MILLISECONDS = 60 * 60 * 1000;

/** Resolution SLA in hours for each supported priority. */
export const SLA_HOURS: Readonly<Record<Priority, number>> = Object.freeze({
  CRITICA: 4,
  ALTA: 8,
  MEDIA: 24,
  BAJA: 72,
});

/** Resolution SLA in milliseconds for each supported priority. */
export const SLA_DURATION_MS: Readonly<Record<Priority, number>> =
  Object.freeze(
    Object.fromEntries(
      (Object.entries(SLA_HOURS) as Array<[Priority, number]>).map(
        ([priority, hours]) => [priority, hours * HOUR_IN_MILLISECONDS],
      ),
    ) as Record<Priority, number>,
  );

/**
 * Returns the resolution SLA duration for a priority.
 *
 * The parameter is typed as Priority, so callers must validate untrusted
 * values before reaching the domain rule.
 */
export function getSlaDurationMs(priority: Priority): number {
  return SLA_DURATION_MS[priority];
}

export function getSlaHours(priority: Priority): number {
  return SLA_HOURS[priority];
}

/** Calculates the due date without modifying the creation date. */
export function calculateDueAt(createdAt: Date, priority: Priority): Date {
  return new Date(createdAt.getTime() + getSlaDurationMs(priority));
}

export const calculateDueDate = calculateDueAt;
