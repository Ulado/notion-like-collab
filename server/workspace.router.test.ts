import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

const dbMock = vi.hoisted(() => ({
  archivePage: vi.fn(),
  createPage: vi.fn(),
  getPageById: vi.fn(),
  getWorkspaceSnapshot: vi.fn(),
  inviteCollaborator: vi.fn(),
  listPageVersions: vi.fn(),
  listPendingInvitations: vi.fn(),
  movePage: vi.fn(),
  pollPageUpdate: vi.fn(),
  renamePage: vi.fn(),
  respondToInvitation: vi.fn(),
  restorePageVersion: vi.fn(),
  savePageContent: vi.fn(),
  syncPresence: vi.fn(),
}));

vi.mock("./db", () => dbMock);

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createProtectedContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 7,
    openId: "workspace-user",
    email: "workspace@example.com",
    name: "Workspace User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  return {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
    } as TrpcContext["res"],
  };
}

describe("workspace router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a combined snapshot with pending invitations", async () => {
    dbMock.getWorkspaceSnapshot.mockResolvedValue({
      recentPages: [{ id: 1, title: "Welcome" }],
      pageTree: [{ id: 1, title: "Welcome" }],
    });
    dbMock.listPendingInvitations.mockResolvedValue([{ id: 8, title: "Shared spec" }]);

    const caller = appRouter.createCaller(createProtectedContext());
    const result = await caller.workspace.snapshot();

    expect(result).toEqual({
      recentPages: [{ id: 1, title: "Welcome" }],
      pageTree: [{ id: 1, title: "Welcome" }],
      pendingInvitations: [{ id: 8, title: "Shared spec" }],
    });
    expect(dbMock.getWorkspaceSnapshot).toHaveBeenCalledWith(7);
    expect(dbMock.listPendingInvitations).toHaveBeenCalledWith({
      userId: 7,
      email: "workspace@example.com",
    });
  });

  it("throws NOT_FOUND when the requested page is inaccessible", async () => {
    dbMock.getPageById.mockResolvedValue(null);

    const caller = appRouter.createCaller(createProtectedContext());

    await expect(caller.workspace.page({ pageId: 99 })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "找不到頁面，或您沒有檢視權限。",
    } satisfies Partial<TRPCError>);
  });

  it("throws FORBIDDEN when a non-owner tries to invite collaborators", async () => {
    dbMock.inviteCollaborator.mockResolvedValue(null);

    const caller = appRouter.createCaller(createProtectedContext());

    await expect(
      caller.workspace.inviteCollaborator({
        pageId: 1,
        inviteeEmail: "viewer@example.com",
        role: "檢視者",
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "只有擁有者可以邀請協作者。",
    } satisfies Partial<TRPCError>);
  });

  it("forwards page move requests with the expected sorting payload", async () => {
    dbMock.movePage.mockResolvedValue({
      id: 3,
      title: "Nested Page",
      sortOrder: 1,
      parentPageId: 1,
    });

    const caller = appRouter.createCaller(createProtectedContext());
    const result = await caller.workspace.movePage({
      pageId: 3,
      parentPageId: 1,
      sortOrder: 1,
    });

    expect(result).toEqual({
      id: 3,
      title: "Nested Page",
      sortOrder: 1,
      parentPageId: 1,
    });
    expect(dbMock.movePage).toHaveBeenCalledWith({
      pageId: 3,
      userId: 7,
      parentPageId: 1,
      sortOrder: 1,
    });
  });

  it("passes the current user's email when responding to invitations", async () => {
    dbMock.respondToInvitation.mockResolvedValue({
      invitationId: 5,
      pageId: 12,
      status: "accepted",
    });

    const caller = appRouter.createCaller(createProtectedContext());
    const result = await caller.workspace.respondToInvitation({
      invitationId: 5,
      accept: true,
    });

    expect(result).toEqual({
      invitationId: 5,
      pageId: 12,
      status: "accepted",
    });
    expect(dbMock.respondToInvitation).toHaveBeenCalledWith({
      invitationId: 5,
      userId: 7,
      email: "workspace@example.com",
      accept: true,
    });
  });

  it("throws FORBIDDEN when autosave is rejected by the data layer", async () => {
    dbMock.savePageContent.mockResolvedValue(null);

    const caller = appRouter.createCaller(createProtectedContext());

    await expect(
      caller.workspace.savePage({
        pageId: 1,
        title: "Welcome",
        document: {
          blocks: [{ id: "block-1", type: "paragraph", spans: [{ text: "Hello" }] }],
        },
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "您沒有編輯此頁面的權限。",
    } satisfies Partial<TRPCError>);
  });

  it("throws FORBIDDEN when version restore is rejected by the data layer", async () => {
    dbMock.restorePageVersion.mockResolvedValue(null);

    const caller = appRouter.createCaller(createProtectedContext());

    await expect(
      caller.workspace.restoreVersion({
        pageId: 1,
        versionId: 2,
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "您沒有還原版本的權限。",
    } satisfies Partial<TRPCError>);
  });

  it("returns the saved page when autosave succeeds", async () => {
    const savedPage = {
      id: 1,
      title: "Welcome",
      role: "擁有者",
      contentVersion: 3,
      latestVersionNumber: 3,
      document: {
        blocks: [{ id: "block-1", type: "paragraph", spans: [{ text: "Hello" }] }],
      },
      collaborators: [],
      activeEditors: [],
    };
    dbMock.savePageContent.mockResolvedValue(savedPage);

    const caller = appRouter.createCaller(createProtectedContext());
    const result = await caller.workspace.savePage({
      pageId: 1,
      title: "Welcome",
      document: {
        blocks: [{ id: "block-1", type: "paragraph", spans: [{ text: "Hello" }] }],
      },
    });

    expect(result).toEqual(savedPage);
    expect(dbMock.savePageContent).toHaveBeenCalledWith({
      pageId: 1,
      userId: 7,
      title: "Welcome",
      document: {
        blocks: [{ id: "block-1", type: "paragraph", spans: [{ text: "Hello" }] }],
      },
    });
  });
});
