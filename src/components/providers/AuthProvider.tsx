"use client";

import { createContext, useContext, useEffect, useState, useRef } from "react";
import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onIdTokenChanged,
  signInWithEmailAndPassword,
} from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "@/lib/firebase/client";
import { UserProfile } from "@/lib/types";
import { useRouter } from "next/navigation";
import Cookies from "js-cookie";

interface AuthContextType {
  user: UserProfile | null;
  loading: boolean;
  loginWithGoogle: () => Promise<void>;
  loginWithEmail: (email: string, password: string) => Promise<void>;
  registerWithEmail: (
    email: string,
    password: string,
    name: string,
  ) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const profileLoadedRef = useRef(false);

  useEffect(() => {
    // Use onIdTokenChanged instead of onAuthStateChanged so the cookie
    // is refreshed every time the Firebase SDK silently renews the token
    // (~every 55 minutes). onAuthStateChanged only fires on sign-in/out.
    const unsubscribe = onIdTokenChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        try {
          // Refresh the auth cookie on every token change
          const token = await firebaseUser.getIdToken();
          Cookies.set("auth_token", token, { expires: 7 }); // 7 days

          // Only fetch the full profile on the first load (sign-in).
          // Subsequent token refreshes just update the cookie above.
          if (profileLoadedRef.current) {
            setLoading(false);
            return;
          }

          // Fetch user profile from Firestore
          const userDocRef = doc(db, "users", firebaseUser.uid);
          const userDoc = await getDoc(userDocRef);

          if (userDoc.exists()) {
            const userData = userDoc.data() as UserProfile;
            setUser(userData);
            profileLoadedRef.current = true;
            Cookies.set("user_role", userData.role, { expires: 7 });

            // Backward compatibility: if status is missing but active is true, treat as 'active'
            // Old 'pending' status maps to 'pending_company_setup'
            let effectiveStatus =
              userData.status ||
              (userData.active ? "active" : "pending_company_setup");
            if ((effectiveStatus as string) === "pending") {
              effectiveStatus = "pending_company_setup";
            }
            Cookies.set("user_status", effectiveStatus, { expires: 7 });

            // Redirect based on status
            if (
              effectiveStatus === "pending_company_setup" &&
              window.location.pathname !== "/company-setup"
            ) {
              router.push("/company-setup");
            } else if (
              effectiveStatus === "pending_approval" &&
              window.location.pathname !== "/pending-approval"
            ) {
              router.push("/pending-approval");
            } else if (effectiveStatus === "active") {
              const path = window.location.pathname;
              if (path === "/" || path === "/login") {
                router.push("/dashboard");
              }
            }
          } else {
            // Create new user profile if it doesn't exist (First Login with Google usually)
            // Note: Registration flow handles this manually, but this is a fallback for Google Sign In
            const newUser: UserProfile = {
              uid: firebaseUser.uid,
              email: firebaseUser.email!,
              displayName: firebaseUser.displayName || "User",
              ...(firebaseUser.photoURL && { photoURL: firebaseUser.photoURL }),
              role: "user", // Default role for new users
              companyRoles: {},
              active: false, // Pending company setup
              status: "pending_company_setup",
              createdAt: new Date(),
              updatedAt: new Date(),
            };

            await setDoc(userDocRef, {
              ...newUser,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });

            setUser(newUser);
            profileLoadedRef.current = true;
            Cookies.set("user_role", newUser.role, { expires: 7 });
            Cookies.set("user_status", "pending_company_setup", {
              expires: 7,
            });
            router.push("/company-setup");
          }
        } catch (error) {
          console.error("Error fetching user profile:", error);
          // Don't destroy the session on transient errors (e.g. network
          // hiccups when the tab was in the background). If a user was
          // already loaded, keep it — the Firebase Auth session is still
          // valid and a page refresh will recover automatically.
          if (!profileLoadedRef.current) {
            // Only clear state if we never successfully loaded a profile
            setUser(null);
            Cookies.remove("auth_token");
            Cookies.remove("user_role");
            Cookies.remove("user_status");
          }
        }
      } else {
        // User truly signed out
        setUser(null);
        profileLoadedRef.current = false;
        Cookies.remove("auth_token");
        Cookies.remove("user_role");
        Cookies.remove("user_status");
      }
      setLoading(false);
    });

    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Changed dependency from [router] to [] to prevent unnecessary re-subscriptions

  const loginWithGoogle = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      // Navigation handled by onAuthStateChanged based on user status
    } catch (error) {
      console.error("Error logging in with Google:", error);
      throw error;
    }
  };

  const loginWithEmail = async (email: string, password: string) => {
    try {
      await signInWithEmailAndPassword(auth, email, password);
      // Navigation handled by onAuthStateChanged based on user status
    } catch (error) {
      console.error("Error logging in with Email:", error);
      throw error;
    }
  };

  const registerWithEmail = async (
    email: string,
    password: string,
    name: string,
  ) => {
    try {
      // 1. Create Auth User
      const userCredential = await import("firebase/auth").then((m) =>
        m.createUserWithEmailAndPassword(auth, email, password),
      );
      const firebaseUser = userCredential.user;

      // 2. Update Profile Name
      await import("firebase/auth").then((m) =>
        m.updateProfile(firebaseUser, { displayName: name }),
      );

      // 3. Create Firestore Profile (explicitly here to ensure setting name correctly)
      const userDocRef = doc(db, "users", firebaseUser.uid);
      const newUser: UserProfile = {
        uid: firebaseUser.uid,
        email: firebaseUser.email!,
        displayName: name, // Use provided name
        ...(firebaseUser.photoURL && { photoURL: firebaseUser.photoURL }),
        role: "user", // Default role for new users
        companyRoles: {},
        active: false, // Pending company setup
        status: "pending_company_setup",
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
    <AuthContext.Provider
      value={{
        user,
        loading,
        loginWithGoogle,
        loginWithEmail,
        registerWithEmail,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
