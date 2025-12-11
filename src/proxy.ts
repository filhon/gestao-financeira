import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const publicRoutes = ["/login", "/pending-approval", "/company-setup"];

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
        // If user needs company setup but is on pending-approval, redirect to company-setup
        if (token && status === 'pending_company_setup' && pathname === '/pending-approval') {
            return NextResponse.redirect(new URL("/company-setup", request.url));
        }
        // If user is pending approval but is on company-setup, redirect to pending-approval
        if (token && status === 'pending_approval' && pathname === '/company-setup') {
            return NextResponse.redirect(new URL("/pending-approval", request.url));
        }
        return NextResponse.next();
    }

    // If no token and route is not public, redirect to login
    if (!token) {
        return NextResponse.redirect(new URL("/login", request.url));
    }

    // SECURITY: Block pending users from accessing protected routes
    if (status === 'pending_company_setup') {
        return NextResponse.redirect(new URL("/company-setup", request.url));
    }
    
    if (status === 'pending_approval' || status === 'pending') {
        return NextResponse.redirect(new URL("/pending-approval", request.url));
    }
    
    if (status === 'rejected') {
        return NextResponse.redirect(new URL("/login", request.url));
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
