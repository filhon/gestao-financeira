/**
 * Text Sanitizer
 * Safely renders text content without XSS vulnerabilities
 * Replacement for dangerouslySetInnerHTML
 */

/**
 * Escapes HTML characters to prevent XSS
 */
export function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, (char) => map[char]);
}

/**
 * Converts markdown-style bold (**text**) to HTML
 * Safe because we escape all other HTML first
 */
export function formatTextWithBold(text: string): string {
  // First escape all HTML
  const escaped = escapeHtml(text);

  // Then apply safe formatting
  return escaped.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
}

/**
 * Strips all HTML tags from text
 */
export function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

/**
 * Allows only specific safe HTML tags
 */
export function sanitizeHtml(
  html: string,
  allowedTags: string[] = ["strong", "em", "b", "i"]
): string {
  const tagPattern = /<\/?([a-z][a-z0-9]*)\b[^>]*>/gi;

  return html.replace(tagPattern, (match, tag) => {
    if (allowedTags.includes(tag.toLowerCase())) {
      // Keep allowed tags but remove attributes
      return match.replace(/\s+[a-z-]+=["'][^"']*["']/gi, "");
    }
    return ""; // Remove disallowed tags
  });
}
