#pragma once

static const char * TTS_WEB_UI = R"HTML(<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>BKG Qwen TTS</title>
<style>
:root{color-scheme:dark;--bg:#0b1020;--panel:#151c31;--line:#2d3858;--text:#eef2ff;--muted:#a8b2cc;--accent:#70a5ff;--bad:#ff7b86}
*{box-sizing:border-box}body{margin:0;background:linear-gradient(135deg,#080c18,#111831);color:var(--text);font:16px system-ui,sans-serif}
main{max-width:920px;margin:auto;padding:28px}.card{background:rgba(21,28,49,.96);border:1px solid var(--line);border-radius:18px;padding:22px;box-shadow:0 18px 50px #0006}
h1{margin:0 0 5px;font-size:28px}.sub{color:var(--muted);margin:0 0 22px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
label{display:block;font-weight:650;margin:0 0 7px}textarea,input,select{width:100%;border:1px solid var(--line);border-radius:10px;background:#0c1326;color:var(--text);padding:11px;font:inherit}
textarea{min-height:150px;resize:vertical}.wide{grid-column:1/-1}.row{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:18px}
button{border:0;border-radius:10px;padding:12px 18px;background:var(--accent);color:#07101f;font-weight:800;cursor:pointer}button:disabled{opacity:.55;cursor:wait}
.secondary{background:#293451;color:var(--text)}audio{width:100%;margin-top:18px}.status{color:var(--muted);min-height:24px}.error{color:var(--bad)}
small{color:var(--muted)}@media(max-width:680px){.grid{grid-template-columns:1fr}.wide{grid-column:auto}main{padding:14px}}
</style>
</head>
<body><main><section class="card">
<h1>BKG Qwen TTS</h1><p class="sub">Lokale Sprachsynthese über Qwen3-TTS, direkt aus dem C++-Server.</p>
<div class="grid">
<div class="wide"><label for="text">Text</label><textarea id="text">Dies ist ein Test der direkten Qwen TTS Weboberfläche.</textarea></div>
<div><label for="voice">Stimme</label><select id="voice"><option>vivian</option></select></div>
<div><label for="language">Sprache</label><select id="language"><option value="auto">Automatisch</option><option value="German">Deutsch</option><option value="English">Englisch</option><option value="French">Französisch</option><option value="Spanish">Spanisch</option><option value="Italian">Italienisch</option><option value="Japanese">Japanisch</option><option value="Korean">Koreanisch</option><option value="Chinese">Chinesisch</option></select></div>
<div><label for="emotion">Emotion</label><select id="emotion"><option value="">Neutral</option><option value="friendly and warm">Freundlich</option><option value="happy and energetic">Fröhlich</option><option value="sad and subdued">Traurig</option><option value="angry and intense">Wütend</option><option value="whispering softly">Flüsternd</option><option value="dramatic and cinematic">Dramatisch</option><option value="calm and reassuring">Ruhig</option></select></div>
<div><label for="style">Freie Stil-Anweisung</label><input id="style" placeholder="z. B. langsam, warm, nachdenklich"></div>
<div><label for="temperature">Temperatur</label><input id="temperature" type="number" min="0" max="2" step="0.05" value="0.9"></div>
<div><label for="topP">Top P</label><input id="topP" type="number" min="0.01" max="1" step="0.01" value="1"></div>
<div><label for="topK">Top K</label><input id="topK" type="number" min="0" step="1" value="50"></div>
<div><label for="repeat">Wiederholungsstrafe</label><input id="repeat" type="number" min="0.1" step="0.01" value="1.05"></div>
<div><label for="seed">Seed</label><input id="seed" type="number" value="42"></div>
<div><label for="format">Ausgabe</label><select id="format"><option value="wav">WAV-Datei</option><option value="pcm">PCM-Stream</option></select></div>
</div>
<div class="row"><button id="generate">Sprache erzeugen</button><button id="refresh" class="secondary">Stimmen neu laden</button><span id="status" class="status"></span></div>
<audio id="player" controls></audio>
<small>API: <code>/v1/audio/speech</code> · Health: <code>/health</code></small>
</section></main>
<script>
const $=id=>document.getElementById(id);let currentUrl=null;
function setStatus(text,error=false){const el=$("status");el.textContent=text;el.className=error?"status error":"status"}
async function loadVoices(){try{const r=await fetch('/v1/voices');if(!r.ok)throw new Error(await r.text());const d=await r.json();const s=$("voice");s.innerHTML='';for(const v of d.voices||[]){const o=document.createElement('option');o.value=v.name;o.textContent=v.name+(v.kind==='registered'?' (Klon)':'');s.appendChild(o)}if(!s.options.length)s.innerHTML='<option value="vivian">vivian</option>';setStatus('Stimmen geladen')}catch(e){setStatus('Stimmen konnten nicht geladen werden: '+e.message,true)}}
async function generate(){const b=$("generate");b.disabled=true;setStatus('Erzeuge Audio …');try{const instructions=[$("emotion").value,$("style").value].filter(Boolean).join(', ');const body={input:$("text").value,voice:$("voice").value,instructions,response_format:$("format").value,temperature:Number($("temperature").value),top_p:Number($("topP").value),top_k:Number($("topK").value),repetition_penalty:Number($("repeat").value),seed:Number($("seed").value)};const r=await fetch('/v1/audio/speech',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw new Error(await r.text());const blob=await r.blob();if(currentUrl)URL.revokeObjectURL(currentUrl);currentUrl=URL.createObjectURL(blob);const p=$("player");p.src=currentUrl;await p.play().catch(()=>{});setStatus(`Fertig: ${Math.round(blob.size/1024)} KiB`)}catch(e){setStatus('Fehler: '+e.message,true)}finally{b.disabled=false}}
$("generate").addEventListener('click',generate);$("refresh").addEventListener('click',loadVoices);loadVoices();
</script></body></html>)HTML";
