/**
 * The note template. A small, explicit engine rather than a dependency:
 * `{{var}}`, `{{var|filter}}`, `{{var|filter:arg}}`, and
 * `{{#if var}} … {{else}} … {{/if}}` (nestable). Tags that sit alone on a
 * line consume the line, the way Handlebars treats standalone blocks, so
 * an omitted section leaves no blank hole behind.
 *
 * Every variable is always defined (see `variables`), so a template never
 * has to guard against a missing field — only against an empty one.
 */
import type { Clip } from './types';

/**
 * Date formatting without moment. Obsidian exports moment, but the type of
 * that export resolves to `any` wherever the moment typings are not
 * installed — which includes the directory's automated review — and the
 * handful of tokens a note template needs are easy to cover by hand.
 * Tokens: YYYY YY MMMM MMM MM M DD D dddd ddd HH H hh h mm ss A a. Anything
 * in [square brackets] is literal.
 */
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function formatDate(d: Date, fmt: string): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	const h12 = d.getHours() % 12 || 12;
	const tokens: Record<string, () => string> = {
		YYYY: () => String(d.getFullYear()),
		YY: () => String(d.getFullYear()).slice(-2),
		MMMM: () => MONTHS[d.getMonth()] ?? '',
		MMM: () => (MONTHS[d.getMonth()] ?? '').slice(0, 3),
		MM: () => pad(d.getMonth() + 1),
		M: () => String(d.getMonth() + 1),
		DD: () => pad(d.getDate()),
		D: () => String(d.getDate()),
		dddd: () => DAYS[d.getDay()] ?? '',
		ddd: () => (DAYS[d.getDay()] ?? '').slice(0, 3),
		HH: () => pad(d.getHours()),
		H: () => String(d.getHours()),
		hh: () => pad(h12),
		h: () => String(h12),
		mm: () => pad(d.getMinutes()),
		ss: () => pad(d.getSeconds()),
		A: () => (d.getHours() < 12 ? 'AM' : 'PM'),
		a: () => (d.getHours() < 12 ? 'am' : 'pm'),
	};
	return fmt.replace(/\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|H|hh|h|mm|ss|A|a/g, (m, literal: string | undefined) =>
		literal !== undefined ? literal : (tokens[m]?.() ?? m),
	);
}

export const PLATFORM_LABELS: Record<string, string> = {
	tiktok: 'TikTok',
	instagram: 'Instagram',
	youtube: 'YouTube',
	x: 'X',
	twitter: 'X',
	facebook: 'Facebook',
};

export type Vars = Record<string, string | number | boolean | string[] | Date | null>;

export function variables(clip: Clip): Vars {
	const platformLabel = PLATFORM_LABELS[clip.platform] ?? capitalize(clip.platform || 'source');
	const saved = clip.saved_at ? new Date(clip.saved_at) : new Date();
	const title = clip.title || clip.creator || `${platformLabel} ${clip.media_kind === 'carousel' ? 'carousel' : 'clip'}`;
	return {
		clip_id: clip.id,
		title,
		creator: clip.creator,
		platform: clip.platform,
		platform_label: platformLabel,
		url: clip.url,
		clippings_url: clip.clippings_url,
		notebook: clip.notebook,
		note: clip.note,
		takeaways: clip.takeaways,
		transcript: clip.transcript,
		transcript_method: clip.transcript_method,
		caption: clip.caption,
		media_kind: clip.media_kind,
		carousel: clip.media_kind === 'carousel',
		slide_count: clip.slide_count,
		duration: clip.duration,
		duration_label: durationLabel(clip.duration),
		thumbnail_url: clip.thumbnail_url,
		saved,
		completed: clip.completed_at ? new Date(clip.completed_at) : null,
		year: formatDate(saved, 'YYYY'),
		month: formatDate(saved, 'MM'),
	};
}

function capitalize(s: string): string {
	return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}

export function durationLabel(seconds: number | null): string {
	if (!seconds) return '';
	const m = Math.floor(seconds / 60);
	const s = seconds % 60;
	return m ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
}

