import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  serverTimestamp,
  Timestamp,
  DocumentData,
  runTransaction,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import {
  ReimbursementReport,
  ReimbursementReportStatus,
  Transaction,
  Entity,
  Company,
} from "@/lib/types";
import { format } from "date-fns";
import { formatCurrency } from "@/lib/utils";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

const COLLECTION = "reimbursement_reports";

// ─── Date conversion helpers ──────────────────────────────────────────────────

const convertDates = (data: DocumentData): ReimbursementReport => {
  return {
    id: data.id,
    ...data,
    periodStart: (data.periodStart as Timestamp)?.toDate(),
    periodEnd: (data.periodEnd as Timestamp)?.toDate(),
    approvalTokenExpiresAt: data.approvalTokenExpiresAt
      ? (data.approvalTokenExpiresAt as Timestamp)?.toDate()
      : undefined,
    approvedAt: (data.approvedAt as Timestamp)?.toDate(),
    rejectedAt: (data.rejectedAt as Timestamp)?.toDate(),
    paidAt: (data.paidAt as Timestamp)?.toDate(),
    createdAt: (data.createdAt as Timestamp)?.toDate(),
    updatedAt: (data.updatedAt as Timestamp)?.toDate(),
  } as ReimbursementReport;
};

// ─── Font cache (Inter, same as reportService) ────────────────────────────────

let interFontCache: string | null = null;

const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
};

const ensureInterFont = async (doc: jsPDF): Promise<boolean> => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fontList = (doc as any).getFontList?.() ?? {};
    if (fontList.Inter) return true;

    if (!interFontCache) {
      const res = await fetch("/fonts/Inter-Regular.ttf?v=4.1", {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Font load failed");
      interFontCache = arrayBufferToBase64(await res.arrayBuffer());
    }

    doc.addFileToVFS("Inter-Regular.ttf", interFontCache);
    doc.addFont("Inter-Regular.ttf", "Inter", "normal", "Identity-H");
    doc.addFont("Inter-Regular.ttf", "Inter", "bold", "Identity-H");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return !!((doc as any).getFontList?.() ?? {}).Inter;
  } catch {
    return false;
  }
};

// ─── Status labels ────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<ReimbursementReportStatus, string> = {
  draft: "Rascunho",
  pending_approval: "Aguardando Aprovação",
  approved: "Aprovado",
  paid: "Pago",
  rejected: "Rejeitado",
};

const TX_STATUS_LABEL: Record<string, string> = {
  paid: "Pago",
  approved: "Aprovado",
  pending_approval: "Pend. Aprov.",
  pending_authorization: "Pend. Autor.",
  authorized: "Autorizado",
  draft: "Rascunho",
  rejected: "Rejeitado",
};

// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

