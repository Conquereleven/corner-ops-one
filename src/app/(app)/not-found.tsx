import Link from "next/link";
import { EmptyState } from "@/components/shared/states";

export default function NotFound() {
  return (
    <EmptyState
      className="mt-10"
      title="Not found"
      description="This record doesn't exist in the current workspace (demo data may have been regenerated)."
      action={<Link href="/overview" className="text-sm font-medium underline underline-offset-2">Back to overview</Link>}
    />
  );
}
