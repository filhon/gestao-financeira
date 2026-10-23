"use client";

/**
 * ResponsiveModal
 *
 * Desktop → Dialog (centered modal)
 * Mobile  → Sheet side="bottom" (bottom drawer, drag-friendly)
 * `panel` → Sheet side="right" no desktop (painel lateral que mantém a lista
 *           visível ao lado)
 *
 * API mirrors Dialog exactly so migration is a find-and-replace:
 *   Dialog            → ResponsiveModal
 *   DialogContent     → ResponsiveModalContent
 *   DialogHeader      → ResponsiveModalHeader
 *   DialogFooter      → ResponsiveModalFooter
 *   DialogTitle       → ResponsiveModalTitle
 *   DialogDescription → ResponsiveModalDescription
 *   DialogClose       → ResponsiveModalClose
 *   DialogTrigger     → ResponsiveModalTrigger  (optional — same Radix primitive)
 */

import * as React from "react";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

// ─── Context ─────────────────────────────────────────────────────────────────

const ResponsiveModalContext = React.createContext<{
  sheet: boolean;
  side: "bottom" | "right";
}>({ sheet: false, side: "bottom" });

function useResponsiveModal() {
  return React.useContext(ResponsiveModalContext);
}

// ─── Root ─────────────────────────────────────────────────────────────────────

interface ResponsiveModalProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
  /** No desktop, abre como painel lateral em vez de modal centralizado. */
  panel?: boolean;
}

function ResponsiveModal({
  children,
  panel = false,
  ...props
}: ResponsiveModalProps) {
  const isMobile = useMediaQuery("(max-width: 767px)");
  const sheet = isMobile || panel;
  const Root = sheet ? Sheet : Dialog;
  const value = React.useMemo(
    () => ({
      sheet,
      side: isMobile ? ("bottom" as const) : ("right" as const),
    }),
    [sheet, isMobile],
  );
  return (
    <ResponsiveModalContext.Provider value={value}>
      <Root {...props}>{children}</Root>
    </ResponsiveModalContext.Provider>
  );
}

// ─── Trigger ─────────────────────────────────────────────────────────────────
// Sheet and Dialog both use @radix-ui/react-dialog under the hood, so the
// trigger primitive is the same. We keep both for symmetry.

function ResponsiveModalTrigger(
  props: React.ComponentProps<typeof DialogTrigger>,
) {
  const { sheet } = useResponsiveModal();
  const Trigger = sheet ? SheetTrigger : DialogTrigger;
  return <Trigger {...props} />;
}

// ─── Content ─────────────────────────────────────────────────────────────────

interface ResponsiveModalContentProps
  extends React.ComponentProps<typeof DialogContent> {
  /** Extra class applied only on the bottom sheet (mobile). */
  sheetClassName?: string;
}

function ResponsiveModalContent({
  className,
  sheetClassName,
  children,
  ...props
}: ResponsiveModalContentProps) {
  const { sheet, side } = useResponsiveModal();

  if (sheet && side === "right") {
    return (
      <SheetContent
        side="right"
        overlayClassName="bg-black/15"
        className={cn(
          "w-full sm:max-w-xl lg:max-w-2xl overflow-y-auto px-6 pb-6 pt-5",
          sheetClassName,
        )}
        {...props}
      >
        {children}
      </SheetContent>
    );
  }

  if (sheet) {
    return (
      <SheetContent
        side="bottom"
        className={cn(
          "rounded-t-2xl max-h-[92dvh] overflow-y-auto px-4 pb-6 pt-3",
          sheetClassName,
        )}
        {...props}
      >
        {/* Drag handle indicator */}
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-muted-foreground/25 shrink-0" />
        {children}
      </SheetContent>
    );
  }

  return (
    <DialogContent className={className} {...props}>
      {children}
    </DialogContent>
  );
}

// ─── Header ───────────────────────────────────────────────────────────────────

function ResponsiveModalHeader(props: React.ComponentProps<"div">) {
  const { sheet } = useResponsiveModal();
  const Header = sheet ? SheetHeader : DialogHeader;
  return <Header {...props} />;
}

// ─── Footer ───────────────────────────────────────────────────────────────────

function ResponsiveModalFooter(props: React.ComponentProps<"div">) {
  const { sheet } = useResponsiveModal();
  const Footer = sheet ? SheetFooter : DialogFooter;
  return <Footer {...props} />;
}

// ─── Title ────────────────────────────────────────────────────────────────────

function ResponsiveModalTitle(props: React.ComponentProps<typeof DialogTitle>) {
  const { sheet } = useResponsiveModal();
  const Title = sheet ? SheetTitle : DialogTitle;
  return <Title {...props} />;
}

// ─── Description ──────────────────────────────────────────────────────────────

function ResponsiveModalDescription(
  props: React.ComponentProps<typeof DialogDescription>,
) {
  const { sheet } = useResponsiveModal();
  const Description = sheet ? SheetDescription : DialogDescription;
  return <Description {...props} />;
}

// ─── Close ────────────────────────────────────────────────────────────────────

function ResponsiveModalClose(props: React.ComponentProps<typeof DialogClose>) {
  const { sheet } = useResponsiveModal();
  const Close = sheet ? SheetClose : DialogClose;
  return <Close {...props} />;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export {
  ResponsiveModal,
  ResponsiveModalTrigger,
  ResponsiveModalContent,
  ResponsiveModalHeader,
  ResponsiveModalFooter,
  ResponsiveModalTitle,
  ResponsiveModalDescription,
  ResponsiveModalClose,
};
