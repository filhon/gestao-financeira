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
