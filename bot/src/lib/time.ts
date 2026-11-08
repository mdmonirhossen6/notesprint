export const DHAKA_TIME_ZONE = 'Asia/Dhaka';
export const DHAKA_TIME_ZONE_LABEL = 'BST';

export function nowSeconds(now = Date.now()): number {
  return Math.floor(now / 1000);
}

interface DhakaParts {
  day: string;
  month: string;
  year: string;
  hour: string;
  minute: string;
  period: string;
}

function dhakaParts(date: Date): DhakaParts {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: DHAKA_TIME_ZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(date);

  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';

  return {
    day: value('day'),
    month: value('month'),
    year: value('year'),
    hour: value('hour'),
    minute: value('minute'),
    period: (value('dayPeriod') || 'am').toUpperCase(),
  };
}

export function formatDhakaTimestamp(date: Date = new Date()): string {
  const parts = dhakaParts(date);
  return `${parts.day} ${parts.month} ${parts.year}, ${parts.hour}:${parts.minute} ${parts.period} (${DHAKA_TIME_ZONE_LABEL})`;
}

export function formatDhakaTime(date: Date = new Date()): string {
  const parts = dhakaParts(date);
  return `${parts.hour}:${parts.minute} ${parts.period}`;
}
