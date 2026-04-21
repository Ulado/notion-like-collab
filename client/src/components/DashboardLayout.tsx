import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { getLoginUrl } from "@/const";
import { useIsMobile } from "@/hooks/useMobile";
import { LogOut, PanelLeft } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";

type DashboardLayoutProps = {
  children: ReactNode;
  sidebarContent: ReactNode;
  brand: ReactNode;
  mobileTitle: string;
};

const SIDEBAR_WIDTH_KEY = "workspace-sidebar-width";
const DEFAULT_WIDTH = 300;
const MIN_WIDTH = 240;
const MAX_WIDTH = 420;

export default function DashboardLayout({
  children,
  sidebarContent,
  brand,
  mobileTitle,
}: DashboardLayoutProps) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });
  const { loading, user } = useAuth();

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
  }, [sidebarWidth]);

  if (loading) {
    return <DashboardLayoutSkeleton />;
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,rgba(173,154,119,0.15),transparent_34%),linear-gradient(180deg,#fbfaf7_0%,#f5efe5_100%)] px-6 py-16 text-foreground">
        <div className="w-full max-w-lg rounded-[2rem] border border-white/60 bg-white/80 p-10 text-center shadow-[0_24px_80px_rgba(76,61,43,0.14)] backdrop-blur-xl">
          <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-xl font-semibold text-primary">
            ✦
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">進入協作工作區</h1>
          <p className="mt-4 text-sm leading-7 text-muted-foreground">
            請先使用 Manus OAuth 登入，即可存取您被授權的頁面、版本紀錄與多人協作編輯能力。
          </p>
          <Button
            onClick={() => {
              window.location.href = getLoginUrl();
            }}
            size="lg"
            className="mt-8 h-12 w-full rounded-2xl shadow-[0_16px_40px_rgba(94,70,37,0.22)]"
          >
            使用 Manus OAuth 登入
          </Button>
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": `${sidebarWidth}px`,
        } as CSSProperties
      }
    >
      <DashboardLayoutContent
        brand={brand}
        mobileTitle={mobileTitle}
        setSidebarWidth={setSidebarWidth}
        sidebarContent={sidebarContent}
      >
        {children}
      </DashboardLayoutContent>
    </SidebarProvider>
  );
}

type DashboardLayoutContentProps = {
  children: ReactNode;
  sidebarContent: ReactNode;
  brand: ReactNode;
  mobileTitle: string;
  setSidebarWidth: (width: number) => void;
};

function DashboardLayoutContent({
  children,
  sidebarContent,
  brand,
  mobileTitle,
  setSidebarWidth,
}: DashboardLayoutContentProps) {
  const { user, logout } = useAuth();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const isMobile = useIsMobile();
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isCollapsed) {
      setIsResizing(false);
    }
  }, [isCollapsed]);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!isResizing) return;
      const sidebarLeft = sidebarRef.current?.getBoundingClientRect().left ?? 0;
      const nextWidth = event.clientX - sidebarLeft;
      if (nextWidth >= MIN_WIDTH && nextWidth <= MAX_WIDTH) {
        setSidebarWidth(nextWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, setSidebarWidth]);

  return (
    <>
      <div className="relative" ref={sidebarRef}>
        <Sidebar collapsible="icon" className="border-r border-sidebar-border/70 bg-sidebar/90 backdrop-blur-xl" disableTransition={isResizing}>
          <SidebarHeader className="border-b border-sidebar-border/60 px-4 py-4">
            <div className="flex items-center gap-3">
              <button
                onClick={toggleSidebar}
                className="flex h-10 w-10 items-center justify-center rounded-2xl border border-border/60 bg-background/80 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="切換側邊欄"
              >
                <PanelLeft className="h-4 w-4" />
              </button>
              {!isCollapsed ? <div className="min-w-0 flex-1">{brand}</div> : null}
            </div>
          </SidebarHeader>
          <SidebarContent className="px-3 py-4">{sidebarContent}</SidebarContent>
          <SidebarFooter className="border-t border-sidebar-border/60 p-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex w-full items-center gap-3 rounded-2xl border border-border/60 bg-background/70 px-3 py-3 text-left transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-data-[collapsible=icon]:justify-center">
                  <Avatar className="h-10 w-10 border border-border/70 bg-primary/10">
                    <AvatarFallback className="bg-primary/10 text-sm font-semibold text-primary">
                      {user?.name?.charAt(0).toUpperCase() || "U"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
                    <p className="truncate text-sm font-medium">{user?.name || "未命名使用者"}</p>
                    <p className="mt-1 truncate text-xs text-muted-foreground">{user?.email || "尚未提供電子郵件"}</p>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 rounded-2xl">
                <DropdownMenuItem
                  onClick={logout}
                  className="cursor-pointer rounded-xl text-destructive focus:text-destructive"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  登出
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarFooter>
        </Sidebar>
        <div
          className={`absolute right-0 top-0 h-full w-1 cursor-col-resize transition-colors hover:bg-primary/20 ${isCollapsed ? "hidden" : ""}`}
          onMouseDown={() => {
            if (!isCollapsed) {
              setIsResizing(true);
            }
          }}
          style={{ zIndex: 50 }}
        />
      </div>

      <SidebarInset className="bg-[radial-gradient(circle_at_top,rgba(207,187,148,0.18),transparent_20%),linear-gradient(180deg,#fbfaf7_0%,#f3eee5_100%)]">
        {isMobile ? (
          <div className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-border/60 bg-background/90 px-3 backdrop-blur-xl">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="h-10 w-10 rounded-2xl border border-border/60 bg-background text-foreground" />
              <div>
                <p className="text-sm font-medium tracking-tight">{mobileTitle}</p>
                <p className="text-xs text-muted-foreground">多人協作文件平台</p>
              </div>
            </div>
          </div>
        ) : null}
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </SidebarInset>
    </>
  );
}
