import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { type BuiltPage, buildSite } from "../src/build";
import { headingIds } from "../src/markdown";
import { PAGES } from "../src/pages";
import { REPO_BLOB_URL, REPO_ROOT, SITE_URL, SPEC_FILE } from "../src/paths";

const out = mkdtempSync(join(tmpdir(), "ogs-docs-"));
const built: BuiltPage[] = buildSite(out);
const read = (name: string) => readFileSync(resolve(out, name), "utf8");

/** Ids of every element in a built HTML page. */
const htmlIds = (html: string) => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
const hrefs = (html: string) => [...html.matchAll(/\shref="([^"]+)"/g)].map((m) => m[1] ?? "");
const mdLinks = (md: string) =>
  [...md.replace(/^\s*```[\s\S]*?^\s*```/gm, "").matchAll(/\]\(([^)\s]+)\)/g)].map(
    (m) => m[1] ?? "",
  );

/** The built file a site path is served from (Cloudflare Pages: `/x` → x.html). */
function servedFile(path: string): string | null {
  const clean = path === "/" ? "/index" : path;
  for (const candidate of [clean, `${clean}.html`]) {
    const file = resolve(out, `.${candidate}`);
    if (existsSync(file) && !file.endsWith(out)) return file;
  }
  return null;
}

