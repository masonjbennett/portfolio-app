// Dates as the chrome prints them. The app's title chip formats its dates with strftime's
// "%b %Y" (portfolio_app.py 1182); monthYear is that, for an ISO day.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "2019-01-01" -> "Jan 2019". Anything that is not an ISO day is printed as it came, never guessed at.
export function monthYear(iso: string): string {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(iso);
  const name = m ? MONTHS[Number(m[2]) - 1] : undefined;
  return m && name ? `${name} ${m[1]}` : iso;
}

// Today in the visitor's own calendar, ISO. settings.end null means this day (704: date.today()).
export function todayISO(now: Date = new Date()): string {
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${mm}-${dd}`;
}
