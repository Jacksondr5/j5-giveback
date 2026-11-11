// The typed Lakebed client, and the small hooks every page shares.

import { createClient } from "lakebed/client";
import { createContext } from "preact";
import { useContext, useEffect, useState } from "preact/hooks";
import type app from "../server/index";
import type { ViewerView } from "../shared/api";
import { MINUTE } from "./lib/format";

export const client = createClient<typeof app>();

export const SITE_NAME = "J5 Code giveback";

/**
 * Who the server says the caller is. `undefined` while the answer is loading.
 * Pages wait for it before choosing between the public and the owner queries,
 * so an owner never sees the public form flash first.
 */
export const ViewerContext = createContext<ViewerView | undefined>(undefined);

export function useViewer(): ViewerView | undefined {
  return useContext(ViewerContext);
}

/** The current time, updated once a minute. */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), MINUTE);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** Sets the browser tab's title to "<page> · J5 Code giveback", or to the site name alone. */
export function useTitle(page: string | null): void {
  useEffect(() => {
    document.title = page ? `${page} · ${SITE_NAME}` : SITE_NAME;
  }, [page]);
}
