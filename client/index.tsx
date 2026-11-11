// Placeholder client. It renders the public overview as JSON so the server can be
// exercised, and shows a signed-in user their id for the OWNER_IDS allow-list.
// The real pages are built in a separate task.

import { canAccessApp, createClient, retryAuth, SignInWithGoogle, signOut, useAuth } from "lakebed/client";
import type app from "../server/index";

const client = createClient<typeof app>();

function Json({ value }: { value: unknown }) {
  return (
    <pre className="overflow-x-auto whitespace-pre-wrap break-words border border-neutral-800 p-3 text-xs">
      {value === undefined ? "Loading..." : JSON.stringify(value, null, 2)}
    </pre>
  );
}

function Data() {
  const viewer = client.useQuery("viewer");
  const overview = client.useQuery("overview");
  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-2 text-lg font-semibold">Viewer</h2>
        <Json value={viewer} />
        {viewer?.signedIn && !viewer.isOwner ? (
          <p className="mt-2 text-sm text-neutral-400">
            To see private fields, add the user id above to the OWNER_IDS server secret.
          </p>
        ) : null}
      </section>
      <section>
        <h2 className="mb-2 text-lg font-semibold">Overview</h2>
        <Json value={overview} />
      </section>
    </div>
  );
}

export function App() {
  const auth = useAuth();
  if (auth.isLoading) {
    return null;
  }
  return (
    <main className="min-h-screen bg-black px-4 py-8 text-white">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">Giveback dashboard</h1>
          {auth.isSignedIn ? (
            <button className="border border-neutral-700 px-3 py-1.5 text-sm" type="button" onClick={() => void signOut()}>
              Sign out {auth.displayName}
            </button>
          ) : (
            <SignInWithGoogle className="border border-neutral-700 px-3 py-1.5 text-sm" />
          )}
        </div>
        {canAccessApp() ? (
          <Data />
        ) : (
          <section>
            <p role="alert">{auth.error ?? "The session could not be started."}</p>
            <button className="mt-3 border border-white px-3 py-1.5 text-sm" type="button" onClick={() => void retryAuth()}>
              Retry
            </button>
          </section>
        )}
      </div>
    </main>
  );
}
