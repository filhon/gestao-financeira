"use client";

/**
 * ResponsiveModal
 *
 * Desktop → Dialog (centered modal)
 * Mobile  → Sheet side="bottom" (bottom drawer, drag-friendly)
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

const ResponsiveModalContext = React.createContext(false);

function useResponsiveModal() {
  return React.useContext(ResponsiveModalContext);
}

// ─── Root ─────────────────────────────────────────────────────────────────────

interface ResponsiveModalProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}

function ResponsiveModal({ children, ...props }: ResponsiveModalProps) {
  const isMobile = useMediaQuery("(max-width: 767px)");
  const Root = isMobile ? Sheet : Dialog;
  return (
    <ResponsiveModalContext.Provider value={isMobile}>
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
  const isMobile = useResponsiveModal();
  const Trigger = isMobile ? SheetTrigger : DialogTrigger;
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
  const isMobile = useResponsiveModal();

  if (isMobile) {
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
  const isMobile = useResponsiveModal();
  const Header = isMobile ? SheetHeader : DialogHeader;
  return <Header {...props} />;
}

// ─── Footer ───────────────────────────────────────────────────────────────────

function ResponsiveModalFooter(props: React.ComponentProps<"div">) {
  const isMobile = useResponsiveModal();
  const Footer = isMobile ? SheetFooter : DialogFooter;
  return <Footer {...props} />;
}

// ─── Title ────────────────────────────────────────────────────────────────────

function ResponsiveModalTitle(props: React.ComponentProps<typeof DialogTitle>) {
  const isMobile = useResponsiveModal();
  const Title = isMobile ? SheetTitle : DialogTitle;
  return <Title {...props} />;
}

// ─── Description ──────────────────────────────────────────────────────────────

function ResponsiveModalDescription(
  props: React.ComponentProps<typeof DialogDescription>,
) {
  const isMobile = useResponsiveModal();
  const Description = isMobile ? SheetDescription : DialogDescription;
  return <Description {...props} />;
}

// ─── Close ────────────────────────────────────────────────────────────────────

function ResponsiveModalClose(props: React.ComponentProps<typeof DialogClose>) {
  const isMobile = useResponsiveModal();
  const Close = isMobile ? SheetClose : DialogClose;
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
