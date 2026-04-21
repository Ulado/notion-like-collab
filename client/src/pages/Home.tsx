import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import {
  DEFAULT_PAGE_DOCUMENT,
  MARKDOWN_SHORTCUTS,
  type BlockType,
  type CollaboratorRoleLabel,
  type PageBlock,
  type PageDocument,
} from "@shared/collab";
import {
  ChevronRight,
  Clock3,
  CopyPlus,
  GripVertical,
  History,
  Loader2,
  Plus,
  Share2,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

type HomeProps = {
  pageId?: number;
};

type SnapshotData = {
  recentPages: Array<{
    id: number;
    title: string;
    icon: string | null;
    summary: string;
    parentPageId: number | null;
    sortOrder: number;
    depth: number;
    role: CollaboratorRoleLabel;
    updatedAt: Date;
    createdAt: Date;
    contentVersion: number;
  }>;
  pageTree: Array<{
    id: number;
    title: string;
    icon: string | null;
    summary: string;
    parentPageId: number | null;
    sortOrder: number;
    depth: number;
    role: CollaboratorRoleLabel;
    ownerUserId: number;
    updatedAt: Date;
    createdAt: Date;
    contentVersion: number;
  }>;
  pendingInvitations: Array<{
    id: number;
    pageId: number;
    inviteeEmail: string;
    role: CollaboratorRoleLabel;
    status: string;
    expiresAt: Date;
    title: string;
    icon: string | null;
    inviterName: string | null;
    inviterEmail: string | null;
  }>;
};

type PageDetails = {
  id: number;
  title: string;
  icon: string | null;
  summary: string;
  parentPageId: number | null;
  sortOrder: number;
  depth: number;
  role: CollaboratorRoleLabel;
  ownerUserId: number;
  updatedAt: Date;
  createdAt: Date;
  contentVersion: number;
  latestVersionNumber: number;
  document: PageDocument;
  collaborators: Array<{
    id: number;
    name: string | null;
    email: string | null;
    role: CollaboratorRoleLabel;
    acceptedAt: Date | null;
  }>;
  activeEditors: Array<{
    sessionId: string;
    userId: number;
    name: string | null;
    email: string | null;
    activeBlockId: string | null;
    selectionStart: number | null;
    selectionEnd: number | null;
    lastHeartbeatAt: Date;
  }>;
};

type VersionItem = {
  id: number;
  versionNumber: number;
  title: string;
  document: PageDocument;
  createdAt: Date;
  createdByUserId: number;
  authorName: string | null;
  authorEmail: string | null;
};

type PageTreeItem = SnapshotData["pageTree"][number];
type TreeNode = PageTreeItem & { children: TreeNode[] };
type MovePageInput = {
  pageId: number;
  parentPageId: number | null;
  sortOrder: number;
};

const blockTypeLabels: Record<BlockType, string> = {
  "heading-1": "標題 1",
  "heading-2": "標題 2",
  "heading-3": "標題 3",
  paragraph: "段落",
  todo: "待辦清單",
  "bulleted-list": "項目符號清單",
  "numbered-list": "數字清單",
  quote: "引用",
  code: "程式碼區塊",
};

const blockPlaceholders: Record<BlockType, string> = {
  "heading-1": "輸入大標題",
  "heading-2": "輸入章節標題",
  "heading-3": "輸入小節標題",
  paragraph: "輸入內容，或輸入 #、-、[]、>、``` 轉換區塊類型",
  todo: "輸入待辦事項",
  "bulleted-list": "輸入項目內容",
  "numbered-list": "輸入步驟內容",
  quote: "輸入引用內容",
  code: "輸入程式碼",
};

function makeBlock(type: BlockType = "paragraph", text = ""): PageBlock {
  return {
    id: `block-${crypto.randomUUID()}`,
    type,
    checked: type === "todo" ? false : undefined,
    spans: [{ text }],
  };
}

function getBlockText(block: PageBlock) {
  return block.spans.map(span => span.text).join("");
}

function setBlockText(block: PageBlock, text: string): PageBlock {
  return {
    ...block,
    spans: [{ text }],
  };
}

function applyMarkdownShortcut(text: string): { type: BlockType; text: string } | null {
  for (const shortcut of MARKDOWN_SHORTCUTS) {
    if (shortcut.match.test(text)) {
      return {
        type: shortcut.type,
        text: text.replace(shortcut.match, ""),
      };
    }
  }
  return null;
}

function buildTree(items: SnapshotData["pageTree"]): TreeNode[] {
  const map = new Map<number, TreeNode>();
  const roots: TreeNode[] = [];

  items
    .slice()
    .sort((left, right) => {
      if (left.depth !== right.depth) return left.depth - right.depth;
      if (left.parentPageId !== right.parentPageId) return (left.parentPageId ?? 0) - (right.parentPageId ?? 0);
      return left.sortOrder - right.sortOrder;
    })
    .forEach(item => {
      map.set(item.id, { ...item, children: [] });
    });

  map.forEach(node => {
    if (node.parentPageId && map.has(node.parentPageId)) {
      map.get(node.parentPageId)?.children.push(node);
    } else {
      roots.push(node);
    }
  });

  const sortChildren = (nodes: TreeNode[]) => {
    nodes.sort((left, right) => left.sortOrder - right.sortOrder);
    nodes.forEach(node => sortChildren(node.children));
  };

  sortChildren(roots);
  return roots;
}

function collectDescendantIds(items: PageTreeItem[], pageId: number) {
  const childrenByParent = new Map<number, number[]>();

  items.forEach(item => {
    if (!item.parentPageId) return;
    const siblings = childrenByParent.get(item.parentPageId) ?? [];
    siblings.push(item.id);
    childrenByParent.set(item.parentPageId, siblings);
  });

  const visited = new Set<number>();
  const visit = (currentId: number) => {
    if (visited.has(currentId)) return;
    visited.add(currentId);
    (childrenByParent.get(currentId) ?? []).forEach(childId => visit(childId));
  };

  visit(pageId);
  return visited;
}

function applyOptimisticPageMove(items: PageTreeItem[], input: MovePageInput): PageTreeItem[] {
  const nextItems = items.map(item => ({ ...item }));
  const itemMap = new Map(nextItems.map(item => [item.id, item]));
  const movedPage = itemMap.get(input.pageId);
  if (!movedPage) return items;

  const previousParentPageId = movedPage.parentPageId;
  const descendantIds = collectDescendantIds(nextItems, input.pageId);
  const nextParent = input.parentPageId ? itemMap.get(input.parentPageId) : null;
  const nextDepth = nextParent ? nextParent.depth + 1 : 0;
  const depthDelta = nextDepth - movedPage.depth;

  descendantIds.forEach(id => {
    const item = itemMap.get(id);
    if (!item) return;
    item.depth = Math.max(0, item.depth + depthDelta);
    if (id === input.pageId) {
      item.parentPageId = input.parentPageId;
      item.sortOrder = input.sortOrder;
    }
  });

  const resequenceSiblings = (parentPageId: number | null) => {
    const siblings = nextItems
      .filter(item => item.parentPageId === parentPageId && item.id !== input.pageId)
      .sort((left, right) => left.sortOrder - right.sortOrder);

    if (parentPageId === input.parentPageId) {
      const insertAt = Math.max(0, Math.min(input.sortOrder, siblings.length));
      siblings.splice(insertAt, 0, itemMap.get(input.pageId)!);
    }

    siblings.forEach((item, index) => {
      item.sortOrder = index;
    });
  };

  if (previousParentPageId === input.parentPageId) {
    resequenceSiblings(input.parentPageId);
  } else {
    resequenceSiblings(previousParentPageId);
    resequenceSiblings(input.parentPageId);
  }

  return nextItems;
}

function formatTime(value: Date | string) {
  return new Date(value).toLocaleString();
}

function editorCanWrite(role?: CollaboratorRoleLabel) {
  return role === "擁有者" || role === "編輯者";
}

function renderEditorBrand() {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-lg text-primary shadow-inner">
          ✦
        </div>
        <div className="min-w-0">
          <p className="truncate font-serif text-lg leading-none tracking-tight text-foreground">Atelier Notes</p>
          <p className="mt-1 truncate text-xs text-muted-foreground">Elegant collaborative documents</p>
        </div>
      </div>
    </div>
  );
}

