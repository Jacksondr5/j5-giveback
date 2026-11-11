// The frame every page sits in: site name, navigation, sign-in, and the footer.

import { Link, SignInWithGoogle, signOut, useAuth, useLocation } from "lakebed/client";
import type { ComponentChildren } from "preact";
import { useEffect } from "preact/hooks";
import { SITE_NAME, useNow, useViewer } from "../data";
import { FOCUS, LINK, MONO, NowContext, TEXT_MUTED, cx } from "./ui";

const NAV_ITEM = cx(FOCUS, "rounded-sm py-1 hover:underline hover:underline-offset-4");
const NAV_CURRENT = "font-semibold text-stone-900 dark:text-stone-100";

function NavLink({ to, current, children }: { to: string; current: boolean; children: ComponentChildren }) {
  return (
    <li>
      <Link aria-current={current ? "page" : undefined} className={cx(NAV_ITEM, current && NAV_CURRENT)} to={to}>
        {children}
      </Link>
    </li>
  );
}

/** Sign in, or for a signed-in account: the owner marker and sign out. Reading never needs any of it. */
function Account() {
  const auth = useAuth();
  const viewer = useViewer();
  const signedIn = viewer?.signedIn ?? auth.isSignedIn;
  if (auth.isLoading) return null;
  if (!signedIn) {
    return (
      <li>
        <SignInWithGoogle className={cx(NAV_ITEM, "cursor-pointer")}>Sign in</SignInWithGoogle>
      </li>
    );
  }
  return (
    <>
      {viewer?.isOwner ? (
        <li className="rounded border border-dashed border-stone-500 px-1.5 py-0.5 text-xs dark:border-stone-400">
          Owner view
        </li>
      ) : null}
      <li>
        <button className={cx(NAV_ITEM, "cursor-pointer")} onClick={() => void signOut()} type="button">
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
    <p className={cx("mt-3 rounded-md border border-stone-300 px-3 py-2 text-xs dark:border-stone-700", TEXT_MUTED)}>
      Signed in{auth.isSignedIn && auth.displayName ? ` as ${auth.displayName}` : ""}. This account has no extra
      access, so you see the same public view as everyone else.
      {viewer.userId ? (
        <>
          {" "}
          Your user id is <span className={cx(MONO, "break-all")}>{viewer.userId}</span>.
        </>
      ) : null}
    </p>
  );
}

/** Page background and form-control scheme on the root element, so overscroll and native controls match. */
function useRootStyle(): void {
  useEffect(() => {
    document.documentElement.classList.add("bg-stone-50", "scheme-light", "dark:bg-stone-950", "dark:scheme-dark");
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
      <div className="min-h-screen bg-stone-50 font-sans text-sm leading-normal text-stone-900 antialiased dark:bg-stone-950 dark:text-stone-100">
        <a
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:outline-2 focus:outline-stone-900 dark:focus:bg-stone-900 dark:focus:outline-stone-100"
          href="#main"
        >
          Skip to content
        </a>
        <div className="mx-auto max-w-5xl px-4 pb-16 pt-5 sm:px-6 sm:pt-7">
          <header className="flex flex-wrap items-start justify-between gap-x-8 gap-y-2">
            <div className="min-w-0 max-w-2xl flex-1 basis-72">
              {home ? (
                <>
                  <h1 className="text-xl font-semibold tracking-tight">{SITE_NAME}</h1>
                  <p className={cx("mt-1", TEXT_MUTED)}>
                    Bug fixes found while maintaining J5 Code, a fork of T3 Code, and offered back to the upstream
                    projects under their contribution rules.
                  </p>
                </>
              ) : (
                <p className="text-base font-semibold tracking-tight">
                  <Link className={cx(FOCUS, "rounded-sm hover:underline hover:underline-offset-4")} to="/">
                    {SITE_NAME}
                  </Link>
                </p>
              )}
            </div>
            <nav aria-label="Main">
              <ul className={cx("flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.8125rem]", TEXT_MUTED)}>
                <NavLink current={home} to="/">
                  Overview
                </NavLink>
                <NavLink current={pathname === "/items" || pathname.startsWith("/items/")} to="/items">
                  All items
                </NavLink>
                <NavLink current={pathname === "/about"} to="/about">
                  How it works
                </NavLink>
                <Account />
              </ul>
            </nav>
          </header>
          <NoExtraAccess />
          <main id="main">{children}</main>
          <footer className={cx("mt-12 border-t border-stone-200 pt-4 text-xs dark:border-stone-800", TEXT_MUTED)}>
            <p>
              A read-only record. Agents write the state, GitHub supplies the live status of each thread, and nothing
              here asks anything of upstream.{" "}
              <Link className={LINK} to="/about">
                How it works
              </Link>
            </p>
          </footer>
        </div>
      </div>
    </NowContext.Provider>
  );
}
