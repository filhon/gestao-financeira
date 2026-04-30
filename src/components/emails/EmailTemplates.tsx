import * as React from "react";

interface ApprovalRequestEmailProps {
  transactionId: string;
  description: string;
  amount: string;
  requesterName: string;
  link: string;
}

export const ApprovalRequestEmail: React.FC<
  Readonly<ApprovalRequestEmailProps>
> = ({ transactionId, description, amount, requesterName, link }) => (
  <div style={{ fontFamily: "sans-serif", lineHeight: "1.5" }}>
    <h2>Nova Solicitação de Aprovação</h2>
    <p>Olá,</p>
    <p>Uma nova transação requer sua aprovação.</p>
    <ul>
      <li>
        <strong>ID:</strong> {transactionId}
      </li>
      <li>
        <strong>Solicitante:</strong> {requesterName}
      </li>
      <li>
        <strong>Descrição:</strong> {description}
      </li>
      <li>
        <strong>Valor:</strong> {amount}
      </li>
    </ul>
    <p>
      <a
        href={link}
        style={{
          background: "#000",
          color: "#fff",
          padding: "10px 20px",
          textDecoration: "none",
          borderRadius: "5px",
        }}
      >
        Ver Detalhes
      </a>
    </p>
  </div>
);

interface StatusUpdateEmailProps {
  transactionId: string;
  description: string;
  status: string;
  updatedBy: string;
  link: string;
}

export const StatusUpdateEmail: React.FC<Readonly<StatusUpdateEmailProps>> = ({
  transactionId,
  description,
  status,
  updatedBy,
  link,
}) => {
  const statusText =
    {
      approved: "Aprovada",
      rejected: "Rejeitada",
      paid: "Paga/Recebida",
    }[status] || status;

  const color =
    {
      approved: "#10b981", // emerald-500
      rejected: "#ef4444", // red-500
      paid: "#3b82f6", // blue-500
    }[status] || "#6b7280";

  return (
    <div style={{ fontFamily: "sans-serif", lineHeight: "1.5" }}>
      <h2>Atualização de Status</h2>
      <p>
        A transação <strong>{description}</strong> foi{" "}
        <strong style={{ color }}>{statusText}</strong>.
      </p>
      <ul>
        <li>
          <strong>ID:</strong> {transactionId}
        </li>
        <li>
          <strong>Atualizado por:</strong> {updatedBy}
        </li>
      </ul>
      <p>
        <a
          href={link}
          style={{
            background: "#000",
            color: "#fff",
            padding: "10px 20px",
            textDecoration: "none",
            borderRadius: "5px",
          }}
        >
          Ver Transação
        </a>
      </p>
    </div>
  );
};

// ============================================
// Batch Email Templates
// ============================================

interface BatchApprovalEmailProps {
  batchName: string;
  batchId: string;
  transactionCount: number;
  totalAmount: string;
  senderName: string;
  link: string;
}

export const BatchApprovalEmail: React.FC<
  Readonly<BatchApprovalEmailProps>