function EmptyEditorState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <Card className="w-full max-w-3xl rounded-[2rem] border-white/70 bg-white/80 shadow-[0_24px_80px_rgba(76,61,43,0.12)] backdrop-blur-xl">
        <CardHeader className="pb-4 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-primary/10 text-primary">
            <Sparkles className="h-7 w-7" />
          </div>
          <CardTitle className="font-serif text-4xl tracking-tight">精緻協作工作區</CardTitle>
          <CardDescription className="mx-auto max-w-2xl text-base leading-8 text-muted-foreground">
            這裡是您的工作區首頁。您可以快速開啟最近編輯的頁面、接受協作邀請，或建立新的文件開始共同撰寫。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center pb-8">
          <Button onClick={onCreate} size="lg" className="h-12 rounded-2xl px-8">
            <Plus className="mr-2 h-4 w-4" />
            建立第一個頁面
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default function Home({ pageId }: HomeProps) {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const [draftTitle, setDraftTitle] = useState("Untitled");
  const [draftDocument, setDraftDocument] = useState<PageDocument>(DEFAULT_PAGE_DOCUMENT);
  const [activeVersion, setActiveVersion] = useState(0);
  const [isDirty, setIsDirty] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [hasRemoteConflict, setHasRemoteConflict] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<CollaboratorRoleLabel>("編輯者");
  const [renamingPageId, setRenamingPageId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [draggingPageId, setDraggingPageId] = useState<number | null>(null);
  const [focusedBlockId, setFocusedBlockId] = useState<string | null>(null);
  const [selectionRange, setSelectionRange] = useState<{ start: number | null; end: number | null }>({ start: null, end: null });
  const [sessionId] = useState(() => crypto.randomUUID());
  const textAreaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const pendingFocusBlockId = useRef<string | null>(null);

  const snapshotQuery = trpc.workspace.snapshot.useQuery(undefined, {
    retry: false,
    staleTime: 5_000,
  });

  const snapshot = snapshotQuery.data as SnapshotData | undefined;
  const activePageId = pageId && Number.isFinite(pageId) ? pageId : undefined;

  const pageQuery = trpc.workspace.page.useQuery(
    { pageId: activePageId ?? 0 },
    {
      enabled: Boolean(activePageId),
      retry: false,
    },
  );

  const versionsQuery = trpc.workspace.versions.useQuery(
    { pageId: activePageId ?? 0 },
    {
      enabled: Boolean(activePageId),
      retry: false,
    },
  );

  const pollUpdatesQuery = trpc.workspace.pollUpdates.useQuery(
    {
      pageId: activePageId ?? 0,
      sinceVersion: activeVersion,
    },
    {
      enabled: Boolean(activePageId),
      refetchInterval: activePageId ? 1200 : false,
      retry: false,
    },
  );

  const page = pageQuery.data as PageDetails | undefined;
  const versions = (versionsQuery.data as VersionItem[] | undefined) ?? [];
  const pageTree = useMemo(() => buildTree(snapshot?.pageTree ?? []), [snapshot?.pageTree]);

  const createPageMutation = trpc.workspace.createPage.useMutation({
    onSuccess: async createdPage => {
      await utils.workspace.snapshot.invalidate();
      if (createdPage?.id) {
        navigate(`/pages/${createdPage.id}`);
      }
      toast.success("已建立新頁面");
    },
    onError: error => toast.error(error.message),
  });

  const renamePageMutation = trpc.workspace.renamePage.useMutation({
    onSuccess: async () => {
      await utils.workspace.snapshot.invalidate();
      if (activePageId) {
        await utils.workspace.page.invalidate({ pageId: activePageId });
      }
      setRenamingPageId(null);
      toast.success("頁面名稱已更新");
    },
    onError: error => toast.error(error.message),
  });

  const archivePageMutation = trpc.workspace.archivePage.useMutation({
    onSuccess: async () => {
      await utils.workspace.snapshot.invalidate();
      if (activePageId) {
        navigate("/");
      }
      toast.success("頁面已刪除");
    },
    onError: error => toast.error(error.message),
  });

  const movePageMutation = trpc.workspace.movePage.useMutation({
    onMutate: async input => {
      await utils.workspace.snapshot.cancel();
      const previousSnapshot = utils.workspace.snapshot.getData();

      if (previousSnapshot) {
        utils.workspace.snapshot.setData(undefined, {
          ...previousSnapshot,
          pageTree: applyOptimisticPageMove(previousSnapshot.pageTree, input as MovePageInput),
        });
      }

      return { previousSnapshot };
    },
    onSuccess: () => {
      toast.success("頁面順序已更新");
    },
    onError: (error, _input, context) => {
      if (context?.previousSnapshot) {
        utils.workspace.snapshot.setData(undefined, context.previousSnapshot);
      }
      toast.error(error.message);
    },
    onSettled: async () => {
      await utils.workspace.snapshot.invalidate();
    },
  });

  const savePageMutation = trpc.workspace.savePage.useMutation({
    onSuccess: async savedPage => {
      await utils.workspace.snapshot.invalidate();
      if (activePageId) {
        utils.workspace.page.setData({ pageId: activePageId }, savedPage);
        await utils.workspace.versions.invalidate({ pageId: activePageId });
      }
      setActiveVersion(savedPage.contentVersion);
      setSaveState("saved");
      setHasRemoteConflict(false);
      setIsDirty(false);
    },
    onError: error => {
      setSaveState("error");
      toast.error(error.message);
    },
  });

  const inviteMutation = trpc.workspace.inviteCollaborator.useMutation({
    onSuccess: async result => {
      await utils.workspace.page.invalidate({ pageId: activePageId ?? 0 });
      setInviteEmail("");
      toast.success(result.status === "accepted" ? "協作者已加入頁面" : "邀請已送出");
    },
    onError: error => toast.error(error.message),
  });

  const restoreVersionMutation = trpc.workspace.restoreVersion.useMutation({
    onSuccess: async restoredPage => {
      await utils.workspace.page.invalidate({ pageId: restoredPage.id });
      await utils.workspace.versions.invalidate({ pageId: restoredPage.id });
      await utils.workspace.snapshot.invalidate();
      toast.success("版本已還原");
    },
    onError: error => toast.error(error.message),
  });

  const respondInvitationMutation = trpc.workspace.respondToInvitation.useMutation({
    onSuccess: async result => {
      await utils.workspace.snapshot.invalidate();
      if (result.pageId) {
        navigate(`/pages/${result.pageId}`);
      }
      toast.success("邀請狀態已更新");
    },
    onError: error => toast.error(error.message),
  });

  const heartbeatMutation = trpc.workspace.heartbeat.useMutation();

  useEffect(() => {
    if (!page) return;
    setDraftTitle(page.title);
    setDraftDocument(page.document);
    setActiveVersion(page.contentVersion);
    setIsDirty(false);
    setHasRemoteConflict(false);
    setSaveState("idle");
  }, [page?.id, page?.contentVersion]);

  useEffect(() => {
    if (!activePageId || !isDirty || !editorCanWrite(page?.role)) {
      return;
    }

    setSaveState("saving");
    setHasRemoteConflict(false);
    const timer = window.setTimeout(() => {
      savePageMutation.mutate({
        pageId: activePageId,
        title: draftTitle,
        document: draftDocument,
      });
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [activePageId, draftDocument, draftTitle, isDirty, page?.role]);

  useEffect(() => {
    const remoteUpdate = pollUpdatesQuery.data;
    if (!remoteUpdate || !remoteUpdate.hasUpdate || !remoteUpdate.page) {
      return;
    }

    if (isDirty || savePageMutation.isPending) {
      if (!hasRemoteConflict) {
        setHasRemoteConflict(true);
        toast.warning("偵測到其他協作者的新變更，系統會在目前內容儲存後再同步。", {
          id: `page-conflict-${activePageId}`,
        });
      }
      return;
    }

    const updatedPage = remoteUpdate.page as PageDetails;
    setDraftTitle(updatedPage.title);
    setDraftDocument(updatedPage.document);
    setActiveVersion(updatedPage.contentVersion);
    setHasRemoteConflict(false);
    utils.workspace.page.setData({ pageId: updatedPage.id }, updatedPage);
  }, [activePageId, hasRemoteConflict, pollUpdatesQuery.data, isDirty, savePageMutation.isPending, utils.workspace.page]);

  useEffect(() => {
    if (!activePageId) return;

    const sendHeartbeat = () => {
      heartbeatMutation.mutate({
        pageId: activePageId,
        sessionId,
        activeBlockId: focusedBlockId,
        selectionStart: selectionRange.start,
        selectionEnd: selectionRange.end,
      });
    };

    sendHeartbeat();
    const interval = window.setInterval(sendHeartbeat, 5000);
    return () => window.clearInterval(interval);
  }, [activePageId, focusedBlockId, selectionRange.end, selectionRange.start, sessionId]);

  useEffect(() => {
    if (!pendingFocusBlockId.current) return;
    const target = pendingFocusBlockId.current;
    textAreaRefs.current[target]?.focus();
    pendingFocusBlockId.current = null;
  }, [draftDocument]);

  const openPage = (targetPageId: number) => {
    navigate(`/pages/${targetPageId}`);
  };

  const startRename = (targetPageId: number, title: string) => {
    setRenamingPageId(targetPageId);
    setRenameValue(title);
  };

  const submitRename = () => {
    if (!renamingPageId) return;
    renamePageMutation.mutate({
      pageId: renamingPageId,
      title: renameValue,
    });
  };

  const updateBlock = (blockId: string, updater: (block: PageBlock) => PageBlock) => {
    setDraftDocument(previous => ({
      blocks: previous.blocks.map(block => (block.id === blockId ? updater(block) : block)),
    }));
    setIsDirty(true);
  };

  const changeBlockText = (blockId: string, rawText: string) => {
    const shortcut = applyMarkdownShortcut(rawText);
    updateBlock(blockId, block => {
      if (!shortcut) {
        return setBlockText(block, rawText);
      }

      return {
        ...setBlockText(
          {
            ...block,
            type: shortcut.type,
            checked: shortcut.type === "todo" ? false : undefined,
          },
          shortcut.text,
        ),
      };
    });
  };

  const insertBlockAfter = (blockId: string, type: BlockType = "paragraph") => {
    const newBlock = makeBlock(type);
    setDraftDocument(previous => {
      const index = previous.blocks.findIndex(block => block.id === blockId);
      const nextBlocks = [...previous.blocks];
      nextBlocks.splice(index + 1, 0, newBlock);
      return { blocks: nextBlocks };
    });
    pendingFocusBlockId.current = newBlock.id;
    setIsDirty(true);
  };

  const removeBlock = (blockId: string) => {
    setDraftDocument(previous => {
      if (previous.blocks.length === 1) {
        return previous;
      }
      const index = previous.blocks.findIndex(block => block.id === blockId);
      const fallback = previous.blocks[Math.max(0, index - 1)];
      pendingFocusBlockId.current = fallback?.id ?? null;
      return { blocks: previous.blocks.filter(block => block.id !== blockId) };
    });
    setIsDirty(true);
  };

  const sidebarContent = (
    <div className="flex h-full flex-col gap-4">
      <div className="rounded-[1.6rem] border border-white/60 bg-white/70 p-3 shadow-[0_14px_40px_rgba(76,61,43,0.08)] backdrop-blur-xl">
        <div className="mb-3 flex items-center justify-between px-1">
          <div>
            <p className="text-sm font-semibold tracking-tight">文件樹</p>
            <p className="mt-1 text-xs text-muted-foreground">支援巢狀頁面、拖曳排序與快速建立。</p>
          </div>
        </div>
        <Button
          className="h-11 w-full justify-start rounded-2xl"
          onClick={() => createPageMutation.mutate({ parentPageId: null, title: "Untitled" })}
        >
          {createPageMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
          新增頁面
        </Button>
        <div
          data-dropzone="root-page-tree"
          className="mt-3 rounded-2xl border border-dashed border-border/70 px-3 py-2 text-xs text-muted-foreground"
          onDragOver={event => event.preventDefault()}
          onDrop={event => {
            event.preventDefault();
            if (!draggingPageId) return;
            movePageMutation.mutate({
              pageId: draggingPageId,
              parentPageId: null,
              sortOrder: 0,
            });
          }}
        >
          將頁面拖曳到此處，可移回根層級
        </div>
      </div>

      <ScrollArea className="flex-1 rounded-[1.6rem] border border-white/60 bg-white/70 p-3 shadow-[0_14px_40px_rgba(76,61,43,0.08)] backdrop-blur-xl">
        <div className="space-y-1">
          {pageTree.map(node => (
            <TreeItem
              key={node.id}
              node={node}
              activePageId={activePageId}
              draggingPageId={draggingPageId}
              renamingPageId={renamingPageId}
              renameValue={renameValue}
              setRenameValue={setRenameValue}
              setDraggingPageId={setDraggingPageId}
              onCreateChild={targetPageId => createPageMutation.mutate({ parentPageId: targetPageId, title: "Untitled" })}
              onDelete={targetPageId => archivePageMutation.mutate({ pageId: targetPageId })}
              onDropAfter={target => {
                if (!draggingPageId || draggingPageId === target.id) return;
                movePageMutation.mutate({
                  pageId: draggingPageId,
                  parentPageId: target.parentPageId,
                  sortOrder: target.sortOrder + 1,
                });
              }}
              onOpen={openPage}
              onRenameStart={startRename}
              onRenameSubmit={submitRename}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );

  const renderDashboard = () => {
    if (!snapshot) {
      return (
        <div className="flex min-h-[60vh] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      );
    }

    return (
      <div className="grid gap-6 xl:grid-cols-[1.5fr_0.9fr]">
        <div className="space-y-6">
          <Card className="rounded-[2rem] border-white/70 bg-white/80 shadow-[0_24px_80px_rgba(76,61,43,0.10)] backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="font-serif text-4xl tracking-tight">工作區首頁</CardTitle>
              <CardDescription className="text-base leading-8">
                在這裡快速回到最近編輯的頁面，或直接建立新的協作文檔。
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-2 2xl:grid-cols-3">
              {snapshot.recentPages.length === 0 ? (
                <div className="md:col-span-2 xl:col-span-3">
                  <EmptyEditorState onCreate={() => createPageMutation.mutate({ parentPageId: null, title: "Untitled" })} />
                </div>
              ) : (
                snapshot.recentPages.map(recentPage => (
                  <button
                    key={recentPage.id}
                    onClick={() => openPage(recentPage.id)}
                    className="min-h-[230px] rounded-[1.6rem] border border-border/60 bg-background/85 p-5 text-left transition-all hover:-translate-y-0.5 hover:shadow-[0_18px_36px_rgba(76,61,43,0.10)]"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-lg text-primary">
                          {recentPage.icon || "📄"}
                        </div>
                        <div>
                          <p className="font-medium tracking-tight">{recentPage.title}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{recentPage.role}</p>
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <p className="mt-4 line-clamp-3 text-sm leading-7 text-muted-foreground">
                      {recentPage.summary || "尚未填寫摘要。"}
                    </p>
                    <div className="mt-5 flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock3 className="h-3.5 w-3.5" />
                      {formatTime(recentPage.updatedAt)}
                    </div>
                  </button>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="rounded-[2rem] border-white/70 bg-white/80 shadow-[0_24px_80px_rgba(76,61,43,0.10)] backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="font-serif text-2xl">快速入口</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button className="h-11 w-full justify-start rounded-2xl" onClick={() => createPageMutation.mutate({ parentPageId: null, title: "Meeting Notes" })}>
                <CopyPlus className="mr-2 h-4 w-4" />
                建立會議紀錄
              </Button>
              <Button variant="outline" className="h-11 w-full justify-start rounded-2xl border-border/70 bg-white/60" onClick={() => createPageMutation.mutate({ parentPageId: null, title: "Project Brief" })}>
                <Sparkles className="mr-2 h-4 w-4" />
                建立專案簡報草稿
              </Button>
            </CardContent>
          </Card>

          <Card className="rounded-[2rem] border-white/70 bg-white/80 shadow-[0_24px_80px_rgba(76,61,43,0.10)] backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="font-serif text-2xl">待處理邀請</CardTitle>
              <CardDescription>擁有者可以將您加入頁面，並指定為編輯者或檢視者。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {snapshot.pendingInvitations.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border/70 px-4 py-6 text-sm text-muted-foreground">
                  目前沒有待回覆的頁面邀請。
                </div>
              ) : (
                snapshot.pendingInvitations.map(invitation => (
                  <div key={invitation.id} className="rounded-2xl border border-border/60 bg-background/80 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">{invitation.icon || "📄"} {invitation.title}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          來自 {invitation.inviterName || invitation.inviterEmail || "協作者"}，角色：{invitation.role}
                        </p>
                      </div>
                      <Badge variant="outline" className="rounded-full">待回覆</Badge>
                    </div>
                    <div className="mt-4 flex gap-3">
                      <Button className="rounded-xl" size="sm" onClick={() => respondInvitationMutation.mutate({ invitationId: invitation.id, accept: true })}>
                        接受
                      </Button>
                      <Button variant="outline" className="rounded-xl border-border/70 bg-white/70" size="sm" onClick={() => respondInvitationMutation.mutate({ invitationId: invitation.id, accept: false })}>
                        拒絕
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  };

  const renderEditor = () => {
    if (pageQuery.isLoading || !page) {
      return (
        <div className="flex min-h-[60vh] items-center justify-center rounded-[2rem] border border-white/70 bg-white/80 shadow-[0_24px_80px_rgba(76,61,43,0.10)] backdrop-blur-xl">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      );
    }

    return (
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="rounded-[2rem] border-white/70 bg-white/80 shadow-[0_24px_80px_rgba(76,61,43,0.10)] backdrop-blur-xl">
          <CardHeader className="gap-4 border-b border-border/60 pb-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-14 w-14 items-center justify-center rounded-[1.4rem] bg-primary/10 text-2xl text-primary shadow-inner">
                  {page.icon || "📄"}
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Collaborative page</p>
                  <p className="mt-1 text-sm text-muted-foreground">角色：{page.role}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Badge variant="outline" className={`rounded-full border-border/70 px-3 py-1.5 ${saveState === "error" ? "bg-destructive/10 text-destructive" : "bg-white/70"}`}>
                  {saveState === "saving" ? "自動儲存中" : saveState === "saved" ? "已儲存" : saveState === "error" ? "儲存失敗" : "尚未變更"}
                </Badge>
                <Badge variant="outline" className="rounded-full border-border/70 bg-white/70 px-3 py-1.5">版本 {page.latestVersionNumber}</Badge>
              </div>
            </div>
            {hasRemoteConflict ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50/90 px-4 py-3 text-sm text-amber-900">
                偵測到其他協作者的更新，目前內容儲存完成後會自動同步最新狀態。
              </div>
            ) : null}
            <Input
              value={draftTitle}
              onChange={event => {
                setDraftTitle(event.target.value);
                setIsDirty(true);
              }}
              disabled={!editorCanWrite(page.role)}
              className="h-auto border-0 bg-transparent px-0 py-0 font-serif text-4xl tracking-tight shadow-none focus-visible:ring-0"
            />
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            <div className="rounded-[1.5rem] border border-border/60 bg-background/55 p-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium tracking-tight">區塊工具列</p>
                  <p className="mt-1 text-xs text-muted-foreground">快速加入常用區塊，並支援 Markdown 快捷輸入。</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
              {Object.entries(blockTypeLabels).map(([value, label]) => (
                <Button
                  key={value}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-full border-border/70 bg-white/70"
                  onClick={() => {
                    const newBlock = makeBlock(value as BlockType);
                    setDraftDocument(previous => ({ blocks: [...previous.blocks, newBlock] }));
                    pendingFocusBlockId.current = newBlock.id;
                    setIsDirty(true);
                  }}
                  disabled={!editorCanWrite(page.role)}
                >
                  {label}
                </Button>
              ))}
              </div>
            </div>

            <div className="space-y-3">
              {draftDocument.blocks.map((block, index) => {
                const text = getBlockText(block);
                return (
                  <div key={block.id} className="group rounded-[1.5rem] border border-transparent bg-white/30 p-3 transition-colors hover:border-border/60 hover:bg-white/70">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <GripVertical className="h-4 w-4" />
                        <select
                          value={block.type}
                          disabled={!editorCanWrite(page.role)}
                          onChange={event => {
                            updateBlock(block.id, current => ({
                              ...current,
                              type: event.target.value as BlockType,
                              checked: event.target.value === "todo" ? current.checked ?? false : undefined,
                            }));
                          }}
                          className="rounded-xl border border-border/60 bg-white/80 px-2 py-1 text-xs"
                        >
                          {Object.entries(blockTypeLabels).map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                          ))}
                        </select>
                      </div>
                      <div className="flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                        <Button type="button" size="sm" variant="ghost" className="rounded-xl" disabled={!editorCanWrite(page.role)} onClick={() => insertBlockAfter(block.id)}>
                          <Plus className="h-4 w-4" />
                        </Button>
                        <Button type="button" size="sm" variant="ghost" className="rounded-xl text-destructive" disabled={!editorCanWrite(page.role)} onClick={() => removeBlock(block.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    <div className={`flex gap-3 ${block.type === "todo" ? "items-start" : "items-stretch"}`}>
                      {block.type === "todo" ? (
                        <input
                          type="checkbox"
                          checked={Boolean(block.checked)}
                          disabled={!editorCanWrite(page.role)}
                          onChange={event => {
                            updateBlock(block.id, current => ({
                              ...current,
                              checked: event.target.checked,
                            }));
                          }}
                          className="mt-3 h-4 w-4 rounded border-border"
                        />
                      ) : null}

                      {(block.type === "bulleted-list" || block.type === "numbered-list" || block.type === "quote") ? (
                        <div className={`mt-3 text-sm ${block.type === "quote" ? "text-primary" : "text-muted-foreground"}`}>
                          {block.type === "bulleted-list" ? "•" : block.type === "numbered-list" ? `${index + 1}.` : "❝"}
                        </div>
                      ) : null}

                      <Textarea
                        ref={element => {
                          textAreaRefs.current[block.id] = element;
                        }}
                        value={text}
                        readOnly={!editorCanWrite(page.role)}
                        placeholder={blockPlaceholders[block.type]}
                        className={getBlockClassName(block.type, Boolean(block.checked))}
                        rows={Math.max(1, text.split("\n").length)}
                        onFocus={event => {
                          setFocusedBlockId(block.id);
                          setSelectionRange({ start: event.target.selectionStart, end: event.target.selectionEnd });
                        }}
                        onSelect={event => {
                          setFocusedBlockId(block.id);
                          setSelectionRange({ start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd });
                        }}
                        onChange={event => changeBlockText(block.id, event.target.value)}
                        onKeyDown={event => {
                          if (!editorCanWrite(page.role)) return;

                          if (event.key === "Enter" && !event.shiftKey) {
                            event.preventDefault();
                            insertBlockAfter(block.id);
                          }

                          if (event.key === "Backspace" && text.length === 0 && draftDocument.blocks.length > 1) {
                            event.preventDefault();
                            removeBlock(block.id);
                          }
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="rounded-[2rem] border-white/70 bg-white/80 shadow-[0_24px_80px_rgba(76,61,43,0.10)] backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="font-serif text-2xl">協作者與權限</CardTitle>
              <CardDescription>僅擁有者可邀請指定使用者並設定為編輯者或檢視者。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {page.collaborators.map(collaborator => (
                <div key={collaborator.id} className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-background/80 px-4 py-3">
                  <div>
                    <p className="font-medium">{collaborator.name || collaborator.email || `使用者 #${collaborator.id}`}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{collaborator.email || "尚未提供電子郵件"}</p>
                  </div>
                  <Badge variant="outline" className="rounded-full">{collaborator.role}</Badge>
                </div>
              ))}

              {page.role === "擁有者" ? (
                <div className="rounded-2xl border border-border/60 bg-background/70 p-4">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Share2 className="h-4 w-4" />
                    邀請使用者
                  </div>
                  <Input
                    value={inviteEmail}
                    onChange={event => setInviteEmail(event.target.value)}
                    placeholder="name@example.com"
                    className="mt-3 rounded-2xl border-border/70 bg-white/80"
                  />
                  <select
                    value={inviteRole}
                    onChange={event => setInviteRole(event.target.value as CollaboratorRoleLabel)}
                    className="mt-3 h-11 w-full rounded-2xl border border-border/70 bg-white/80 px-3 text-sm"
                  >
                    <option value="編輯者">編輯者</option>
                    <option value="檢視者">檢視者</option>
                  </select>
                  <Button
                    className="mt-3 h-11 w-full rounded-2xl"
                    onClick={() => {
                      if (!activePageId || !inviteEmail) {
                        toast.error("請輸入欲邀請的電子郵件");
                        return;
                      }
                      inviteMutation.mutate({
                        pageId: activePageId,
                        inviteeEmail: inviteEmail,
                        role: inviteRole,
                      });
                    }}
                  >
                    送出邀請
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className="rounded-[2rem] border-white/70 bg-white/80 shadow-[0_24px_80px_rgba(76,61,43,0.10)] backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="font-serif text-2xl">即時協作狀態</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {page.activeEditors.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border/70 px-4 py-6 text-sm text-muted-foreground">目前沒有其他協作者在線上。</div>
              ) : (
                page.activeEditors.map(editor => (
                  <div key={editor.sessionId} className="rounded-2xl border border-border/60 bg-background/75 px-4 py-3">
                    <p className="font-medium">{editor.name || editor.email || `使用者 #${editor.userId}`}</p>
                    <p className="mt-1 text-xs text-muted-foreground">最後同步：{formatTime(editor.lastHeartbeatAt)}</p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="rounded-[2rem] border-white/70 bg-white/80 shadow-[0_24px_80px_rgba(76,61,43,0.10)] backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="font-serif text-2xl">版本紀錄</CardTitle>
              <CardDescription>每次自動儲存都會保留歷史版本，方便日後查閱與還原。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {versions.map(version => (
                <div key={version.id} className="rounded-2xl border border-border/60 bg-background/80 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">版本 {version.versionNumber} · {version.title}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{version.authorName || version.authorEmail || `使用者 #${version.createdByUserId}`} · {formatTime(version.createdAt)}</p>
                    </div>
                    {editorCanWrite(page.role) ? (
                      <Button size="sm" variant="outline" className="rounded-xl border-border/70 bg-white/70" onClick={() => restoreVersionMutation.mutate({ pageId: page.id, versionId: version.id })}>
                        <History className="mr-2 h-4 w-4" />
                        還原
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  };

  return (
    <DashboardLayout brand={renderEditorBrand()} mobileTitle="Atelier Notes" sidebarContent={sidebarContent}>
      {snapshotQuery.isLoading ? (
        <div className="flex min-h-[60vh] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : activePageId ? (
        renderEditor()
      ) : (
        renderDashboard()
      )}
    </DashboardLayout>
  );
}

function getBlockClassName(type: BlockType, checked: boolean) {
  const base = "min-h-[52px] rounded-2xl border border-border/60 bg-white/75 px-4 py-3 text-base leading-8 shadow-none transition-colors focus-visible:ring-0";

  if (type === "heading-1") {
    return `${base} font-serif text-3xl tracking-tight`;
  }

  if (type === "heading-2") {
    return `${base} font-serif text-2xl tracking-tight`;
  }

  if (type === "heading-3") {
    return `${base} text-xl font-semibold tracking-tight`;
  }

  if (type === "quote") {
    return `${base} border-l-4 border-l-primary bg-primary/5 text-primary`;
  }

  if (type === "code") {
    return `${base} bg-[#1f1c1a] font-mono text-sm text-white`;
  }

  if (type === "todo" && checked) {
    return `${base} text-muted-foreground line-through`;
  }

  return base;
}

type TreeItemProps = {
  node: TreeNode;
  activePageId?: number;
  draggingPageId: number | null;
  renamingPageId: number | null;
  renameValue: string;
  setRenameValue: (value: string) => void;
  setDraggingPageId: (value: number | null) => void;
  onCreateChild: (pageId: number) => void;
  onDelete: (pageId: number) => void;
  onDropAfter: (node: TreeNode) => void;
  onOpen: (pageId: number) => void;
  onRenameStart: (pageId: number, title: string) => void;
  onRenameSubmit: () => void;
};

function TreeItem({
  node,
  activePageId,
  draggingPageId,
  renamingPageId,
  renameValue,
  setRenameValue,
  setDraggingPageId,
  onCreateChild,
  onDelete,
  onDropAfter,
  onOpen,
  onRenameStart,
  onRenameSubmit,
}: TreeItemProps) {
  const isActive = activePageId === node.id;
  const isRenaming = renamingPageId === node.id;

  return (
    <div className="space-y-1">
      <div
        draggable
        data-page-id={node.id}
        data-page-depth={node.depth}
        data-parent-page-id={node.parentPageId ?? "root"}
        onDragStart={() => setDraggingPageId(node.id)}
        onDragEnd={() => setDraggingPageId(null)}
        onDragOver={event => event.preventDefault()}
        onDrop={event => {
          event.preventDefault();
          if (!draggingPageId) return;
          onDropAfter(node);
        }}
        className={`group flex items-center gap-2 rounded-2xl px-3 py-2 transition-all ${isActive ? "bg-primary text-primary-foreground shadow-[0_16px_30px_rgba(107,84,51,0.24)]" : "hover:bg-accent/70"}`}
        style={{ marginLeft: `${node.depth * 10}px` }}
      >
        <GripVertical className={`h-4 w-4 shrink-0 ${isActive ? "text-primary-foreground/80" : "text-muted-foreground"}`} />
        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onOpen(node.id)} onDoubleClick={() => onRenameStart(node.id, node.title)}>
          {isRenaming ? (
            <Input
              value={renameValue}
              autoFocus
              onChange={event => setRenameValue(event.target.value)}
              onBlur={onRenameSubmit}
              onKeyDown={event => {
                if (event.key === "Enter") {
                  onRenameSubmit();
                }
              }}
              className="h-8 rounded-xl border-white/40 bg-white/90 text-sm text-foreground"
            />
          ) : (
            <div className="truncate text-sm font-medium tracking-tight">
              <span className="mr-2">{node.icon || "📄"}</span>
              {node.title}
            </div>
          )}
        </button>
        <div className="hidden items-center gap-1 group-hover:flex">
          <Button type="button" size="sm" variant="ghost" aria-label={`為 ${node.title} 建立子頁`} className={`h-8 w-8 rounded-xl p-0 ${isActive ? "hover:bg-white/20" : ""}`} onClick={() => onCreateChild(node.id)}>
            <Plus className="h-4 w-4" />
          </Button>
          <Button type="button" size="sm" variant="ghost" aria-label={`刪除 ${node.title}`} className={`h-8 w-8 rounded-xl p-0 ${isActive ? "hover:bg-white/20" : "text-destructive"}`} onClick={() => onDelete(node.id)}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {node.children.length > 0 ? (
        <div className="space-y-1">
          {node.children.map(child => (
            <TreeItem
              key={child.id}
              node={child}
              activePageId={activePageId}
              draggingPageId={draggingPageId}
              renamingPageId={renamingPageId}
              renameValue={renameValue}
              setRenameValue={setRenameValue}
              setDraggingPageId={setDraggingPageId}
              onCreateChild={onCreateChild}
              onDelete={onDelete}
              onDropAfter={onDropAfter}
              onOpen={onOpen}
              onRenameStart={onRenameStart}
              onRenameSubmit={onRenameSubmit}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
