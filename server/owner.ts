// Owner read paths: the public data with nothing hidden, plus the private tables.
// Every function here must be called only after requireOwner() has passed.

import type {
  AskPrivateView,
  ItemPrivateView,
  OwnerAskView,
  OwnerItemDetailView,
  OwnerItemView,
  OwnerOverviewView
} from "../shared/api";
import { askView, dependenciesOf, eventView, linkView, ownerItemView, readItemDetail, readItemRows, readOverview } from "./read";
import type { AskRow, ItemRow, ReadDb } from "./schema";

async function askPrivateFor(db: ReadDb, askId: string): Promise<AskPrivateView | null> {
  const row = await db.askPrivate.withIndex("by_ask", (q) => q.eq("askId", askId)).first();
  return row ? { recommendation: row.recommendation ?? null, draftPointer: row.draftPointer ?? null } : null;
}

async function ownerAsk(db: ReadDb, ask: AskRow, item: ItemRow): Promise<OwnerAskView> {
  return { ...askView(ask, item, true), key: ask.key, private: await askPrivateFor(db, ask.id) };
}

// One index scan per ask for its private row; a handler may make 100 scans.
const MAX_ASKS_WITH_PRIVATE = 80;

export async function ownerOverview(db: ReadDb): Promise<OwnerOverviewView> {
  const { view, openAskRows } = await readOverview(db, true);
  const openAsks: OwnerAskView[] = [];
  for (const [index, ask] of openAskRows.entries()) {
    const base = view.openAsks[index];
    if (!base) continue;
    const privateView = index < MAX_ASKS_WITH_PRIVATE ? await askPrivateFor(db, ask.id) : null;
    openAsks.push({ ...base, key: ask.key, private: privateView });
  }
  return { ...view, openAsks };
}

export async function ownerItems(db: ReadDb): Promise<OwnerItemView[]> {
  const { rows, primaryByItem, dependenciesByItem } = await readItemRows(db);
  return rows.map((row) => ownerItemView(row, primaryByItem.get(row.id) ?? null, dependenciesByItem.get(row.id) ?? []));
}

export async function ownerItemDetail(db: ReadDb, ref: string): Promise<OwnerItemDetailView | null> {
  const data = await readItemDetail(db, ref, true);
  if (!data) return null;
  const { row, links, asks, events } = data;
  const privateRow = await db.itemPrivate.withIndex("by_item", (q) => q.eq("itemId", row.id)).first();
  const privateView: ItemPrivateView | null = privateRow
    ? {
        notes: privateRow.notes ?? null,
        impact: privateRow.impact ?? null,
        preparedBranch: privateRow.preparedBranch ?? null,
        agentName: privateRow.agentName ?? null,
        agentAddress: privateRow.agentAddress ?? null
      }
    : null;
  const ownerAsks: OwnerAskView[] = [];
  for (const ask of asks.slice(0, MAX_ASKS_WITH_PRIVATE)) {
    ownerAsks.push(await ownerAsk(db, ask, row));
  }
  const primary = links.find((link) => link.role === "primary") ?? null;
  return {
    item: ownerItemView(row, primary, dependenciesOf(links)),
    private: privateView,
    links: links.map(linkView),
    asks: ownerAsks,
    events: events.map((event) => ({ ...eventView(event), key: event.key }))
  };
}
