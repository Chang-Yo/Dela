//#region \0rolldown/runtime.js
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));
//#endregion
let node_assert_strict = require("node:assert/strict");
node_assert_strict = __toESM(node_assert_strict, 1);
let node_crypto = require("node:crypto");
let node_fs_promises = require("node:fs/promises");
let node_path = require("node:path");
let electron = require("electron");
let cheerio = require("cheerio");
let zod = require("zod");
let node_util = require("node:util");
//#region experiments/notice-subscriptions/parser.ts
var noticeRuleSchema = zod.z.discriminatedUnion("kind", [zod.z.object({
	version: zod.z.literal(1),
	kind: zod.z.literal("html"),
	pageUrl: zod.z.url(),
	label: zod.z.string(),
	containerSelector: zod.z.string().min(1),
	itemSelector: zod.z.string().min(1),
	linkSelector: zod.z.string().nullable(),
	expectsDates: zod.z.boolean(),
	parts: zod.z.array(zod.z.object({
		containerSelector: zod.z.string().min(1),
		itemSelector: zod.z.string().min(1),
		linkSelector: zod.z.string().nullable(),
		label: zod.z.string().optional()
	})).optional()
}), zod.z.object({
	version: zod.z.literal(1),
	kind: zod.z.literal("feed"),
	pageUrl: zod.z.url(),
	label: zod.z.string()
})]);
var normalizeText = (text) => text.replace(/\s+/g, " ").trim().replace(/^[·•●]\s*/, "");
function semanticWords(value) {
	return value.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/);
}
function dateElements($, element) {
	return element.find("time,[datetime],[class],div,span,p,td").filter((_, node) => {
		const candidate = $(node);
		if (candidate.is("time,[datetime]")) return true;
		if (candidate.is("a,h1,h2,h3,h4") || candidate.find("a[href]").length) return false;
		const text = normalizeText(orderedText($, node)).replace(/^[（([]\s*(.*?)\s*[）)\]]$/, "$1");
		return semanticWords(candidate.attr("class") ?? "").some((word) => [
			"date",
			"time",
			"calendar"
		].includes(word)) || /^(?:发布时间|发布日期|(?:以上(?:新闻|公告|消息))?发布于|日期|Published(?:\s+on)?|Posted(?:\s+on)?)\s*[:：]?\s*/i.test(text) && dateIn(text) !== null || /^[\d\s年月日,.:/—–-]+$/.test(text) && dateIn(text) !== null || /^[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}$/.test(text) && dateIn(text) !== null;
	});
}
function orderedText($, node) {
	if (!node) return "";
	if (node.type === "text") return $(node).text();
	return $(node).contents().toArray().map((child) => orderedText($, child)).join(" ");
}
function stripChrome($) {
	$("script,style,noscript,template").remove();
}
var chromeCache = /* @__PURE__ */ new WeakMap();
function isChrome($, node) {
	let cache = chromeCache.get($);
	if (!cache) {
		cache = /* @__PURE__ */ new WeakMap();
		chromeCache.set($, cache);
	}
	const ancestors = [];
	let current = node;
	let excluded = false;
	while (current) {
		const known = cache.get(current);
		if (known !== void 0) {
			excluded = known;
			break;
		}
		ancestors.push(current);
		const wrapper = $(current);
		if (wrapper.is("nav,menu,[role=\"navigation\"],[role=\"menu\"],[role=\"menubar\"],[role=\"banner\"],[role=\"contentinfo\"],[hidden],[aria-hidden=\"true\"]")) {
			excluded = true;
			break;
		}
		const localHeader = wrapper.is("header") && wrapper.closest("article,section").length > 0;
		if (wrapper.is("header,footer") && !localHeader) {
			excluded = true;
			break;
		}
		if (!wrapper.is("html,body,main,[role=\"main\"]")) {
			excluded = [wrapper.attr("class") ?? "", wrapper.attr("id") ?? ""].join(" ").split(/\s+/).some((token) => {
				if (localHeader && /^header\d*$/i.test(token)) return false;
				if (/^(?:(?:site|main|primary|secondary|top|bottom)[_-])?(?:nav(?:igation|bar)?|menu|header|footer|foot)\d*$/i.test(token)) return true;
				if (/^(?:menu|nav)[_-](?:l|r|left|right)$/i.test(token)) return false;
				const words = semanticWords(token);
				return ![
					"has",
					"with",
					"without",
					"no"
				].includes(words[0] ?? "") && words.some((word) => /^(?:sub)?(?:nav(?:igation|bar)?|menu|menubar)\d*$/.test(word));
			});
			if (excluded) break;
		}
		current = wrapper.parent().get(0);
	}
	for (const ancestor of ancestors) cache.set(ancestor, excluded);
	return excluded;
}
var noiseTitle = /^(?:更多[+＋>]?|查看(?:详情|更多)|了解详情|详情|首页|上一页|下一页|末页|返回|more|read more|next|previous)$/i;
function validateNoticeUrl(rawUrl) {
	const url = new URL(rawUrl);
	if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("订阅地址仅支持不含账号密码的 HTTP(S) URL");
	return url.href;
}
function articleUrl(rawUrl, baseUrl, anchorIds) {
	if (!rawUrl.trim()) return null;
	try {
		const url = new URL(rawUrl, baseUrl);
		validateNoticeUrl(url.href);
		const base = new URL(baseUrl);
		base.hash = "";
		const fragment = url.hash;
		url.hash = "";
		if (url.href === base.href) return fragment && anchorIds?.has(decodeURIComponent(fragment.slice(1))) ? url.href + fragment : null;
		return rawUrl.trim().startsWith("#") ? null : url.href;
	} catch {
		return null;
	}
}
function documentFor(input, charset) {
	const prefix = typeof input === "string" ? input : input.toString();
	const isFeed = /^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<(?:rss|feed)(?:\s|>)/i.test(prefix);
	const options = {
		xml: isFeed,
		encoding: { transportLayerEncodingLabel: charset }
	};
	const $ = typeof input === "string" ? (0, cheerio.load)(input, options) : (0, cheerio.loadBuffer)(input, options);
	const anchors = /* @__PURE__ */ new Set();
	$("article").each((_, node) => {
		const targets = [node, ...$(node).find("h1[id],h2[id],h3[id]").toArray()];
		for (const target of targets) {
			const id = $(target).attr("id");
			if (id && $(node).find("h1 a[href],h2 a[href],h3 a[href]").toArray().some((link) => $(link).attr("href") === `#${id}`)) anchors.add(id);
		}
	});
	articleAnchors.set($, anchors);
	return {
		$,
		isFeed
	};
}
function dateIn(text) {
	const normalized = normalizeText(text);
	const direct = normalized.match(/\b(\d{4})\s*[-./年]\s*(\d{1,2})\s*[-./月]\s*(\d{1,2})(?:日|\b)/);
	const reversed = normalized.match(/(?:^|\s)(\d{1,2})\s+(\d{4})\s*[-./]\s*(\d{1,2})(?:\s|$)/);
	const monthFirst = normalized.match(/(?:^|\s)(\d{1,2})\s*[-./]\s*(\d{1,2})\s*\/?\s*(\d{4})(?:\s|$)/);
	const english = normalized.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+(\d{1,2}),?\s+(\d{4})\b/i);
	const parts = direct ? [
		Number(direct[1]),
		Number(direct[2]),
		Number(direct[3])
	] : reversed ? [
		Number(reversed[2]),
		Number(reversed[3]),
		Number(reversed[1])
	] : monthFirst ? [
		Number(monthFirst[3]),
		Number(monthFirst[1]),
		Number(monthFirst[2])
	] : english ? [
		Number(english[3]),
		[
			"jan",
			"feb",
			"mar",
			"apr",
			"may",
			"jun",
			"jul",
			"aug",
			"sep",
			"oct",
			"nov",
			"dec"
		].indexOf(english[1].slice(0, 3).toLowerCase()) + 1,
		Number(english[2])
	] : null;
	if (!parts) return null;
	const [year, month, day] = parts;
	const date = new Date(Date.UTC(year, month - 1, day));
	if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
	return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
