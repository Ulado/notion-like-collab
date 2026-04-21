import { and, asc, desc, eq, gt, inArray, isNull, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { nanoid } from "nanoid";
import {
  type CollaboratorRole,
  type InsertPage,
  type InsertPageCollaborator,
  type InsertPageInvitation,
  type InsertPagePresence,
  type InsertPageVersion,
  InsertUser,
  type Page,
  pageCollaborators,
  pageInvitations,
  pagePresence,
  pages,
  pageVersions,
  users,
} from "../drizzle/schema";
import { DEFAULT_PAGE_DOCUMENT, type PageDocument } from "../shared/collab";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

async function requireDb() {
  const db = await getDb();
  if (!db) {
    throw new Error("Database is not available");
  }
  return db;
}

function serializeDocument(document: PageDocument) {
  return JSON.stringify(document);
}

function safeString(value: unknown) {
  return typeof value === "string" ? value : "";
}

export function deserializeDocument(contentJson: string): PageDocument {
  try {
    const parsed = JSON.parse(contentJson) as PageDocument;
    if (!parsed || !Array.isArray(parsed.blocks)) {
      return DEFAULT_PAGE_DOCUMENT;
    }
    return parsed;
  } catch {
    return DEFAULT_PAGE_DOCUMENT;
  }
}

function getSummaryFromDocument(document: PageDocument) {
  return document.blocks
    .flatMap(block => block.spans)
    .map(span => safeString(span.text).trim())
    .filter(Boolean)
    .join(" ")
    .slice(0, 160);
}

function normalizeTitle(title?: string) {
  const normalized = title?.trim();
  return normalized && normalized.length > 0 ? normalized : "Untitled";
}

function canEdit(role: CollaboratorRole) {
  return role === "擁有者" || role === "編輯者";
}

async function getNextSortOrder(parentPageId: number | null) {
  const db = await requireDb();

  const siblingRows = parentPageId == null
    ? await db
        .select({ sortOrder: pages.sortOrder })
        .from(pages)
        .where(and(isNull(pages.parentPageId), eq(pages.isArchived, 0)))
        .orderBy(desc(pages.sortOrder))
        .limit(1)
    : await db
        .select({ sortOrder: pages.sortOrder })
        .from(pages)
        .where(and(eq(pages.parentPageId, parentPageId), eq(pages.isArchived, 0)))
        .orderBy(desc(pages.sortOrder))
        .limit(1);

  return (siblingRows[0]?.sortOrder ?? -1) + 1;
}

async function getPageRole(pageId: number, userId: number) {
  const db = await requireDb();
  const rows = await db
    .select({ role: pageCollaborators.role })
    .from(pageCollaborators)
    .where(and(eq(pageCollaborators.pageId, pageId), eq(pageCollaborators.userId, userId)))
    .limit(1);

  return rows[0]?.role;
}

export function normalizePageOrder(pageIds: number[], movedPageId?: number | null, targetSortOrder?: number) {
  if (movedPageId == null || !pageIds.includes(movedPageId)) {
    return pageIds.map((id, index) => ({ id, sortOrder: index }));
  }

  const remaining = pageIds.filter(id => id !== movedPageId);
  const safeIndex = Math.max(0, Math.min(targetSortOrder ?? remaining.length, remaining.length));
  remaining.splice(safeIndex, 0, movedPageId);

  return remaining.map((id, index) => ({ id, sortOrder: index }));
}

async function reindexChildren(parentPageId: number | null, movedPageId?: number | null, targetSortOrder?: number, executor?: any) {
  const db = executor ?? await requireDb();
  const siblings = parentPageId == null
    ? await db
        .select({ id: pages.id })
        .from(pages)
        .where(and(isNull(pages.parentPageId), eq(pages.isArchived, 0)))
        .orderBy(asc(pages.sortOrder), asc(pages.id))
    : await db
        .select({ id: pages.id })
        .from(pages)
        .where(and(eq(pages.parentPageId, parentPageId), eq(pages.isArchived, 0)))
        .orderBy(asc(pages.sortOrder), asc(pages.id));

  const nextOrder = normalizePageOrder(
    siblings.map((sibling: { id: number }) => sibling.id),
    movedPageId,
    targetSortOrder,
  );

  await Promise.all(
    nextOrder.map(item =>
      db
        .update(pages)
        .set({ sortOrder: item.sortOrder })
        .where(eq(pages.id, item.id)),
    ),
  );
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function ensureStarterPage(userId: number) {
  const db = await requireDb();
  const existing = await db
    .select({ id: pages.id })
    .from(pages)
    .where(eq(pages.ownerUserId, userId))
    .limit(1);

  if (existing.length > 0) {
    return existing[0]?.id ?? null;
  }

  const now = new Date();
  const document = DEFAULT_PAGE_DOCUMENT;
  const pageValues: InsertPage = {
    ownerUserId: userId,
    parentPageId: null,
    title: "Welcome",
    icon: "✦",
    summary: getSummaryFromDocument(document),
    sortOrder: 0,
    depth: 0,
    isArchived: 0,
    contentJson: serializeDocument(document),
    contentVersion: 1,
    latestVersionNumber: 1,
    lastEditedByUserId: userId,
    createdAt: now,
    updatedAt: now,
  };

  const insertResult = await db.insert(pages).values(pageValues);
  const pageId = Number(insertResult[0].insertId);

  const collaborator: InsertPageCollaborator = {
    pageId,
    userId,
    role: "擁有者",
    invitedByUserId: userId,
    acceptedAt: now,
    createdAt: now,
    updatedAt: now,
  };

  const version: InsertPageVersion = {
    pageId,
    versionNumber: 1,
    title: "Welcome",
    snapshotJson: serializeDocument(document),
    createdByUserId: userId,
    createdAt: now,
  };

  await db.insert(pageCollaborators).values(collaborator);
  await db.insert(pageVersions).values(version);

  return pageId;
}

function toPageSummary(page: Page, role: CollaboratorRole) {
  return {
    id: page.id,
    title: page.title,
    icon: page.icon ?? null,
    summary: page.summary ?? "",
    parentPageId: page.parentPageId ?? null,
    sortOrder: page.sortOrder,
    depth: page.depth,
    role,
    ownerUserId: page.ownerUserId,
    updatedAt: page.updatedAt,
    createdAt: page.createdAt,
    contentVersion: page.contentVersion,
  };
}

export async function getWorkspaceSnapshot(userId: number) {
  const db = await requireDb();
  await ensureStarterPage(userId);

  const rows = await db
    .select({
      page: pages,
      role: pageCollaborators.role,
    })
    .from(pageCollaborators)
    .innerJoin(pages, eq(pageCollaborators.pageId, pages.id))
    .where(and(eq(pageCollaborators.userId, userId), eq(pages.isArchived, 0)))
    .orderBy(asc(pages.depth), asc(pages.sortOrder), asc(pages.id));

  const recentPages = rows
    .slice()
    .sort((left, right) => Number(right.page.updatedAt) - Number(left.page.updatedAt))
    .slice(0, 8)
    .map(row => toPageSummary(row.page, row.role));

  const pageTree = rows.map(row => toPageSummary(row.page, row.role));

  return {
    recentPages,
    pageTree,
  };
}

export async function getPageById(pageId: number, userId: number) {
  const db = await requireDb();
  const pageRows = await db
    .select({
      page: pages,
      role: pageCollaborators.role,
    })
    .from(pages)
    .innerJoin(pageCollaborators, eq(pageCollaborators.pageId, pages.id))
    .where(and(eq(pages.id, pageId), eq(pageCollaborators.userId, userId), eq(pages.isArchived, 0)))
    .limit(1);

  const row = pageRows[0];
  if (!row) {
    return null;
  }

  const collaboratorRows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: pageCollaborators.role,
      acceptedAt: pageCollaborators.acceptedAt,
    })
    .from(pageCollaborators)
    .innerJoin(users, eq(users.id, pageCollaborators.userId))
    .where(eq(pageCollaborators.pageId, pageId))
    .orderBy(asc(pageCollaborators.createdAt));

  const presenceRows = await db
    .select({
      sessionId: pagePresence.sessionId,
      userId: pagePresence.userId,
      activeBlockId: pagePresence.activeBlockId,
      selectionStart: pagePresence.selectionStart,
      selectionEnd: pagePresence.selectionEnd,
      lastHeartbeatAt: pagePresence.lastHeartbeatAt,
      name: users.name,
      email: users.email,
    })
    .from(pagePresence)
    .innerJoin(users, eq(users.id, pagePresence.userId))
    .where(and(eq(pagePresence.pageId, pageId), gt(pagePresence.lastHeartbeatAt, new Date(Date.now() - 30_000))));

  const activeEditors = Array.from(
    presenceRows
      .sort((left, right) => Number(right.lastHeartbeatAt) - Number(left.lastHeartbeatAt))
      .reduce(
        (map, presence) => {
          if (!map.has(presence.userId)) {
            map.set(presence.userId, presence);
          }
          return map;
        },
        new Map<number, (typeof presenceRows)[number]>(),
      )
      .values(),
  );

  return {
    ...toPageSummary(row.page, row.role),
    document: deserializeDocument(row.page.contentJson),
    latestVersionNumber: row.page.latestVersionNumber,
    collaborators: collaboratorRows.map(collaborator => ({
      id: collaborator.id,
      name: collaborator.name,
      email: collaborator.email,
      role: collaborator.role,
      acceptedAt: collaborator.acceptedAt,
    })),
    activeEditors: activeEditors.map(presence => ({
      sessionId: presence.sessionId,
      userId: presence.userId,
      name: presence.name,
      email: presence.email,
      activeBlockId: presence.activeBlockId,
      selectionStart: presence.selectionStart,
      selectionEnd: presence.selectionEnd,
      lastHeartbeatAt: presence.lastHeartbeatAt,
    })),
  };
}

