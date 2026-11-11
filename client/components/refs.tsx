// An upstream ref such as "t3code#33420", linking out to GitHub.

import type { LinkView } from "../../shared/api";
import { LINK_KIND_LABELS } from "../../shared/enums";
import { fullRef, shortKind, shortRef } from "../lib/format";
import { ExternalLink, LINK, MONO, TEXT_MUTED, cx } from "./ui";

/** The ref alone, in the mono face. */
export function RefLink({ link }: { link: LinkView }) {
  return (
    <ExternalLink className={cx(LINK, MONO, "break-words")} href={link.url} title={fullRef(link.repo, link.number)}>
      {shortRef(link.repo, link.number)}
    </ExternalLink>
  );
}

/** The lead cell of a row: the ref with its kind under it. Side by side on a phone. */
export function RefLead({ link }: { link: LinkView | null }) {
  if (!link) {
    return <p className={cx("text-xs", TEXT_MUTED)}>No thread of ours</p>;
  }
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 sm:block">
      <RefLink link={link} />
      <span className={cx("block text-xs", TEXT_MUTED)} title={LINK_KIND_LABELS[link.kind]}>
        {shortKind(link.kind)}
      </span>
    </p>
  );
}
