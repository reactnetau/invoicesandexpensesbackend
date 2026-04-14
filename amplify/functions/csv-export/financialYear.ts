/** Australian financial year: July 1 to June 30 */

export function getFyDateRange(fyStartYear: number): { startDate: Date; endDate: Date } {
  return {
    startDate: new Date(fyStartYear, 6, 1),       // July 1
    endDate: new Date(fyStartYear + 1, 6, 1),    // July 1 next year (exclusive)
  };
}

export function getFyLabel(fyStartYear: number): string {
  return `FY ${fyStartYear}/${String(fyStartYear + 1).slice(-2)}`;
}

export function getCurrentFyStartYear(): number {
  const now = new Date();
  return now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
}