export async function createPage(input: {
  userId: number;
  parentPageId?: number | null;
  title?: string;
  icon?: string | null;
}) {
  const db = await requireDb();
  const parentPageId = input.parentPageId ?? null;
  const title = normalizeTitle(input.title);
  const now = new Date();
  const document = {
    blocks: [
      {
        id: `block-${nanoid(10)}`,
        type: "heading-1",
        spans: [{ text: title }],
      },
      {
        id: `block-${nanoid(10)}`,
        type: "paragraph",
        spans: [{ text: "Start writing here." }],
      },
    ],
  } satisfies PageDocument;

  let depth = 0;
  let inheritedCollaborators: Array<{ userId: number; role: CollaboratorRole }> = [
    { userId: input.userId, role: "擁有者" },
  ];

  if (parentPageId != null) {
    const parent = await getPageById(parentPageId, input.userId);
    if (!parent || !canEdit(parent.role)) {
      return null;
    }

    depth = parent.depth + 1;
    inheritedCollaborators = parent.collaborators.map(collaborator => ({
      userId: collaborator.id,
      role: collaborator.role,
    }));
  }

  const pageValues: InsertPage = {
    ownerUserId: input.userId,
    parentPageId,
    title,
    icon: input.icon ?? "📄",
    summary: getSummaryFromDocument(document),
    sortOrder: await getNextSortOrder(parentPageId),
    depth,
    isArchived: 0,
    contentJson: serializeDocument(document),
    contentVersion: 1,
    latestVersionNumber: 1,
    lastEditedByUserId: input.userId,
    createdAt: now,
    updatedAt: now,
  };

  const insertResult = await db.insert(pages).values(pageValues);
  const pageId = Number(insertResult[0].insertId);

  const collaboratorValues: InsertPageCollaborator[] = inheritedCollaborators.map(collaborator => ({
    pageId,
    userId: collaborator.userId,
    role: collaborator.userId === input.userId ? "擁有者" : collaborator.role,
    invitedByUserId: input.userId,
    acceptedAt: now,
    createdAt: now,
    updatedAt: now,
  }));

  const versionValue: InsertPageVersion = {
    pageId,
    versionNumber: 1,
    title,
    snapshotJson: serializeDocument(document),
    createdByUserId: input.userId,
    createdAt: now,
  };

  await db.insert(pageCollaborators).values(collaboratorValues);
  await db.insert(pageVersions).values(versionValue);

  return getPageById(pageId, input.userId);
}