function rowDate($, row) {
	const dated = dateElements($, $(row));
	for (const node of dated.toArray()) {
		const datetime = $(node).attr("datetime")?.trim();
		if (datetime && dateIn(datetime.slice(0, 10)) && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(datetime)) {
			const timestamp = new Date(datetime);
			if (!Number.isNaN(timestamp.valueOf())) return timestamp.toISOString();
		}
		const date = dateIn(datetime ?? orderedText($, node));
		if (date) return date;
	}
	const content = $(row).clone();
	content.find("a,h1,h2,h3,h4,p").remove();
	return dateIn(orderedText($, content.get(0)));
}
function linkTitle($, link) {
	const element = $(link);
	const heading = element.find("h1,h2,h3,h4,[class~=\"h1\"],[class~=\"h2\"],[class~=\"h3\"],[class~=\"h4\"],[class*=\"title\"],[class~=\"tit\"]").toArray().map((node) => normalizeText($(node).text())).find((title) => title.length >= 4 && !/^[\d\s年月日:./-]+$/.test(title)) ?? "";
	const content = element.clone();
	dateElements($, content).remove();
	let title = normalizeText(element.attr("title") || (heading.length >= 4 ? heading : content.text()));
	title = title.replace(/(?:查看|了解)(?:详情|更多)\s*[>+＋]*$/g, "").trim();
	return title;
}
var articleAnchors = /* @__PURE__ */ new WeakMap();
var linkCache = /* @__PURE__ */ new WeakMap();
function primaryLink($, row, pageUrl) {
	let cache = linkCache.get($);
	if (!cache) {
		cache = /* @__PURE__ */ new WeakMap();
		linkCache.set($, cache);
	}
	const collect = (node) => {
		const known = cache.get(node);
		if (known) return known;
		const distinct = /* @__PURE__ */ new Map();
		if (!isChrome($, node)) {
			const literal = ($(node).attr("onclick") ?? "").match(/^\s*(?:(?:window\.)?location\.href\s*=\s*(['"])([^'"]+)\1|(?:windowOpen|window\.open)\(\s*(['"])([^'"]+)\3\s*\))\s*;?\s*$/);
			const href = $(node).attr("href") ?? literal?.[2] ?? literal?.[4];
			const articleHeading = $(node).is("article") ? $(node).find("h1 a[href],h2 a[href],h3 a[href]").toArray().find((link) => articleAnchors.get($)?.has(($(link).attr("href") ?? "").slice(1))) : void 0;
			if (articleHeading) {
				const link = articleHeading;
				for (const target of collect(link)) distinct.set(target.url, target);
			} else if (href !== void 0) {
				const title = linkTitle($, node);
				const url = articleUrl(href, pageUrl, articleAnchors.get($));
				if (url && title.length >= 4 && title.length <= 250 && !noiseTitle.test(title)) distinct.set(url, {
					node,
					title,
					url
				});
			} else for (const child of $(node).children().toArray()) {
				for (const link of collect(child)) {
					const previous = distinct.get(link.url);
					if (!previous || link.title.length > previous.title.length) distinct.set(link.url, link);
				}
				if (distinct.size > 1) break;
			}
		}
		const links = [...distinct.values()];
		cache.set(node, links);
		return links;
	};
	const links = collect(row);
	return links.length === 1 ? links[0] : null;
}
function selectorPart($, node) {
	const element = $(node);
	return String(element.prop("tagName")).toLowerCase() + (element.attr("class") ?? "").split(/\s+/).filter(Boolean).slice(0, 2).map((value) => `[class~=${JSON.stringify(value)}]`).join("");
}
function pathTo($, node, stop) {
	if (node === stop) return null;
	const segments = [];
	let current = node;
	while (current && current !== stop && !$(current).is("html")) {
		const element = $(current);
		const id = element.attr("id");
		const idSelector = id ? `[id=${JSON.stringify(id)}]` : null;
		if (!stop && idSelector && $(idSelector).length === 1) {
			segments.unshift(idSelector);
			return segments.join(" > ");
		}
		let segment = selectorPart($, current);
		const parent = element.parent();
		if (parent.children(segment).length > 1) {
			const tag = String(element.prop("tagName")).toLowerCase();
			segment += `:nth-of-type(${parent.children(tag).toArray().findIndex((node) => node === current) + 1})`;
		}
		segments.unshift(segment);
		current = parent.get(0);
	}
	return segments.join(" > ");
}
function labelFor($, container, fallback) {
	const hint = (element) => {
		if (!element.length || element.is("ul,ol,table") || element.find("a[href]").length > 1 || element.find("ul,ol,table").length > 0) return null;
		const selector = "h1,h2,h3,h4,[role=\"heading\"],[class*=\"title\"]";
		const heading = element.is(selector) ? element : element.find(selector).first();
		const label = normalizeText(element.attr("aria-label") || heading.find("p").first().text() || heading.text() || element.text());
		if (label && label.length <= 80 && !noiseTitle.test(label)) return label;
		const image = element.find("img").first();
		const accessible = normalizeText(image.attr("alt") ?? image.attr("title") ?? "");
		if (accessible && accessible.length <= 80) return accessible;
		return /(?:^|[/_.-])(notice|announcement|news|event)(?=[_.?/-]|$)/i.exec(image.attr("src") ?? "")?.[1] ?? null;
	};
	let current = container;
	for (let depth = 0; current && depth < 4; depth++) {
		const element = $(current);
		const direct = hint(element.children("h1,h2,h3,h4,[role=\"heading\"],[class*=\"title\"]").first());
		if (direct) return direct;
		for (const sibling of element.prevAll().slice(0, 2).toArray()) {
			const label = hint($(sibling));
			if (label) return label;
		}
		current = element.parent().get(0);
	}
	return fallback;
}
function feedEntries($, pageUrl) {
	const entries = /* @__PURE__ */ new Map();
	$("item,entry").each((_, node) => {
		const item = $(node);
		const link = item.children("link[rel=\"alternate\"],link:not([rel])").first();
		let baseUrl = pageUrl;
		for (const ancestor of [...link.parents().toArray().reverse(), ...link.toArray()]) {
			const base = $(ancestor).attr("xml:base");
			if (base) baseUrl = new URL(base, baseUrl).href;
		}
		const url = articleUrl(link.attr("href") ?? link.text(), baseUrl);
		const title = normalizeText(item.children("title").first().text());
		const rawDate = item.children("pubDate,published").first().text();
		const parsed = new Date(rawDate);
		if (url && title) entries.set(url, {
			id: url,
			title,
			url,
			publishedAt: rawDate && !Number.isNaN(parsed.valueOf()) ? parsed.toISOString() : null
		});
	});
	return [...entries.values()];
}
function retainEntry(entries, entry) {
	const previous = entries.get(entry.id);
	if (!previous || Number(Boolean(entry.publishedAt)) > Number(Boolean(previous.publishedAt)) || Boolean(entry.publishedAt) === Boolean(previous.publishedAt) && entry.title.length > previous.title.length) entries.set(entry.id, entry);
}
function analyzeNoticePage(input, rawUrl, options = {}) {
	const pageUrl = validateNoticeUrl(rawUrl);
	const { $, isFeed } = documentFor(input, options.charset);
	const baseHref = $("base[href]").first().attr("href");
	const linkBase = baseHref ? new URL(baseHref, pageUrl).href : pageUrl;
	const title = normalizeText(isFeed ? $("channel > title,feed > title").first().text() : $("title").first().text());
	const result = {
		pageUrl,
		title,
		status: "unsupported",
		candidates: [],
		feeds: [],
		diagnostics: []
	};
	if (isFeed) {
		const entries = feedEntries($, pageUrl);
		if (entries.length) result.candidates.push({
			label: title || "Feed",
			score: 100,
			reasons: ["原生 RSS/Atom"],
			entries,
			rule: {
				version: 1,
				kind: "feed",
				pageUrl,
				label: title || "Feed"
			}
		});
	} else {
		$("link[rel~=\"alternate\"]").each((_, node) => {
			if (!/application\/(?:rss|atom)\+xml/i.test($(node).attr("type") ?? "")) return;
			const url = articleUrl($(node).attr("href") ?? "", linkBase);
			if (url) result.feeds.push({
				title: $(node).attr("title") ?? "Feed",
				url
			});
		});
		const hasScripts = $("script[src]").length > 0;
		stripChrome($);
		if ($("*").length > 2e4) {
			result.diagnostics.push("页面超过 20000 个 DOM 元素，原型停止结构分析");
			return result;
		}
		const sample = options.sampleTitle ? normalizeText(options.sampleTitle) : null;
		const unique = /* @__PURE__ */ new Map();
		$("ul,ol,tbody,table,section,div,main,article,dl").each((_, container) => {
			const groups = /* @__PURE__ */ new Map();
			$(container).children("li,tr,div,article,section,a,dd").each((_, row) => {
				const link = primaryLink($, row, linkBase);
				if (!link) return;
				const linkSelector = pathTo($, link.node, row)?.replace(/:nth-of-type\(\d+\)/g, "") ?? null;
				const key = `${String($(row).prop("tagName")).toLowerCase()}|${linkSelector}`;
				const group = groups.get(key) ?? [];
				group.push({
					row,
					linkSelector,
					entry: {
						id: link.url,
						title: link.title,
						url: link.url,
						publishedAt: rowDate($, row)
					}
				});
				groups.set(key, group);
			});
			for (const group of groups.values()) {
				const records = /* @__PURE__ */ new Map();
				for (const { entry } of group) retainEntry(records, entry);
				const entries = [...records.values()];
				if (entries.length < (sample ? 1 : 2)) continue;
				const identity = entries.map((entry) => entry.id).sort().join("\n");
				const first = group[0];
				const previous = unique.get(identity);
				if (previous?.rule.kind === "html" && previous.entries.filter((entry) => entry.publishedAt).length >= entries.filter((entry) => entry.publishedAt).length && (previous.rule.linkSelector?.split(" > ").length ?? 0) <= (first.linkSelector?.split(" > ").length ?? 0)) continue;
				const commonClasses = ($(first.row).attr("class") ?? "").split(/\s+/).filter((value) => value && group.every(({ row }) => ($(row).attr("class") ?? "").split(/\s+/).includes(value))).slice(0, 2);
				const itemSelector = String($(first.row).prop("tagName")).toLowerCase() + commonClasses.map((value) => `[class~=${JSON.stringify(value)}]`).join("");
				const label = labelFor($, container, title || "候选栏目");
				const dateRatio = entries.filter((entry) => entry.publishedAt).length / entries.length;
				const score = Math.round(Math.min(100, 20 + Math.min(entries.length, 5) * 2 + dateRatio * 25 + (/通知|公告|notice|announcement/i.test(label) ? 15 : 0) + ($(container).closest("main,[role=\"main\"]").length ? 10 : 0)));
				unique.set(identity, {
					label,
					score,
					reasons: [
						`${entries.length} 条重复结构`,
						`日期覆盖 ${Math.round(dateRatio * 100)}%`,
						...sample ? ["匹配用户标题样例"] : []
					],
					entries,
					rule: {
						version: 1,
						kind: "html",
						pageUrl,
						label,
						containerSelector: pathTo($, container),
						itemSelector,
						linkSelector: first.linkSelector,
						expectsDates: dateRatio >= .5
					}
				});
			}
		});
		const candidates = [...unique.values()];
		const scopes = /* @__PURE__ */ new Map();
		for (const candidate of candidates) {
			if (candidate.rule.kind !== "html" || candidate.entries.length < 2) continue;
			let scope = $(candidate.rule.containerSelector).parent().get(0);
			for (let depth = 0; scope && depth < 2; depth++, scope = $(scope).parent().get(0)) {
				if ($(scope).is("html,body,main")) break;
				const group = scopes.get(scope) ?? [];
				group.push(candidate);
				scopes.set(scope, group);
			}
		}
		for (const [scope, group] of scopes) {
			if (group.length < 2 || new Set(group.map((candidate) => candidate.label)).size !== 1) continue;
			if (group.some((candidate) => candidate.entries.filter((entry) => entry.publishedAt).length / candidate.entries.length < .5)) continue;
			const parts = group.map((candidate) => candidate.rule).filter((rule) => rule.kind === "html");
			if (parts.some((part) => parts.some((other) => part !== other && $(part.containerSelector).parents(other.containerSelector).length > 0))) continue;
			const branches = $(scope).children().toArray();
			if (parts.some((part) => {
				let current = $(part.containerSelector).get(0);
				while (current && current !== scope) {
					const element = $(current);
					if (element.is("[role=\"tabpanel\"]") || semanticWords(`${element.attr("id") ?? ""} ${element.attr("class") ?? ""}`).some((word) => /^tabs?\d*$/.test(word))) return true;
					current = element.parent().get(0);
				}
				return false;
			})) continue;
			if (branches.some((branch) => parts.filter((part) => {
				const container = $(part.containerSelector).get(0);
				return container === branch || $(container).parents().toArray().includes(branch);
			}).length > 1) && parts.some((part) => $(part.containerSelector).parent().get(0) !== scope)) continue;
			const merged = /* @__PURE__ */ new Map();
			for (const candidate of group) for (const entry of candidate.entries) retainEntry(merged, entry);
			if (merged.size <= Math.max(...group.map((candidate) => candidate.entries.length))) continue;
			const label = labelFor($, scope, title || "候选栏目");
			const entries = [...merged.values()];
			candidates.push({
				label,
				score: Math.min(100, Math.max(...group.map((candidate) => candidate.score)) + 5),
				reasons: [`${entries.length} 条同栏目多布局记录`, `${parts.length} 个独立容器`],
				entries,
				rule: {
					version: 1,
					kind: "html",
					pageUrl,
					label,
					containerSelector: pathTo($, scope),
					itemSelector: parts[0].itemSelector,
					linkSelector: parts[0].linkSelector,
					expectsDates: entries.filter((entry) => entry.publishedAt).length / entries.length >= .5,
					parts: parts.map(({ containerSelector, itemSelector, linkSelector, label }) => ({
						containerSelector,
						itemSelector,
						linkSelector,
						label
					}))
				}
			});
		}
		result.candidates = candidates.filter((candidate) => {
			if (sample && !candidate.entries.some((entry) => normalizeText(entry.title) === sample)) return false;
			if (candidate.entries.length !== 1 || candidate.rule.kind !== "html") return true;
			const container = $(candidate.rule.containerSelector);
			return !candidates.some((other) => other.entries.length > 1 && (!sample || other.entries.some((entry) => normalizeText(entry.title) === sample)) && other.rule.kind === "html" && other.entries.some((entry) => entry.id === candidate.entries[0].id) && container.parents(other.rule.containerSelector).length > 0);
		});
		result.candidates.sort((a, b) => b.score - a.score);
		if (!result.candidates.length) result.diagnostics.push(sample ? "没有找到匹配标题样例的栏目" : "未识别到至少两条有效公告；可能是单篇页面、登录页或需要 JavaScript 渲染");
		if (hasScripts) result.diagnostics.push("本次仅分析服务器 HTML，未执行页面 JavaScript");
	}
	result.status = result.candidates.length > 1 ? "needs-selection" : result.candidates.length ? "ok" : "unsupported";
	return result;
}
function extractNoticeEntries(input, rule, charset) {
	validateNoticeUrl(rule.pageUrl);
	const { $, isFeed } = documentFor(input, charset);
	const baseHref = $("base[href]").first().attr("href");
	const linkBase = baseHref ? new URL(baseHref, rule.pageUrl).href : rule.pageUrl;
	if (rule.kind === "feed") {
		const entries = isFeed ? feedEntries($, rule.pageUrl) : [];
		if (!entries.length) throw new Error("订阅 Feed 失配或为空，请重新确认");
		return entries;
	}
	stripChrome($);
	const containers = $(rule.containerSelector);
	if (containers.length !== 1) throw new Error("订阅栏目定位失配，请重新确认");
	if (labelFor($, containers.get(0), normalizeText($("title").first().text()) || "候选栏目") !== rule.label) throw new Error("订阅栏目名称变化，请重新确认");
	const entries = /* @__PURE__ */ new Map();
	for (const part of rule.parts ?? [rule]) {
		const source = $(part.containerSelector);
		if (source.length !== 1) throw new Error("订阅栏目分组失配，请重新确认");
		if (part.label !== void 0 && labelFor($, source.get(0), normalizeText($("title").first().text()) || "候选栏目") !== part.label) throw new Error("订阅栏目分组名称变化，请重新确认");
		source.children(part.itemSelector).each((_, row) => {
			const targets = part.linkSelector === null ? $(row) : $(row).find(part.linkSelector);
			const primary = primaryLink($, row, linkBase);
			if (!primary || !targets.toArray().some((node) => node === primary.node)) return;
			retainEntry(entries, {
				id: primary.url,
				title: primary.title,
				url: primary.url,
				publishedAt: rowDate($, row)
			});
		});
	}
	const items = [...entries.values()];
	if (!items.length || rule.expectsDates && !items.some((entry) => entry.publishedAt)) throw new Error("订阅栏目结构失配或为空，请重新确认");
	return items;
}
//#endregion
//#region experiments/notice-subscriptions/state.ts
var subscriptionStateSchema = zod.z.object({
	version: zod.z.literal(1),
	rule: noticeRuleSchema,
	acquisition: zod.z.enum(["http", "rendered"]).optional(),
	seenIds: zod.z.array(zod.z.string()),
	checkedAt: zod.z.iso.datetime()
});
function updateSubscription(rule, entries, previous = null, checkedAt = (/* @__PURE__ */ new Date()).toISOString()) {
	if (previous && !(0, node_util.isDeepStrictEqual)(previous.rule, rule)) throw new Error("订阅规则已改变，请重新建立基线");
	if (!entries.length) throw new Error("没有有效公告，保留上次订阅状态");
	const seen = new Set(previous?.seenIds);
	const added = /* @__PURE__ */ new Map();
	for (const entry of entries) {
		if (previous && !seen.has(entry.id)) added.set(entry.id, entry);
		seen.add(entry.id);
	}
	return {
		baseline: previous === null,
		newEntries: [...added.values()],
		state: {
			version: 1,
			rule,
			seenIds: [...seen],
			checkedAt,
			...previous?.acquisition ? { acquisition: previous.acquisition } : {}
		}
	};
}
//#endregion
//#region experiments/notice-subscriptions/validation/framework/capture-example.ts
async function main() {
	const root = (0, node_path.resolve)(process.argv[2] ?? ".");
	const directory = (0, node_path.resolve)(root, "experiments/notice-subscriptions/validation/framework/evidence");
	await (0, node_fs_promises.mkdir)(directory, { recursive: true });
	const demonstration = "本地合成框架演示；不是 Dela 产品界面，也不代表真实站点消息";
	const url = "https://framework-demo.example/notice";
	const html = (ids) => `<html lang="zh-CN"><head><meta charset="utf-8"><title>本地合成框架演示</title></head><body><main><h2>通知公告</h2><ul>${ids.map((id) => `<li><a href="/notice/${id}">合成通知 ${id}：框架订阅演示</a><time>2026-11-${String(id === 3 ? 12 : id).padStart(2, "0")}</time></li>`).join("")}</ul></main></body></html>`;
	const before = html([1, 2]);
	const after = html([
		3,
		2,
		1
	]);
	await (0, node_fs_promises.writeFile)((0, node_path.resolve)(directory, "input-before.html"), before);
	await (0, node_fs_promises.writeFile)((0, node_path.resolve)(directory, "input-after.html"), after);
	const preview = analyzeNoticePage(before, url);
	node_assert_strict.default.equal(preview.candidates.length, 1);
	const selected = preview.candidates[0];
	const confirmed = updateSubscription(selected.rule, extractNoticeEntries(before, selected.rule));
	node_assert_strict.default.equal(confirmed.baseline, true);
	node_assert_strict.default.deepEqual(confirmed.newEntries, []);
	const baseline = {
		...confirmed.state,
		acquisition: "http"
	};
	await (0, node_fs_promises.writeFile)((0, node_path.resolve)(directory, "baseline.json"), JSON.stringify(baseline, null, 2) + "\n");
	const restored = subscriptionStateSchema.parse(JSON.parse(await (0, node_fs_promises.readFile)((0, node_path.resolve)(directory, "baseline.json"), "utf8")));
	const first = updateSubscription(restored.rule, extractNoticeEntries(after, restored.rule), restored);
	node_assert_strict.default.deepEqual(first.newEntries.map((entry) => entry.id), ["https://framework-demo.example/notice/3"]);
	const second = updateSubscription(first.state.rule, extractNoticeEntries(after, first.state.rule), first.state);
	node_assert_strict.default.deepEqual(second.newEntries, []);
	for (const [name, result] of [
		["preview", preview],
		["confirmation", confirmed],
		["refresh-first", first],
		["refresh-again", second]
	]) await (0, node_fs_promises.writeFile)((0, node_path.resolve)(directory, name + ".json"), JSON.stringify(result, null, 2) + "\n");
	const previewLog = {
		demonstration,
		operation: "analyzeNoticePage → 显式选择候选 1 → extractNoticeEntries → updateSubscription",
		beforeConfirmation: {
			status: preview.status,
			candidateCount: preview.candidates.length,
			candidates: preview.candidates.map((candidate, index) => ({
				index: index + 1,
				label: candidate.label,
				entries: candidate.entries
			}))
		},
		afterConfirmation: {
			selectedCandidate: 1,
			baseline: confirmed.baseline,
			newEntries: confirmed.newEntries,
			seenIds: confirmed.state.seenIds
		}
	};
	const refreshLog = {
		demonstration,
		operation: "读取 JSON 基线 → 重放同一规则 → updateSubscription → 再次重放并更新",
		firstRefresh: {
			inputOrder: [
				3,
				2,
				1
			],
			baseline: first.baseline,
			newEntries: first.newEntries,
			seenIds: first.state.seenIds
		},
		secondRefresh: {
			sameInput: true,
			baseline: second.baseline,
			newEntries: second.newEntries,
			seenIds: second.state.seenIds
		}
	};
	const window = new electron.BrowserWindow({
		width: 1320,
		height: 1400,
		show: false,
		webPreferences: {
			nodeIntegration: false,
			contextIsolation: true,
			sandbox: true,
			backgroundThrottling: false
		}
	});
	try {
		for (const [name, title, log] of [[
			"preview",
			"实际运行记录：候选预览与显式确认",
			previewLog
		], [
			"refresh",
			"实际运行记录：新 URL 仅报告一次",
			refreshLog
		]]) {
			const text = JSON.stringify(log, null, 2);
			const page = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${title}</title><style>body{margin:28px;background:white;color:#111;font:16px/1.45 Consolas,"Microsoft YaHei",monospace}h1{font-size:22px;margin:0 0 12px}p{margin:0 0 16px}pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:0}</style><h1>${title}</h1><p>本地合成框架演示 · 只读日志摘要 · 完整输入与 JSON 输出保存在同目录</p><pre>${text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</pre></html>`;
			await (0, node_fs_promises.writeFile)((0, node_path.resolve)(directory, name + "-log.json"), text + "\n");
			await (0, node_fs_promises.writeFile)((0, node_path.resolve)(directory, name + "-log.html"), page);
			await window.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(page));
			const height = await window.webContents.executeJavaScript("Math.ceil(document.documentElement.scrollHeight)");
			window.setContentSize(1320, height);
			await window.webContents.executeJavaScript("new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))");
			await (0, node_fs_promises.writeFile)((0, node_path.resolve)(directory, name + ".png"), (await window.webContents.capturePage(void 0, { stayHidden: true })).toPNG());
		}
	} finally {
		window.destroy();
	}
	const paths = [
		"experiments/notice-subscriptions/parser.ts",
		"experiments/notice-subscriptions/state.ts",
		"experiments/notice-subscriptions/validation/framework/capture-example.ts",
		"experiments/notice-subscriptions/validation/framework/evidence/run-capture.ts",
		"experiments/notice-subscriptions/validation/framework/evidence/capture-example.cjs",
		...[
			"input-before.html",
			"input-after.html",
			"preview.json",
			"confirmation.json",
			"baseline.json",
			"refresh-first.json",
			"refresh-again.json",
			"preview-log.json",
			"refresh-log.json",
			"preview.png",
			"refresh.png"
		].map((name) => "experiments/notice-subscriptions/validation/framework/evidence/" + name)
	];
	const sha256 = Object.fromEntries(await Promise.all(paths.map(async (path) => [path, (0, node_crypto.createHash)("sha256").update(await (0, node_fs_promises.readFile)((0, node_path.resolve)(root, path))).digest("hex")])));
	const results = {
		demonstration,
		capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
		electron: process.versions.electron,
		node: process.versions.node,
		core: [
			"analyzeNoticePage",
			"extractNoticeEntries",
			"updateSubscription",
			"subscriptionStateSchema"
		],
		source: "本地构造 HTML；保留原始输入；无网络请求；与 CLI import 同一 parser/state 模块",
		result: {
			candidates: preview.candidates.length,
			baselineNewEntries: confirmed.newEntries.length,
			firstRefreshNewEntries: first.newEntries.length,
			secondRefreshNewEntries: second.newEntries.length
		},
		sha256
	};
	await (0, node_fs_promises.writeFile)((0, node_path.resolve)(directory, "manifest.json"), JSON.stringify(results, null, 2) + "\n");
	console.log(JSON.stringify(results, null, 2));
}
electron.app.on("window-all-closed", () => {});
electron.app.disableHardwareAcceleration();
electron.app.whenReady().then(main).catch((error) => {
	console.error(error);
	electron.app.exit(1);
}).finally(() => electron.app.quit());
//#endregion
