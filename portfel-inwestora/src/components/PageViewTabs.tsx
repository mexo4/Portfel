"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { getPageViews, resolvePageView, withPageView, type ViewedRoute } from "@/lib/page-views";
import type { WorkspaceRouteKey } from "@/lib/workspace-routes";

/** The second row of tabs: one tab for each function of the open page. */
export default function PageViewTabs({ route, getHref, label }: { route: WorkspaceRouteKey; getHref: (href: string) => string; label: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const views = getPageViews(route);
  if (views.length === 0) return null;
  const active = resolvePageView(route as ViewedRoute, searchParams);
  return (
    <nav className="workspace-view-tabs" aria-label={`Widoki strony ${label}`}>
      {views.map((view) => (
        <Link key={view.id} href={getHref(withPageView(`${pathname}?${searchParams.toString()}`, route, view.id))} prefetch={false} scroll={false} className={view.id === active ? "is-active" : undefined} aria-current={view.id === active ? "page" : undefined}>
          {view.label}
        </Link>
      ))}
    </nav>
  );
}
