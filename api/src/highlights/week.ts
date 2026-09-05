// Africa/Ouagadougou is UTC all year. Dates never depend on the server's timezone.
export function currentWeekStart(now = new Date()): string {
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
  return monday.toISOString().slice(0, 10);
}

export function weekEnd(weekStart: string): string {
  const sunday = new Date(`${weekStart}T00:00:00.000Z`);
  sunday.setUTCDate(sunday.getUTCDate() + 6);
  return sunday.toISOString().slice(0, 10);
}
