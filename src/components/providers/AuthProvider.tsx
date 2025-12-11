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
    registerWithEmail: (email: string, password: string, name: string) => Promise<void>;
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

                        // Backward compatibility: if status is missing but active is true, treat as 'active'
                        // Old 'pending' status maps to 'pending_company_setup'
                        let effectiveStatus = userData.status || (userData.active ? 'active' : 'pending_company_setup');
                        if ((effectiveStatus as string) === 'pending') {
                            effectiveStatus = 'pending_company_setup';
                        }
                        Cookies.set("user_status", effectiveStatus, { expires: 1 / 24 });

                        // Redirect based on status
                        if (effectiveStatus === 'pending_company_setup' && window.location.pathname !== '/company-setup') {
                            router.push('/company-setup');
                        } else if (effectiveStatus === 'pending_approval' && window.location.pathname !== '/pending-approval') {
                            router.push('/pending-approval');
                        }
                    } else {
                        // Create new user profile if it doesn't exist (First Login with Google usually)
                        // Note: Registration flow handles this manually, but this is a fallback for Google Sign In
                        const newUser: UserProfile = {
                            uid: firebaseUser.uid,
                            email: firebaseUser.email!,
                            displayName: firebaseUser.displayName || "User",
                            ...(firebaseUser.photoURL && { photoURL: firebaseUser.photoURL }),
                            role: 'user', // Default role for new users
                            companyRoles: {},
                            active: false, // Pending company setup
                            status: 'pending_company_setup',
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
                        Cookies.set("user_status", 'pending_company_setup', { expires: 1 / 24 });
                        router.push('/company-setup');
                    }
                } catch (error) {
                    console.error("Error fetching user profile:", error);
                    setUser(null);
                    Cookies.remove("auth_token");
                    Cookies.remove("user_role");
                    Cookies.remove("user_status");
                }
            } else {
                setUser(null);
                Cookies.remove("auth_token");
                Cookies.remove("user_role");
                Cookies.remove("user_status");
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

    const registerWithEmail = async (email: string, password: string, name: string) => {
        try {
            // 1. Create Auth User
            const userCredential = await import("firebase/auth").then(m => m.createUserWithEmailAndPassword(auth, email, password));
            const firebaseUser = userCredential.user;

            // 2. Update Profile Name
            await import("firebase/auth").then(m => m.updateProfile(firebaseUser, { displayName: name }));

            // 3. Create Firestore Profile (explicitly here to ensure setting name correctly)
            const userDocRef = doc(db, "users", firebaseUser.uid);
            const newUser: UserProfile = {
                uid: firebaseUser.uid,
                email: firebaseUser.email!,
                displayName: name, // Use provided name
                ...(firebaseUser.photoURL && { photoURL: firebaseUser.photoURL }),
                role: 'user', // Default role for new users
                companyRoles: {},
                active: false, // Pending company setup
                status: 'pending_company_setup',
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            await setDoc(userDocRef, {
                ...newUser,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            });

            // State update will happen via onAuthStateChanged, but we can push navigation if needed.
            // onAuthStateChanged will pick it up and redirect to /pending-approval anyway.
        } catch (error) {
            console.error("Error registering:", error);
            throw error;
        }
    };

    const logout = async () => {
        try {
            await signOut(auth);
            Cookies.remove("auth_token");
            Cookies.remove("user_role");
            Cookies.remove("user_status");
            router.push("/login");
        } catch (error) {
            console.error("Error logging out:", error);
        }
    };

    return (
        <AuthContext.Provider value={{ user, loading, loginWithGoogle, loginWithEmail, registerWithEmail, logout }}>
            {children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => useContext(AuthContext);
