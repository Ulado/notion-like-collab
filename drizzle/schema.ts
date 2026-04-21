import {
  index,
  int,
  longtext,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const collaboratorRoleEnum = mysqlEnum("collaboratorRole", ["擁有者", "編輯者", "檢視者"]);
export const invitationStatusEnum = mysqlEnum("invitationStatus", ["pending", "accepted", "declined", "revoked"]);

export const pages = mysqlTable(
  "pages",
  {
    id: int("id").autoincrement().primaryKey(),
    ownerUserId: int("ownerUserId").notNull(),
    parentPageId: int("parentPageId"),
    title: varchar("title", { length: 255 }).notNull(),
    icon: varchar("icon", { length: 64 }),
    summary: text("summary"),
    sortOrder: int("sortOrder").default(0).notNull(),
    depth: int("depth").default(0).notNull(),
    isArchived: int("isArchived").default(0).notNull(),
    contentJson: longtext("contentJson").notNull(),
    contentVersion: int("contentVersion").default(1).notNull(),
    latestVersionNumber: int("latestVersionNumber").default(1).notNull(),
    lastEditedByUserId: int("lastEditedByUserId"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    ownerIdx: index("pages_owner_idx").on(table.ownerUserId),
    parentIdx: index("pages_parent_idx").on(table.parentPageId),
    updatedIdx: index("pages_updated_idx").on(table.updatedAt),
    treeOrderIdx: index("pages_tree_order_idx").on(table.parentPageId, table.sortOrder),
  }),
);

export const pageCollaborators = mysqlTable(
  "pageCollaborators",
  {
    id: int("id").autoincrement().primaryKey(),
    pageId: int("pageId").notNull(),
    userId: int("userId").notNull(),
    role: collaboratorRoleEnum.notNull(),
    invitedByUserId: int("invitedByUserId"),
    acceptedAt: timestamp("acceptedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    pageUserUnique: uniqueIndex("page_collaborators_page_user_unique").on(table.pageId, table.userId),
    pageIdx: index("page_collaborators_page_idx").on(table.pageId),
    userIdx: index("page_collaborators_user_idx").on(table.userId),
  }),
);

export const pageInvitations = mysqlTable(
  "pageInvitations",
  {
    id: int("id").autoincrement().primaryKey(),
    pageId: int("pageId").notNull(),
    invitedByUserId: int("invitedByUserId").notNull(),
    inviteeUserId: int("inviteeUserId"),
    inviteeEmail: varchar("inviteeEmail", { length: 320 }).notNull(),
    role: collaboratorRoleEnum.notNull(),
    status: invitationStatusEnum.default("pending").notNull(),
    token: varchar("token", { length: 96 }).notNull(),
    expiresAt: timestamp("expiresAt").notNull(),
    respondedAt: timestamp("respondedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    tokenUnique: uniqueIndex("page_invitations_token_unique").on(table.token),
    emailIdx: index("page_invitations_email_idx").on(table.inviteeEmail),
    pageIdx: index("page_invitations_page_idx").on(table.pageId),
  }),
);

export const pageVersions = mysqlTable(
  "pageVersions",
  {
    id: int("id").autoincrement().primaryKey(),
    pageId: int("pageId").notNull(),
    versionNumber: int("versionNumber").notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    snapshotJson: longtext("snapshotJson").notNull(),
    createdByUserId: int("createdByUserId").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    pageVersionUnique: uniqueIndex("page_versions_page_version_unique").on(table.pageId, table.versionNumber),
    pageIdx: index("page_versions_page_idx").on(table.pageId),
  }),
);

export const pagePresence = mysqlTable(
  "pagePresence",
  {
    id: int("id").autoincrement().primaryKey(),
    pageId: int("pageId").notNull(),
    userId: int("userId").notNull(),
    sessionId: varchar("sessionId", { length: 96 }).notNull(),
    activeBlockId: varchar("activeBlockId", { length: 96 }),
    selectionStart: int("selectionStart"),
    selectionEnd: int("selectionEnd"),
    lastHeartbeatAt: timestamp("lastHeartbeatAt").defaultNow().notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    sessionUnique: uniqueIndex("page_presence_session_unique").on(table.sessionId),
    pageIdx: index("page_presence_page_idx").on(table.pageId),
    userIdx: index("page_presence_user_idx").on(table.userId),
  }),
);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export type CollaboratorRole = "擁有者" | "編輯者" | "檢視者";
export type InvitationStatus = "pending" | "accepted" | "declined" | "revoked";

export type Page = typeof pages.$inferSelect;
export type InsertPage = typeof pages.$inferInsert;
export type PageCollaborator = typeof pageCollaborators.$inferSelect;
export type InsertPageCollaborator = typeof pageCollaborators.$inferInsert;
export type PageInvitation = typeof pageInvitations.$inferSelect;
export type InsertPageInvitation = typeof pageInvitations.$inferInsert;
export type PageVersion = typeof pageVersions.$inferSelect;
export type InsertPageVersion = typeof pageVersions.$inferInsert;
export type PagePresence = typeof pagePresence.$inferSelect;
export type InsertPagePresence = typeof pagePresence.$inferInsert;
