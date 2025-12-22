import * as React from 'react';

interface ApprovalRequestEmailProps {
    transactionId: string;
    description: string;
    amount: string;
    requesterName: string;
    link: string;
}

export const ApprovalRequestEmail: React.FC<Readonly<ApprovalRequestEmailProps>> = ({
    transactionId,
    description,
    amount,
    requesterName,
    link,
}) => (
    <div style={{ fontFamily: 'sans-serif', lineHeight: '1.5' }}>
        <h2>Nova Solicitação de Aprovação</h2>
        <p>Olá,</p>
        <p>Uma nova transação requer sua aprovação.</p>
        <ul>
            <li><strong>ID:</strong> {transactionId}</li>
            <li><strong>Solicitante:</strong> {requesterName}</li>
            <li><strong>Descrição:</strong> {description}</li>
            <li><strong>Valor:</strong> {amount}</li>
        </ul>
        <p>
            <a href={link} style={{ background: '#000', color: '#fff', padding: '10px 20px', textDecoration: 'none', borderRadius: '5px' }}>
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
    const statusText = {
        approved: 'Aprovada',
        rejected: 'Rejeitada',
        paid: 'Paga/Recebida',
    }[status] || status;

    const color = {
        approved: '#10b981', // emerald-500
        rejected: '#ef4444', // red-500
        paid: '#3b82f6',     // blue-500
    }[status] || '#6b7280';

    return (
        <div style={{ fontFamily: 'sans-serif', lineHeight: '1.5' }}>
            <h2>Atualização de Status</h2>
            <p>A transação <strong>{description}</strong> foi <strong style={{ color }}>{statusText}</strong>.</p>
            <ul>
                <li><strong>ID:</strong> {transactionId}</li>
                <li><strong>Atualizado por:</strong> {updatedBy}</li>
            </ul>
            <p>
                <a href={link} style={{ background: '#000', color: '#fff', padding: '10px 20px', textDecoration: 'none', borderRadius: '5px' }}>
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

export const BatchApprovalEmail: React.FC<Readonly<BatchApprovalEmailProps>> = ({
    batchName,
    batchId,
    transactionCount,
    totalAmount,
    senderName,
    link,
}) => (
    <div style={{ fontFamily: 'sans-serif', lineHeight: '1.6', maxWidth: '600px', margin: '0 auto' }}>
        <div style={{ background: '#f8fafc', padding: '20px', borderRadius: '8px' }}>
            <h2 style={{ color: '#1e293b', marginTop: 0 }}>📋 Lote de Pagamentos Aguardando Aprovação</h2>
            
            <p style={{ color: '#475569' }}>Olá,</p>
            <p style={{ color: '#475569' }}>
                <strong>{senderName}</strong> enviou um lote de pagamentos para sua aprovação.
            </p>
            
            <div style={{ background: '#fff', padding: '16px', borderRadius: '6px', border: '1px solid #e2e8f0', margin: '20px 0' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <tbody>
                        <tr>
                            <td style={{ padding: '8px 0', color: '#64748b' }}>Lote:</td>
                            <td style={{ padding: '8px 0', fontWeight: 'bold', textAlign: 'right' }}>{batchName}</td>
                        </tr>
                        <tr>
                            <td style={{ padding: '8px 0', color: '#64748b' }}>Transações:</td>
                            <td style={{ padding: '8px 0', fontWeight: 'bold', textAlign: 'right' }}>{transactionCount}</td>
                        </tr>
                        <tr>
                            <td style={{ padding: '8px 0', color: '#64748b', borderTop: '1px solid #e2e8f0' }}>Valor Total:</td>
                            <td style={{ padding: '8px 0', fontWeight: 'bold', textAlign: 'right', borderTop: '1px solid #e2e8f0', color: '#059669', fontSize: '18px' }}>{totalAmount}</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <p style={{ color: '#475569', fontSize: '14px' }}>
                Clique no botão abaixo para revisar as transações e aprovar o lote. Você poderá editar valores, rejeitar transações individuais ou devolver o lote para ajustes.
            </p>

            <div style={{ textAlign: 'center', margin: '24px 0' }}>
                <a href={link} style={{ 
                    background: '#059669', 
                    color: '#fff', 
                    padding: '12px 32px', 
                    textDecoration: 'none', 
                    borderRadius: '6px',
                    fontWeight: 'bold',
                    display: 'inline-block'
                }}>
                    Revisar e Aprovar Lote
                </a>
            </div>

            <p style={{ color: '#94a3b8', fontSize: '12px', marginBottom: 0 }}>
                Este link expira em 48 horas. Se você não reconhece esta solicitação, por favor ignore este email.
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

export const BatchAuthorizationEmail: React.FC<Readonly<BatchAuthorizationEmailProps>> = ({
    batchName,
    batchId,
    transactionCount,
    totalAmount,
    senderName,
    link,
}) => (
    <div style={{ fontFamily: 'sans-serif', lineHeight: '1.6', maxWidth: '600px', margin: '0 auto' }}>
        <div style={{ background: '#f8fafc', padding: '20px', borderRadius: '8px' }}>
            <h2 style={{ color: '#1e293b', marginTop: 0 }}>🏦 Autorização Bancária Necessária</h2>
            
            <p style={{ color: '#475569' }}>Olá,</p>
            <p style={{ color: '#475569' }}>
                <strong>{senderName}</strong> solicita sua autorização para processamento bancário do seguinte lote:
            </p>
            
            <div style={{ background: '#fff', padding: '16px', borderRadius: '6px', border: '1px solid #e2e8f0', margin: '20px 0' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <tbody>
                        <tr>
                            <td style={{ padding: '8px 0', color: '#64748b' }}>Lote:</td>
                            <td style={{ padding: '8px 0', fontWeight: 'bold', textAlign: 'right' }}>{batchName}</td>
                        </tr>
                        <tr>
                            <td style={{ padding: '8px 0', color: '#64748b' }}>Transações:</td>
                            <td style={{ padding: '8px 0', fontWeight: 'bold', textAlign: 'right' }}>{transactionCount}</td>
                        </tr>
                        <tr>
                            <td style={{ padding: '8px 0', color: '#64748b', borderTop: '1px solid #e2e8f0' }}>Valor Total:</td>
                            <td style={{ padding: '8px 0', fontWeight: 'bold', textAlign: 'right', borderTop: '1px solid #e2e8f0', color: '#0284c7', fontSize: '18px' }}>{totalAmount}</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <p style={{ color: '#475569', fontSize: '14px' }}>
                Este lote já foi aprovado e está pronto para importação no sistema bancário. Clique no botão abaixo para confirmar a autorização.
            </p>

            <div style={{ textAlign: 'center', margin: '24px 0' }}>
                <a href={link} style={{ 
                    background: '#0284c7', 
                    color: '#fff', 
                    padding: '12px 32px', 
                    textDecoration: 'none', 
                    borderRadius: '6px',
                    fontWeight: 'bold',
                    display: 'inline-block'
                }}>
                    Confirmar Autorização
                </a>
            </div>

            <p style={{ color: '#94a3b8', fontSize: '12px', marginBottom: 0 }}>
                Este link expira em 48 horas. Se você não reconhece esta solicitação, por favor ignore este email.
            </p>
        </div>
    </div>
);
