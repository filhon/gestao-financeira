"use client";

"use client";

import { createContext, useContext, useEffect, useState } from "react";
import {
    User as FirebaseUser,
    GoogleAuthProvider,
    signInWithPopup,
    signOut,
    onAuthStateChanged,
    signInWithEmailAndPassword
} from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "@/lib/firebase/client";
import { UserProfile, UserRole } from "@/lib/types";
import { useRouter } from "next/navigation";
import Cookies from "js-cookie";

interface AuthContextType {
    user: UserProfile | null;
    loading: boolean;
    loginWithGoogle: () => Promise<void>;
    loginWithEmail: (email: string, password: string) => Promise<void>;
    logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<UserProfile | null>(null);
    const [loading, setLoading] = useState(true);
    const router = useRouter();

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
            if (firebaseUser) {
                try {
                    // Get ID token and set cookie
                    const token = await firebaseUser.getIdToken();
                    Cookies.set("auth_token", token, { expires: 1 / 24 }); // 1 hour

                    // Fetch user profile from Firestore
                    const userDocRef = doc(db, "users", firebaseUser.uid);
                    const userDoc = await getDoc(userDocRef);

                    if (userDoc.exists()) {
                        const userData = userDoc.data() as UserProfile;
                        setUser(userData);
                        Cookies.set("user_role", userData.role, { expires: 1 / 24 });
                    } else {
                        // Create new user profile if it doesn't exist
                        const newUser: UserProfile = {
                            uid: firebaseUser.uid,
                            email: firebaseUser.email!,
                            displayName: firebaseUser.displayName || "User",
                            photoURL: firebaseUser.photoURL || undefined,
                            role: 'financial_manager', // Default role
                            active: true,
                            createdAt: new Date(),
                            updatedAt: new Date(),
                        };

                        await setDoc(userDocRef, {
                            ...newUser,
                            createdAt: serverTimestamp(),
                            updatedAt: serverTimestamp(),
                        });

                        setUser(newUser);
                        Cookies.set("user_role", newUser.role, { expires: 1 / 24 });
                    }
                } catch (error) {
                    console.error("Error fetching user profile:", error);
                    setUser(null);
                    Cookies.remove("auth_token");
                    Cookies.remove("user_role");
                }
            } else {
                setUser(null);
                Cookies.remove("auth_token");
                Cookies.remove("user_role");
            }
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    const loginWithGoogle = async () => {
        try {
            const provider = new GoogleAuthProvider();
            await signInWithPopup(auth, provider);
            router.push("/");
        } catch (error) {
            console.error("Error logging in with Google:", error);
            throw error;
        }
    };

    const loginWithEmail = async (email: string, password: string) => {
        try {
            await signInWithEmailAndPassword(auth, email, password);
            router.push("/");
        } catch (error) {
            console.error("Error logging in with Email:", error);
            throw error;
        }
    };

    const logout = async () => {
        try {
            await signOut(auth);
            Cookies.remove("auth_token");
            Cookies.remove("user_role");
            router.push("/login");
        } catch (error) {
            console.error("Error logging out:", error);
        }
    };

    return (
        <AuthContext.Provider value={{ user, loading, loginWithGoogle, loginWithEmail, logout }}>
            {children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => useContext(AuthContext);