export async function renamePage(input: {
  pageId: number;
  userId: number;
  title: string;
}) {
  const role = await getPageRole(input.pageId, input.userId);
  if (!role || !canEdit(role)) {
    return null;
  }

  const db = await requireDb();
  await db
    .update(pages)
    .set({
      title: normalizeTitle(input.title),
      lastEditedByUserId: input.userId,
      updatedAt: new Date(),
    })
    .where(eq(pages.id, input.pageId));

  return getPageById(input.pageId, input.userId);
}

export async function archivePage(input: {
  pageId: number;
  userId: number;
}) {
  const role = await getPageRole(input.pageId, input.userId);
  if (!role || !canEdit(role)) {
    return false;
  }

  const db = await requireDb();
  await db
    .update(pages)
    .set({
      isArchived: 1,
      updatedAt: new Date(),
      lastEditedByUserId: input.userId,
    })
    .where(eq(pages.id, input.pageId));

  return true;
}

export async function movePage(input: {
  pageId: number;
  userId: number;
  parentPageId: number | null;
  sortOrder: number;
}) {
  const role = await getPageRole(input.pageId, input.userId);
  if (!role || !canEdit(role) || input.parentPageId === input.pageId) {
    return null;
  }

  let depth = 0;
  if (input.parentPageId != null) {
    const parent = await getPageById(input.parentPageId, input.userId);
    if (!parent || !canEdit(parent.role)) {
      return null;
    }
    depth = parent.depth + 1;
  }

  const db = await requireDb();
  const currentRows = await db.select().from(pages).where(eq(pages.id, input.pageId)).limit(1);
  const currentPage = currentRows[0];
  if (!currentPage) {
    return null;
  }

  const previousParentPageId = currentPage.parentPageId ?? null;
  const nextParentPageId = input.parentPageId;
  const targetSortOrder = Math.max(0, input.sortOrder);

  await db.transaction(async tx => {
    await tx
      .update(pages)
      .set({
        parentPageId: input.parentPageId,
        sortOrder: targetSortOrder,
        depth,
        updatedAt: new Date(),
      })
      .where(eq(pages.id, input.pageId));

    if (previousParentPageId === nextParentPageId) {
      await reindexChildren(nextParentPageId, input.pageId, targetSortOrder, tx);
    } else {
      await reindexChildren(previousParentPageId, undefined, undefined, tx);
      await reindexChildren(nextParentPageId, input.pageId, targetSortOrder, tx);
    }
  });

  return getPageById(input.pageId, input.userId);
}

