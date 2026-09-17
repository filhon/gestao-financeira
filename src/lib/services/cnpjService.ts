import { titleCasePtBr } from "@/lib/utils";

export interface CnpjData {
  name: string;
  email: string;
  phone: string;
  address: string;
}

export type CnpjLookupResult =
  | { status: "ok"; data: CnpjData }
  | { status: "not_found" }
  | { status: "unavailable" };

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

    const street = [est.tipo_logradouro, est.logradouro]
      .filter(Boolean)
      .join(" ");
    const cep = est.cep ? `CEP ${est.cep.slice(0, 5)}-${est.cep.slice(5)}` : "";
    const address = [
      titleCasePtBr(
        [street, est.numero, est.complemento].filter(Boolean).join(", "),
      ),
      est.bairro && titleCasePtBr(est.bairro),
      est.cidade?.nome &&
        `${est.cidade.nome} - ${est.estado?.sigla ?? ""}`.trim(),
      cep,
    ]
      .filter(Boolean)
      .join(", ");

    const tel: string = est.telefone1 ?? "";
    const phone =
      est.ddd1 && tel
        ? `(${est.ddd1}) ${tel.slice(0, -4)}-${tel.slice(-4)}`
        : "";

    return {
      status: "ok",
      data: {
        name: titleCasePtBr(json.razao_social ?? ""),
        email: (est.email ?? "").toLowerCase(),
        phone,
        address,
      },
    };
  },
};
