import { RequestOriginType } from "@/lib/types";

export const REQUEST_ORIGIN_TYPE_LABELS: Record<RequestOriginType, string> = {
  director: "Diretoria",
  department: "Departamento",
  sector: "Setor",
};

export const REQUEST_ORIGIN_TYPE_SHORT: Record<RequestOriginType, string> = {
  director: "Dir.",
  department: "Dep.",
  sector: "Set.",
};
