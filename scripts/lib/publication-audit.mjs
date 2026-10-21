// Local developer audit only. Never import this module from an API entry.
// Ported from the reviewed publication auditor; no private denylist is embedded.
import { isUtf8 } from "node:buffer";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open, opendir } from "node:fs/promises";
import { join, parse, resolve, sep } from "node:path";
import { inflateSync } from "node:zlib";
import sanitizeHtml from "sanitize-html";
import { Marked } from "marked";
const defaults = {
    maxFiles: 20_000, maxObjects: 20_000, maxFileBytes: 8 * 1024 * 1024,
    maxTotalBytes: 128 * 1024 * 1024, maxDepth: 128, maxFindings: 1_000,
    maxDecodeViews: 64, maxDecodeQueue: 256, maxDecodeCharsMultiplier: 16,
    maxGitOutputBytes: 16 * 1024 * 1024, gitTimeoutMs: 15_000,
};
const normalize = (text) => text.normalize("NFKC").toLowerCase();
const auditMarkdown = new Marked({ tokenizer: {
    lheading(source) {
        // This underline is a necessary condition for Marked's setext rule.
        // Check each tokenizer input, including stripped blockquote/list text.
        // Returning false retains the original rule whenever it can match.
        if (!/\n {0,3}(?:=+|-+) *(?:\n|$)/.test(source)) return;
        return false;
    },
} });
export function renderAuditMarkdown(text) {
    return auditMarkdown.parse(text, { async: false });
}
const entities = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", colon: ":", sol: "/", bsol: "\\",
    period: ".", commat: "@", num: "#", quest: "?", equals: "=", percnt: "%", semi: ";",
    lowbar: "_", hyphen: "-", dash: "-", Tab: "\t", NewLine: "\n", nbsp: " ",
};
function codePoint(value, original) {
    return Number.isInteger(value) && value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : original;
}
function decode(text) {
    // Escape markup so the existing HTML parser decodes all named entities in
    // comments and attributes as text. Undo only its serializer's five escapes.
    const html = text.includes("&") ? sanitizeHtml(text.replaceAll("<", "&lt;"), {
        allowedTags: [], allowedAttributes: {},
    }).replace(/&(amp|lt|gt|quot|apos);/g, (_, entity) => entities[entity]) : text;
    return html
        .replace(/(?:%[\da-f]{2})+/gi, (value) => Buffer.from(value.replaceAll("%", ""), "hex").toString("utf8"))
        .replace(/\\u\{([\da-f]{1,6})\}|\\u([\da-f]{4})|\\x([\da-f]{2})/gi, (original, braces, unicode, hex) => codePoint(Number.parseInt(braces ?? unicode ?? hex, 16), original))
        .replace(/\\([\\`*_[\]#!|~{}<>/.-])/g, "$1");
}
// Same maximal ASCII runs and at-most-two padding characters as the previous
// two Base64 regexes. An iterative scan avoids the regex engine's stack limit
// on multi-megabyte inline assets; it does not truncate or split long tokens.
function* base64Tokens(text, includeSlash) {
    const allowed = code => (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
        || (code >= 48 && code <= 57) || code === 43 || code === 45 || code === 95
        || (includeSlash && code === 47);
    let cursor = 0;
    while (cursor < text.length) {
        if (!allowed(text.charCodeAt(cursor))) { cursor++; continue; }
        const start = cursor;
        while (cursor < text.length && allowed(text.charCodeAt(cursor))) cursor++;
        if (cursor - start < 8) continue;
        if (text[cursor] === '=') cursor++;
        if (text[cursor] === '=') cursor++;
        yield text.slice(start, cursor);
    }
}
// These guards skip only identity operations: decode changes text only at &,
// % or backslash; the pinned HTML parser/serializer changes tag/entity syntax
// only at <, > or &. All normalized comparison values remain inspected.
function comparisonViews(text) {
    const views = [normalize(text)];
    if (/[&%\\]/.test(text)) views.push(normalize(decode(text)));
    if (/[<>&]/.test(text)) views.push(normalize(sanitizeHtml(text, {
        allowedTags: [], allowedAttributes: {}, nonTextTags: [],
    })));
    return views;
}
/** Bounded decoding, including nested URL/entity/JSON encodings and base64 text. */
function inspectText(text, needles, limits) {
    const queue = [{ text, render: true }];
    const queued = new Set([`1:${text}`]);
    const seen = new Set();
    const inspectedTokens = new Set();
    let decodedChars = 0;
    // Two bounded parser-derived views are now included in addition to decoded
    // source. Each rendered view is inspected, not recursively rendered again.
    const budget = text.length * limits.maxDecodeCharsMultiplier + 1024;
    function enqueue(candidate, render) {
        const key = `${render ? 1 : 0}:${candidate}`;
        if (queued.has(key))
            return true;
        if (queue.length >= limits.maxDecodeQueue)
            return false;
        queued.add(key);
        queue.push({ text: candidate, render });
        return true;
    }
    for (let index = 0; index < queue.length; index++) {
        const { text: view, render } = queue[index];
        const key = `${render ? 1 : 0}:${view}`;
        if (seen.has(key))
            continue;
        if (seen.size >= limits.maxDecodeViews || decodedChars + view.length > budget)
            return { match: false, exhausted: true };
        seen.add(key);
        decodedChars += view.length;
        const normalized = normalize(view);
        if (needles.some((needle) => normalized.includes(needle)))
            return { match: true, exhausted: false };
        const decoded = decode(view);
        if (decoded !== view && !enqueue(decoded, render))
            return { match: false, exhausted: true };
        // Inspect what ordinary HTML/Markdown readers see, not just source bytes.
        // Retain raw views above for attributes, comments and metadata. A control
        // byte in a comment must not disable checks on the rest of the document.
        if (render) {
            try {
                if (view.includes("<")) {
                    const visible = sanitizeHtml(view, { allowedTags: [], allowedAttributes: {}, nonTextTags: [] });
                    if (visible !== view && !enqueue(visible, false))
                        return { match: false, exhausted: true };
                }
                // Always parse source, including ordinary [citation](url) syntax.
                const rendered = renderAuditMarkdown(view);
                const visible = sanitizeHtml(rendered, { allowedTags: [], allowedAttributes: {}, nonTextTags: [] });
                if (visible !== view && !enqueue(visible, false))
                    return { match: false, exhausted: true };
            }
            catch {
                return { match: false, exhausted: true };
            }
        }
        // Decode complete tokens, so a secret inside a larger encoded URL is also checked.
        for (const includeSlash of [true, false])
            for (const token of base64Tokens(view, includeSlash)) {
                const input = token.replaceAll("-", "+").replaceAll("_", "/");
                // An identical token has exactly the same comparisons and
                // render=true child, already queued on its first occurrence.
                // Bound this optional cache; eviction only repeats work.
                if (input.length <= 4096) {
                    if (inspectedTokens.has(input)) continue;
                    if (inspectedTokens.size >= 4096) inspectedTokens.delete(inspectedTokens.values().next().value);
                    inspectedTokens.add(input);
                }
                // A URL prefix may be indistinguishable from the standard Base64 alphabet
                // and shift its start. Four comparison-only alignments cover the byte
                // offsets, including '/' belonging to the encoded identifier itself.
                for (let shift = 0; shift < 4; shift++) {
                    const aligned = Buffer.from(input.slice(shift), "base64").toString("utf8");
                    const views = comparisonViews(aligned);
                    if (views.some(text => needles.some(needle => text.includes(needle))))
                        return { match: true, exhausted: false };
                }
                if (input.length % 4 === 1)
                    continue;
                const bytes = Buffer.from(input, "base64");
                if (bytes.toString("base64").replace(/=+$/, "") !== input.replace(/=+$/, ""))
                    continue;
                const utf8 = isUtf8(bytes);
                if (!utf8) {
                    const binaryText = bytes.toString("utf8");
                    const binaryViews = comparisonViews(binaryText);
                    if (binaryViews.some(text => needles.some(needle => text.includes(needle))))
                        return { match: true, exhausted: false };
                    continue;
                }
                const candidate = bytes.toString("utf8");
                if (!enqueue(candidate, true))
                    return { match: false, exhausted: true };
            }
    }
    return { match: false, exhausted: false };
}
class Audit {
    limits;
    needles;
    result = { checked: 0, findings: [], complete: true };
    totalBytes = 0;
    entries = 0;
    stopped = false;
    keys = new Set();
    constructor(limits, needles) {
        this.limits = limits;
        this.needles = needles;
    }
    safePath(path) {
        // Never expose a path containing a forbidden value, even in an encoded filename.
        const check = inspectText(path, this.needles, this.limits);
        if (check.match || check.exhausted || path.length > 512 || path.startsWith("/") ||
            /[\\\x00-\x1f\x7f]/.test(path) || /(?:^|\/)\.\.(?:\/|$)/.test(path))
            return "[redacted]";
        const safe = path.split("/").map((part) => part.replace(/[^a-zA-Z0-9._-]/g, "_")).join("/") || ".";
        return inspectText(safe, this.needles, this.limits).match ? "[redacted]" : safe;
    }
    add(rule, path = ".", incomplete = false) {
        if (incomplete)
            this.result.complete = false;
        if (this.stopped)
            return;
        const finding = { rule, path: this.safePath(path) };
        const key = `${finding.rule}:${finding.path}`;
        if (this.keys.has(key))
            return;
        if (this.result.findings.length >= this.limits.maxFindings) {
            this.result.complete = false;
            // Keep the output bounded while making truncation explicit, including maxFindings=1.
            this.result.findings[this.limits.maxFindings - 1] = { rule: "LIMIT_EXCEEDED", path: "." };
            this.stopped = true;
            return;
        }
        this.keys.add(key);
        this.result.findings.push(finding);
    }
    text(text, rule, path) {
        const result = inspectText(text, this.needles, this.limits);
        if (result.match)
            this.add(rule, path);
        if (result.exhausted)
            this.add("DECODE_LIMIT", path, true);
    }
    reserve(bytes, path) {
        if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > this.limits.maxFileBytes ||
            this.totalBytes + bytes > this.limits.maxTotalBytes) {
            this.add("LIMIT_EXCEEDED", path, true);
            return false;
        }
        this.totalBytes += bytes;
        return true;
    }
    byteViews(bytes, rule, path) {
        this.text(bytes.toString("utf8"), rule, path);
        // EXIF/XMP and other binary metadata may store either UTF16 byte order/alignment.
        for (const offset of [0, 1]) {
            const wide = bytes.subarray(offset, offset + Math.floor((bytes.length - offset) / 2) * 2);
            this.text(wide.toString("utf16le"), rule, path);
            this.text(Buffer.from(wide).swap16().toString("utf16le"), rule, path);
        }
    }
    binary(bytes, rule, path) {
        this.byteViews(bytes, rule, path);
        // PNG text and ICC profiles may be compressed, invisible to raw byte searches.
        if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
            return;
        let offset = 8;
        let ended = false;
        while (offset + 12 <= bytes.length) {
            const length = bytes.readUInt32BE(offset);
            const type = bytes.toString("ascii", offset + 4, offset + 8);
            if (offset + length + 12 > bytes.length)
                break;
            const data = bytes.subarray(offset + 8, offset + 8 + length);
            try {
                let compressed;
                if (type === "zTXt" || type === "iCCP") {
                    const end = data.indexOf(0);
                    if (end < 0 || data[end + 1] !== 0)
                        throw new Error();
                    compressed = data.subarray(end + 2);
                }
                else if (type === "iTXt") {
                    const end = data.indexOf(0);
                    if (end < 0 || data.length < end + 5 || data[end + 2] !== 0)
                        throw new Error();
                    const languageEnd = data.indexOf(0, end + 3);
                    const translatedEnd = data.indexOf(0, languageEnd + 1);
                    if (languageEnd < 0 || translatedEnd < 0 || data[end + 1] > 1)
                        throw new Error();
                    if (data[end + 1] === 1)
                        compressed = data.subarray(translatedEnd + 1);
                }
                if (compressed) {
                    const expanded = inflateSync(compressed, { maxOutputLength: this.limits.maxFileBytes });
                    if (this.reserve(expanded.length, path))
                        this.byteViews(expanded, rule, path);
                }
            }
            catch (error) {
                this.add(error.code === "ERR_BUFFER_TOO_LARGE" ? "LIMIT_EXCEEDED" : "UNREADABLE_METADATA", path, true);
            }
            offset += length + 12;
            if (type === "IEND") {
                ended = true;
                break;
            }
        }
        if (!ended)
            this.add("UNREADABLE_METADATA", path, true);
    }
    async directory(root) {
        const visit = async (absolute, relative, depth) => {
            if (this.stopped)
                return;
            this.text(relative, "FORBIDDEN_PATH", relative);
            try {
                const stat = await lstat(absolute);
                if (stat.isSymbolicLink()) {
                    this.add("SYMLINK", relative, true);
                    return;
                }
                if (stat.isDirectory()) {
                    if (depth > this.limits.maxDepth) {
                        this.add("LIMIT_EXCEEDED", relative, true);
                        return;
                    }
                    const directory = await opendir(absolute);
                    for await (const entry of directory) {
                        if (++this.entries > this.limits.maxFiles) {
                            this.add("LIMIT_EXCEEDED", relative, true);
                            break;
                        }
                        await visit(join(absolute, entry.name), relative === "." ? entry.name : `${relative}/${entry.name}`, depth + 1);
                        if (this.stopped)
                            break;
                    }
                    const after = await lstat(absolute);
                    if (stat.ino !== after.ino || stat.mtimeMs !== after.mtimeMs)
                        this.add("CHANGED_DURING_AUDIT", relative, true);
                }
                else if (stat.isFile()) {
                    if (!this.reserve(stat.size, relative))
                        return;
                    const bytes = await readRegularFile(absolute, this.limits.maxFileBytes);
                    this.result.checked++;
                    this.binary(bytes, "FORBIDDEN_CONTENT", relative);
                }
                else
                    this.add("UNSUPPORTED_ENTRY", relative, true);
            }
            catch (error) {
                this.add(error instanceof AuditFailure ? error.rule : "UNREADABLE_ENTRY", relative, true);
            }
        };
        await requirePlainPath(root);
        if (!(await lstat(root)).isDirectory())
            throw new AuditFailure("INVALID_TARGET");
        await visit(root, ".", 0);
    }
    async git(root) {
        await requirePlainPath(root);
        const run = (args, input) => runGit(root, args, this.limits, input);
        const gitDir = (await run(["rev-parse", "--absolute-git-dir"])).output.toString("utf8").trim();
        await requirePlainPath(gitDir);
        const bare = (await run(["rev-parse", "--is-bare-repository"])).output.toString("utf8").trim() === "true";
        const repositoryRoot = bare ? gitDir : (await run(["rev-parse", "--show-toplevel"])).output.toString("utf8").trim();
        if (resolve(repositoryRoot) !== root)
            throw new AuditFailure("INVALID_TARGET");
        const commonDir = resolve(root, (await run(["rev-parse", "--git-common-dir"])).output.toString("utf8").trim());
        await requirePlainPath(commonDir);
        for (const storage of new Set([gitDir, commonDir]))
            await this.gitStorage(storage);
        const shallow = await run(["rev-parse", "--is-shallow-repository"]);
        if (shallow.output.toString("utf8").trim() !== "false")
            this.add("PARTIAL_HISTORY", ".", true);
        const partial = await run(["config", "--local", "--get-regexp", "^(extensions\\.partialclone|remote\\..*\\.(promisor|partialclonefilter))$"]);
        if (partial.output.length)
            this.add("PARTIAL_HISTORY", ".", true);
        const remotes = await run(["config", "--local", "--get-regexp", "^remote\\..*\\.url$"]);
        if (remotes.output.length)
            this.add("REMOTE_HISTORY_UNVERIFIED", ".", true);
        for (const name of ["info/grafts", "objects/info/alternates", "objects/info/http-alternates"]) {
            try {
                await lstat(join(commonDir, name));
                this.add("PARTIAL_HISTORY", ".", true);
            }
            catch (error) {
                if (error.code !== "ENOENT")
                    this.add("UNREADABLE_OBJECT", ".", true);
            }
        }
        const replacements = await run(["for-each-ref", "--format=%(objectname)", "refs/replace/"]);
        if (replacements.output.length)
            this.add("PARTIAL_HISTORY", ".", true);
        const refsBefore = (await run(["for-each-ref", "--format=%(refname) %(objectname)"])).output;
        const head = await run(["rev-parse", "--verify", "--quiet", "HEAD"]);
        const format = (await run(["rev-parse", "--show-object-format"])).output.toString("utf8").trim();
        const hashBytes = format === "sha1" ? 20 : format === "sha256" ? 32 : 0;
        if (!hashBytes)
            throw new AuditFailure("UNSUPPORTED_OBJECT");
        const listed = await run(["rev-list", "--objects", "--all", "--no-object-names", "--missing=print", ...(head.code === 0 ? ["HEAD"] : [])]);
        for (const line of refsBefore.toString("utf8").split("\n").filter(Boolean))
            this.text(line.split(" ")[0], "FORBIDDEN_PATH", "git/refs");
        const objects = [...new Set(listed.output.toString("utf8").trim().split("\n").filter(Boolean))];
        if (objects.length > this.limits.maxObjects)
            this.add("LIMIT_EXCEEDED", "git/objects", true);
        for (const [index, oid] of objects.slice(0, this.limits.maxObjects).entries()) {
            if (this.stopped)
                break;
            const path = `git/objects/${index + 1}`;
            if (!new RegExp(`^[a-f0-9]{${hashBytes * 2}}$`).test(oid)) {
                this.add("UNREADABLE_OBJECT", path, true);
                continue;
            }
            try {
                const info = (await run(["cat-file", "--batch-check"], `${oid}\n`)).output.toString("utf8").trim().split(" ");
                const [id, type, sizeText] = info;
                if (id !== oid || !["blob", "tree", "commit", "tag"].includes(type) || !/^\d+$/.test(sizeText ?? ""))
                    throw new AuditFailure("UNREADABLE_OBJECT");
                const size = Number(sizeText);
                if (!this.reserve(size, path))
                    continue;
                const raw = (await run(["cat-file", type, oid])).output;
                if (raw.length !== size)
                    throw new AuditFailure("UNREADABLE_OBJECT");
                this.result.checked++;
                if (type === "tree")
                    this.tree(raw, path, hashBytes);
                else if (type === "commit") {
                    const text = raw.toString("utf8");
                    const split = text.indexOf("\n\n");
                    if (split < 0) {
                        this.add("UNREADABLE_OBJECT", path, true);
                        continue;
                    }
                    const headers = text.slice(0, split).split("\n");
                    for (const header of headers)
                        this.text(header, /^(author|committer) /.test(header) ? "FORBIDDEN_COMMIT_IDENTITY" : "FORBIDDEN_METADATA", path);
                    this.text(text.slice(split + 2), "FORBIDDEN_COMMIT_MESSAGE", path);
                }
                else
                    this.binary(raw, type === "blob" ? "FORBIDDEN_CONTENT" : "FORBIDDEN_METADATA", path);
            }
            catch (error) {
                this.add(error instanceof AuditFailure ? error.rule : "UNREADABLE_OBJECT", path, true);
            }
        }
        const refsAfter = (await run(["for-each-ref", "--format=%(refname) %(objectname)"])).output;
        const headAfter = (await run(["rev-parse", "--verify", "--quiet", "HEAD"])).output;
        if (!refsBefore.equals(refsAfter) || !head.output.equals(headAfter))
            this.add("CHANGED_DURING_AUDIT", "git/refs", true);
    }
    tree(bytes, path, hashBytes) {
        let offset = 0;
        while (offset < bytes.length) {
            const space = bytes.indexOf(32, offset);
            const nul = bytes.indexOf(0, space + 1);
            if (space < offset || nul < space || nul + 1 + hashBytes > bytes.length) {
                this.add("UNREADABLE_OBJECT", path, true);
                return;
            }
            const mode = bytes.toString("ascii", offset, space);
            const name = bytes.toString("utf8", space + 1, nul);
            const location = `${path}/${name}`;
            this.text(name, "FORBIDDEN_PATH", location);
            if (mode === "120000")
                this.add("SYMLINK", location, true);
            else if (mode === "160000")
                this.add("SUBMODULE", location, true);
            else if (!["40000", "100644", "100755"].includes(mode))
                this.add("UNSUPPORTED_ENTRY", location, true);
            offset = nul + 1 + hashBytes;
        }
    }
    async gitStorage(root) {
        // Check metadata only, without following filesystem links in refs/pack/loose
        // objects. These are separate from tracked Git symlink entries in trees.
        const visit = async (path, depth) => {
            if (depth > this.limits.maxDepth)
                throw new AuditFailure("LIMIT_EXCEEDED");
            const stat = await lstat(path);
            if (stat.isSymbolicLink())
                throw new AuditFailure("SYMLINK");
            if (!stat.isDirectory()) {
                if (!stat.isFile())
                    throw new AuditFailure("UNSUPPORTED_ENTRY");
                return;
            }
            const directory = await opendir(path);
            for await (const entry of directory) {
                if (++this.entries > this.limits.maxFiles)
                    throw new AuditFailure("LIMIT_EXCEEDED");
                await visit(join(path, entry.name), depth + 1);
            }
        };
        await visit(root, 0);
    }
}
class AuditFailure extends Error {
    rule;
    constructor(rule) {
        super(rule);
        this.rule = rule;
    }
}
async function requirePlainPath(path) {
    const absolute = resolve(path);
    let current = parse(absolute).root;
    for (const component of absolute.slice(current.length).split(sep).filter(Boolean)) {
        current = join(current, component);
        if ((await lstat(current)).isSymbolicLink())
            throw new AuditFailure("SYMLINK");
    }
}
async function readRegularFile(path, maxBytes) {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
        const before = await handle.stat();
        if (!before.isFile())
            throw new AuditFailure("UNSUPPORTED_ENTRY");
        if (before.size > maxBytes)
            throw new AuditFailure("LIMIT_EXCEEDED");
        const buffer = Buffer.alloc(before.size + 1);
        let length = 0;
        while (length < buffer.length) {
            const read = await handle.read(buffer, length, buffer.length - length, null);
            if (!read.bytesRead)
                break;
            length += read.bytesRead;
        }
        const after = await handle.stat();
        if (length !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
            throw new AuditFailure("CHANGED_DURING_AUDIT");
        }
        return buffer.subarray(0, length);
    }
    finally {
        await handle.close();
    }
}
/** Fixed read-only Git verbs only. No shell, filters, hooks, credential prompts or lazy fetch. */
function runGit(root, args, limits, input) {
    return new Promise((accept, reject) => {
        const env = { ...process.env };
        for (const key of Object.keys(env))
            if (key.startsWith("GIT_"))
                delete env[key];
        Object.assign(env, { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
            GIT_OPTIONAL_LOCKS: "0", GIT_NO_LAZY_FETCH: "1", GIT_NO_REPLACE_OBJECTS: "1", GIT_TERMINAL_PROMPT: "0" });
        const child = spawn("git", ["--no-pager", "--no-replace-objects", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null",
            "-c", "protocol.allow=never", "-C", root, ...args], { env, stdio: ["pipe", "pipe", "pipe"], shell: false });
        const buffers = [];
        let size = 0;
        let errorOutput = false;
        let failure;
        const timeout = setTimeout(() => { failure = "LIMIT_EXCEEDED"; child.kill("SIGKILL"); }, limits.gitTimeoutMs);
        child.stdout.on("data", (chunk) => {
            size += chunk.length;
            if (size > limits.maxGitOutputBytes) {
                failure = "LIMIT_EXCEEDED";
                child.kill("SIGKILL");
            }
            else
                buffers.push(chunk);
        });
        child.stderr.on("data", () => { errorOutput = true; }); // Discard sensitive Git diagnostics.
        child.on("error", () => { clearTimeout(timeout); reject(new AuditFailure("UNREADABLE_OBJECT")); });
        child.stdin.on("error", () => { });
        child.on("close", (code) => {
            clearTimeout(timeout);
            const expectedMissing = code === 1 && ["config", "rev-parse"].includes(args[0]);
            if (failure || errorOutput || (code !== 0 && !expectedMissing))
                reject(new AuditFailure(failure ?? "UNREADABLE_OBJECT"));
            else
                accept({ output: Buffer.concat(buffers), code: code ?? -1 });
        });
        child.stdin.end(input);
    });
}
/**
 * Local acceptance audit, never a PII detector or a proof about unavailable remote history.
 * forbiddenFile is a private UTF8 JSON array of nonempty strings; it is never emitted.
 * checked counts fully read regular files / Git objects, not matches or decoded views.
 * Git locations are stable within this run: git/objects/<enumeration index>[/tree-entry].
 * No UUID patterns are banned: only the caller's explicit private values are matched.
 */
export async function auditPublication(options) {
    const invalid = () => ({ checked: 0, findings: [{ rule: "INVALID_INPUT", path: "." }], complete: false });
    if (!options || typeof options.forbiddenFile !== "string" || !options.forbiddenFile ||
        Number(typeof options.directory === "string" && !!options.directory) + Number(typeof options.git === "string" && !!options.git) !== 1)
        return invalid();
    const limits = { ...defaults, ...options.limits };
    if (Object.entries(limits).some(([key, value]) => !(key in defaults) || !Number.isSafeInteger(value) || value < (key === "maxDepth" ? 0 : 1)) || limits.maxDecodeCharsMultiplier > 1024)
        return invalid();
    let values;
    try {
        await requirePlainPath(options.forbiddenFile);
        values = JSON.parse((await readRegularFile(options.forbiddenFile, 1024 * 1024)).toString("utf8"));
    }
    catch {
        return invalid();
    }
    if (!Array.isArray(values) || !values.length || values.length > 1024 ||
        values.some((value) => typeof value !== "string" || !value.trim() || value.length > 4096))
        return invalid();
    const audit = new Audit(limits, [...new Set(values.map(normalize))]);
    try {
        if (options.directory)
            await audit.directory(resolve(options.directory));
        else
            await audit.git(resolve(options.git));
    }
    catch (error) {
        audit.add(error instanceof AuditFailure ? error.rule : "UNREADABLE_ENTRY", ".", true);
    }
    return audit.result;
}
