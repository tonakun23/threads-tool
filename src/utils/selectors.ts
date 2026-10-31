/**
 * Threads.net DOM Selectors
 *
 * Centralized selector management for easier maintenance
 * when Threads updates their DOM structure.
 *
 * Updated based on actual DOM inspection (2024-12)
 */

export const SELECTORS = {
    // Search page
    search: {
        // Main content region
        contentRegion: 'div[role="main"], [role="region"]',
        // Results area - the scrollable content
        results: 'div[role="main"]',
        // Post containers - only select containers that have a post link
        post: 'div[tabindex="0"]:has(a[href*="/post/"])',
        postContainer: 'div[tabindex="0"]:has(a[href*="/post/"])',
        noResults: 'div:has-text("No results found"), div:has-text("找不到結果")',
    },

    // Post elements
    post: {
        // Author info
        author: {
            // Username link: /@username (not post links)
            username: 'a[href^="/@"]:not([href*="/post/"])',
            // Display name - text inside the author link
            name: 'a[href^="/@"]:not([href*="/post/"]) span',
            // Avatar image
            avatar: 'img[alt*="大頭貼照"], img[alt*="profile picture"], img[alt*="avatar"]',
            // Verified badge
            verified: 'svg[aria-label*="已驗證"], svg[aria-label*="Verified"], img[alt*="已驗證"], img[alt*="Verified"]',
        },
        // Post link pattern: /@username/post/xxx
        postLink: 'a[href*="/post/"]',
        // Post content - text with dir="auto"
        content: 'div[dir="auto"], span[dir="auto"]',
        // Timestamp
        timestamp: 'time',
        // Stats buttons - match by Chinese or English text patterns
        stats: {
            likes: 'div[role="button"]:has-text("讚"), div[role="button"]:has-text("like"), button:has-text("讚"), button:has-text("like")',
            replies: 'div[role="button"]:has-text("留言"), div[role="button"]:has-text("回覆"), div[role="button"]:has-text("comment"), div[role="button"]:has-text("reply")',
            reposts: 'div[role="button"]:has-text("轉發"), div[role="button"]:has-text("repost")',
            shares: 'div[role="button"]:has-text("分享"), div[role="button"]:has-text("share")',
        },
        // Images in post (exclude avatars)
        images: 'img:not([alt*="大頭貼"]):not([alt*="profile"]):not([alt*="avatar"])',
    },

    // Profile page
    profile: {
        displayName: 'h1',
        username: 'a[href^="/@"]',
        bio: 'div[dir="auto"]',
        avatar: 'img[alt*="大頭貼照"], img[alt*="profile picture"]',
        verified: 'svg[aria-label*="已驗證"], svg[aria-label*="Verified"]',
        stats: {
            followers: 'a[href*="followers"]',
            following: 'a[href*="following"]',
        },
    },

    // Common
    common: {
        spinner: '[role="progressbar"], div[aria-label*="Loading"], div[aria-label*="載入"]',
        loginPrompt: 'button:has-text("登入"), button:has-text("Log in")',
        loadMore: 'button:has-text("載入更多"), button:has-text("Load more"), button:has-text("Show more")',
    },
} as const;

// Helper function to build selector string
export function buildSelector(...parts: string[]): string {
    return parts.join(', ');
}
