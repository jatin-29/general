import { Suspense } from "react";
import Dashboard from "@/components/Dashboard";
import JobsFeed from "@/components/JobsFeed";
import { JOBS_MODE } from "@/lib/mode";

export default function Page() {
  if (JOBS_MODE) return <JobsFeed />;
  return (
    <Suspense fallback={null}>
      <Dashboard />
    </Suspense>
  );
}
