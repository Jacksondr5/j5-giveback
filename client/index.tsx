// The giveback dashboard client. A read-only site: four pages, sign-in, and filters.
//
//   pages/       one file per page
//   components/  the frame, chips and other shared pieces
//   lib/         pure formatting and derivation, with no DOM and no Lakebed
//   data.ts      the typed Lakebed client and shared hooks

import {
  ErrorBoundary,
  Route,
  Router,
  Routes,
  SignInWithGoogle,
  canAccessApp,
  retryAuth,
  useAuth,
  useLocation
} from "lakebed/client";
import { Shell } from "./components/Shell";
import { BUTTON, CARD, ErrorState, SERIF, Skeleton, TEXT_DIM, cx } from "./components/ui";
import { ViewerContext, client } from "./data";
import { AboutPage } from "./pages/About";
import { ItemPage } from "./pages/Item";
import { ItemsPage } from "./pages/Items";
import { NotFoundPage } from "./pages/NotFound";
import { OverviewPage } from "./pages/Overview";

function Pages() {
  const { pathname } = useLocation();
  return (
    // Keyed by path, so a failed page does not stay failed after navigating away.
    <ErrorBoundary fallback={(error, retry) => <ErrorState error={error} retry={retry} />} key={pathname}>
      <Routes>
        <Route element={<OverviewPage />} path="/" />
        <Route element={<ItemsPage />} path="/items" />
        <Route element={<ItemPage />} path="/items/:ref" />
        <Route element={<AboutPage />} path="/about" />
        {/* Lakebed finishes Google sign-in here and then returns to the page the visitor was on. */}
        <Route element={<Skeleton label="Signing in" rows={2} />} path="/auth/callback" />
        <Route element={<NotFoundPage />} path="*" />
      </Routes>
    </ErrorBoundary>
  );
}

/** Mounted only once the session exists. Asks the server who the caller is, then renders the pages. */
function Site() {
  const viewer = client.useQuery("viewer");
  return (
    <ViewerContext.Provider value={viewer}>
      <Shell>
        <Pages />
      </Shell>
    </ViewerContext.Provider>
  );
}

/** The session could not be started or renewed. Data stays unmounted until it recovers. */
function SessionProblem({ message }: { message: string }) {
  return (
    <Shell>
      <div className={cx(CARD, "mt-6 max-w-2xl p-4")} role="alert">
        <h1 className={cx(SERIF, "text-lg font-bold")}>The session could not be started</h1>
        <p className={cx("mt-1", TEXT_DIM)}>
          Reading this site needs no account, but the browser session behind it failed to start. Trying again usually
          fixes it.
        </p>
        <p className={cx("mt-2 break-words text-xs", TEXT_DIM)}>{message}</p>
        <p className="mt-3 flex flex-wrap gap-2">
          <button className={BUTTON} onClick={() => void retryAuth()} type="button">
            Try again
          </button>
          <SignInWithGoogle className={cx(BUTTON, "cursor-pointer")}>Sign in with Google</SignInWithGoogle>
        </p>
      </div>
    </Shell>
  );
}

function Gate() {
  const auth = useAuth();
  if (auth.isLoading) {
    return (
      <Shell>
        <Skeleton rows={3} />
      </Shell>
    );
  }
  if (!canAccessApp()) {
    return <SessionProblem message={auth.error ?? "No session is available."} />;
  }
  return (
    <ErrorBoundary
      fallback={(error, retry) => (
        <Shell>
          <ErrorState error={error} retry={retry} />
        </Shell>
      )}
    >
      <Site />
    </ErrorBoundary>
  );
}

export function App() {
  return (
    <Router>
      <Gate />
    </Router>
  );
}
