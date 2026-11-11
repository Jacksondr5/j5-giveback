// Payload validation for the agent endpoints. Pure functions: no database, no env.
// Every problem is collected with the path of the offending value, so one 400
// response lists everything that is wrong with a batch.

import type { ValidationIssue } from "../shared/api";
import {
  ASK_KINDS,
  EVENT_ACTORS,
  EVENT_TYPES,
  FOLLOW_UP_STATES,
  LINK_KINDS,
  LINK_OWNERSHIPS,
  LINK_ROLES,
  OUTCOMES,
  ROUTES,
  STAGES,
  WAITING_ON,
  isOneOf,
  type AskKind,
  type EventActor,
  type EventType,
  type FollowUpState,
  type LinkKind,
  type LinkOwnership,
  type LinkRole,
  type Outcome,
  type Route,
  type Stage,
  type WaitingOn
} from "../shared/enums";
import { KEY_PATTERN, LIMITS, LOCAL_PATH_MARKERS, REPO_PATTERN, SLUG_PATTERN } from "../shared/limits";

export type Issues = ValidationIssue[];

type Obj = Record<string, unknown>;

export function isObject(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const MIN_TIME = Date.UTC(2015, 0, 1);
const DAY = 86_400_000;

// Control characters other than tab, line feed and carriage return.
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function checkUnknownKeys(issues: Issues, value: Obj, path: string, allowed: readonly string[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      issues.push({ path: `${path}.${key}`, message: `Unknown field. Allowed fields: ${allowed.join(", ")}.` });
    }
  }
}

type TextOptions = { max: number; min?: number; multiline?: boolean; pattern?: RegExp; patternHint?: string };

/** Returns the trimmed text, or undefined after recording why it is not acceptable. */
function checkText(issues: Issues, value: unknown, path: string, options: TextOptions): string | undefined {
  if (typeof value !== "string") {
    issues.push({ path, message: "Must be a string." });
    return undefined;
  }
  const text = value.trim();
  const before = issues.length;
  const min = options.min ?? 1;
  if (text.length < min) {
    issues.push({ path, message: min === 1 ? "Must not be empty." : `Must be at least ${min} characters.` });
  }
  if (text.length > options.max) {
    issues.push({ path, message: `Must be at most ${options.max} characters (got ${text.length}).` });
  }
  if (CONTROL_CHARS.test(text)) {
    issues.push({ path, message: "Must not contain control characters." });
  }
  if (!options.multiline && /[\r\n]/.test(text)) {
    issues.push({ path, message: "Must be a single line." });
  }
  for (const marker of LOCAL_PATH_MARKERS) {
    if (text.includes(marker)) {
      issues.push({ path, message: `Must not contain a local path ("${marker}"). Local paths are never stored.` });
    }
  }
  if (options.pattern && !options.pattern.test(text)) {
    issues.push({ path, message: options.patternHint ?? "Has an invalid format." });
  }
  return issues.length === before ? text : undefined;
}

function requiredText(issues: Issues, obj: Obj, field: string, path: string, options: TextOptions): string | undefined {
  if (obj[field] === undefined || obj[field] === null) {
    issues.push({ path: `${path}.${field}`, message: "Required." });
    return undefined;
  }
  return checkText(issues, obj[field], `${path}.${field}`, options);
}

/** Optional text that cannot be cleared. */
function optionalText(issues: Issues, obj: Obj, field: string, path: string, options: TextOptions): string | undefined {
  if (obj[field] === undefined) return undefined;
  if (obj[field] === null) {
    issues.push({ path: `${path}.${field}`, message: "Must not be null." });
    return undefined;
  }
  return checkText(issues, obj[field], `${path}.${field}`, options);
}

/** Optional text where null means "clear it". */
function nullableText(
  issues: Issues,
  obj: Obj,
  field: string,
  path: string,
  options: TextOptions
): string | null | undefined {
  if (obj[field] === undefined) return undefined;
  if (obj[field] === null) return null;
  return checkText(issues, obj[field], `${path}.${field}`, options);
}

function checkEnum<T extends string>(issues: Issues, value: unknown, path: string, values: readonly T[]): T | undefined {
  if (isOneOf(values, value)) {
    return value;
  }
  issues.push({ path, message: `Must be one of: ${values.join(", ")}.` });
  return undefined;
}

