import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function isMarkdownPath(path: string): boolean {
	return [".md", ".markdown", ".txt"].includes(extname(path).toLowerCase());
}

function isLatexPath(path: string): boolean {
	return extname(path).toLowerCase() === ".tex";
}

function wrapCodeAsMarkdown(source: string, filePath: string): string {
	const language = extname(filePath).replace(/^\./, "") || "text";
	return `# ${basename(filePath)}\n\n\`\`\`${language}\n${source}\n\`\`\`\n`;
}

export async function openWithDefaultApp(targetPath: string): Promise<void> {
	const target = pathToFileURL(targetPath).href;
	if (process.platform === "darwin") {
		await execFileAsync("open", [target]);
		return;
	}
	if (process.platform === "win32") {
		await execFileAsync("cmd", ["/c", "start", "", target]);
		return;
	}
	await execFileAsync("xdg-open", [target]);
}

async function runCommandWithInput(
	command: string,
	args: string[],
	input: string,
): Promise<{ stdout: string; stderr: string }> {
	return await new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];

		child.stdout.on("data", (chunk: Buffer | string) => {
			stdoutChunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
		});
		child.stderr.on("data", (chunk: Buffer | string) => {
			stderrChunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
		});

		child.once("error", reject);
		child.once("close", (code) => {
			const stdout = Buffer.concat(stdoutChunks).toString("utf8");
			const stderr = Buffer.concat(stderrChunks).toString("utf8");
			if (code === 0) {
				resolve({ stdout, stderr });
				return;
			}
			reject(new Error(`${command} failed with exit code ${code}${stderr ? `: ${stderr.trim()}` : ""}`));
		});

		child.stdin.end(input);
	});
}

export async function renderHtmlPreview(filePath: string): Promise<string> {
	const source = await readFile(filePath, "utf8");
	const pandocCommand = process.env.PANDOC_PATH?.trim() || "pandoc";
	const inputFormat = isLatexPath(filePath)
		? "latex"
		: "markdown+lists_without_preceding_blankline+tex_math_dollars+autolink_bare_uris-raw_html";
	const markdown = isLatexPath(filePath) || isMarkdownPath(filePath) ? source : wrapCodeAsMarkdown(source, filePath);
	const args = ["-f", inputFormat, "-t", "html5", "--mathml", "--wrap=none", `--resource-path=${dirname(filePath)}`];
	const { stdout } = await runCommandWithInput(pandocCommand, args, markdown);
	const html = `<!doctype html><html><head><meta charset="utf-8" /><base href="${pathToFileURL(dirname(filePath) + "/").href}" /><title>${basename(filePath)}</title><style>
:root{
  --bg:#faf7f2;
  --paper:#fffdf9;
  --border:#d7cec1;
  --text:#1f1c18;
  --muted:#6c645a;
  --code:#f3eee6;
  --link:#0f6d8c;
  --quote:#8b7f70;
}
@media (prefers-color-scheme: dark){
  :root{
    --bg:#161311;
    --paper:#1d1916;
    --border:#3b342d;
    --text:#ebe3d6;
    --muted:#b4ab9f;
    --code:#221d19;
    --link:#8ac6d6;
    --quote:#a89d8f;
  }
}
body{
  font-family:Charter,"Iowan Old Style","Palatino Linotype","Book Antiqua",Palatino,Georgia,serif;
  margin:0;
  background:var(--bg);
  color:var(--text);
  line-height:1.7;
}
main{
  max-width:900px;
  margin:2rem auto 4rem;
  padding:2.5rem 3rem;
  background:var(--paper);
  border:1px solid var(--border);
  border-radius:18px;
  box-shadow:0 12px 40px rgba(0,0,0,.06);
}
h1,h2,h3,h4,h5,h6{
  font-family:"Helvetica Neue",Helvetica,Arial,sans-serif;
  line-height:1.2;
  margin-top:1.5em;
}
h1{font-size:2.2rem;border-bottom:1px solid var(--border);padding-bottom:.35rem;}
h2{font-size:1.6rem;border-bottom:1px solid var(--border);padding-bottom:.25rem;}
p,ul,ol,blockquote,table{margin:1rem 0;}
pre,code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
pre{
  background:var(--code);
  border:1px solid var(--border);
  border-radius:12px;
  padding:1rem 1.1rem;
  overflow:auto;
}
code{
  background:var(--code);
  padding:.12rem .28rem;
  border-radius:6px;
}
a{color:var(--link);text-decoration:none}
a:hover{text-decoration:underline}
img{max-width:100%}
blockquote{
  border-left:4px solid var(--border);
  padding-left:1rem;
  color:var(--quote);
}
table{border-collapse:collapse;width:100%}
th,td{border:1px solid var(--border);padding:.55rem .7rem;text-align:left}
</style></head><body><main>${stdout}</main></body></html>`;
	const tempDir = await mkdtemp(join(tmpdir(), "feynman-preview-"));
	const htmlPath = join(tempDir, `${basename(filePath)}.html`);
	await writeFile(htmlPath, html, "utf8");
	return htmlPath;
}

export async function renderPdfPreview(filePath: string): Promise<string> {
	const source = await readFile(filePath, "utf8");
	const pandocCommand = process.env.PANDOC_PATH?.trim() || "pandoc";
	const pdfEngine = process.env.PANDOC_PDF_ENGINE?.trim() || "xelatex";
	const inputFormat = isLatexPath(filePath)
		? "latex"
		: "markdown+lists_without_preceding_blankline+tex_math_dollars+autolink_bare_uris-raw_html";
	const markdown = isLatexPath(filePath) || isMarkdownPath(filePath) ? source : wrapCodeAsMarkdown(source, filePath);
	const tempDir = await mkdtemp(join(tmpdir(), "feynman-preview-"));
	const pdfPath = join(tempDir, `${basename(filePath)}.pdf`);
	const args = [
		"-f",
		inputFormat,
		"-o",
		pdfPath,
		`--pdf-engine=${pdfEngine}`,
		`--resource-path=${dirname(filePath)}`,
	];
	await runCommandWithInput(pandocCommand, args, markdown);
	return pdfPath;
}

export async function pathExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}
