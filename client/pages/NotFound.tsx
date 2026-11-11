// Shown for an address that matches no page, and for an item reference that finds no item.

import { Link } from "lakebed/client";
import { LINK, TEXT_MUTED, cx } from "../components/ui";
import { useTitle } from "../data";

export function NotFound({ what = "page" }: { what?: "page" | "item" }) {
  return (
    <>
      <h1 className="mt-6 text-xl font-semibold tracking-tight">
        {what === "item" ? "No item at this address" : "No page at this address"}
      </h1>
      <p className={cx("mt-1 max-w-2xl", TEXT_MUTED)}>
        {what === "item"
          ? "There is no item with this reference. It may have been mistyped, or the link may be out of date."
          : "The address may have been mistyped, or the link may be out of date."}
      </p>
      <p className="mt-3">
        <Link className={LINK} to="/items">
          All items
        </Link>{" "}
        <span aria-hidden="true">·</span>{" "}
        <Link className={LINK} to="/">
          Overview
        </Link>
      </p>
    </>
  );
}

export function NotFoundPage() {
  useTitle("Not found");
  return <NotFound />;
}
