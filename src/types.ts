/**
 * The clip object the server sends (`GET /api/obsidian/clips`). This mirrors
 * `obsidian_api.clip_payload` on the backend; the two must move together.
 */
export interface Clip {
	id: number;
	title: string;
	creator: string;
	platform: string; // tiktok | instagram | youtube | x | facebook | other
	url: string;
	notebook: string;
	notebook_id: number;
	note: string; // what the user typed when saving ("why I saved this")
	takeaways: string[];
	transcript: string; // for a carousel this is the slide text
	transcript_method: string;
	caption: string;
	media_kind: 'video' | 'carousel';
	slide_count: number | null;
	duration: number | null; // seconds
	thumbnail_url: string | null;
	saved_at: string; // ISO 8601 with timezone
	completed_at: string | null;
}

export interface ClipsPage {
	clips: Clip[];
	next: number | null; // pass back as `after`
}