> = ({ batchName, transactionCount, totalAmount, senderName, link }) => (
  <div
    style={{
      fontFamily: "sans-serif",
      lineHeight: "1.6",
      maxWidth: "600px",
      margin: "0 auto",
    }}
  >
    <div
      style={{ background: "#f8fafc", padding: "20px", borderRadius: "8px" }}
    >
      <h2 style={{ color: "#1e293b", marginTop: 0 }}>
        📋 Lote de Pagamentos Aguardando Aprovação
      </h2>

      <p style={{ color: "#475569" }}>Olá,</p>
      <p style={{ color: "#475569" }}>
        <strong>{senderName}</strong> enviou um lote de pagamentos para sua
        aprovação.
      </p>

      <div
        style={{
          background: "#fff",
          padding: "16px",
          borderRadius: "6px",
          border: "1px solid #e2e8f0",
          margin: "20px 0",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            <tr>
              <td style={{ padding: "8px 0", color: "#64748b" }}>Lote:</td>
              <td
                style={{
                  padding: "8px 0",
                  fontWeight: "bold",
                  textAlign: "right",
                }}
              >
                {batchName}
              </td>
            </tr>
            <tr>
              <td style={{ padding: "8px 0", color: "#64748b" }}>
                Transações:
              </td>
              <td
                style={{
                  padding: "8px 0",
                  fontWeight: "bold",
                  textAlign: "right",
                }}
              >
                {transactionCount}
              </td>
            </tr>
            <tr>
              <td
                style={{
                  padding: "8px 0",
                  color: "#64748b",
                  borderTop: "1px solid #e2e8f0",
                }}
              >
                Valor Total:
              </td>
              <td
                style={{
                  padding: "8px 0",
                  fontWeight: "bold",
                  textAlign: "right",
                  borderTop: "1px solid #e2e8f0",
                  color: "#059669",
                  fontSize: "18px",
                }}
              >
                {totalAmount}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p style={{ color: "#475569", fontSize: "14px" }}>
        Clique no botão abaixo para revisar as transações e aprovar o lote. Você
        poderá editar valores, rejeitar transações individuais ou devolver o
        lote para ajustes.
      </p>

      <div style={{ textAlign: "center", margin: "24px 0" }}>
        <a
          href={link}
          style={{
            background: "#059669",
            color: "#fff",
            padding: "12px 32px",
            textDecoration: "none",
            borderRadius: "6px",
            fontWeight: "bold",
            display: "inline-block",
          }}
        >
          Revisar e Aprovar Lote
        </a>
      </div>

      <p style={{ color: "#94a3b8", fontSize: "12px", marginBottom: 0 }}>
        Este link expira em 48 horas. Se você não reconhece esta solicitação,
        por favor ignore este email.
      </p>
    </div>
  </div>
);

interface BatchAuthorizationEmailProps {
  batchName: string;
  batchId: string;
  transactionCount: number;
  totalAmount: string;
  senderName: string;
  link: string;
}

export const BatchAuthorizationEmail: React.FC<
  Readonly<BatchAuthorizationEmailProps>
> = ({ batchName, transactionCount, totalAmount, senderName, link }) => (
  <div
    style={{
      fontFamily: "sans-serif",
      lineHeight: "1.6",
      maxWidth: "600px",
      margin: "0 auto",
    }}
  >
    <div
      style={{ background: "#f8fafc", padding: "20px", borderRadius: "8px" }}
    >
      <h2 style={{ color: "#1e293b", marginTop: 0 }}>
        🏦 Autorização Bancária Necessária
      </h2>

      <p style={{ color: "#475569" }}>Olá,</p>
      <p style={{ color: "#475569" }}>
        <strong>{senderName}</strong> solicita sua autorização para
        processamento bancário do seguinte lote:
      </p>

      <div
        style={{
          background: "#fff",
          padding: "16px",
          borderRadius: "6px",
          border: "1px solid #e2e8f0",
          margin: "20px 0",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            <tr>
              <td style={{ padding: "8px 0", color: "#64748b" }}>Lote:</td>
              <td
                style={{
                  padding: "8px 0",
                  fontWeight: "bold",
                  textAlign: "right",
                }}
              >
                {batchName}
              </td>
            </tr>
            <tr>
              <td style={{ padding: "8px 0", color: "#64748b" }}>
                Transações:
              </td>
              <td
                style={{
                  padding: "8px 0",
                  fontWeight: "bold",
                  textAlign: "right",
                }}
              >
                {transactionCount}
              </td>
            </tr>
            <tr>
              <td
                style={{
                  padding: "8px 0",
                  color: "#64748b",
                  borderTop: "1px solid #e2e8f0",
                }}
              >
                Valor Total:
              </td>
              <td
                style={{
                  padding: "8px 0",
                  fontWeight: "bold",
                  textAlign: "right",
                  borderTop: "1px solid #e2e8f0",
                  color: "#0284c7",
                  fontSize: "18px",
                }}
              >
                {totalAmount}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p style={{ color: "#475569", fontSize: "14px" }}>
        Este lote já foi aprovado e está pronto para importação no sistema
        bancário. Clique no botão abaixo para confirmar a autorização.
      </p>

      <div style={{ textAlign: "center", margin: "24px 0" }}>
        <a
          href={link}
          style={{
            background: "#0284c7",
            color: "#fff",
            padding: "12px 32px",
            textDecoration: "none",
            borderRadius: "6px",
            fontWeight: "bold",
            display: "inline-block",
          }}
        >
          Confirmar Autorização
        </a>
      </div>

      <p style={{ color: "#94a3b8", fontSize: "12px", marginBottom: 0 }}>
        Este link expira em 48 horas. Se você não reconhece esta solicitação,
        por favor ignore este email.
      </p>
    </div>
  </div>
);

// ============================================
// Feedback Email Template
// ============================================

interface FeedbackNotificationEmailProps {
  userName: string;
  userEmail: string;
  feedbackType: string;
  feedbackTypeLabel: string;
  title: string;
  description: string;
  link: string;
}

export const FeedbackNotificationEmail: React.FC<
  Readonly<FeedbackNotificationEmailProps>
> = ({
  userName,
  userEmail,
  feedbackType,
  feedbackTypeLabel,
  title,
  description,
  link,
}) => {
  const typeColors = {
    bug: "#dc2626",
    improvement: "#0284c7",
    question: "#ca8a04",
    praise: "#059669",
  };

  const typeEmojis = {
    bug: "🐛",
    improvement: "💡",
    question: "❓",
    praise: "⭐",
  };

  const color =
    typeColors[feedbackType as keyof typeof typeColors] || "#6b7280";
  const emoji = typeEmojis[feedbackType as keyof typeof typeEmojis] || "📝";

  return (
    <div
      style={{
        fontFamily: "sans-serif",
        lineHeight: "1.6",
        maxWidth: "600px",
        margin: "0 auto",
      }}
    >
      <div
        style={{ background: "#f8fafc", padding: "20px", borderRadius: "8px" }}
      >
        <h2 style={{ color: "#1e293b", marginTop: 0 }}>
          {emoji} Novo Feedback Recebido
        </h2>

        <div
          style={{
            background: "#fff",
            padding: "16px",
            borderRadius: "6px",
            border: `2px solid ${color}`,
            margin: "20px 0",
          }}
        >
          <div
            style={{
              color,
              fontWeight: "bold",
              fontSize: "12px",
              textTransform: "uppercase",
              marginBottom: "8px",
            }}
          >
            {feedbackTypeLabel}
          </div>
          <h3 style={{ margin: "8px 0", color: "#1e293b" }}>{title}</h3>
          <p
            style={{
              color: "#475569",
              margin: "12px 0",
              whiteSpace: "pre-wrap",
            }}
          >
            {description}
          </p>
        </div>

        <div
          style={{
            background: "#fff",
            padding: "12px 16px",
            borderRadius: "6px",
            border: "1px solid #e2e8f0",
            margin: "20px 0",
          }}
        >
          <p style={{ margin: 0, fontSize: "14px", color: "#64748b" }}>
            Enviado por:{" "}
            <strong style={{ color: "#1e293b" }}>{userName}</strong>
          </p>
          <p
            style={{ margin: "4px 0 0 0", fontSize: "12px", color: "#94a3b8" }}
          >
            {userEmail}
          </p>
        </div>

        <div style={{ textAlign: "center", margin: "24px 0" }}>
          <a
            href={link}
            style={{
              background: color,
              color: "#fff",
              padding: "12px 32px",
              textDecoration: "none",
              borderRadius: "6px",
              fontWeight: "bold",
              display: "inline-block",
            }}
          >
            Ver Feedback e Responder
          </a>
        </div>

        <p
          style={{
            color: "#94a3b8",
            fontSize: "12px",
            marginBottom: 0,
            textAlign: "center",
          }}
        >
          Este é um email automático do sistema de feedbacks do Fin Control.
        </p>
      </div>
    </div>
  );
};

// ============================================
// Reimbursement Report Emails
// ============================================

interface ReimbursementApprovalEmailProps {
  rdNumber: string;
  employeeName: string;
  period: string;
  totalAmount: string;
  transactionCount: number;
  senderName: string;
  approveLink: string;
  rejectLink: string;
}

export const ReimbursementApprovalEmail: React.FC<
  Readonly<ReimbursementApprovalEmailProps>
> = ({
  rdNumber,
  employeeName,
  period,
  totalAmount,
  transactionCount,
  senderName,
  approveLink,
  rejectLink,
}) => (
  <div
    style={{
      fontFamily: "sans-serif",
      maxWidth: "600px",
      margin: "0 auto",
      backgroundColor: "#f8fafc",
      padding: "24px",
    }}
  >
    <div
      style={{
        background: "#0f172a",
        borderRadius: "8px 8px 0 0",
        padding: "24px",
        textAlign: "center",
      }}
    >
      <p style={{ color: "#94a3b8", margin: 0, fontSize: "12px" }}>
        FIN CONTROL
      </p>
      <h1 style={{ color: "#ffffff", margin: "8px 0 0", fontSize: "24px" }}>
        {rdNumber}
      </h1>
      <p style={{ color: "#94a3b8", margin: "4px 0 0", fontSize: "13px" }}>
        Relatório de Despesas — Aprovação Necessária
      </p>
    </div>

    <div
      style={{
        background: "#ffffff",
        padding: "24px",
        borderRadius: "0 0 8px 8px",
        border: "1px solid #e2e8f0",
        borderTop: "none",
      }}
    >
      <p style={{ color: "#475569" }}>
        <strong>{senderName}</strong> encaminhou um Relatório de Despesas para
        sua aprovação.
      </p>

      <div
        style={{
          background: "#f8fafc",
          padding: "16px",
          borderRadius: "6px",
          border: "1px solid #e2e8f0",
          margin: "20px 0",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            <tr>
              <td
                style={{ padding: "6px 0", color: "#64748b", fontSize: "14px" }}
              >
                Funcionário:
              </td>
              <td
                style={{
                  padding: "6px 0",
                  fontWeight: "bold",
                  textAlign: "right",
                  fontSize: "14px",
                }}
              >
                {employeeName}
              </td>
            </tr>
            <tr>
              <td
                style={{ padding: "6px 0", color: "#64748b", fontSize: "14px" }}
              >
                Período:
              </td>
              <td
                style={{
                  padding: "6px 0",
                  fontWeight: "bold",
                  textAlign: "right",
                  fontSize: "14px",
                }}
              >
                {period}
              </td>
            </tr>
            <tr>
              <td
                style={{ padding: "6px 0", color: "#64748b", fontSize: "14px" }}
              >
                Lançamentos:
              </td>
              <td
                style={{
                  padding: "6px 0",
                  fontWeight: "bold",
                  textAlign: "right",
                  fontSize: "14px",
                }}
              >
                {transactionCount}
              </td>
            </tr>
            <tr>
              <td
                style={{
                  padding: "10px 0 6px",
                  color: "#64748b",
                  borderTop: "1px solid #e2e8f0",
                  fontSize: "14px",
                  fontWeight: "bold",
                }}
              >
                Total do Reembolso:
              </td>
              <td
                style={{
                  padding: "10px 0 6px",
                  fontWeight: "bold",
                  textAlign: "right",
                  borderTop: "1px solid #e2e8f0",
                  color: "#16a34a",
                  fontSize: "18px",
                }}
              >
                {totalAmount}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", gap: "12px", margin: "24px 0" }}>
        <a
          href={approveLink}
          style={{
            display: "inline-block",
            background: "#16a34a",
            color: "#ffffff",
            padding: "12px 24px",
            textDecoration: "none",
            borderRadius: "6px",
            fontWeight: "bold",
            fontSize: "14px",
          }}
        >
          ✓ Aprovar Reembolso
        </a>
        <a
          href={rejectLink}
          style={{
            display: "inline-block",
            background: "#ffffff",
            color: "#dc2626",
            padding: "12px 24px",
            textDecoration: "none",
            borderRadius: "6px",
            fontWeight: "bold",
            fontSize: "14px",
            border: "2px solid #dc2626",
          }}
        >
          ✕ Recusar
        </a>
      </div>

      <p style={{ color: "#94a3b8", fontSize: "12px", marginTop: "24px" }}>
        Este link expira em 7 dias. Em caso de dúvidas, acesse o sistema Fin
        Control.
      </p>
    </div>
  </div>
);

interface ReimbursementApprovedEmailProps {
  rdNumber: string;
  employeeName: string;
  period: string;
  totalAmount: string;
  approvedBy: string;
  systemLink: string;
}

export const ReimbursementApprovedEmail: React.FC<
  Readonly<ReimbursementApprovedEmailProps>
> = ({
  rdNumber,
  employeeName,
  period,
  totalAmount,
  approvedBy,
  systemLink,
}) => (
  <div
    style={{
      fontFamily: "sans-serif",
      maxWidth: "600px",
      margin: "0 auto",
      backgroundColor: "#f8fafc",
      padding: "24px",
    }}
  >
    <div
      style={{
        background: "#16a34a",
        borderRadius: "8px 8px 0 0",
        padding: "24px",
        textAlign: "center",
      }}
    >
      <p style={{ color: "#dcfce7", margin: 0, fontSize: "12px" }}>
        FIN CONTROL
      </p>
      <h1 style={{ color: "#ffffff", margin: "8px 0 0", fontSize: "22px" }}>
        Reembolso Aprovado ✓
      </h1>
      <p style={{ color: "#dcfce7", margin: "4px 0 0", fontSize: "13px" }}>
        {rdNumber}
      </p>
    </div>

    <div
      style={{
        background: "#ffffff",
        padding: "24px",
        borderRadius: "0 0 8px 8px",
        border: "1px solid #e2e8f0",
        borderTop: "none",
      }}
    >
      <p style={{ color: "#475569" }}>
        Olá <strong>{employeeName}</strong>,
      </p>
      <p style={{ color: "#475569" }}>
        Seu Relatório de Despesas foi aprovado por <strong>{approvedBy}</strong>{" "}
        e está pendente de pagamento.
      </p>

      <div
        style={{
          background: "#f0fdf4",
          padding: "16px",
          borderRadius: "6px",
          border: "1px solid #bbf7d0",
          margin: "20px 0",
        }}
      >
        <p style={{ margin: "0 0 8px", color: "#15803d", fontWeight: "bold" }}>
          Total aprovado: {totalAmount}
        </p>
        <p style={{ margin: 0, color: "#64748b", fontSize: "13px" }}>
          Período: {period}
        </p>
      </div>

      <a
        href={systemLink}
        style={{
          display: "inline-block",
          background: "#0f172a",
          color: "#ffffff",
          padding: "12px 24px",
          textDecoration: "none",
          borderRadius: "6px",
          fontWeight: "bold",
          fontSize: "14px",
        }}
      >
        Ver no Sistema
      </a>
    </div>
  </div>
);
