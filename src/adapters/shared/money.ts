import { round2 } from "@/lib/rng";

export const VAT_RATE = 0.05;

export function vatOn(amount: number): number {
  return round2(amount * VAT_RATE);
}

export function toMinor(amount: number): number {
  return Math.round(amount * 100);
}

export function fromMinor(minor: number): number {
  return round2(minor / 100);
}
