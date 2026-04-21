export const COLLABORATOR_ROLE_LABELS = ["擁有者", "編輯者", "檢視者"] as const;

export type CollaboratorRoleLabel = typeof COLLABORATOR_ROLE_LABELS[number];

export const BLOCK_TYPES = [
  "heading-1",
  "heading-2",
  "heading-3",
  "paragraph",
  "todo",
  "bulleted-list",
  "numbered-list",
  "quote",
  "code",
] as const;

export type BlockType = typeof BLOCK_TYPES[number];

export type RichTextSpan = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  code?: boolean;
};

export type PageBlock = {
  id: string;
  type: BlockType;
  checked?: boolean;
  language?: string;
  level?: number;
  spans: RichTextSpan[];
};

export type PageDocument = {
  blocks: PageBlock[];
};

export type PageTreeNode = {
  id: number;
  title: string;
  icon: string | null;
  parentPageId: number | null;
  sortOrder: number;
  depth: number;
  role: CollaboratorRoleLabel;
  children: PageTreeNode[];
};

export const DEFAULT_PAGE_DOCUMENT: PageDocument = {
  blocks: [
    {
      id: "block-welcome",
      type: "heading-1",
      spans: [{ text: "Untitled" }],
    },
    {
      id: "block-intro",
      type: "paragraph",
      spans: [{ text: "Write something beautiful together." }],
    },
  ],
};

export const MARKDOWN_SHORTCUTS = [
  { match: /^#\s/, type: "heading-1" },
  { match: /^##\s/, type: "heading-2" },
  { match: /^###\s/, type: "heading-3" },
  { match: /^-\s/, type: "bulleted-list" },
  { match: /^\d+\.\s/, type: "numbered-list" },
  { match: /^\[\s\]\s/, type: "todo" },
  { match: /^>\s/, type: "quote" },
  { match: /^```/, type: "code" },
] as const;
