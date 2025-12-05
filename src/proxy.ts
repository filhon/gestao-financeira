import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const publicRoutes = ["/login"];

export function proxy(request: NextRequest) {
    const token = request.cookies.get("auth_token")?.value;
    const role = request.cookies.get("user_role")?.value;
    const { pathname } = request.nextUrl;

    // Check if route is public
    if (publicRoutes.includes(pathname)) {
        // If user is logged in and tries to access login, redirect to dashboard
        if (token) {
            return NextResponse.redirect(new URL("/", request.url));
        }
        return NextResponse.next();
    }

    // If no token and route is not public, redirect to login
    if (!token) {
        return NextResponse.redirect(new URL("/login", request.url));
    }

    // RBAC Logic (Example)
    // if (pathname.startsWith("/configuracoes") && role !== "admin") {
    //   return NextResponse.redirect(new URL("/", request.url));
    // }

    return NextResponse.next();
}

export const config = {
    matcher: [
        /*
         * Match all request paths except for the ones starting with:
         * - api (API routes)
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         */
        "/((?!api|_next/static|_next/image|favicon.ico).*)",
    ],
};
