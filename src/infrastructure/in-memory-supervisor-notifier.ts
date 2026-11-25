import type { SupervisorNotification } from '../domain/types.js';
import type { SupervisorNotifier } from './contracts.js';

function copyNotification(
  record: SupervisorNotification,
): SupervisorNotification {
  return {
    ...record,
    notifiedAt: new Date(record.notifiedAt),
  };
}

/** In-memory supervisor notifier whose emitted records can be inspected in tests. */
export class InMemorySupervisorNotifier implements SupervisorNotifier {
  private readonly emittedNotifications: SupervisorNotification[] = [];

  notify(record: SupervisorNotification): void {
    this.emittedNotifications.push(copyNotification(record));
  }

  list(): SupervisorNotification[] {
    return this.emittedNotifications.map(copyNotification);
  }

  listNotifications(): SupervisorNotification[] {
    return this.list();
  }

  get notifications(): SupervisorNotification[] {
    return this.list();
  }
}
