import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const publicRoutes = ["/login", "/pending-approval"];

export function proxy(request: NextRequest) {
    const token = request.cookies.get("auth_token")?.value;
    const status = request.cookies.get("user_status")?.value;
    const { pathname } = request.nextUrl;

    // Check if route is public
    if (publicRoutes.some(route => pathname === route || pathname.startsWith(route + "/"))) {
        // If user is logged in and active, redirect login to dashboard
        if (token && status === 'active' && pathname === '/login') {
            return NextResponse.redirect(new URL("/", request.url));
        }
        return NextResponse.next();
    }

    // If no token and route is not public, redirect to login
    if (!token) {
        return NextResponse.redirect(new URL("/login", request.url));
    }

    // SECURITY: Block pending/rejected users from accessing protected routes
    if (status !== 'active') {
        return NextResponse.redirect(new URL("/pending-approval", request.url));
    }

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
