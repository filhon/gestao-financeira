import React from "react";
import { Mail, MessageCircle } from "lucide-react";

interface DunningStatusProps {
  status?: {
    emailSent: boolean;
    whatsappSent: boolean;
  };
}

export function DunningStatus({ status }: DunningStatusProps) {
  const emailSent = status?.emailSent || false;
  const whatsappSent = status?.whatsappSent || false;

  return (
    <div className="flex items-center gap-2">
      <div
        className={`flex items-center justify-center rounded-full p-1.5 ${
          emailSent ? "bg-green-100 text-green-600" : "bg-gray-100 text-gray-400"
        }`}
        title={emailSent ? "E-mail de cobrança enviado" : "E-mail não enviado"}
      >
        <Mail className="h-4 w-4" />
      </div>
      <div
        className={`flex items-center justify-center rounded-full p-1.5 ${
          whatsappSent ? "bg-green-100 text-green-600" : "bg-gray-100 text-gray-400"
        }`}
        title={whatsappSent ? "WhatsApp de cobrança enviado" : "WhatsApp não enviado"}
      >
        <MessageCircle className="h-4 w-4" />
      </div>
    </div>
  );
}