function checkTime(issues: Issues, value: unknown, path: string, now: number): number | undefined {
  let time: number;
  if (typeof value === "number") {
    time = value;
  } else if (typeof value === "string" && value.trim().length > 0) {
    time = Date.parse(value.trim());
  } else {
    issues.push({ path, message: "Must be epoch milliseconds or an ISO 8601 string." });
    return undefined;
  }
  if (!Number.isFinite(time)) {
    issues.push({ path, message: "Is not a valid time. Use epoch milliseconds or an ISO 8601 string." });
    return undefined;
  }
  if (time < MIN_TIME || time > now + DAY) {
    issues.push({ path, message: "Must be between 2015-01-01 and one day from now. Epoch values are in milliseconds." });
    return undefined;
  }
  return Math.round(time);
}

function checkBoolean(issues: Issues, value: unknown, path: string): boolean | undefined {
  if (typeof value === "boolean") return value;
  issues.push({ path, message: "Must be true or false." });
  return undefined;
}

const KEY_OPTIONS: TextOptions = {
  max: LIMITS.key,
  min: 3,
  pattern: KEY_PATTERN,
  patternHint: "May contain only letters, digits and . _ : # - and must start with a letter or digit."
};

const SLUG_OPTIONS: TextOptions = {
  max: LIMITS.slugMax,
  min: LIMITS.slugMin,
  pattern: SLUG_PATTERN,
  patternHint: "Must be lowercase letters, digits and hyphens, starting and ending with a letter or digit."
};

const REPO_OPTIONS: TextOptions = {
  max: LIMITS.repo,
  pattern: REPO_PATTERN,
  patternHint: 'Must be "owner/name".'
};

