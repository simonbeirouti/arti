import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import {
  loadCatalogue,
  publicCatalogue,
  validateCatalogue,
} from "../../src/catalog";
import { renderKnowledge } from "./render";

const styles = `:root{font-family:'Avenir Next','Segoe UI',sans-serif;color:#24362e;background:#f6f7f2;line-height:1.7}*{box-sizing:border-box}body{margin:0}a{color:inherit}header{display:flex;align-items:center;justify-content:space-between;background:#192e28;color:#cbd8c9;padding:24px max(24px,calc((100% - 1000px)/2));font-size:12px;gap:20px}.brand{font-size:32px;font-weight:700;text-decoration:none;letter-spacing:-2px;color:#d2e2b3}main{max-width:1000px;margin:52px auto;padding:0 24px}h1{font-size:46px;letter-spacing:-2px;line-height:1.2;margin:10px 0 20px}h2{font-size:27px;letter-spacing:-.7px}h3,h4{margin-top:28px}.eyebrow{font-size:11px;letter-spacing:1.3px;text-transform:uppercase;color:#7c8d76}.intro,.source{color:#748078}.notice{background:#edf0e5;border:1px solid #e0e6d6;border-radius:6px;padding:18px 22px;font-size:13px;margin:30px 0}label{display:block;font-size:13px;margin-bottom:8px}input{width:100%;font:inherit;padding:13px 16px;background:#fcfdf9;border:1px solid #d4ddca;border-radius:6px;color:#24362e;outline-offset:4px}#search-status{font-size:12px;color:#748078}.capabilities{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;list-style:none;padding:0;margin:30px 0}.capabilities li{padding:20px;border:1px solid #e1e5db;background:#fcfdf9;border-radius:6px;font-size:13px}.capabilities span{display:block;color:#748078;font-size:11px;margin-top:6px}.guide{padding:30px;margin:20px 0;background:#fcfdf9;border:1px solid #e1e5db;border-radius:8px;overflow-wrap:anywhere}.guide p{font-size:14px}.source{font-size:11px!important}code{font-size:12px}pre{overflow:auto;background:#edf0e5;padding:18px;border-radius:6px}footer{max-width:1000px;margin:auto;padding:25px;color:#748078;font-size:11px;border-top:1px solid #e1e5db}[hidden]{display:none!important}@media(max-width:600px){header span{font-size:10px}main{margin-top:32px}h1{font-size:35px}.guide{padding:22px}.capabilities{grid-template-columns:1fr}}`;

const search = `const input=document.getElementById('guide-search');const status=document.getElementById('search-status');const empty=document.getElementById('no-results');const guides=[...document.querySelectorAll('[data-search]')];input.addEventListener('input',()=>{const query=input.value.trim().toLowerCase();let count=0;for(const guide of guides){guide.hidden=!guide.dataset.search.includes(query);if(!guide.hidden)count+=1;}status.textContent=count+' public guides';empty.hidden=count!==0;});`;

export async function buildPublicKnowledge(
  root: string,
  output: string,
): Promise<void> {
  const catalogue = await loadCatalogue(root);
  await validateCatalogue(root, catalogue);
  const publicData = publicCatalogue(catalogue);
  await mkdir(output, { recursive: true });
  await Promise.all([
    writeFile(join(output, "index.html"), renderKnowledge(publicData)),
    writeFile(join(output, "styles.css"), styles),
    writeFile(join(output, "search.js"), search),
    writeFile(join(output, "catalog.json"), JSON.stringify(publicData)),
  ]);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(import.meta.filename)
) {
  const root = resolve(import.meta.dirname, "../../../..");
  await buildPublicKnowledge(root, resolve(root, "apps/knowledge/dist"));
  console.log("Public knowledge built from canonical catalogue sources.");
}
