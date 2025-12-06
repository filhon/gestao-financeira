import { ApprovalRequestEmail, StatusUpdateEmail } from '@/components/emails/EmailTemplates';
import { NextResponse } from 'next/server';
import { Resend } from 'resend';

export async function POST(request: Request) {
    const { type, to, data } = await request.json();

    let emailComponent;
    let subject = "";

    if (type === 'approval_request') {
        emailComponent = <ApprovalRequestEmail {...data} />;
        subject = `Aprovação Necessária: ${data.description}`;
    } else if (type === 'status_update') {
        emailComponent = <StatusUpdateEmail {...data} />;
        subject = `Atualização de Status: ${data.description}`;
    } else {
        return NextResponse.json({ error: "Invalid email type" }, { status: 400 });
    }

    try {
        if (!process.env.RESEND_API_KEY) {
            console.warn("RESEND_API_KEY is missing. Email simulation:");
            console.log("To:", to);
            console.log("Type:", type);
            console.log("Data:", data);
            return NextResponse.json({ success: true, message: "Email simulated (API Key missing)" });
        }

        const resend = new Resend(process.env.RESEND_API_KEY);



        // Resend Free Tier Restriction: Can only send to verified email.
        // We redirect to the developer's email in dev mode.
        const isDev = process.env.NODE_ENV === 'development';
        const verifiedEmail = 'filipe.honorio@hebron.com.br';
        const recipient = isDev ? verifiedEmail : to;

        if (isDev && to !== verifiedEmail) {
            console.log(`[DEV] Redirecting email from ${to} to ${verifiedEmail}`);
        }

        const { data: result, error } = await resend.emails.send({
            from: 'Fin Control <onboarding@resend.dev>',
            to: recipient,
            subject: isDev ? `[TESTE - Original: ${to}] ${subject}` : subject,
            react: emailComponent,
        });

        if (error) {
            console.error("Resend API Error:", error);
            return NextResponse.json({ error }, { status: 500 });
        }

        return NextResponse.json(result);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
        console.error("Email API Internal Error:", error);
        return NextResponse.json({ error: "Internal Server Error", details: error.message }, { status: 500 });
    }
}