function checkGithubUrl(issues: Issues, value: unknown, path: string, repo?: string): string | undefined {
  const url = checkText(issues, value, path, { max: LIMITS.url });
  if (url === undefined) return undefined;
  if (!url.startsWith("https://github.com/") || /\s/.test(url)) {
    issues.push({ path, message: "Must be an https://github.com/ URL." });
    return undefined;
  }
  if (repo !== undefined && !url.toLowerCase().startsWith(`https://github.com/${repo.toLowerCase()}/`)) {
    issues.push({ path, message: `Must start with https://github.com/${repo}/ to match the link's repo.` });
    return undefined;
  }
  return url;
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export type ParsedLink = {
  url: string;
  repo: string;
  number: number;
  kind: LinkKind;
  ownership: LinkOwnership;
  role: LinkRole;
  triageBucket?: string | null;
  triageRank?: number | null;
};

export type ParsedItemFields = {
  title?: string;
  summary?: string;
  stage?: Stage;
  route?: Route | null;
  routeReason?: string | null;
  waitingOn?: WaitingOn;
  waitingSince?: number;
  outcome?: Outcome | null;
  closedAt?: number | null;
  targetRepo?: string;
  originRefs?: string;
  foundAt?: number;
  lastValidatedAt?: number | null;
  lastValidatedSha?: string | null;
  validationVerdict?: string | null;
  followUpState?: FollowUpState;
  followUpNote?: string | null;
  isPublic?: boolean;
};

export type ParsedItemPrivate = {
  notes?: string | null;
  impact?: string | null;
  preparedBranch?: string | null;
};

export type ParsedItem = {
  slug: string;
  fields: ParsedItemFields;
  stageNote?: string;
  clearUpstreamChange: boolean;
  links?: ParsedLink[];
  private?: ParsedItemPrivate;
};

const ITEM_KEYS = [
  "slug",
  "title",
  "summary",
  "stage",
  "route",
  "routeReason",
  "waitingOn",
  "waitingSince",
  "outcome",
  "closedAt",
  "targetRepo",
  "originRefs",
  "foundAt",
  "lastValidatedAt",
  "lastValidatedSha",
  "validationVerdict",
  "followUpState",
  "followUpNote",
  "isPublic",
  "stageNote",
  "clearUpstreamChange",
  "links",
  "private"
] as const;

const LINK_KEYS = ["url", "repo", "number", "kind", "ownership", "role", "triageBucket", "triageRank"] as const;
const ITEM_PRIVATE_KEYS = ["notes", "impact", "preparedBranch"] as const;

function parseLink(issues: Issues, value: unknown, path: string): ParsedLink | undefined {
  if (!isObject(value)) {
    issues.push({ path, message: "Must be an object." });
    return undefined;
  }
  const before = issues.length;
  checkUnknownKeys(issues, value, path, LINK_KEYS);
  const repo = requiredText(issues, value, "repo", path, REPO_OPTIONS);
  const url =
    value.url === undefined || value.url === null
      ? (issues.push({ path: `${path}.url`, message: "Required." }), undefined)
      : checkGithubUrl(issues, value.url, `${path}.url`, repo);
  let number: number | undefined;
  if (typeof value.number === "number" && Number.isSafeInteger(value.number) && value.number > 0) {
    number = value.number;
  } else {
    issues.push({ path: `${path}.number`, message: "Required. Must be a positive whole number." });
  }
  const kind = checkEnum(issues, value.kind, `${path}.kind`, LINK_KINDS);
  const ownership = checkEnum(issues, value.ownership, `${path}.ownership`, LINK_OWNERSHIPS);
  const role = checkEnum(issues, value.role, `${path}.role`, LINK_ROLES);
  const triageBucket = nullableText(issues, value, "triageBucket", path, { max: LIMITS.triageBucket });
  let triageRank: number | null | undefined;
  if (value.triageRank === null) {
    triageRank = null;
  } else if (value.triageRank !== undefined) {
    if (typeof value.triageRank === "number" && Number.isSafeInteger(value.triageRank) && value.triageRank > 0) {
      triageRank = value.triageRank;
    } else {
      issues.push({ path: `${path}.triageRank`, message: "Must be a positive whole number or null." });
    }
  }
  if (issues.length !== before || !url || !repo || !number || !kind || !ownership || !role) {
    return undefined;
  }
  const link: ParsedLink = { url, repo, number, kind, ownership, role };
  if (triageBucket !== undefined) link.triageBucket = triageBucket;
  if (triageRank !== undefined) link.triageRank = triageRank;
  return link;
}

function parseItem(issues: Issues, value: unknown, path: string, now: number): ParsedItem | undefined {
  if (!isObject(value)) {
    issues.push({ path, message: "Must be an object." });
    return undefined;
  }
  const before = issues.length;
  checkUnknownKeys(issues, value, path, ITEM_KEYS);

  const slug = requiredText(issues, value, "slug", path, SLUG_OPTIONS);
  const fields: ParsedItemFields = {};

  const title = optionalText(issues, value, "title", path, { max: LIMITS.title });
  if (title !== undefined) fields.title = title;
  const summary = optionalText(issues, value, "summary", path, { max: LIMITS.summary });
  if (summary !== undefined) fields.summary = summary;
  if (value.stage !== undefined) {
    const stage = checkEnum(issues, value.stage, `${path}.stage`, STAGES);
    if (stage) fields.stage = stage;
  }
  if (value.route === null) {
    fields.route = null;
  } else if (value.route !== undefined) {
    const route = checkEnum(issues, value.route, `${path}.route`, ROUTES);
    if (route) fields.route = route;
  }
  const routeReason = nullableText(issues, value, "routeReason", path, { max: LIMITS.routeReason });
  if (routeReason !== undefined) fields.routeReason = routeReason;
  if (value.waitingOn !== undefined) {
    const waitingOn = checkEnum(issues, value.waitingOn, `${path}.waitingOn`, WAITING_ON);
    if (waitingOn) fields.waitingOn = waitingOn;
  }
  if (value.waitingSince !== undefined) {
    const waitingSince = checkTime(issues, value.waitingSince, `${path}.waitingSince`, now);
    if (waitingSince !== undefined) fields.waitingSince = waitingSince;
  }
  if (value.outcome === null) {
    fields.outcome = null;
  } else if (value.outcome !== undefined) {
    const outcome = checkEnum(issues, value.outcome, `${path}.outcome`, OUTCOMES);
    if (outcome) fields.outcome = outcome;
  }
  if (value.closedAt === null) {
    fields.closedAt = null;
  } else if (value.closedAt !== undefined) {
    const closedAt = checkTime(issues, value.closedAt, `${path}.closedAt`, now);
    if (closedAt !== undefined) fields.closedAt = closedAt;
  }
  const targetRepo = optionalText(issues, value, "targetRepo", path, REPO_OPTIONS);
  if (targetRepo !== undefined) fields.targetRepo = targetRepo;

  if (value.originRefs !== undefined) {
    if (!Array.isArray(value.originRefs)) {
      issues.push({ path: `${path}.originRefs`, message: "Must be an array of strings." });
    } else if (value.originRefs.length > LIMITS.originRefs) {
      issues.push({ path: `${path}.originRefs`, message: `Must have at most ${LIMITS.originRefs} entries.` });
    } else {
      const refs: string[] = [];
      value.originRefs.forEach((ref, index) => {
        const text = checkText(issues, ref, `${path}.originRefs[${index}]`, { max: LIMITS.originRef });
        if (text !== undefined) refs.push(text);
      });
      fields.originRefs = refs.join("\n");
    }
  }
  if (value.foundAt !== undefined) {
    const foundAt = checkTime(issues, value.foundAt, `${path}.foundAt`, now);
    if (foundAt !== undefined) fields.foundAt = foundAt;
  }
  if (value.lastValidatedAt === null) {
    fields.lastValidatedAt = null;
  } else if (value.lastValidatedAt !== undefined) {
    const lastValidatedAt = checkTime(issues, value.lastValidatedAt, `${path}.lastValidatedAt`, now);
    if (lastValidatedAt !== undefined) fields.lastValidatedAt = lastValidatedAt;
  }
  const lastValidatedSha = nullableText(issues, value, "lastValidatedSha", path, {
    max: LIMITS.sha,
    min: 7,
    pattern: /^[0-9a-f]+$/,
    patternHint: "Must be a lowercase hexadecimal commit SHA."
  });
  if (lastValidatedSha !== undefined) fields.lastValidatedSha = lastValidatedSha;
  const validationVerdict = nullableText(issues, value, "validationVerdict", path, { max: LIMITS.validationVerdict });
  if (validationVerdict !== undefined) fields.validationVerdict = validationVerdict;
  if (value.followUpState !== undefined) {
    const followUpState = checkEnum(issues, value.followUpState, `${path}.followUpState`, FOLLOW_UP_STATES);
    if (followUpState) fields.followUpState = followUpState;
  }
  const followUpNote = nullableText(issues, value, "followUpNote", path, { max: LIMITS.followUpNote });
  if (followUpNote !== undefined) fields.followUpNote = followUpNote;
  if (value.isPublic !== undefined) {
    const isPublic = checkBoolean(issues, value.isPublic, `${path}.isPublic`);
    if (isPublic !== undefined) fields.isPublic = isPublic;
  }

  const stageNote = optionalText(issues, value, "stageNote", path, { max: LIMITS.eventNote });
  let clearUpstreamChange = false;
  if (value.clearUpstreamChange !== undefined) {
    clearUpstreamChange = checkBoolean(issues, value.clearUpstreamChange, `${path}.clearUpstreamChange`) ?? false;
  }

  let links: ParsedLink[] | undefined;
  if (value.links !== undefined) {
    if (!Array.isArray(value.links)) {
      issues.push({ path: `${path}.links`, message: "Must be an array." });
    } else if (value.links.length > LIMITS.linksPerItem) {
      issues.push({ path: `${path}.links`, message: `An item may have at most ${LIMITS.linksPerItem} links.` });
    } else {
      links = [];
      const seen = new Set<string>();
      let primaries = 0;
      value.links.forEach((entry, index) => {
        const link = parseLink(issues, entry, `${path}.links[${index}]`);
        if (!link) return;
        if (seen.has(link.url)) {
          issues.push({ path: `${path}.links[${index}].url`, message: "Appears twice in this item's links." });
          return;
        }
        seen.add(link.url);
        if (link.role === "primary") primaries += 1;
        links?.push(link);
      });
      if (primaries > 1) {
        issues.push({ path: `${path}.links`, message: 'At most one link may have role "primary".' });
      }
    }
  }

  let privateFields: ParsedItemPrivate | undefined;
  if (value.private !== undefined) {
    if (!isObject(value.private)) {
      issues.push({ path: `${path}.private`, message: "Must be an object." });
    } else {
      const privatePath = `${path}.private`;
      checkUnknownKeys(issues, value.private, privatePath, ITEM_PRIVATE_KEYS);
      privateFields = {};
      const notes = nullableText(issues, value.private, "notes", privatePath, {
        max: LIMITS.privateNotes,
        multiline: true
      });
      if (notes !== undefined) privateFields.notes = notes;
      const impact = nullableText(issues, value.private, "impact", privatePath, {
        max: LIMITS.privateImpact,
        multiline: true
      });
      if (impact !== undefined) privateFields.impact = impact;
      const preparedBranch = nullableText(issues, value.private, "preparedBranch", privatePath, {
        max: LIMITS.privateBranch
      });
      if (preparedBranch !== undefined) privateFields.preparedBranch = preparedBranch;
    }
  }

  if (issues.length !== before || slug === undefined) {
    return undefined;
  }
  const item: ParsedItem = { slug, fields, clearUpstreamChange };
  if (stageNote !== undefined) item.stageNote = stageNote;
  if (links !== undefined) item.links = links;
  if (privateFields !== undefined) item.private = privateFields;
  return item;
}

/** Reads `{ <field>: [...] }` and checks the batch size. */
function batchOf(issues: Issues, body: unknown, field: string, max: number): unknown[] | undefined {
  if (!isObject(body) || !Array.isArray(body[field])) {
    issues.push({ path: field, message: `The body must be a JSON object with a "${field}" array.` });
    return undefined;
  }
  const list = body[field] as unknown[];
  if (list.length === 0) {
    issues.push({ path: field, message: "Must not be empty." });
    return undefined;
  }
  if (list.length > max) {
    issues.push({
      path: field,
      message: `A request may carry at most ${max} ${field} (got ${list.length}). Split the batch into several requests.`
    });
    return undefined;
  }
  return list;
}

export function parseItemsRequest(body: unknown, now: number): { items: ParsedItem[]; issues: Issues } {
  const issues: Issues = [];
  const items: ParsedItem[] = [];
  const list = batchOf(issues, body, "items", LIMITS.itemsPerBatch);
  if (!list) return { items, issues };
  const seen = new Set<string>();
  list.forEach((entry, index) => {
    const item = parseItem(issues, entry, `items[${index}]`, now);
    if (!item) return;
    if (seen.has(item.slug)) {
      issues.push({ path: `items[${index}].slug`, message: `The slug "${item.slug}" appears twice in this batch.` });
      return;
    }
    seen.add(item.slug);
    items.push(item);
  });
  const linkTotal = items.reduce((sum, item) => sum + (item.links?.length ?? 0), 0);
  if (linkTotal > LIMITS.linksPerBatch) {
    issues.push({
      path: "items",
      message: `A request may carry at most ${LIMITS.linksPerBatch} links across all its items (got ${linkTotal}). Split the batch into several requests.`
    });
  }
  return { items, issues };
}

// ---------------------------------------------------------------------------
// Asks
// ---------------------------------------------------------------------------

export type ParsedAskPrivate = { recommendation?: string | null; draftPointer?: string | null };

export type ParsedAsk =
  | {
      op: "open";
      key: string;
      item: string;
      kind: AskKind;
      publicLabel: string;
      openedAt?: number;
      private?: ParsedAskPrivate;
    }
  | { op: "close"; key: string; resolution?: string; closedAt?: number };

const ASK_OPEN_KEYS = ["op", "key", "item", "kind", "publicLabel", "openedAt", "private"] as const;
const ASK_CLOSE_KEYS = ["op", "key", "resolution", "closedAt"] as const;
const ASK_PRIVATE_KEYS = ["recommendation", "draftPointer"] as const;

function parseAsk(issues: Issues, value: unknown, path: string, now: number): ParsedAsk | undefined {
  if (!isObject(value)) {
    issues.push({ path, message: "Must be an object." });
    return undefined;
  }
  const before = issues.length;
  const op = checkEnum(issues, value.op, `${path}.op`, ["open", "close"] as const);
  if (!op) return undefined;
  const key = requiredText(issues, value, "key", path, KEY_OPTIONS);

  if (op === "close") {
    checkUnknownKeys(issues, value, path, ASK_CLOSE_KEYS);
    const resolution = optionalText(issues, value, "resolution", path, { max: LIMITS.askResolution });
    const closedAt = value.closedAt === undefined ? undefined : checkTime(issues, value.closedAt, `${path}.closedAt`, now);
    if (issues.length !== before || key === undefined) return undefined;
    const ask: ParsedAsk = { op, key };
    if (resolution !== undefined) ask.resolution = resolution;
    if (closedAt !== undefined) ask.closedAt = closedAt;
    return ask;
  }

  checkUnknownKeys(issues, value, path, ASK_OPEN_KEYS);
  const item = requiredText(issues, value, "item", path, SLUG_OPTIONS);
  const kind = checkEnum(issues, value.kind, `${path}.kind`, ASK_KINDS);
  const publicLabel = requiredText(issues, value, "publicLabel", path, { max: LIMITS.askLabel });
  const openedAt = value.openedAt === undefined ? undefined : checkTime(issues, value.openedAt, `${path}.openedAt`, now);
  let privateFields: ParsedAskPrivate | undefined;
  if (value.private !== undefined) {
    if (!isObject(value.private)) {
      issues.push({ path: `${path}.private`, message: "Must be an object." });
    } else {
      const privatePath = `${path}.private`;
      checkUnknownKeys(issues, value.private, privatePath, ASK_PRIVATE_KEYS);
      privateFields = {};
      const recommendation = nullableText(issues, value.private, "recommendation", privatePath, {
        max: LIMITS.askRecommendation,
        multiline: true
      });
      if (recommendation !== undefined) privateFields.recommendation = recommendation;
      const draftPointer = nullableText(issues, value.private, "draftPointer", privatePath, {
        max: LIMITS.askDraftPointer
      });
      if (draftPointer !== undefined) privateFields.draftPointer = draftPointer;
    }
  }
  if (issues.length !== before || key === undefined || item === undefined || !kind || publicLabel === undefined) {
    return undefined;
  }
  const ask: ParsedAsk = { op, key, item, kind, publicLabel };
  if (openedAt !== undefined) ask.openedAt = openedAt;
  if (privateFields !== undefined) ask.private = privateFields;
  return ask;
}

export function parseAsksRequest(body: unknown, now: number): { asks: ParsedAsk[]; issues: Issues } {
  const issues: Issues = [];
  const asks: ParsedAsk[] = [];
  const list = batchOf(issues, body, "asks", LIMITS.asksPerBatch);
  if (!list) return { asks, issues };
  const seen = new Set<string>();
  list.forEach((entry, index) => {
    const ask = parseAsk(issues, entry, `asks[${index}]`, now);
    if (!ask) return;
    if (seen.has(ask.key)) {
      issues.push({
        path: `asks[${index}].key`,
        message: `The key "${ask.key}" appears twice in this batch. Open and close an ask in separate requests.`
      });
      return;
    }
    seen.add(ask.key);
    asks.push(ask);
  });
  return { asks, issues };
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type ParsedEvent = {
  key: string;
  item: string;
  at?: number;
  actor: EventActor;
  type: EventType;
  note: string;
  url?: string;
  isPublic: boolean;
};

const EVENT_KEYS = ["key", "item", "at", "actor", "type", "note", "url", "isPublic"] as const;

function parseEvent(issues: Issues, value: unknown, path: string, now: number): ParsedEvent | undefined {
  if (!isObject(value)) {
    issues.push({ path, message: "Must be an object." });
    return undefined;
  }
  const before = issues.length;
  checkUnknownKeys(issues, value, path, EVENT_KEYS);
  const key = requiredText(issues, value, "key", path, KEY_OPTIONS);
  const item = requiredText(issues, value, "item", path, SLUG_OPTIONS);
  const at = value.at === undefined ? undefined : checkTime(issues, value.at, `${path}.at`, now);
  const actor = checkEnum(issues, value.actor, `${path}.actor`, EVENT_ACTORS);
  const type = checkEnum(issues, value.type, `${path}.type`, EVENT_TYPES);
  const note = requiredText(issues, value, "note", path, { max: LIMITS.eventNote });
  let url: string | undefined;
  if (value.url !== undefined && value.url !== null) {
    const text = checkText(issues, value.url, `${path}.url`, { max: LIMITS.url });
    if (text !== undefined) {
      if (!text.startsWith("https://") || /\s/.test(text)) {
        issues.push({ path: `${path}.url`, message: "Must be an https:// URL." });
      } else {
        url = text;
      }
    }
  }
  let isPublic: boolean | undefined;
  if (value.isPublic === undefined) {
    issues.push({ path: `${path}.isPublic`, message: "Required. Say whether anyone may read this event." });
  } else {
    isPublic = checkBoolean(issues, value.isPublic, `${path}.isPublic`);
  }
  if (
    issues.length !== before ||
    key === undefined ||
    item === undefined ||
    !actor ||
    !type ||
    note === undefined ||
    isPublic === undefined
  ) {
    return undefined;
  }
  const event: ParsedEvent = { key, item, actor, type, note, isPublic };
  if (at !== undefined) event.at = at;
  if (url !== undefined) event.url = url;
  return event;
}

export function parseEventsRequest(body: unknown, now: number): { events: ParsedEvent[]; issues: Issues } {
  const issues: Issues = [];
  const events: ParsedEvent[] = [];
  const list = batchOf(issues, body, "events", LIMITS.eventsPerBatch);
  if (!list) return { events, issues };
  const seen = new Set<string>();
  list.forEach((entry, index) => {
    const event = parseEvent(issues, entry, `events[${index}]`, now);
    if (!event) return;
    if (seen.has(event.key)) {
      issues.push({ path: `events[${index}].key`, message: `The key "${event.key}" appears twice in this batch.` });
      return;
    }
    seen.add(event.key);
    events.push(event);
  });
  return { events, issues };
}
