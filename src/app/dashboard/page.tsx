import { Workspace } from "@/components/workspace";
import { parseWorkspaceHandoff } from "@/lib/workspace-handoff";

export const metadata = {
  title: "Dashboard — WebForge",
  description: "Manage your web-data APIs.",
};

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const query = await searchParams;
  const normalized = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === "string") normalized.set(key, value);
    else if (value?.[0]) normalized.set(key, value[0]);
  }
  return <Workspace initialHandoff={parseWorkspaceHandoff(normalized)} />;
}
