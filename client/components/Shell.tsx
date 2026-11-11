// The frame every page sits in: the site name, navigation and sign-in, across the full width.

import { Link, SignInWithGoogle, signOut, useAuth, useLocation } from "lakebed/client";
import type { ComponentChildren } from "preact";
import { useEffect } from "preact/hooks";
import { SITE_NAME, useNow, useViewer } from "../data";
import { FOCUS, NowContext, PRIVATE_BOX, ROOT_TOKENS, SANS, SERIF, TEXT_DIM, cx } from "./ui";

const NAV_ITEM = cx(FOCUS, "block rounded-sm border-b-2 py-1 hover:text-(color:--ink)");
const NAV_CURRENT = "border-(color:--ink) font-semibold text-(color:--ink)";
const NAV_OTHER = "border-transparent";

function NavLink({ to, current, children }: { to: string; current: boolean; children: ComponentChildren }) {
  return (
    <li>
      <Link aria-current={current ? "page" : undefined} className={cx(NAV_ITEM, current ? NAV_CURRENT : NAV_OTHER)} to={to}>
        {children}
      </Link>
    </li>
  );
}

/** The return arrow of the favicon. */
function Mark() {
  return (
    <svg aria-hidden="true" className="shrink-0" height="22" viewBox="0 0 64 64" width="22">
      <rect fill="#1c1917" height="64" rx="14" width="64" />
      <g fill="none" stroke="#f5b301" stroke-linecap="round" stroke-linejoin="round" stroke-width="6.5">
        <path d="M43 46H27a12 12 0 0 1 0-24h18" />
        <path d="M37 12l10 10-10 10" />
      </g>
    </svg>
  );
}

/** Sign in, or for a signed-in account: the one legend for the dashed style, and sign out. Reading never needs any of it. */
function Account() {
  const auth = useAuth();
  const viewer = useViewer();
  const signedIn = viewer?.signedIn ?? auth.isSignedIn;
  if (auth.isLoading) return null;
  if (!signedIn) {
    return (
      <li>
        <SignInWithGoogle className={cx(NAV_ITEM, NAV_OTHER, "cursor-pointer")}>Sign in</SignInWithGoogle>
      </li>
    );
  }
  return (
    <>
      {viewer?.isOwner ? (
        <li
          className={cx(PRIVATE_BOX, "px-1.5 py-0.5 text-xs text-(color:--ink)")}
          title="You are signed in as the owner. Anything with a dashed edge or a dashed underline is sent only to you."
        >
          Dashed = only you
        </li>
      ) : null}
      <li>
        <button className={cx(NAV_ITEM, NAV_OTHER, "cursor-pointer")} onClick={() => void signOut()} type="button">
          Sign out
        </button>
      </li>
    </>
  );
}

/** Told to a signed-in account that is not an owner, with the id an owner would need to grant access. */
function NoExtraAccess() {
  const auth = useAuth();
  const viewer = useViewer();
  if (!viewer || !viewer.signedIn || viewer.isOwner) return null;
  return (
    <p className={cx("mt-3 max-w-3xl text-xs", TEXT_DIM)}>
      Signed in{auth.isSignedIn && auth.displayName ? ` as ${auth.displayName}` : ""}, with the same public view as
      everyone else.
      {viewer.userId ? (
        <>
          {" "}
          Your user id is <span className="break-all tabular-nums text-(color:--ink)">{viewer.userId}</span>.
        </>
      ) : null}
    </p>
  );
}

/** The palette, page background and form-control scheme on the root element, so overscroll and native controls match. */
function useRootStyle(): void {
  useEffect(() => {
    document.documentElement.classList.add(...ROOT_TOKENS);
  }, []);
}

export function Shell({ children }: { children: ComponentChildren }) {
  useRootStyle();
  const now = useNow();
  const { pathname } = useLocation();
  const home = pathname === "/";

  // The router keeps the scroll position across pages. A new page starts at its top.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <NowContext.Provider value={now}>
      <div className={cx(SANS, "min-h-screen bg-(--paper) text-sm leading-5 text-(color:--ink) antialiased")}>
        <a
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-(--card) focus:px-3 focus:py-2 focus:outline-2 focus:outline-(color:--ink)"
          href="#main"
        >
          Skip to content
        </a>
        <header className="border-b border-(color:--rule) bg-(--card)">
          <div className="mx-auto flex max-w-[150rem] flex-wrap items-center gap-x-8 px-4 pt-2.5 sm:px-6 xl:px-8">
            <p className={cx(SERIF, "w-full pb-1 text-[1.0625rem] font-bold leading-6 sm:w-auto sm:pb-2")}>
              <Link className={cx(FOCUS, "inline-flex items-center gap-2 rounded-sm")} to="/">
                <Mark />
                {SITE_NAME}
              </Link>
            </p>
            <nav aria-label="Main" className={cx("flex min-w-0 flex-1 flex-wrap items-center gap-x-5 gap-y-1 text-[0.8125rem]", TEXT_DIM)}>
              <ul className="flex flex-wrap items-center gap-x-5 gap-y-1">
                <NavLink current={home} to="/">
                  Overview
                </NavLink>
                <NavLink current={pathname === "/items" || pathname.startsWith("/items/")} to="/items">
                  All items
                </NavLink>
                <NavLink current={pathname === "/about"} to="/about">
                  How it works
                </NavLink>
              </ul>
              <ul className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1">
                <Account />
              </ul>
            </nav>
          </div>
        </header>
        <div className="mx-auto max-w-[150rem] px-4 pb-16 sm:px-6 xl:px-8">
          <NoExtraAccess />
          <main id="main">{children}</main>
        </div>
      </div>
    </NowContext.Provider>
  );
}
