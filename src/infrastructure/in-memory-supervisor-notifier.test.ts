import { describe, expect, it } from 'vitest';
import { InMemorySupervisorNotifier } from './in-memory-supervisor-notifier.js';

describe('InMemorySupervisorNotifier', () => {
  it('copies notifications on input and through every inspection accessor', () => {
    const notifier = new InMemorySupervisorNotifier();
    const notification = {
      ticketId: 'ticket-1',
      cycle: 1,
      notifiedAt: new Date('2025-01-01T00:00:00.000Z'),
    };

    notifier.notify(notification);
    notification.notifiedAt.setUTCDate(2);

    const fromList = notifier.list();
    fromList[0].notifiedAt.setUTCDate(3);
    const fromListNotifications = notifier.listNotifications();
    fromListNotifications[0].notifiedAt.setUTCDate(4);
    notifier.notifications[0].notifiedAt.setUTCDate(5);

    expect(notifier.list()).toEqual([
      {
        ticketId: 'ticket-1',
        cycle: 1,
        notifiedAt: new Date('2025-01-01T00:00:00.000Z'),
      },
    ]);
  });

  it('keeps emitted notifications observable', () => {
    const notifier = new InMemorySupervisorNotifier();
    const notifiedAt = new Date('2025-01-01T00:00:00.000Z');

    notifier.notify({
      ticketId: 'ticket-1',
      cycle: 1,
      notifiedAt,
    });

    expect(notifier.list()).toEqual([
      {
        ticketId: 'ticket-1',
        cycle: 1,
        notifiedAt,
      },
    ]);
    expect(notifier.notifications).toEqual(notifier.list());
  });

  it('returns defensive notification records', () => {
    const notifier = new InMemorySupervisorNotifier();
    notifier.notify({
      ticketId: 'ticket-1',
      cycle: 1,
      notifiedAt: new Date('2025-01-01T00:00:00.000Z'),
    });

    const observed = notifier.list();
    observed[0].notifiedAt.setUTCDate(2);

    expect(notifier.list()[0].notifiedAt.toISOString()).toBe(
      '2025-01-01T00:00:00.000Z',
    );
  });
});