export async function savePageContent(input: {
  pageId: number;
  userId: number;
  title: string;
  document: PageDocument;
}) {
  const role = await getPageRole(input.pageId, input.userId);
  if (!role || !canEdit(role)) {
    return null;
  }

  const db = await requireDb();
  const currentRows = await db.select().from(pages).where(eq(pages.id, input.pageId)).limit(1);
  const currentPage = currentRows[0];
  if (!currentPage) {
    return null;
  }

  const nextVersionNumber = currentPage.latestVersionNumber + 1;
  const nextContentVersion = currentPage.contentVersion + 1;
  const nextTitle = normalizeTitle(input.title);
  const now = new Date();

  await db
    .update(pages)
    .set({
      title: nextTitle,
      summary: getSummaryFromDocument(input.document),
      contentJson: serializeDocument(input.document),
      contentVersion: nextContentVersion,
      latestVersionNumber: nextVersionNumber,
      lastEditedByUserId: input.userId,
      updatedAt: now,
    })
    .where(eq(pages.id, input.pageId));

  const versionValue: InsertPageVersion = {
    pageId: input.pageId,
    versionNumber: nextVersionNumber,
    title: nextTitle,
    snapshotJson: serializeDocument(input.document),
    createdByUserId: input.userId,
    createdAt: now,
  };

  await db.insert(pageVersions).values(versionValue);

  return getPageById(input.pageId, input.userId);
}

