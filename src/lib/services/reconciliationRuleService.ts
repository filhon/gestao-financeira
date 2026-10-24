import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { auditService } from "@/lib/services/auditService";
import { ReconciliationRule } from "@/lib/types";
import { stripUndefined } from "@/lib/utils";

const COLLECTION_NAME = "reconciliation_rules";

type Actor = { uid: string; email: string };

export type ReconciliationRuleDraft = Pick<
  ReconciliationRule,
  "pattern" | "direction" | "action" | "template"
>;

export const reconciliationRuleService = {
  async getAll(companyId: string): Promise<ReconciliationRule[]> {
    const snap = await getDocs(
      query(
        collection(db, COLLECTION_NAME),
        where("companyId", "==", companyId),
      ),
    );
    return snap.docs
      .map((d) => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
          createdAt: (data.createdAt as Timestamp)?.toDate(),
        } as ReconciliationRule;
      })
      .sort((a, b) => a.pattern.localeCompare(b.pattern, "pt-BR"));
  },

  async create(
    draft: ReconciliationRuleDraft,
    companyId: string,
    actor: Actor,
  ) {
    const ref = await addDoc(
      collection(db, COLLECTION_NAME),
      stripUndefined({
        ...draft,
        companyId,
        active: true,
        createdBy: actor.uid,
        createdAt: serverTimestamp(),
      }),
    );
    await auditService.log({
      companyId,
      userId: actor.uid,
      userEmail: actor.email,
      action: "create",
      entity: "reconciliation_rule",
      entityId: ref.id,
      details: { pattern: draft.pattern, action: draft.action },
    });
    return ref.id;
  },

  async setActive(rule: ReconciliationRule, active: boolean, actor: Actor) {
    await updateDoc(doc(db, COLLECTION_NAME, rule.id), { active });
    await auditService.log({
      companyId: rule.companyId,
      userId: actor.uid,
      userEmail: actor.email,
      action: "update",
      entity: "reconciliation_rule",
      entityId: rule.id,
      details: { pattern: rule.pattern, active },
    });
  },

  async delete(rule: ReconciliationRule, actor: Actor) {
    await deleteDoc(doc(db, COLLECTION_NAME, rule.id));
    await auditService.log({
      companyId: rule.companyId,
      userId: actor.uid,
      userEmail: actor.email,
      action: "delete",
      entity: "reconciliation_rule",
      entityId: rule.id,
      details: { pattern: rule.pattern },
    });
  },
};