describe("the docs site build", () => {
  it("renders every page", () => {
    expect(built.map((b) => b.page.slug)).toEqual(PAGES.map((p) => p.slug));
    expect(built.length).toBe(10); // 10 since 2026-10-18: Starter template
    for (const b of built) expect(b.title.length).toBeGreaterThan(0);
  });

  it("gives every page an HTML page and a Markdown twin", () => {
    for (const p of PAGES) {
      expect(existsSync(resolve(out, `${p.slug}.html`)), `${p.slug}.html`).toBe(true);
      const md = read(`${p.slug}.md`);
      expect(md.startsWith("# "), `${p.slug}.md starts with its title`).toBe(true);
      expect(read(`${p.slug}.html`)).toContain(`href="/${p.slug}.md"`);
    }
  });

  it("serves pages that read without JavaScript", () => {
    for (const p of PAGES) {
      const html = read(`${p.slug}.html`);
      expect(html).not.toMatch(/<script/i);
      expect(html).toMatch(/<article>[\s\S]*<h1 id=/);
    }
  });

  it("lists every page in llms.txt, in the llmstxt.org shape", () => {
    const llms = read("llms.txt");
    expect(llms).toMatch(/^# .+\n\n> .+/);
    for (const b of built)
      expect(llms).toContain(`- [${b.title}](${SITE_URL}/${b.page.slug}.md): `);
    expect(llms).toContain(`${SITE_URL}/llms-full.txt`);
  });

  it("puts every page, in order, into llms-full.txt", () => {
    const full = read("llms-full.txt");
    let at = 0;
    for (const b of built) {
      const i = full.indexOf(b.markdown.trim(), at);
      expect(i, `${b.page.slug} in llms-full.txt`).toBeGreaterThanOrEqual(at);
      at = i;
    }
  });

  it("renders the contract page from docs/specification.md, not a copy", () => {
    const spec = readFileSync(SPEC_FILE, "utf8");
    const contract = read("contract.md");
    const specHeadings = spec.match(/^## .+$/gm) ?? [];
    expect(specHeadings.length).toBeGreaterThan(5);
    for (const h of specHeadings) expect(contract).toContain(h);
    expect(contract).toContain("## 8. Joining and invites (planned)");
    expect(spec).toMatch(/^\*\*Rendered\*\* .*https:\/\/ogs-docs\.pages\.dev/m);
    expect(contract).not.toContain("**Rendered**");
    expect(existsSync(resolve(REPO_ROOT, "apps/docs/content/contract.md"))).toBe(false);
  });
});

describe("links", () => {
  const pageIds = new Map(built.map((b) => [b.page.slug, htmlIds(b.html)]));

  /** Checks one link from `from`; returns a problem or null. */
  function check(link: string, from: string): string | null {
    const [path = "", hash] = link.split("#");
    if (link.startsWith(`${REPO_BLOB_URL}/`)) {
      const file = resolve(REPO_ROOT, path.slice(REPO_BLOB_URL.length + 1));
      return existsSync(file) ? null : `${from}: ${link} (no such repo file)`;
    }
    if (link.startsWith(SITE_URL)) return check(link.slice(SITE_URL.length) || "/", from);
    if (/^(https?:|mailto:)/.test(link)) return null;
    if (link.startsWith("#")) return null; // same-page anchors are checked below
    if (!link.startsWith("/")) return `${from}: ${link} (relative link left in output)`;
    const file = servedFile(path);
    if (!file) return `${from}: ${link} (not in the site)`;
    if (hash) {
      const slug = file.slice(out.length + 1).replace(/\.(html|md)$/, "");
      const ids = file.endsWith(".md")
        ? new Set(headingIds(readFileSync(file, "utf8")))
        : pageIds.get(slug);
      if (!ids?.has(hash)) return `${from}: ${link} (no #${hash} on ${slug})`;
    }
    return null;
  }

  it("every link in the HTML pages resolves, anchors included", () => {
    const problems = built.flatMap((b) => {
      const ids = pageIds.get(b.page.slug);
      return hrefs(b.html).flatMap((h) => {
        if (h.startsWith("#"))
          return ids?.has(h.slice(1)) ? [] : [`${b.page.slug}: ${h} (no such anchor)`];
        const p = check(h, `${b.page.slug}.html`);
        return p ? [p] : [];
      });
    });
    expect(problems).toEqual([]);
  });

  it("every link in the Markdown twins and llms files resolves", () => {
    const sources = [
      ...built.map((b) => [`${b.page.slug}.md`, b.markdown] as const),
      ["llms.txt", read("llms.txt")] as const,
    ];
    const problems = sources.flatMap(([name, md]) =>
      mdLinks(md).flatMap((l) => {
        if (l.startsWith("#")) {
          return new Set(headingIds(md)).has(l.slice(1)) ? [] : [`${name}: ${l} (no such anchor)`];
        }
        const p = check(l, name);
        return p ? [p] : [];
      }),
    );
    expect(problems).toEqual([]);
  });

  it("the 404 page and stylesheet exist", () => {
    expect(existsSync(resolve(out, "404.html"))).toBe(true);
    expect(existsSync(resolve(out, "style.css"))).toBe(true);
    expect(read("_headers")).toContain("text/markdown");
  });
});

describe("the /on-tv landing page", () => {
  const html = read("on-tv.html");

  it("plays the 30 s couch video from the site", () => {
    expect(html).toContain('src="/media/couch-demo.mp4"');
    expect(existsSync(resolve(out, "media/couch-demo.mp4"))).toBe(true);
    expect(existsSync(resolve(out, "media/couch-demo.jpg"))).toBe(true);
  });

  it("gives the one-line prompt pointing at this site's llms.txt", () => {
    expect(html).toContain(`Make this game OGS-compatible: follow ${SITE_URL}/llms.txt`);
    expect(html).not.toContain("{{");
  });

  it("posts the waitlist form to the Worker even without JavaScript, carrying the UTM tags", () => {
    expect(html).toMatch(/<form class="join" method="post" action="\/api\/waitlist">/);
    for (const name of ["email", "building", "engine", "utm_source", "utm_medium", "utm_campaign", "ref", "website"])
      expect(html).toContain(`name="${name}"`);
  });

  it("links only to pages that exist", () => {
    for (const h of hrefs(html).filter((h) => h.startsWith("/") && !h.startsWith("//")))
      expect(servedFile(h.split("#")[0] ?? h), h).not.toBeNull();
  });
});
