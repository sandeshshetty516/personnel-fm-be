import {
  currentFinancialMonth,
  financialMonthBuckets,
  formatCalendarDate,
  parseCalendarDate,
} from '../src/common/dates';

const span = (b: { start: Date; end: Date }) =>
  `${formatCalendarDate(b.start)}..${formatCalendarDate(new Date(b.end.getTime() - 86_400_000))}`;

describe('calendar dates', () => {
  it('rejects impossible dates', () => {
    expect(parseCalendarDate('2026-02-29')).toBeNull();
    expect(parseCalendarDate('2028-02-29')).not.toBeNull();
    expect(parseCalendarDate('2026-13-01')).toBeNull();
  });
});

describe('currentFinancialMonth', () => {
  it('follows the configured start day', () => {
    expect(currentFinancialMonth('2026-11-03', 1)).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(currentFinancialMonth('2026-11-03', 25)).toEqual({ from: '2026-10-25', to: '2026-11-24' });
    expect(currentFinancialMonth('2026-01-05', 10)).toEqual({ from: '2025-12-10', to: '2026-01-09' });
  });
});

describe('financialMonthBuckets', () => {
  it('splits a range into calendar months when months start on day 1', () => {
    expect(financialMonthBuckets('2026-09-01', '2026-11-30', 1).map(span)).toEqual([
      '2026-09-01..2026-09-30',
      '2026-10-01..2026-10-31',
      '2026-11-01..2026-11-30',
    ]);
  });

  it('splits at the financial month start day and clips the ends to the range', () => {
    expect(financialMonthBuckets('2026-10-01', '2026-11-30', 25).map(span)).toEqual([
      '2026-10-01..2026-10-24',
      '2026-10-25..2026-11-24',
      '2026-11-25..2026-11-30',
    ]);
  });

  it('returns a single bucket for a short range', () => {
    expect(financialMonthBuckets('2026-11-03', '2026-11-03', 1).map(span)).toEqual(['2026-11-03..2026-11-03']);
  });
});