export const reimbursementReportService = {
  // ── Get next RD number (atomic increment) ────────────────────────────────
  getNextRdNumber: async (
    companyId: string,
  ): Promise<{ rdNumber: string; rdSequence: number }> => {
    const companyRef = doc(db, "companies", companyId);
    let nextSeq = 1;

    await runTransaction(db, async (txn) => {
      const snap = await txn.get(companyRef);
      if (!snap.exists()) throw new Error("Company not found");
      const current = (snap.data().rdCounter as number) ?? 0;
      nextSeq = current + 1;
      txn.update(companyRef, { rdCounter: nextSeq });
    });

    const rdNumber = `RD-${String(nextSeq).padStart(4, "0")}`;
    return { rdNumber, rdSequence: nextSeq };
  },

  // ── Create ────────────────────────────────────────────────────────────────
  create: async (
    data: {
      employeeId: string;
      employeeName: string;
      employeeDocument?: string;
      employeeEmail?: string;
      periodStart: Date;
      periodEnd: Date;
      transactionIds: string[];
      totalAmount: number;
      notes?: string;
    },
    user: { uid: string; email: string },
    companyId: string,
  ): Promise<ReimbursementReport> => {
    const { rdNumber, rdSequence } =
      await reimbursementReportService.getNextRdNumber(companyId);

    const docRef = await addDoc(collection(db, COLLECTION), {
      companyId,
      rdNumber,
      rdSequence,
      employeeId: data.employeeId,
      employeeName: data.employeeName,
      ...(data.employeeDocument
        ? { employeeDocument: data.employeeDocument }
        : {}),
      ...(data.employeeEmail ? { employeeEmail: data.employeeEmail } : {}),
      periodStart: Timestamp.fromDate(data.periodStart),
      periodEnd: Timestamp.fromDate(data.periodEnd),
      transactionIds: data.transactionIds,
      totalAmount: data.totalAmount,
      status: "draft",
      ...(data.notes ? { notes: data.notes } : {}),
      createdBy: user.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const snap = await getDoc(docRef);
    return convertDates({ id: snap.id, ...snap.data()! });
  },

  // ── Get all for company ───────────────────────────────────────────────────
  getAll: async (
    companyId: string,
    filters?: {
      employeeId?: string;
      status?: ReimbursementReportStatus;
    },
  ): Promise<ReimbursementReport[]> => {
    let q = query(
      collection(db, COLLECTION),
      where("companyId", "==", companyId),
      orderBy("createdAt", "desc"),
    );

    if (filters?.employeeId) {
      q = query(q, where("employeeId", "==", filters.employeeId));
    }
    if (filters?.status) {
      q = query(q, where("status", "==", filters.status));
    }

    const snapshot = await getDocs(q);
    return snapshot.docs.map((d) => convertDates({ id: d.id, ...d.data() }));
  },

  // ── Get by ID ─────────────────────────────────────────────────────────────
  getById: async (id: string): Promise<ReimbursementReport | null> => {
    const snap = await getDoc(doc(db, COLLECTION, id));
    if (!snap.exists()) return null;
    return convertDates({ id: snap.id, ...snap.data() });
  },

  // ── Get by approval token (magic link) ───────────────────────────────────
  getByToken: async (token: string): Promise<ReimbursementReport | null> => {
    const q = query(
      collection(db, COLLECTION),
      where("approvalToken", "==", token),
    );
    const snap = await getDocs(q);
    if (snap.empty) return null;
    const d = snap.docs[0];
    return convertDates({ id: d.id, ...d.data() });
  },

  // ── Send for approval ─────────────────────────────────────────────────────
  sendForApproval: async (
    reportId: string,
    approverEmail: string,
  ): Promise<void> => {
    const token = crypto.randomUUID();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await updateDoc(doc(db, COLLECTION, reportId), {
      status: "pending_approval",
      approverEmail,
      approvalToken: token,
      approvalTokenExpiresAt: Timestamp.fromDate(expiresAt),
      updatedAt: serverTimestamp(),
    });
  },

  // ── Approve by token ──────────────────────────────────────────────────────
  approveByToken: async (
    token: string,
  ): Promise<{ success: boolean; error?: string }> => {
    const report = await reimbursementReportService.getByToken(token);
    if (!report)
      return { success: false, error: "Token inválido ou expirado." };
    if (report.status !== "pending_approval")
      return {
        success: false,
        error: "Este relatório não está aguardando aprovação.",
      };
    if (
      report.approvalTokenExpiresAt &&
      report.approvalTokenExpiresAt < new Date()
    )
      return { success: false, error: "O link de aprovação expirou." };

    await updateDoc(doc(db, COLLECTION, report.id), {
      status: "approved",
      approvalToken: null,
      approvalTokenExpiresAt: null,
      approvedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    return { success: true };
  },

  // ── Reject by token ───────────────────────────────────────────────────────
  rejectByToken: async (
    token: string,
    reason: string,
  ): Promise<{ success: boolean; error?: string }> => {
    const report = await reimbursementReportService.getByToken(token);
    if (!report)
      return { success: false, error: "Token inválido ou expirado." };
    if (report.status !== "pending_approval")
      return {
        success: false,
        error: "Este relatório não está aguardando aprovação.",
      };

    await updateDoc(doc(db, COLLECTION, report.id), {
      status: "rejected",
      approvalToken: null,
      approvalTokenExpiresAt: null,
      rejectedAt: serverTimestamp(),
      rejectionReason: reason,
      updatedAt: serverTimestamp(),
    });

    return { success: true };
  },

  // ── Approve directly (by authenticated user) ──────────────────────────────
  approve: async (reportId: string, userId: string): Promise<void> => {
    await updateDoc(doc(db, COLLECTION, reportId), {
      status: "approved",
      approvalToken: null,
      approvalTokenExpiresAt: null,
      approvedBy: userId,
      approvedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  },

  // ── Reject directly (by authenticated user) ───────────────────────────────
  reject: async (
    reportId: string,
    userId: string,
    reason: string,
  ): Promise<void> => {
    await updateDoc(doc(db, COLLECTION, reportId), {
      status: "rejected",
      approvalToken: null,
      approvalTokenExpiresAt: null,
      rejectedBy: userId,
      rejectedAt: serverTimestamp(),
      rejectionReason: reason,
      updatedAt: serverTimestamp(),
    });
  },

  // ── Mark as paid ──────────────────────────────────────────────────────────
  markAsPaid: async (reportId: string, userId: string): Promise<void> => {
    await updateDoc(doc(db, COLLECTION, reportId), {
      status: "paid",
      paidBy: userId,
      paidAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  },

  // ── Revert to draft ───────────────────────────────────────────────────────
  revertToDraft: async (reportId: string): Promise<void> => {
    await updateDoc(doc(db, COLLECTION, reportId), {
      status: "draft",
      approvalToken: null,
      approvalTokenExpiresAt: null,
      approverEmail: null,
      updatedAt: serverTimestamp(),
    });
  },

  // ── Delete (draft only) ───────────────────────────────────────────────────
  delete: async (reportId: string): Promise<void> => {
    await deleteDoc(doc(db, COLLECTION, reportId));
  },

  // ─────────────────────────────────────────────────────────────────────────
  // PDF Generation
  // ─────────────────────────────────────────────────────────────────────────
  generatePDF: async (
    report: ReimbursementReport,
    transactions: Transaction[],
    employee: Entity,
    company: Company,
  ): Promise<void> => {
    const doc = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
    });
    const useInter = await ensureInterFont(doc);
    const font = useInter ? "Inter" : "helvetica";

    const PAGE_W = doc.internal.pageSize.getWidth(); // 210
    const PAGE_H = doc.internal.pageSize.getHeight(); // 297
    const MARGIN = 15;
    const USABLE_W = PAGE_W - MARGIN * 2;

    // ── Palette ──────────────────────────────────────────────────────────────
    const NAVY = [15, 23, 42] as [number, number, number];
    const GREEN_600 = [22, 163, 74] as [number, number, number];
    const SLATE_50 = [248, 250, 252] as [number, number, number];
    const SLATE_300 = [203, 213, 225] as [number, number, number];
    const SLATE_600 = [71, 85, 105] as [number, number, number];
    const WHITE = [255, 255, 255] as [number, number, number];
    const GRAY_400 = [156, 163, 175] as [number, number, number];
    const GRAY_300 = [209, 213, 219] as [number, number, number];
    const AMBER_600 = [217, 119, 6] as [number, number, number];
    const RED_600 = [220, 38, 38] as [number, number, number];
    const LINK_BLUE = [37, 99, 235] as [number, number, number];

    const fillRGB = (c: [number, number, number]) =>
      doc.setFillColor(c[0], c[1], c[2]);
    const drawRGB = (c: [number, number, number]) =>
      doc.setDrawColor(c[0], c[1], c[2]);
    const textRGB = (c: [number, number, number]) =>
      doc.setTextColor(c[0], c[1], c[2]);

    const statusColor: [number, number, number] =
      report.status === "approved" || report.status === "paid"
        ? GREEN_600
        : report.status === "rejected"
          ? RED_600
          : AMBER_600;

    // ────────────────────────────────────────────────────────────────────────
    // CAPA
    // ────────────────────────────────────────────────────────────────────────

    // Header block
    fillRGB(NAVY);
    doc.rect(0, 0, PAGE_W, 48, "F");
    fillRGB(GREEN_600);
    doc.rect(0, 46, PAGE_W, 2, "F");

    // Company name
    doc.setFont(font, "normal");
    doc.setFontSize(7.5);
    textRGB(GRAY_400);
    doc.text(company.name.toUpperCase(), MARGIN, 11);

    // RD number — large
    doc.setFont(font, "bold");
    doc.setFontSize(22);
    textRGB(WHITE);
    doc.text(report.rdNumber, MARGIN, 30);

    // Title
    doc.setFont(font, "normal");
    doc.setFontSize(9);
    textRGB(GRAY_300);
    doc.text("RELATÓRIO DE DESPESAS", MARGIN, 40);

    // Generated date — right
    doc.setFont(font, "normal");
    doc.setFontSize(7.5);
    textRGB(GRAY_300);
    doc.text(
      `Gerado em: ${format(new Date(), "dd/MM/yyyy 'às' HH:mm")}`,
      PAGE_W - MARGIN,
      40,
      { align: "right" },
    );

    // ── Status badge ─────────────────────────────────────────────────────────
    const statusText = STATUS_LABEL[report.status];
    const statusBadgeX = PAGE_W - MARGIN - 36;
    fillRGB(statusColor);
    doc.roundedRect(statusBadgeX, 9, 38, 9, 2, 2, "F");
    doc.setFont(font, "bold");
    doc.setFontSize(8);
    textRGB(WHITE);
    doc.text(statusText, statusBadgeX + 19, 14.5, { align: "center" });

    // ── Info cards ───────────────────────────────────────────────────────────
    let y = 58;
    const cardH = 32;
    const cardGap = 4;
    const halfW = (USABLE_W - cardGap) / 2;

    // Employee card
    fillRGB(SLATE_50);
    drawRGB(SLATE_300);
    doc.setLineWidth(0.3);
    doc.roundedRect(MARGIN, y, halfW, cardH, 2, 2, "FD");
    fillRGB(NAVY);
    doc.rect(MARGIN, y, 2.5, cardH, "F");

    doc.setFont(font, "normal");
    doc.setFontSize(7);
    textRGB(SLATE_600);
    doc.text("FUNCIONÁRIO", MARGIN + 6, y + 8);
    doc.setFont(font, "bold");
    doc.setFontSize(10);
    textRGB(NAVY);
    doc.text(employee.name, MARGIN + 6, y + 17, { maxWidth: halfW - 10 });
    if (employee.document) {
      doc.setFont(font, "normal");
      doc.setFontSize(8);
      textRGB(SLATE_600);
      doc.text(`CPF: ${employee.document}`, MARGIN + 6, y + 26);
    }

    // Period card
    const card2X = MARGIN + halfW + cardGap;
    fillRGB(SLATE_50);
    drawRGB(SLATE_300);
    doc.roundedRect(card2X, y, halfW, cardH, 2, 2, "FD");
    fillRGB(GREEN_600);
    doc.rect(card2X, y, 2.5, cardH, "F");

    doc.setFont(font, "normal");
    doc.setFontSize(7);
    textRGB(SLATE_600);
    doc.text("PERÍODO DE REFERÊNCIA", card2X + 6, y + 8);
    doc.setFont(font, "bold");
    doc.setFontSize(10);
    textRGB(NAVY);
    doc.text(
      `${format(report.periodStart, "dd/MM/yyyy")} — ${format(report.periodEnd, "dd/MM/yyyy")}`,
      card2X + 6,
      y + 17,
    );
    doc.setFont(font, "normal");
    doc.setFontSize(8);
    textRGB(SLATE_600);
    doc.text(`${transactions.length} lançamento(s)`, card2X + 6, y + 26);

    // ── Total amount highlight ────────────────────────────────────────────────
    y += cardH + 8;
    const totalH = 22;
    fillRGB(NAVY);
    doc.setLineWidth(0);
    doc.roundedRect(MARGIN, y, USABLE_W, totalH, 2, 2, "F");
    fillRGB(GREEN_600);
    doc.rect(MARGIN, y, 3, totalH, "F");

    doc.setFont(font, "normal");
    doc.setFontSize(8);
    textRGB(GRAY_400);
    doc.text("TOTAL DO REEMBOLSO", MARGIN + 8, y + 7);
    doc.setFont(font, "bold");
    doc.setFontSize(14);
    textRGB([134, 239, 172]);
    doc.text(formatCurrency(report.totalAmount), MARGIN + 8, y + 17);

    // Notes
    if (report.notes) {
      y += totalH + 8;
      doc.setFont(font, "normal");
      doc.setFontSize(8.5);
      textRGB(SLATE_600);
      doc.text("Observações:", MARGIN, y);
      y += 5;
      doc.setFontSize(8);
      textRGB(NAVY);
      const lines = doc.splitTextToSize(report.notes, USABLE_W);
      doc.text(lines, MARGIN, y);
    }

    // ── Cover footer ─────────────────────────────────────────────────────────
    const drawFooter = (pageNum: number, totalPages: number) => {
      doc.setFont(font, "normal");
      doc.setFontSize(7);
      textRGB(GRAY_400);
      drawRGB(SLATE_300);
      doc.setLineWidth(0.2);
      doc.line(MARGIN, PAGE_H - 12, PAGE_W - MARGIN, PAGE_H - 12);
      doc.text("FinControl • Documento Confidencial", MARGIN, PAGE_H - 7);
      doc.text(company.name, PAGE_W / 2, PAGE_H - 7, { align: "center" });
      doc.text(
        `Pág. ${pageNum} de ${totalPages}`,
        PAGE_W - MARGIN,
        PAGE_H - 7,
        {
          align: "right",
        },
      );
    };

    // ────────────────────────────────────────────────────────────────────────
    // SUMÁRIO — tabela de transações
    // ────────────────────────────────────────────────────────────────────────
    doc.addPage();

    // Page header
    fillRGB(NAVY);
    doc.rect(0, 0, PAGE_W, 22, "F");
    fillRGB(GREEN_600);
    doc.rect(0, 20, PAGE_W, 2, "F");

    doc.setFont(font, "bold");
    doc.setFontSize(10);
    textRGB(WHITE);
    doc.text("RESUMO DAS DESPESAS", MARGIN, 13);

    doc.setFont(font, "normal");
    doc.setFontSize(7.5);
    textRGB(GRAY_300);
    doc.text(report.rdNumber, PAGE_W - MARGIN, 13, { align: "right" });

    const sorted = [...transactions].sort(
      (a, b) => a.dueDate.getTime() - b.dueDate.getTime(),
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tableRows: any[][] = sorted.map((t) => {
      const effDate =
        t.status === "paid" && t.paymentDate ? t.paymentDate : t.dueDate;
      const effAmount =
        t.status === "paid" && t.finalAmount ? t.finalAmount : t.amount;
      const atts = (t.attachments ?? []).filter((a) => !!a.url);

      let attachContent = "-";
      if (atts.length === 1) attachContent = "↓ Baixar";
      else if (atts.length > 1)
        attachContent = atts.map((_, i) => `↓ NF ${i + 1}`).join("\n");

      return [
        format(effDate, "dd/MM/yy"),
        t.description || "-",
        {
          content: TX_STATUS_LABEL[t.status] || t.status,
          styles: {
            textColor:
              t.status === "paid"
                ? GREEN_600
                : t.status === "rejected"
                  ? RED_600
                  : SLATE_600,
            halign: "center",
          },
        },
        {
          content: attachContent,
          styles: {
            textColor: atts.length > 0 ? LINK_BLUE : SLATE_600,
            halign: "center",
            fontSize: 7.5,
            fontStyle: atts.length > 0 ? "bold" : "normal",
          },
        },
        {
          content: formatCurrency(effAmount),
          styles: { halign: "right", fontStyle: "bold" },
        },
      ];
    });

    autoTable(doc, {
      startY: 28,
      head: [["Data", "Descrição", "Status", "Nota Fiscal", "Valor (R$)"]],
      body: tableRows,
      theme: "plain",
      columnStyles: {
        0: { cellWidth: 22 },
        1: { cellWidth: USABLE_W - 22 - 24 - 30 - 28 },
        2: { cellWidth: 24, halign: "center" },
        3: { cellWidth: 30, halign: "center" },
        4: { cellWidth: 28, halign: "right" },
      },
      styles: {
        font,
        fontSize: 8.5,
        valign: "middle",
        cellPadding: { top: 2.5, bottom: 2.5, left: 4, right: 4 },
        lineColor: SLATE_300,
        lineWidth: 0.15,
        overflow: "linebreak",
      },
      headStyles: {
        font,
        fontStyle: "bold",
        fontSize: 8,
        valign: "middle",
        fillColor: NAVY,
        textColor: WHITE,
        cellPadding: { top: 3.5, bottom: 3.5, left: 4, right: 4 },
        lineWidth: 0,
      },
      alternateRowStyles: { fillColor: SLATE_50 },
      showHead: "everyPage",
      rowPageBreak: "auto",
      didDrawCell: (data) => {
        if (data.section !== "body" || data.column.index !== 3) return;
        const tx = sorted[data.row.index];
        const atts = (tx.attachments ?? []).filter((a) => !!a.url);
        if (atts.length === 0) return;
        const { x, y, width, height } = data.cell;
        const linkH = height / atts.length;
        atts.forEach((att, i) => {
          doc.link(x, y + i * linkH, width, linkH, { url: att.url });
        });
      },
      didDrawPage: () => {
        doc.setCharSpace(0);
      },
      margin: { top: 15, left: MARGIN, right: MARGIN, bottom: 18 },
    });

    // Total row below table
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const finalY = (doc as any).lastAutoTable.finalY + 4;
    const summaryH = 14;
    if (finalY + summaryH < PAGE_H - 20) {
      fillRGB(NAVY);
      doc.setLineWidth(0);
      doc.roundedRect(MARGIN, finalY, USABLE_W, summaryH, 1.5, 1.5, "F");
      doc.setFont(font, "bold");
      doc.setFontSize(9);
      textRGB(GRAY_400);
      doc.text("TOTAL", MARGIN + 5, finalY + 8.5);
      textRGB([134, 239, 172]);
      doc.text(
        formatCurrency(report.totalAmount),
        PAGE_W - MARGIN - 5,
        finalY + 8.5,
        {
          align: "right",
        },
      );
    }

    // ── Draw footers on all pages ─────────────────────────────────────────────
    const reportPageCount = doc.getNumberOfPages();
    for (let p = 1; p <= reportPageCount; p++) {
      doc.setPage(p);
      drawFooter(p, reportPageCount);
    }

    const filename = `${report.rdNumber.replace("-", "_")}_${format(new Date(), "yyyyMMdd")}.pdf`;
    doc.save(filename);
  },
};