export async function pollPageUpdate(input: {
  pageId: number;
  userId: number;
  sinceVersion: number;
}) {
  const role = await getPageRole(input.pageId, input.userId);
  if (!role) {
    return null;
  }

  const db = await requireDb();
  const rows = await db
    .select()
    .from(pages)
    .where(and(eq(pages.id, input.pageId), gt(pages.contentVersion, input.sinceVersion)))
    .limit(1);

  const page = rows[0];
  if (!page) {
    return { hasUpdate: false };
  }

  return {
    hasUpdate: true,
    page: await getPageById(page.id, input.userId),
  };
}

export async function listPageVersions(input: {
  pageId: number;
  userId: number;
}) {
  const role = await getPageRole(input.pageId, input.userId);
  if (!role) {
    return [];
  }

  const db = await requireDb();
  const versionRows = await db
    .select({
      id: pageVersions.id,
      versionNumber: pageVersions.versionNumber,
      title: pageVersions.title,
      snapshotJson: pageVersions.snapshotJson,
      createdAt: pageVersions.createdAt,
      createdByUserId: pageVersions.createdByUserId,
      authorName: users.name,
      authorEmail: users.email,
    })
    .from(pageVersions)
    .innerJoin(users, eq(users.id, pageVersions.createdByUserId))
    .where(eq(pageVersions.pageId, input.pageId))
    .orderBy(desc(pageVersions.versionNumber));

  return versionRows.map(version => ({
    id: version.id,
    versionNumber: version.versionNumber,
    title: version.title,
    document: deserializeDocument(version.snapshotJson),
    createdAt: version.createdAt,
    createdByUserId: version.createdByUserId,
    authorName: version.authorName,
    authorEmail: version.authorEmail,
  }));
}

export async function restorePageVersion(input: {
  pageId: number;
  versionId: number;
  userId: number;
}) {
  const role = await getPageRole(input.pageId, input.userId);
  if (!role || !canEdit(role)) {
    return null;
  }

  const db = await requireDb();
  const targetRows = await db
    .select()
    .from(pageVersions)
    .where(and(eq(pageVersions.id, input.versionId), eq(pageVersions.pageId, input.pageId)))
    .limit(1);

  const target = targetRows[0];
  if (!target) {
    return null;
  }

  return savePageContent({
    pageId: input.pageId,
    userId: input.userId,
    title: target.title,
    document: deserializeDocument(target.snapshotJson),
  });
}