export function slugify(s: string): string {
	return s
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

function truthy(v: Vars[string]): boolean {
	if (Array.isArray(v)) return v.length > 0;
	return v !== null && v !== undefined && v !== '' && v !== 0 && v !== false;
}

function text(v: Vars[string]): string {
	if (v === null || v === undefined) return '';
	if (Array.isArray(v)) return v.join(', ');
	if (v instanceof Date) return formatDate(v, 'YYYY-MM-DD');
	return String(v);
}

const FILTERS: Record<string, (v: Vars[string], arg: string) => string> = {
	// Dates: moment-style tokens (see formatDate), default a local datetime Obsidian reads as a date property.
	date: (v, arg) => (v instanceof Date ? formatDate(v, arg || 'YYYY-MM-DDTHH:mm:ss') : text(v)),
	slug: (v) => slugify(text(v)),
	upper: (v) => text(v).toUpperCase(),
	lower: (v) => text(v).toLowerCase(),
	truncate: (v, arg) => {
		const n = parseInt(arg, 10) || 60;
		const s = text(v);
		if (s.length <= n) return s;
		const cut = s.slice(0, n);
		const at = cut.lastIndexOf(' ');
		return (at > n / 2 ? cut.slice(0, at) : cut).trimEnd();
	},
	// A string safe on the right of a YAML key — JSON is valid YAML for scalars.
	yaml: (v) => (typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(text(v))),
	wikilink: (v) => (text(v) ? `[[${text(v).replace(/[[\]|#^]/g, '')}]]` : ''),
	// Arrays become a Markdown list; scalars a single item.
	list: (v) => (Array.isArray(v) ? v : text(v) ? [text(v)] : []).map((t) => `- ${t}`).join('\n'),
	// Every line prefixed for a callout or blockquote body.
	quote: (v) =>
		text(v)
			.split('\n')
			.map((l) => `> ${l}`)
			.join('\n'),
	// Tag-safe: no spaces, no punctuation Obsidian rejects in tags.
	tag: (v) => slugify(text(v)).replace(/-/g, '_'),
};

export class TemplateError extends Error {}

/** Render `template` against `vars`. Unknown variables render as ''. */
export function render(template: string, vars: Vars): string {
	const standalone = /^[ \t]*({{#if [^}]+}}|{{else}}|{{\/if}})[ \t]*\r?\n/gm;
	const src = template.replace(standalone, '$1');
	return renderBlocks(src, vars);
}

function renderBlocks(src: string, vars: Vars): string {
	let out = '';
	let i = 0;
	while (i < src.length) {
		const open = src.indexOf('{{#if ', i);
		if (open === -1) {
			out += renderInline(src.slice(i), vars);
			break;
		}
		out += renderInline(src.slice(i, open), vars);
		const headEnd = src.indexOf('}}', open);
		if (headEnd === -1) throw new TemplateError('Unclosed {{#if}} tag.');
		const name = src.slice(open + 6, headEnd).trim();
		// Find the matching {{/if}}, honouring nesting.
		let depth = 1;
		let pos = headEnd + 2;
		let elseAt = -1;
		let closeAt = -1;
		while (pos < src.length) {
			const nextOpen = src.indexOf('{{#if ', pos);
			const nextElse = src.indexOf('{{else}}', pos);
			const nextClose = src.indexOf('{{/if}}', pos);
			if (nextClose === -1) throw new TemplateError(`{{#if ${name}}} is never closed.`);
			const candidates = [nextOpen, nextElse, nextClose].filter((n) => n !== -1);
			const next = Math.min(...candidates);
			if (next === nextOpen) {
				depth++;
				pos = next + 6;
			} else if (next === nextElse) {
				if (depth === 1 && elseAt === -1) elseAt = next;
				pos = next + 8;
			} else {
				depth--;
				if (depth === 0) {
					closeAt = next;
					break;
				}
				pos = next + 7;
			}
		}
		const body = src.slice(headEnd + 2, closeAt);
		const [whenTrue, whenFalse] =
			elseAt === -1 ? [body, ''] : [src.slice(headEnd + 2, elseAt), src.slice(elseAt + 8, closeAt)];
		out += renderBlocks(truthy(vars[name] ?? null) ? whenTrue : whenFalse, vars);
		i = closeAt + 7;
	}
	return out;
}

function renderInline(src: string, vars: Vars): string {
	return src.replace(/{{\s*([a-zA-Z_][\w]*)\s*((?:\|[^}|]+)*)\s*}}/g, (_m, name: string, pipes: string) => {
		let value: Vars[string] = vars[name] ?? '';
		let result: string | null = null;
		for (const raw of pipes.split('|').filter(Boolean)) {
			const [fname, ...rest] = raw.split(':');
			const filter = FILTERS[(fname ?? '').trim()];
			if (!filter) throw new TemplateError(`Unknown filter "${fname}".`);
			result = filter(result === null ? value : result, rest.join(':').trim());
			value = result;
		}
		return result === null ? text(value) : result;
	});
}

export const DEFAULT_NOTE_TEMPLATE = `---
title: {{title|yaml}}
{{#if creator}}
creator: {{creator|yaml}}
{{/if}}
platform: {{platform}}
notebook: "[[{{notebook}}]]"
source: {{url}}
saved: {{saved|date:YYYY-MM-DDTHH:mm:ss}}
{{#if duration}}
duration: {{duration}}
{{/if}}
media: {{media_kind}}
{{#if slide_count}}
slides: {{slide_count}}
{{/if}}
{{#if transcript_method}}
transcript_method: {{transcript_method|yaml}}
{{/if}}
tags:
  - clippings
  - {{platform|tag}}
clippings_id: {{clip_id}}
clippings_url: {{clippings_url}}
---

# {{title}}

{{#if creator}}By {{creator}} on {{platform_label}}{{else}}From {{platform_label}}{{/if}} · saved to [[{{notebook}}]] on {{saved|date:MMMM D, YYYY}} · [Open original]({{url}})

{{#if note}}
> [!note] Why I saved this
{{note|quote}}

{{/if}}
{{#if caption}}
> [!quote] Caption
{{caption|quote}}

{{/if}}
{{#if takeaways}}
## Key takeaways

{{takeaways|list}}

{{/if}}
{{#if transcript}}
## {{#if carousel}}Slide text{{else}}Transcript{{/if}}

{{transcript}}
{{/if}}
`;

export const DEFAULT_FILENAME_TEMPLATE = '{{saved|date:YYYY-MM-DD}} {{title|truncate:60}}';
export const DEFAULT_FOLDER_TEMPLATE = '{{notebook}}';
