import { db } from "@/lib/firebase/client";
import {
  doc,
  getDoc,
  setDoc,
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  Timestamp,
} from "firebase/firestore";

export type LegalDocumentType = "privacy_policy" | "terms_of_service";

export interface LegalDocumentVersion {
  id: string;
  content: string;
  createdAt: Date;
}

export const getLegalDocument = async (
  type: LegalDocumentType
): Promise<string | null> => {
  try {
    const docRef = doc(db, "legal_documents", type);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      return docSnap.data().content as string;
    } else {
      return null;
    }
  } catch (error) {
    console.error(`Error fetching legal document ${type}:`, error);
    return null;
  }
};

export const getLegalDocumentVersions = async (
  type: LegalDocumentType
): Promise<LegalDocumentVersion[]> => {
  try {
    const versionsRef = collection(db, "legal_documents", type, "versions");
    const q = query(versionsRef, orderBy("createdAt", "desc"));
    const querySnapshot = await getDocs(q);

    return querySnapshot.docs.map((doc) => ({
      id: doc.id,
      content: doc.data().content,
      createdAt: (doc.data().createdAt as Timestamp).toDate(),
    }));
  } catch (error) {
    console.error(`Error fetching versions for ${type}:`, error);
    return [];
  }
};

export const getLegalDocumentVersionContent = async (
  type: LegalDocumentType,
  versionId: string
): Promise<string | null> => {
  try {
    const docRef = doc(db, "legal_documents", type, "versions", versionId);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      return docSnap.data().content as string;
    } else {
      return null;
    }
  } catch (error) {
    console.error(`Error fetching version ${versionId} for ${type}:`, error);
    return null;
  }
};

export const saveLegalDocument = async (
  type: LegalDocumentType,
  content: string
): Promise<void> => {
  try {
    const timestamp = new Date();

    // 1. Save to versions subcollection
    const versionsRef = collection(db, "legal_documents", type, "versions");
    await addDoc(versionsRef, {
      content,
      createdAt: timestamp,
    });

    // 2. Update main document (current version)
    const docRef = doc(db, "legal_documents", type);
    await setDoc(docRef, { content, updatedAt: timestamp });
  } catch (error) {
    console.error(`Error saving legal document ${type}:`, error);
    throw error;
  }
};
