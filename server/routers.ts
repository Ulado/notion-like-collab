import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import {
  archivePage,
  createPage,
  getPageById,
  getWorkspaceSnapshot,
  inviteCollaborator,
  listPageVersions,
  listPendingInvitations,
  movePage,
  pollPageUpdate,
  renamePage,
  respondToInvitation,
  restorePageVersion,
  savePageContent,
  syncPresence,
} from "./db";

const collaboratorRoleSchema = z.enum(["擁有者", "編輯者", "檢視者"]);
const richTextSpanSchema = z.object({
  text: z.string(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  code: z.boolean().optional(),
});
const pageBlockSchema = z.object({
  id: z.string().min(1),
  type: z.enum([
    "heading-1",
    "heading-2",
    "heading-3",
    "paragraph",
    "todo",
    "bulleted-list",
    "numbered-list",
    "quote",
    "code",
  ]),
  checked: z.boolean().optional(),
  language: z.string().optional(),
  level: z.number().optional(),
  spans: z.array(richTextSpanSchema),
});
const pageDocumentSchema = z.object({
  blocks: z.array(pageBlockSchema),
});

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),
  workspace: router({
    snapshot: protectedProcedure.query(async ({ ctx }) => {
      const workspace = await getWorkspaceSnapshot(ctx.user.id);
      const pendingInvitations = await listPendingInvitations({
        userId: ctx.user.id,
        email: ctx.user.email,
      });

      return {
        ...workspace,
        pendingInvitations,
      };
    }),
    page: protectedProcedure
      .input(z.object({ pageId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        const page = await getPageById(input.pageId, ctx.user.id);
        if (!page) {
          throw new TRPCError({ code: "NOT_FOUND", message: "找不到頁面，或您沒有檢視權限。" });
        }
        return page;
      }),
    createPage: protectedProcedure
      .input(
        z.object({
          parentPageId: z.number().int().positive().nullable().optional(),
          title: z.string().max(255).optional(),
          icon: z.string().max(64).nullable().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const page = await createPage({
          userId: ctx.user.id,
          parentPageId: input.parentPageId,
          title: input.title,
          icon: input.icon,
        });

        if (!page) {
          throw new TRPCError({ code: "FORBIDDEN", message: "您沒有在此位置建立頁面的權限。" });
        }

        return page;
      }),
    renamePage: protectedProcedure
      .input(
        z.object({
          pageId: z.number().int().positive(),
          title: z.string().min(1).max(255),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const page = await renamePage({
          pageId: input.pageId,
          userId: ctx.user.id,
          title: input.title,
        });

        if (!page) {
          throw new TRPCError({ code: "FORBIDDEN", message: "您沒有重新命名此頁面的權限。" });
        }

        return page;
      }),
    archivePage: protectedProcedure
      .input(z.object({ pageId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const archived = await archivePage({
          pageId: input.pageId,
          userId: ctx.user.id,
        });

        if (!archived) {
          throw new TRPCError({ code: "FORBIDDEN", message: "您沒有刪除此頁面的權限。" });
        }

        return { success: true };
      }),
    movePage: protectedProcedure
      .input(
        z.object({
          pageId: z.number().int().positive(),
          parentPageId: z.number().int().positive().nullable(),
          sortOrder: z.number().int().min(0),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const page = await movePage({
          pageId: input.pageId,
          userId: ctx.user.id,
          parentPageId: input.parentPageId,
          sortOrder: input.sortOrder,
        });

        if (!page) {
          throw new TRPCError({ code: "FORBIDDEN", message: "您沒有調整此頁面位置的權限。" });
        }

        return page;
      }),
    savePage: protectedProcedure
      .input(
        z.object({
          pageId: z.number().int().positive(),
          title: z.string().max(255),
          document: pageDocumentSchema,
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const page = await savePageContent({
          pageId: input.pageId,
          userId: ctx.user.id,
          title: input.title,
          document: input.document,
        });

        if (!page) {
          throw new TRPCError({ code: "FORBIDDEN", message: "您沒有編輯此頁面的權限。" });
        }

        return page;
      }),
    pollUpdates: protectedProcedure
      .input(
        z.object({
          pageId: z.number().int().positive(),
          sinceVersion: z.number().int().min(0),
        }),
      )
      .query(async ({ ctx, input }) => {
        const result = await pollPageUpdate({
          pageId: input.pageId,
          userId: ctx.user.id,
          sinceVersion: input.sinceVersion,
        });

        if (!result) {
          throw new TRPCError({ code: "FORBIDDEN", message: "您沒有檢視此頁面的權限。" });
        }

        return result;
      }),
    versions: protectedProcedure
      .input(z.object({ pageId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        return listPageVersions({
          pageId: input.pageId,
          userId: ctx.user.id,
        });
      }),
    restoreVersion: protectedProcedure
      .input(
        z.object({
          pageId: z.number().int().positive(),
          versionId: z.number().int().positive(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const restoredPage = await restorePageVersion({
          pageId: input.pageId,
          versionId: input.versionId,
          userId: ctx.user.id,
        });

        if (!restoredPage) {
          throw new TRPCError({ code: "FORBIDDEN", message: "您沒有還原版本的權限。" });
        }

        return restoredPage;
      }),
    inviteCollaborator: protectedProcedure
      .input(
        z.object({
          pageId: z.number().int().positive(),
          inviteeEmail: z.string().email(),
          role: collaboratorRoleSchema,
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const invitation = await inviteCollaborator({
          pageId: input.pageId,
          userId: ctx.user.id,
          inviteeEmail: input.inviteeEmail,
          role: input.role,
        });

        if (!invitation) {
          throw new TRPCError({ code: "FORBIDDEN", message: "只有擁有者可以邀請協作者。" });
        }

        return invitation;
      }),
    pendingInvitations: protectedProcedure.query(async ({ ctx }) => {
      return listPendingInvitations({
        userId: ctx.user.id,
        email: ctx.user.email,
      });
    }),
    respondToInvitation: protectedProcedure
      .input(
        z.object({
          invitationId: z.number().int().positive(),
          accept: z.boolean(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const result = await respondToInvitation({
          invitationId: input.invitationId,
          userId: ctx.user.id,
          email: ctx.user.email,
          accept: input.accept,
        });

        if (!result) {
          throw new TRPCError({ code: "NOT_FOUND", message: "找不到邀請紀錄。" });
        }

        return result;
      }),
    heartbeat: protectedProcedure
      .input(
        z.object({
          pageId: z.number().int().positive(),
          sessionId: z.string().min(8),
          activeBlockId: z.string().nullable().optional(),
          selectionStart: z.number().int().nullable().optional(),
          selectionEnd: z.number().int().nullable().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const page = await syncPresence({
          pageId: input.pageId,
          userId: ctx.user.id,
          sessionId: input.sessionId,
          activeBlockId: input.activeBlockId,
          selectionStart: input.selectionStart,
          selectionEnd: input.selectionEnd,
        });

        if (!page) {
          throw new TRPCError({ code: "FORBIDDEN", message: "您沒有此頁面的存取權限。" });
        }

        return {
          success: true,
          activeEditors: page.activeEditors,
        };
      }),
  }),
});

export type AppRouter = typeof appRouter;
