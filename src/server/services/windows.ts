import { DAY, startOfDubaiDay } from "@/lib/time";

export function todayWindow(now: number) {
  const start = startOfDubaiDay(now);
  return { start, end: now + 1, yStart: start - DAY, yEnd: now - DAY };
}
