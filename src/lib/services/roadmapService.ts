import { 
  collection, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  getDocs, 
  query, 
  orderBy, 
  serverTimestamp,
  Timestamp 
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";

export type RoadmapStatus = "suggestion" | "planned" | "in_progress" | "done";

export interface RoadmapItem {
  id: string;
  title: string;
  description: string;
  status: RoadmapStatus;
  votes: number;
  userId: string;
  userEmail?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type NewRoadmapItem = Omit<RoadmapItem, "id" | "createdAt" | "updatedAt" | "votes">;

const COLLECTION_NAME = "roadmap_items";

export const roadmapService = {
  // Buscar todos os itens do roadmap
  getAllItems: async (): Promise<RoadmapItem[]> => {
    try {
      const q = query(collection(db, COLLECTION_NAME), orderBy("createdAt", "desc"));
      const querySnapshot = await getDocs(q);
      
      return querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as RoadmapItem[];
    } catch (error) {
      console.error("Error fetching roadmap items:", error);
      throw error;
    }
  },

  // Adicionar um novo item (sugestão)
  addItem: async (item: NewRoadmapItem): Promise<string> => {
    try {
      const docRef = await addDoc(collection(db, COLLECTION_NAME), {
        ...item,
        votes: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return docRef.id;
    } catch (error) {
      console.error("Error adding roadmap item:", error);
      throw error;
    }
  },

  // Atualizar um item (apenas admins, controlado pelas regras de segurança e UI)
  updateItem: async (id: string, updates: Partial<RoadmapItem>): Promise<void> => {
    try {
      const docRef = doc(db, COLLECTION_NAME, id);
      await updateDoc(docRef, {
        ...updates,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error("Error updating roadmap item:", error);
      throw error;
    }
  },

  // Deletar um item
  deleteItem: async (id: string): Promise<void> => {
    try {
      const docRef = doc(db, COLLECTION_NAME, id);
      await deleteDoc(docRef);
    } catch (error) {
      console.error("Error deleting roadmap item:", error);
      throw error;
    }
  },

  // Mover item para outra coluna/status
  updateItemStatus: async (id: string, newStatus: RoadmapStatus): Promise<void> => {
    try {
      const docRef = doc(db, COLLECTION_NAME, id);
      await updateDoc(docRef, {
        status: newStatus,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error("Error updating roadmap item status:", error);
      throw error;
    }
  },

};
