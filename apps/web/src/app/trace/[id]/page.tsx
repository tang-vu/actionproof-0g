import type { Metadata } from "next";

import { TraceView } from "../../../components/trace-view";

export const metadata: Metadata = { title: "Verification trace" };

export default async function TracePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TraceView id={id} />;
}
