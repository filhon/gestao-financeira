"use client";

import {
    collection,
    addDoc,
    updateDoc,
    doc,
    getDocs,
    getDoc,
    query,
    where,
    orderBy,
    Timestamp,
    DocumentData,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { Feedback, FeedbackStatus, FeedbackType, FeedbackPriority, SystemFeature } from "@/lib/types";
import { notificationService } from "./notificationService";

const COLLECTION_NAME = "feedbacks";

const convertDates = (data: DocumentData): Feedback => {
    return {
        id: data.id,
        ...data,
        createdAt: (data.createdAt as Timestamp)?.toDate(),
        updatedAt: (data.updatedAt as Timestamp)?.toDate(),
        respondedAt: (data.respondedAt as Timestamp)?.toDate(),
        errorContext: data.errorContext ? {
            ...data.errorContext,
            timestamp: (data.errorContext.timestamp as Timestamp)?.toDate(),
        } : undefined,
    } as Feedback;
};

export interface CreateFeedbackData {
    userId: string;
    userEmail: string;
    userName: string;
    type: FeedbackType;
    priority: FeedbackPriority;
    relatedFeatures: SystemFeature[];
    title: string;
    description: string;
    screenshotUrl?: string;
    errorContext?: {
        message: string;
        url: string;
        timestamp: Date;
    };
}

export const feedbackService = {
    /**
     * Create a new feedback and notify global admins
     */
    create: async (data: CreateFeedbackData): Promise<string> => {
        const now = new Date();
        const docRef = await addDoc(collection(db, COLLECTION_NAME), {
            userId: data.userId,
            userEmail: data.userEmail,
            userName: data.userName,
            type: data.type,
            priority: data.priority,
            relatedFeatures: data.relatedFeatures,
            title: data.title,
            description: data.description,
            screenshotUrl: data.screenshotUrl || null,
            status: 'pending' as FeedbackStatus,
            read: false,
            createdAt: Timestamp.fromDate(now),
            updatedAt: Timestamp.fromDate(now),
            errorContext: data.errorContext ? {
                message: data.errorContext.message,
                url: data.errorContext.url,
                timestamp: Timestamp.fromDate(data.errorContext.timestamp),
            } : null,
        });

        // Notify global admins about new feedback
        await feedbackService.notifyAdminsOfNewFeedback(data.userName, data.type, data.title);

        return docRef.id;
    },

    /**
     * Get all feedbacks for a specific user
     */
    getByUser: async (userId: string): Promise<Feedback[]> => {
        const q = query(
            collection(db, COLLECTION_NAME),
            where("userId", "==", userId),
            orderBy("createdAt", "desc")
        );

        const snapshot = await getDocs(q);
        return snapshot.docs.map((doc) => convertDates({ id: doc.id, ...doc.data() }));
    },

    /**
     * Get all feedbacks (admin only)
     */
    getAll: async (): Promise<Feedback[]> => {
        const q = query(
            collection(db, COLLECTION_NAME),
            orderBy("createdAt", "desc")
        );

        const snapshot = await getDocs(q);
        return snapshot.docs.map((doc) => convertDates({ id: doc.id, ...doc.data() }));
    },

    /**
     * Get a single feedback by ID
     */
    getById: async (id: string): Promise<Feedback | null> => {
        const docRef = doc(db, COLLECTION_NAME, id);
        const docSnap = await getDoc(docRef);
        
        if (!docSnap.exists()) return null;
        return convertDates({ id: docSnap.id, ...docSnap.data() });
    },

    /**
     * Respond to a feedback (admin action)
     */
    respond: async (
        id: string, 
        response: string, 
        admin: { uid: string; email: string; displayName?: string }
    ): Promise<void> => {
        const now = new Date();
        const docRef = doc(db, COLLECTION_NAME, id);
        
        // Get feedback to notify user
        const feedback = await feedbackService.getById(id);
        if (!feedback) throw new Error("Feedback not found");

        await updateDoc(docRef, {
            adminResponse: response,
            respondedBy: admin.uid,
            respondedByEmail: admin.email,
            respondedAt: Timestamp.fromDate(now),
            status: 'resolved' as FeedbackStatus,
            updatedAt: Timestamp.fromDate(now),
        });

        // Notify user that their feedback was responded
        await notificationService.create({
            userId: feedback.userId,
            companyId: '', // System-wide notification
            title: 'Resposta ao seu feedback',
            message: `Seu feedback "${feedback.title}" recebeu uma resposta dos desenvolvedores.`,
            type: 'info',
            link: '/feedback',
        });
    },

    /**
     * Update feedback status
     */
    updateStatus: async (id: string, status: FeedbackStatus): Promise<void> => {
        const docRef = doc(db, COLLECTION_NAME, id);
        await updateDoc(docRef, {
            status,
            updatedAt: Timestamp.fromDate(new Date()),
        });
    },

    /**
     * Mark feedback as read (admin action)
     */
    markAsRead: async (id: string): Promise<void> => {
        const docRef = doc(db, COLLECTION_NAME, id);
        await updateDoc(docRef, {
            read: true,
            updatedAt: Timestamp.fromDate(new Date()),
        });
    },

    /**
     * Notify global admins about new feedback
     * Prepared for future email integration via Resend
     */
    notifyAdminsOfNewFeedback: async (
        userName: string,
        feedbackType: FeedbackType,
        title: string
    ): Promise<void> => {
        // Find global admins
        const usersRef = collection(db, "users");
        const adminQuery = query(usersRef, where("role", "==", "admin"));
        const adminSnapshot = await getDocs(adminQuery);

        const typeLabels: Record<FeedbackType, string> = {
            bug: 'Bug',
            improvement: 'Sugestão',
            question: 'Dúvida',
            praise: 'Elogio',
        };

        // Send in-app notification to each admin
        for (const adminDoc of adminSnapshot.docs) {
            await notificationService.create({
                userId: adminDoc.id,
                companyId: '', // System-wide
                title: `Novo feedback: ${typeLabels[feedbackType]}`,
                message: `${userName} enviou: "${title}"`,
                type: 'info',
                link: '/configuracoes/feedbacks',
            });
        }

        // TODO: Future - Send email notification via Resend
        // await emailService.sendFeedbackNotification(adminEmails, { userName, type, title });
    },

    /**
     * Get unread feedback count (for admin badge)
     */
    getUnreadCount: async (): Promise<number> => {
        const q = query(
            collection(db, COLLECTION_NAME),
            where("read", "==", false)
        );
        const snapshot = await getDocs(q);
        return snapshot.size;
    },
};