export async function inviteCollaborator(input: {
  pageId: number;
  userId: number;
  inviteeEmail: string;
  role: CollaboratorRole;
}) {
  const role = await getPageRole(input.pageId, input.userId);
  if (role !== "擁有者") {
    return null;
  }

  const db = await requireDb();
  const inviteeEmail = input.inviteeEmail.trim().toLowerCase();
  const inviteeRows = await db.select().from(users).where(eq(users.email, inviteeEmail)).limit(1);
  const inviteeUser = inviteeRows[0];
  const now = new Date();
  const token = nanoid(32);

  if (inviteeUser) {
    await db.insert(pageCollaborators).values({
      pageId: input.pageId,
      userId: inviteeUser.id,
      role: input.role,
      invitedByUserId: input.userId,
      acceptedAt: now,
      createdAt: now,
      updatedAt: now,
    }).onDuplicateKeyUpdate({
      set: {
        role: input.role,
        invitedByUserId: input.userId,
        acceptedAt: now,
        updatedAt: now,
      },
    });
  }

  const invitation: InsertPageInvitation = {
    pageId: input.pageId,
    invitedByUserId: input.userId,
    inviteeUserId: inviteeUser?.id,
    inviteeEmail,
    role: input.role,
    status: inviteeUser ? "accepted" : "pending",
    token,
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
    respondedAt: inviteeUser ? now : null,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(pageInvitations).values(invitation);

  return {
    inviteeEmail,
    role: input.role,
    status: invitation.status,
    token,
  };
}

export async function listPendingInvitations(input: {
  userId: number;
  email?: string | null;
}) {
  const db = await requireDb();
  const audienceFilter = input.email
    ? or(
        eq(pageInvitations.inviteeUserId, input.userId),
        eq(pageInvitations.inviteeEmail, input.email.toLowerCase()),
      )
    : eq(pageInvitations.inviteeUserId, input.userId);

  const invitationRows = await db
    .select({
      id: pageInvitations.id,
      pageId: pageInvitations.pageId,
      inviteeEmail: pageInvitations.inviteeEmail,
      role: pageInvitations.role,
      status: pageInvitations.status,
      expiresAt: pageInvitations.expiresAt,
      title: pages.title,
      icon: pages.icon,
      inviterName: users.name,
      inviterEmail: users.email,
    })
    .from(pageInvitations)
    .innerJoin(pages, eq(pages.id, pageInvitations.pageId))
    .innerJoin(users, eq(users.id, pageInvitations.invitedByUserId))
    .where(and(eq(pageInvitations.status, "pending"), audienceFilter));

  return invitationRows;
}

export async function respondToInvitation(input: {
  invitationId: number;
  userId: number;
  email?: string | null;
  accept: boolean;
}) {
  const db = await requireDb();
  const invitationRows = await db
    .select()
    .from(pageInvitations)
    .where(eq(pageInvitations.id, input.invitationId))
    .limit(1);

  const invitation = invitationRows[0];
  if (
    !invitation ||
    invitation.status !== "pending" ||
    (invitation.inviteeUserId != null && invitation.inviteeUserId !== input.userId) ||
    (invitation.inviteeEmail != null && invitation.inviteeEmail !== (input.email?.toLowerCase() ?? null))
  ) {
    return null;
  }

  const now = new Date();
  await db
    .update(pageInvitations)
    .set({
      inviteeUserId: input.userId,
      status: input.accept ? "accepted" : "declined",
      respondedAt: now,
      updatedAt: now,
    })
    .where(eq(pageInvitations.id, input.invitationId));

  if (input.accept) {
    await db.insert(pageCollaborators).values({
      pageId: invitation.pageId,
      userId: input.userId,
      role: invitation.role,
      invitedByUserId: invitation.invitedByUserId,
      acceptedAt: now,
      createdAt: now,
      updatedAt: now,
    }).onDuplicateKeyUpdate({
      set: {
        role: invitation.role,
        acceptedAt: now,
        updatedAt: now,
      },
    });
  }

  return {
    success: true,
    pageId: invitation.pageId,
  };
}

export async function syncPresence(input: {
  pageId: number;
  userId: number;
  sessionId: string;
  activeBlockId?: string | null;
  selectionStart?: number | null;
  selectionEnd?: number | null;
}) {
  const role = await getPageRole(input.pageId, input.userId);
  if (!role) {
    return null;
  }

  const db = await requireDb();
  const values: InsertPagePresence = {
    pageId: input.pageId,
    userId: input.userId,
    sessionId: input.sessionId,
    activeBlockId: input.activeBlockId ?? null,
    selectionStart: input.selectionStart ?? null,
    selectionEnd: input.selectionEnd ?? null,
    lastHeartbeatAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  await db.insert(pagePresence).values(values).onDuplicateKeyUpdate({
    set: {
      pageId: input.pageId,
      userId: input.userId,
      activeBlockId: input.activeBlockId ?? null,
      selectionStart: input.selectionStart ?? null,
      selectionEnd: input.selectionEnd ?? null,
      lastHeartbeatAt: new Date(),
      updatedAt: new Date(),
    },
  });

  return getPageById(input.pageId, input.userId);
}

export async function removePresence(sessionId: string) {
  const db = await requireDb();
  await db.delete(pagePresence).where(eq(pagePresence.sessionId, sessionId));
}

export async function getPageRolesForUser(pageIds: number[], userId: number) {
  if (pageIds.length === 0) {
    return [];
  }

  const db = await requireDb();
  return db
    .select({
      pageId: pageCollaborators.pageId,
      role: pageCollaborators.role,
    })
    .from(pageCollaborators)
    .where(and(eq(pageCollaborators.userId, userId), inArray(pageCollaborators.pageId, pageIds)));
}
