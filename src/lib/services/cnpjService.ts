import { titleCasePtBr } from "@/lib/utils";
import type { TaxRegime } from "@/lib/types";

export interface AddressData {
  zipCode: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  state: string;
}

export interface CnpjData extends AddressData {
  name: string;
  tradeName: string;
  email: string;
  phone: string;
  stateRegistration: string;
  /** Só MEI e Simples vêm da Receita; presumido x real não é público. */
  taxRegime?: TaxRegime;
}

export type CnpjLookupResult =
  | { status: "ok"; data: CnpjData }
  | { status: "not_found" }
  | { status: "unavailable" };

/** Endereço em uma linha, no formato que relatórios e e-mails já usam. */
export function formatAddress(a: Partial<AddressData>): string {
  const cep = a.zipCode?.replace(/\D/g, "");
  return [
    [a.street, a.number, a.complement].filter(Boolean).join(", "),
    a.district,
    a.city && [a.city, a.state].filter(Boolean).join(" - "),
    cep?.length === 8 && `CEP ${cep.slice(0, 5)}-${cep.slice(5)}`,
  ]
    .filter(Boolean)
    .join(", ");
}

// ponytail: chamada direta do browser à API pública (3 req/min por IP);
// mover para uma route handler com cache se o limite incomodar.
export const cnpjService = {
  async lookup(cnpj: string): Promise<CnpjLookupResult> {
    const digits = cnpj.replace(/\D/g, "");
    let res: Response;
    try {
      res = await fetch(`https://publica.cnpj.ws/cnpj/${digits}`);
    } catch {
      return { status: "unavailable" };
    }
    if (res.status === 404 || res.status === 400)
      return { status: "not_found" };
    if (!res.ok) return { status: "unavailable" };

    const json = await res.json();
    const est = json.estabelecimento ?? {};
    const state: string = est.estado?.sigla ?? "";

    const tel: string = est.telefone1 ?? "";
    const phone =
      est.ddd1 && tel
        ? `(${est.ddd1}) ${tel.slice(0, -4)}-${tel.slice(-4)}`
        : "";

    // Inscrição ativa no estado do estabelecimento
    const ie = (
      (est.inscricoes_estaduais ?? []) as {
        inscricao_estadual?: string;
        ativo?: boolean;
        estado?: { sigla?: string };
      }[]
    ).find((i) => i.ativo && i.estado?.sigla === state);

    const simples = json.simples ?? {};
    const taxRegime: TaxRegime | undefined =
      simples.mei === "Sim"
        ? "mei"
        : simples.simples === "Sim"
          ? "simples"
          : undefined;

    return {
      status: "ok",
      data: {
        name: titleCasePtBr(json.razao_social ?? ""),
        tradeName: titleCasePtBr(est.nome_fantasia ?? ""),
        email: (est.email ?? "").toLowerCase(),
        phone,
        zipCode: est.cep ?? "",
        street: titleCasePtBr(
          [est.tipo_logradouro, est.logradouro].filter(Boolean).join(" "),
        ),
        number: est.numero ?? "",
        complement: titleCasePtBr(est.complemento ?? ""),
        district: titleCasePtBr(est.bairro ?? ""),
        city: est.cidade?.nome ?? "",
        state,
        stateRegistration: ie?.inscricao_estadual ?? "",
        taxRegime,
      },
    };
  },

  /** Endereço pelo CEP (ViaCEP). `null` quando o CEP não existe ou a consulta falha. */
  async lookupCep(cep: string): Promise<Partial<AddressData> | null> {
    const digits = cep.replace(/\D/g, "");
    if (digits.length !== 8) return null;
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      if (!res.ok) return null;
      const json = await res.json();
      if (json.erro) return null;
      return {
        street: json.logradouro ?? "",
        district: json.bairro ?? "",
        city: json.localidade ?? "",
        state: json.uf ?? "",
      };
    } catch {
      return null;
    }
  },
};
