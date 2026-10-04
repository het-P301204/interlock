/**
 * Logix Designer date strings. ExportDate, LastModifiedDate and
 * ProjectCreationDate use the C ctime layout with zero-padded day of month:
 * "Wed Sep 30 14:12:09 2026". Pure: Date.UTC only computes a weekday.
 */
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** month is 1-based. */
export function logixDate(year: number, month: number, day: number, hour: number, minute: number, second: number): string {
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  return `${DAYS[weekday]} ${MONTHS[month - 1]} ${pad(day)} ${pad(hour)}:${pad(minute)}:${pad(second)} ${year}`
}

/** AOI CreatedDate/EditedDate format: "2026-03-02T10:41:05.880Z". month is 1-based. */
export function aoiDate(year: number, month: number, day: number, hour: number, minute: number, second: number, ms: number): string {
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}.${String(ms).padStart(3, '0')}Z`
}
