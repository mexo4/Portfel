"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { resolvePageView, withPageView, type PageViewId, type ViewedRoute } from "@/lib/page-views";

/** The open view of a page, and a way to switch to another one without leaving the page. */
export function usePageView<Route extends ViewedRoute>(route: Route) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const view = resolvePageView(route, searchParams);
  const openView = useCallback(
    (next: PageViewId<Route>) => {
      router.replace(withPageView(`${pathname}?${searchParams.toString()}`, route, next), { scroll: false });
    },
    [pathname, route, router, searchParams]
  );
  return { view, openView };
}
