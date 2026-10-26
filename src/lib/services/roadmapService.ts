import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  getDocs,
  query,
  where,
  arrayUnion,
  arrayRemove,
  serverTimestamp,
  Timestamp,
  DocumentData,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import {
  PUBLIC_STATUSES,
  voterKey,
  type RoadmapItem,
} from "@/lib/roadmap";

const COLLECTION_NAME = "roadmap_items";

const toItem = (id: string, data: DocumentData): RoadmapItem => ({
  ...(data as Omit<RoadmapItem, "id">),
  id,
  voters: Array.isArray(data.voters) ? data.voters : [],
  createdAt: (data.createdAt as Timestamp)?.toDate(),
  updatedAt: (data.updatedAt as Timestamp)?.toDate(),
  doneAt: (data.doneAt as Timestamp)?.toDate(),
});

export const roadmapService = {
  // O admin lê tudo; os demais juntam o que é da própria empresa com o que já
  // é público. Duas consultas porque as rules só liberam leituras que elas
  // conseguem provar pelo filtro.
  async getVisible(
    companyId: string | undefined,
    isAdmin: boolean,
  ): Promise<RoadmapItem[]> {
    const ref = collection(db, COLLECTION_NAME);
    const snaps = isAdmin
      ? [await getDocs(ref)]
      : await Promise.all([
          getDocs(query(ref, where("status", "in", PUBLIC_STATUSES))),
          ...(companyId
            ? [getDocs(query(ref, where("companyId", "==", companyId)))]
            : []),
        ]);
    const byId = new Map<string, RoadmapItem>();
    snaps.forEach((s) =>
      s.docs.forEach((d) => byId.set(d.id, toItem(d.id, d.data()))),
    );
    return [...byId.values()];
  },

  async create(data: {
    title: string;
    description: string;
    companyId: string;
    userId: string;
    authorName: string;
  }): Promise<string> {
    const ref = await addDoc(collection(db, COLLECTION_NAME), {
      ...data,
      status: "suggestion",
      // Quem sugere já conta como o primeiro voto
      voters: [voterKey(data.companyId, data.userId)],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return ref.id;
  },

  // Autor (enquanto é sugestão) ou admin
  async update(id: string, data: { title: string; description: string }) {
    await updateDoc(doc(db, COLLECTION_NAME, id), {
      ...data,
      updatedAt: serverTimestamp(),
    });
  },

  async remove(id: string) {
    await deleteDoc(doc(db, COLLECTION_NAME, id));
  },

  async vote(id: string, key: string, on: boolean) {
    await updateDoc(doc(db, COLLECTION_NAME, id), {
      voters: on ? arrayUnion(key) : arrayRemove(key),
    });
  },
};
