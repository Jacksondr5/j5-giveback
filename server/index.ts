import { capsule, endpoint, query } from "lakebed/server";
import type {
  ItemDetailView,
  ItemView,
  OverviewView,
  OwnerItemDetailView,
  OwnerItemView,
  OwnerOverviewView,
  ViewerView
} from "../shared/api";
import {
  handleAsks,
  handleDeleteEvents,
  handleDeleteItem,
  handleEvents,
  handleExport,
  handleItems,
  handlePatchLinks,
  handleWatchlist
} from "./agent";
import { isOwner, requireOwner } from "./auth";
import { ownerItemDetail, ownerItems, ownerOverview } from "./owner";
import { askView, dependenciesOf, eventView, itemView, linkView, readItemDetail, readItemList, readOverview } from "./read";
import { handleRefresh } from "./refresh";
import { schema, type PublicDb, type ReadDb } from "./schema";

export default capsule({
  name: "j5-giveback",

  // Reads are public. The owner queries and the HTTP endpoints guard themselves.
  auth: { requireSignIn: false },

  schema,

  queries: {
    // -----------------------------------------------------------------------
    // Public queries. Each one narrows the database to PublicDb, which has no
    // private tables, and asks for the undisclosed form of non-public items.
    // -----------------------------------------------------------------------

    overview: query(async (ctx): Promise<OverviewView> => {
      const db: PublicDb = ctx.db as unknown as ReadDb;
      return (await readOverview(db, false)).view;
    }),

    items: query(async (ctx): Promise<ItemView[]> => {
      const db: PublicDb = ctx.db as unknown as ReadDb;
      return readItemList(db, false);
    }),

    /** `ref` is a slug or an item id. An undisclosed item is found only by id, and comes back redacted. */
    item: query(async (ctx, ref: string): Promise<ItemDetailView | null> => {
      const db: PublicDb = ctx.db as unknown as ReadDb;
      const data = await readItemDetail(db, ref, false);
      if (!data) return null;
      const primary = data.links.find((link) => link.role === "primary") ?? null;
      return {
        item: itemView(data.row, primary, dependenciesOf(data.links), false),
        links: data.links.map(linkView),
        asks: data.asks.map((ask) => askView(ask, data.row, false)),
        events: data.events.map(eventView)
      };
    }),

    /** Who the caller is. A signed-in user reads their own id here, to be added to OWNER_IDS. */
    viewer: query((ctx): ViewerView => {
      const signedIn = ctx.auth.isSignedIn;
      return {
        signedIn,
        userId: signedIn ? ctx.auth.userId : null,
        isOwner: isOwner(ctx.auth, ctx.env)
      };
    }),

    // -----------------------------------------------------------------------
    // Owner queries. requireOwner() throws for anyone who is not signed in
    // with an account listed in OWNER_IDS.
    // -----------------------------------------------------------------------

    ownerOverview: query(async (ctx): Promise<OwnerOverviewView> => {
      requireOwner(ctx.auth, ctx.env);
      return ownerOverview(ctx.db as unknown as ReadDb);
    }),

    ownerItems: query(async (ctx): Promise<OwnerItemView[]> => {
      requireOwner(ctx.auth, ctx.env);
      return ownerItems(ctx.db as unknown as ReadDb);
    }),

    ownerItem: query(async (ctx, ref: string): Promise<OwnerItemDetailView | null> => {
      requireOwner(ctx.auth, ctx.env);
      return ownerItemDetail(ctx.db as unknown as ReadDb, ref);
    })
  },

  endpoints: {
    agentItems: endpoint({ method: "POST", path: "/api/agent/items" }, handleItems),
    agentDeleteItem: endpoint({ method: "POST", path: "/api/agent/items/delete" }, handleDeleteItem),
    agentAsks: endpoint({ method: "POST", path: "/api/agent/asks" }, handleAsks),
    agentEvents: endpoint({ method: "POST", path: "/api/agent/events" }, handleEvents),
    agentDeleteEvents: endpoint({ method: "POST", path: "/api/agent/events/delete" }, handleDeleteEvents),
    agentLinks: endpoint({ method: "POST", path: "/api/agent/links" }, handlePatchLinks),
    agentExport: endpoint({ method: "GET", path: "/api/agent/export", readOnly: true }, handleExport),
    agentWatchlist: endpoint({ method: "GET", path: "/api/agent/watchlist", readOnly: true }, handleWatchlist),
    refresh: endpoint({ method: "POST", path: "/api/refresh" }, handleRefresh)
  }
});
